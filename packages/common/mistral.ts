import { Mistral } from "@mistralai/mistralai"
import { MistralError } from "@mistralai/mistralai/models/errors"
import type { ChatCompletionRequestMessage, ChatCompletionRequestTool, ChatCompletionResponse } from "@mistralai/mistralai/models/components"
import { error, warn } from "./logger"

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY })
const MODEL = process.env.MISTRAL_MODEL || "mistral-small-latest"

export interface AiMessage { role: "user" | "assistant"; content: string }

const MAX_ATTEMPTS = 4
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function callWithRetry(
  request: Parameters<typeof client.chat.complete>[0],
  logTag: string,
): Promise<ChatCompletionResponse | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client.chat.complete(request).catch((e) => {
      const retryable = e instanceof MistralError && RETRYABLE_STATUS.has(e.statusCode)
      if (retryable && attempt < MAX_ATTEMPTS) {
        warn(logTag, `mistral request failed (attempt ${attempt}/${MAX_ATTEMPTS}, retrying): ${e}`)
        return undefined
      }
      error(logTag, `mistral request failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e}`)
      return null
    })

    if (response !== undefined) return response
    await sleep(500 * 2 ** (attempt - 1))
  }
  return null
}

function parseJsonResponse<T>(response: ChatCompletionResponse | null, logTag: string): T | null {
  const content = response?.choices[0]?.message?.content
  const text = typeof content === "string" ? content : undefined
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch (e) {
    error(logTag, `failed to parse mistral response: ${e}`)
    return null
  }
}

export async function generateJson<T>(opts: {
  logTag: string
  system: string
  messages: AiMessage[]
  responseSchema: object
  temperature?: number
  maxOutputTokens?: number
}): Promise<T | null> {
  const response = await callWithRetry({
    model: MODEL,
    messages: [{ role: "system", content: opts.system }, ...opts.messages],
    responseFormat: {
      type: "json_schema",
      jsonSchema: { name: "result", schemaDefinition: opts.responseSchema, strict: true },
    },
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxOutputTokens,
  }, opts.logTag)
  return parseJsonResponse<T>(response, opts.logTag)
}

export interface ToolDef {
  declaration: { name: string; description: string; parameters: object }
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

export async function generateJsonWithTools<T>(opts: {
  logTag: string
  system: string
  messages: AiMessage[]
  tools: ToolDef[]
  responseSchema: object
  temperature?: number
  maxOutputTokens?: number
  maxToolRounds?: number
}): Promise<T | null> {
  const messages: ChatCompletionRequestMessage[] = [
    { role: "system", content: opts.system },
    ...opts.messages,
  ]
  const tools: ChatCompletionRequestTool[] = opts.tools.map(t => ({
    type: "function",
    function: t.declaration,
  }))
  const toolsByName = new Map(opts.tools.map(t => [t.declaration.name, t]))
  const maxToolRounds = opts.maxToolRounds ?? 3

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await callWithRetry({
      model: MODEL,
      messages,
      tools,
      toolChoice: "auto",
      temperature: opts.temperature ?? 0.3,
    }, opts.logTag)
    if (!response) return null

    const message = response.choices[0]?.message
    const calls = message?.toolCalls
    if (!calls?.length) break

    messages.push({ role: "assistant", content: message?.content ?? "", toolCalls: calls })
    const results = await Promise.all(calls.map(async (c) => {
      const rawArgs = c.function.arguments
      const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs
      const result = await (toolsByName.get(c.function.name)?.execute(args ?? {}) ?? Promise.resolve({ error: "unknown tool" }))
      return { toolCallId: c.id, name: c.function.name, content: JSON.stringify(result) }
    }))
    for (const r of results) {
      messages.push({ role: "tool", content: r.content, toolCallId: r.toolCallId, name: r.name })
    }
  }

  messages.push({ role: "user", content: "Com base em tudo que você já determinou, responda agora apenas com o JSON final no formato pedido." })

  const finalResponse = await callWithRetry({
    model: MODEL,
    messages,
    responseFormat: {
      type: "json_schema",
      jsonSchema: { name: "result", schemaDefinition: opts.responseSchema, strict: true },
    },
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxOutputTokens,
  }, opts.logTag)
  return parseJsonResponse<T>(finalResponse, opts.logTag)
}
