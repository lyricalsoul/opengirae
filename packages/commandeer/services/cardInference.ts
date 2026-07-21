import { generateJson, Type } from "@girae/common/gemini"
import { debug } from "@girae/common/logger"

export interface InferredCardData {
  name: string
  category: string
  subcategory: string
  rarity: string
  tags: string[]
  error?: string
}

type RawInference = InferredCardData & { reasoning?: string }

const FEW_SHOT: Array<{ role: "user" | "model"; content: string }> = [
  { role: "user", content: "seulgi, Lendário" },
  { role: "model", content: JSON.stringify({ reasoning: "Seulgi é integrante do Red Velvet, grupo de K-pop sul-coreano.", name: "Seulgi", category: "Música", subcategory: "Red Velvet", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "BoA, solista, Lendário" },
  { role: "model", content: JSON.stringify({ reasoning: "BoA é uma artista solo sul-coreana de K-pop, sem grupo.", name: "BoA", category: "Música", subcategory: "Solistas de K-Pop", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "Ariana grande, Lendário" },
  { role: "model", content: JSON.stringify({ reasoning: "Ariana Grande é uma artista de pop/R&B dos EUA, não asiática.", name: "Ariana Grande", category: "Música", subcategory: "Artistas de Pop/R&B", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "shinji ikari, Raro" },
  { role: "model", content: JSON.stringify({ reasoning: "Shinji Ikari é personagem do anime Neon Genesis Evangelion.", name: "Shinji Ikari", category: "Animangá", subcategory: "Neon Genesis Evangelion", rarity: "Raro", tags: [] }) },
  { role: "user", content: "steve, comum" },
  { role: "model", content: JSON.stringify({ reasoning: "Steve é o personagem padrão do jogo Minecraft.", name: "Steve", category: "Jogos", subcategory: "Minecraft", rarity: "Comum", tags: [] }) },
  { role: "user", content: "van der woodsen, gossip girl, Lendário" },
  { role: "model", content: JSON.stringify({ reasoning: "Serena van der Woodsen é personagem da série de TV Gossip Girl.", name: "Serena van der Woodsen", category: "TV", subcategory: "Gossip Girl", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "philza, qsmp" },
  { role: "model", content: JSON.stringify({ reasoning: "Philza é um streamer de jogos; QSMP é o projeto de streamers em que participa.", name: "Philza", category: "Variedades", subcategory: "Streamers de Jogos", rarity: "Comum", tags: ["QSMP"] }) },
]

export async function inferCardData(
  text: string,
  knownCategories: string[],
  knownRarities: string[],
  knownMusicaSubcategories: string[] = [],
  nameHint?: string,
  subcategoryHint?: string,
): Promise<InferredCardData | null> {
  const system = `Você extrai metadados de cards colecionáveis (personagens, artistas, ídolos, celebridades) de mensagens em texto livre para um bot de colecionáveis abrangente - não é só K-pop, cobre música de qualquer origem, animes/mangás, jogos, TV/filmes, ídolos asiáticos e variedades (streamers, influencers, atores, política, memes, etc.).

Responda SOMENTE com um objeto JSON no formato:
{"reasoning": string, "name": string, "category": string, "subcategory": string, "rarity": string, "tags": string[], "error": string | null}

- "reasoning": uma frase curta em português explicando por que você escolheu essa categoria/subcategoria. Nunca deixe vazio.
- "name": nome do personagem/artista/ídolo na carta. Corrija erros de digitação e capitalização (ex.: "shinji ikari" -> "Shinji Ikari").
- "category": o domínio geral do card. Categorias já existentes: ${knownCategories.join(", ") || "nenhuma ainda"} - reutilize uma existente sempre que fizer sentido. Se nenhuma existente servir, escolha um destes domínios:
  - "Música": artistas musicais que NÃO são de origem asiática (qualquer gênero: pop, rock, sertanejo, funk, MPB, etc.).
  - "Animangá": personagens de anime, mangá ou outras artes visuais japonesas.
  - "Jogos": personagens de jogos eletrônicos.
  - "TV": personagens de séries, novelas ou filmes.
  - "Música": ídolos e artistas musicais de origem asiática (K-pop, J-pop, C-pop, etc.), em grupo ou solo.
  - "Variedades": qualquer coisa que não se encaixe acima - streamers, influencers digitais, participantes de reality show, atores/atrizes de dorama, política, memes, etc.
- "subcategory": a subdivisão específica dentro da categoria. Corrija erros de digitação. Exemplos por categoria:
  - Música: o gênero do artista (ex.: "Artistas de Pop", "Artistas de Rock", "Artistas de Sertanejo", "Artistas de MPB", "Artistas de Funk").
  - Animangá: o nome do anime/mangá (ex.: "Neon Genesis Evangelion", "Naruto").
  - Jogos: o nome do jogo (ex.: "Minecraft", "The Witcher", "Fortnite").
  - TV: o nome da série/novela/filme (ex.: "Gossip Girl", "Avenida Brasil").
  - Música: o nome do grupo (ex.: "Red Velvet", "BTS", "NewJeans"), ou "Solistas de K-Pop"/"Solistas de J-Pop"/"Solistas de C-Pop" para artistas solo. Subcategorias já existentes em Música: ${knownMusicaSubcategories.join(", ") || "nenhuma ainda"}. Se a categoria escolhida for "Música", "subcategory" DEVE ser uma dessas já existentes - nunca invente uma nova.
  - Variedades: uma descrição curta em português (ex.: "Streamers de Jogos", "Influencers Digitais", "Atrizes de Dorama", "BBB", "Memes", "Política Brasileira").
  Se não for possível identificar nada, use "Geral".
- "rarity": escolha exatamente uma destas: ${knownRarities.join(", ")}. Primeiro procure por uma palavra explícita de raridade no texto (em português; Bronze refere-se a Comum, Prata a Raro, Ouro a Lendário). Se não houver nenhuma palavra explícita, avalie a popularidade/relevância do personagem/artista dentro da subcategoria escolhida - quão central ele é à obra ou grupo, seu impacto cultural, o quanto é reconhecido pelo público em geral - e escolha uma raridade proporcional: protagonistas, membros centrais e figuras muito populares tendem a raridades mais altas; personagens secundários ou figuras obscuras, mais baixas. Na dúvida mesmo assim, prefira a raridade mais comum da lista.
- "tags": subcategorias secundárias relevantes, use RARAMENTE - na grande maioria dos casos deve ser um array vazio, só preencha quando houver algo genuinamente relevante além do óbvio (ex.: um grupo relacionado, uma era específica). NUNCA inclua o nome do personagem/artista ("name"), a "subcategory" ou a "category" como tag. Exemplos de tag: para Ariana Grande, "Atrizes de TV" (subcategoria principal é "Artistas de Pop"). Para jogadores de um time, seria o nome do Time.
- "error": se o texto não contiver informação suficiente para identificar o personagem/artista, explique brevemente em português; caso contrário null.${nameHint && subcategoryHint ? `

O nome e a subcategoria deste card já foram identificados com certeza: nome "${nameHint}", subcategoria "${subcategoryHint}". Ainda assim, retorne "name" e "subcategory" no JSON normalmente - eles serão ignorados e substituídos por esses valores já conhecidos. Use-os como contexto confiável para determinar "category", "rarity" e "tags".` : ''}`

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      reasoning: { type: Type.STRING },
      name: { type: Type.STRING },
      category: { type: Type.STRING },
      subcategory: { type: Type.STRING },
      rarity: { type: Type.STRING },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      error: { type: Type.STRING, nullable: true },
    },
    required: ["reasoning", "name", "category", "subcategory", "rarity", "tags"],
  }

  const parsed = await generateJson<RawInference>({
    logTag: "cardInference",
    system,
    messages: [...FEW_SHOT, { role: "user", content: text }],
    responseSchema,
    maxOutputTokens: 500,
  })
  if (!parsed) return null

  const { reasoning, tags, subcategory, ...rest } = parsed
  if (reasoning) debug("cardInference", reasoning)
  
  const name = nameHint ?? rest.name
  const finalSubcategory = subcategoryHint ?? subcategory

  const blocked = [finalSubcategory, rest.category, name].map(v => v?.toLowerCase())
  return {
    ...rest,
    name,
    subcategory: finalSubcategory,
    tags: (tags ?? []).filter(t => !blocked.includes(t.toLowerCase())),
  }
}
