import { GoogleGenAI, ApiError, Type } from "@google/genai"
import { error, warn } from "./logger"

export { Type }

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest"

export interface AiMessage { role: "user" | "model"; content: string }

const MAX_ATTEMPTS = 4
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function generateJson<T>(opts: {
  logTag: string
  system: string
  messages: AiMessage[]
  responseSchema: object
  temperature?: number
  maxOutputTokens?: number
}): Promise<T | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: opts.messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseSchema: opts.responseSchema,
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxOutputTokens,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }).catch((e) => {
      const retryable = e instanceof ApiError && RETRYABLE_STATUS.has(e.status)
      if (retryable && attempt < MAX_ATTEMPTS) {
        warn(opts.logTag, `gemini request failed (attempt ${attempt}/${MAX_ATTEMPTS}, retrying): ${e}`)
        return undefined
      }
      error(opts.logTag, `gemini request failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${e}`)
      return null
    })

    if (response === null) return null
    if (response === undefined) {
      await sleep(500 * 2 ** (attempt - 1))
      continue
    }

    if (!response.text) {
      if (attempt === MAX_ATTEMPTS) return null
      continue
    }

    try {
      return JSON.parse(response.text) as T
    } catch (e) {
      error(opts.logTag, `failed to parse gemini response: ${e}`)
      return null
    }
  }
  return null
}
