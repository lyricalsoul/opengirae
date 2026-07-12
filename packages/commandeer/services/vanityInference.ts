import Groq from "groq-sdk"
import { error } from "@girae/common/logger"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b"

export interface InferredVanityData {
  title: string
  description: string
  price: number | null
}

const TYPE_LABEL = { background: "papel de parede de perfil", sticker: "sticker de perfil" } as const

export async function inferVanityData(hint: string, type: "background" | "sticker"): Promise<InferredVanityData | null> {
  const system = `Você cria o nome e a descrição de um ${TYPE_LABEL[type]} para a loja de um bot de colecionáveis, a partir de uma frase curta dada pelo staff.

Responda SOMENTE com um objeto JSON no formato:
{"title": string, "description": string, "price": number | null}

- "title": um nome curto e direto para o item (ex.: "AZEALIA BANKS : BROKE WITH EXPANSIVE TASTE (P&B)"). Mantenha o estilo do que foi dado, só corrija capitalização/digitação óbvias.
- "description": uma frase curta, simples e objetiva em português descrevendo o item (ex.: "Banner de Azealia Banks na era BROKE WITH EXPANSIVE TASTE"). Uma frase só, direta, sem enrolação e sem emojis.
- "price": se um preço em moedas for mencionado no texto (de qualquer forma, ex.: "por 5000", "5k moedas", "custa 20.000"), extraia o valor numérico. Caso contrário, null. Nunca invente um preço.`

  const completion = await groq.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    reasoning_effort: "none",
    temperature: 0.3,
    max_tokens: 200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: hint },
    ],
  }).catch((e) => {
    error("vanityInference", `groq request failed: ${e}`)
    return null
  })

  const content = completion?.choices?.[0]?.message?.content
  if (!content) return null

  try {
    return JSON.parse(content) as InferredVanityData
  } catch (e) {
    error("vanityInference", `failed to parse groq response: ${e}`)
    return null
  }
}
