import { generateJson } from "@girae/common/mistral"

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

  return generateJson<InferredVanityData>({
    logTag: "vanityInference",
    system,
    messages: [{ role: "user", content: hint }],
    responseSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        price: { type: ["number", "null"] },
      },
      required: ["title", "description", "price"],
    },
    maxOutputTokens: 200,
  })
}
