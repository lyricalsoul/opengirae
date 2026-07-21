import { generateJson, generateJsonWithTools, type ToolDef } from "@girae/common/mistral"
import { debug } from "@girae/common/logger"
import { CardsDB } from "@girae/database/cards"

export interface CategoryRow { id: number; name: string }

export interface InferredCardData {
  name: string
  category: string
  subcategory: string
  rarity: string
  tags: string[]
  error?: string
}

type RawInference = InferredCardData & { reasoning?: string }

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "Música": "artistas e bandas ocidentais (não-asiáticas), qualquer gênero.",
  "GIRÁSIA": "artistas e bandas orientais - grupos e solistas de K-pop, J-pop, C-pop, etc.",
  "Animangá": "personagens de mangá, livros e anime - não só japoneses. O livro em si (o título) vai em \"Livros\"; aqui vão apenas os personagens.",
  "TV": "personagens e coisas de filmes, séries de TV ou outras produções televisivas, ocidentais ou não.",
  "Jogos": "personagens e coisas de jogos eletrônicos.",
  "Variedades": "qualquer coisa que não se encaixe nas outras categorias - políticos, influencers digitais, atletas, participantes de reality show, etc.",
  "Livros": "livros de verdade (o título em si, não seus personagens - personagens vão em \"Animangá\"). Cobre principalmente manhwas.",
  "Memes": "principalmente figuras de memes brasileiros (ex.: Agatha Nunes, Patrícia Pires) - só os memes em si; a pessoa em si (o card dela) vai em \"Variedades\".",
}

const FEW_SHOT: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "seulgi, Lendário" },
  { role: "assistant", content: JSON.stringify({ reasoning: "Seulgi é integrante do Red Velvet, grupo de K-pop sul-coreano - vai em GIRÁSIA, não Música.", name: "Seulgi", category: "GIRÁSIA", subcategory: "Red Velvet", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "BoA, solista, Lendário" },
  { role: "assistant", content: JSON.stringify({ reasoning: "BoA é uma artista solo sul-coreana de K-pop, sem grupo.", name: "BoA", category: "GIRÁSIA", subcategory: "Solistas de K-Pop", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "Ariana grande, Lendário" },
  { role: "assistant", content: JSON.stringify({ reasoning: "Ariana Grande é uma artista de pop/R&B dos EUA, não asiática.", name: "Ariana Grande", category: "Música", subcategory: "Artistas de Pop/R&B", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "shinji ikari, Raro" },
  { role: "assistant", content: JSON.stringify({ reasoning: "Shinji Ikari é personagem do anime Neon Genesis Evangelion.", name: "Shinji Ikari", category: "Animangá", subcategory: "Neon Genesis Evangelion", rarity: "Raro", tags: [] }) },
  { role: "user", content: "steve, comum" },
  { role: "assistant", content: JSON.stringify({ reasoning: "Steve é o personagem padrão do jogo Minecraft.", name: "Steve", category: "Jogos", subcategory: "Minecraft", rarity: "Comum", tags: [] }) },
  { role: "user", content: "van der woodsen, gossip girl, Lendário" },
  { role: "assistant", content: JSON.stringify({ reasoning: "Serena van der Woodsen é personagem da série de TV Gossip Girl.", name: "Serena van der Woodsen", category: "TV", subcategory: "Gossip Girl", rarity: "Lendário", tags: [] }) },
  { role: "user", content: "philza, qsmp" },
  { role: "assistant", content: JSON.stringify({ reasoning: "Philza é um streamer de jogos; QSMP é o projeto de streamers em que participa.", name: "Philza", category: "Variedades", subcategory: "Streamers de Jogos", rarity: "Comum", tags: ["QSMP"] }) },
]

function getSubcategoriesTool(categories: CategoryRow[]): ToolDef {
  return {
    declaration: {
      name: "get_subcategories",
      description: "Retorna as subcategorias já existentes dentro de uma categoria, para reutilizar uma em vez de inventar uma nova.",
      parameters: {
        type: "object",
        properties: { category: { type: "string", description: "Nome exato da categoria." } },
        required: ["category"],
      },
    },
    execute: async (args) => {
      const category = categories.find(c => c.name.toLowerCase() === String(args.category).toLowerCase())
      if (!category) return { subcategories: [] } // brand-new category being proposed - nothing to reuse yet
      const subs = await CardsDB.getSubcategoriesForCategory(category.id)
      return { subcategories: subs.map(s => s.name) }
    },
  }
}

export async function inferCardData(
  text: string,
  categories: CategoryRow[],
  knownRarities: string[],
  nameHint?: string,
  subcategoryHint?: string,
): Promise<InferredCardData | null> {
  const system = `Você extrai metadados de cards colecionáveis (personagens, artistas, ídolos, celebridades) de mensagens em texto livre para um bot de colecionáveis abrangente - não é só K-pop, cobre música de qualquer origem, animes/mangás, jogos, TV/filmes, ídolos asiáticos e variedades (streamers, influencers, atores, política, memes, etc.).

Responda SOMENTE com um objeto JSON no formato:
{"reasoning": string, "name": string, "category": string, "subcategory": string, "rarity": string, "tags": string[], "error": string | null}

- "reasoning": uma frase curta em português explicando por que você escolheu essa categoria/subcategoria. Nunca deixe vazio.
- "name": nome do personagem/artista/ídolo na carta. Corrija erros de digitação e capitalização (ex.: "shinji ikari" -> "Shinji Ikari").
- "category": o domínio geral do card. Escolha exatamente uma destas categorias já existentes:
${categories.map(c => `  - "${c.name}"${CATEGORY_DESCRIPTIONS[c.name] ? `: ${CATEGORY_DESCRIPTIONS[c.name]}` : ''}`).join('\n') || '  (nenhuma categoria cadastrada ainda)'}
- "subcategory": a subdivisão específica dentro da categoria escolhida. Depois de decidir "category", chame a ferramenta get_subcategories com o nome exato dessa categoria para ver quais subcategorias já existem nela. Se alguma delas corresponder de verdade ao personagem/artista (corrigindo só erros óbvios de digitação/capitalização), reutilize-a - NUNCA crie uma subcategoria nova só porque o texto original usa palavras um pouco diferentes (ex.: "Artistas de C-Pop" no texto deve virar a subcategoria já existente "Solistas de C-Pop" se essa for a que já existe). Só proponha uma subcategoria genuinamente nova se nenhuma das existentes servir. Exemplos do tipo de valor esperado por categoria:
  - Música: gênero do artista (ex.: "Artistas de Pop", "Artistas de Rock", "Artistas de Sertanejo").
  - GIRÁSIA: o grupo (ex.: "Red Velvet", "BTS") ou "Solistas de K-Pop"/"Solistas de J-Pop"/"Solistas de C-Pop" para artistas solo.
  - Animangá: o nome do anime/mangá (ex.: "Neon Genesis Evangelion", "Naruto").
  - Jogos: o nome do jogo (ex.: "Minecraft", "The Witcher", "Fortnite").
  - TV: o nome da série/novela/filme (ex.: "Gossip Girl", "Avenida Brasil").
  - Variedades: uma descrição curta em português (ex.: "Streamers de Jogos", "Influencers Digitais", "Atrizes de Dorama", "BBB", "Política Brasileira").
  - Livros: o nome do livro/manhwa (ex.: "Solo Leveling").
  - Memes: uma descrição curta do meme/figura (ex.: "Memes Brasileiros").
  Se não for possível identificar nada, use "Geral".
- "rarity": escolha exatamente uma destas: ${knownRarities.join(", ")}. Primeiro procure por uma palavra explícita de raridade no texto (em português; Bronze refere-se a Comum, Prata a Raro, Ouro a Lendário). Se não houver nenhuma palavra explícita, avalie a popularidade/relevância do personagem/artista dentro da subcategoria escolhida - quão central ele é à obra ou grupo, seu impacto cultural, o quanto é reconhecido pelo público em geral - e escolha uma raridade proporcional: protagonistas, membros centrais e figuras muito populares tendem a raridades mais altas; personagens secundários ou figuras obscuras, mais baixas. Na dúvida mesmo assim, prefira a raridade mais comum da lista.
- "tags": subcategorias secundárias relevantes, use RARAMENTE - na grande maioria dos casos deve ser um array vazio, só preencha quando houver algo genuinamente relevante além do óbvio (ex.: um grupo relacionado, uma era específica). NUNCA inclua o nome do personagem/artista ("name"), a "subcategory" ou a "category" como tag. Exemplos de tag: para Ariana Grande, "Atrizes de TV" (subcategoria principal é "Artistas de Pop"). Para jogadores de um time, seria o nome do Time.
- "error": se o texto não contiver informação suficiente para identificar o personagem/artista, explique brevemente em português; caso contrário null.${nameHint ? `

O nome deste card já foi identificado com certeza: "${nameHint}". Ainda assim, retorne "name" no JSON normalmente - será ignorado e substituído por esse valor já conhecido.` : ''}`

  const responseSchema = {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      name: { type: "string" },
      category: { type: "string" },
      subcategory: { type: "string" },
      rarity: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      error: { type: ["string", "null"] },
    },
    required: ["reasoning", "name", "category", "subcategory", "rarity", "tags", "error"],
  }

  const userTurn = subcategoryHint ? `${text}\n\n(Subcategoria conforme o texto original: "${subcategoryHint}" - use como sinal forte, mas confirme com get_subcategories antes de decidir.)` : text

  const parsed = await generateJsonWithTools<RawInference>({
    logTag: "cardInference",
    system,
    messages: [...FEW_SHOT, { role: "user", content: userTurn }],
    tools: [getSubcategoriesTool(categories)],
    responseSchema,
    maxOutputTokens: 500,
  })
  if (!parsed) return null

  const { reasoning, tags, subcategory, ...rest } = parsed
  if (reasoning) debug("cardInference", reasoning)

  const name = nameHint ?? rest.name

  const blocked = [subcategory, rest.category, name].map(v => v?.toLowerCase())
  return {
    ...rest,
    name,
    subcategory,
    tags: (tags ?? []).filter(t => !blocked.includes(t.toLowerCase())),
  }
}

// Used only for the 📚 header emoji, which covers both Animangá and Jogos.
export async function resolveAmbiguousCategory(subcategoryName: string): Promise<"Animangá" | "Jogos"> {
  const result = await generateJson<{ category: "Animangá" | "Jogos" }>({
    logTag: "cardInference",
    system: `Você decide se uma subcategoria de cards colecionáveis é "Animangá" (personagens de anime/mangá) ou "Jogos" (personagens de jogos eletrônicos). Responda apenas com o JSON pedido.`,
    messages: [{ role: "user", content: subcategoryName }],
    responseSchema: {
      type: "object",
      properties: { category: { type: "string", enum: ["Animangá", "Jogos"] } },
      required: ["category"],
    },
    maxOutputTokens: 50,
  })
  return result?.category ?? "Animangá"
}

const RARITY_FEW_SHOT: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "Subcategoria: Harry Potter. Item: Colin Creevey" },
  { role: "assistant", content: JSON.stringify({ rarity: "Comum" }) },
  { role: "user", content: "Subcategoria: Naruto. Item: Naruto Uzumaki" },
  { role: "assistant", content: JSON.stringify({ rarity: "Lendário" }) },
  { role: "user", content: "Subcategoria: Naruto. Item: Iruka Umino" },
  { role: "assistant", content: JSON.stringify({ rarity: "Comum" }) },
  { role: "user", content: "Subcategoria: Animais. Item: Leão" },
  { role: "assistant", content: JSON.stringify({ rarity: "Lendário" }) },
  { role: "user", content: "Subcategoria: Animais. Item: Toupeira-nariz-de-estrela" },
  { role: "assistant", content: JSON.stringify({ rarity: "Comum" }) },
]

// Used once category/subcategory are already known - only rarity still needs judgment.
export async function inferRarityOnly(name: string, subcategoryName: string, knownRarities: string[]): Promise<string | null> {
  const system = `Você escolhe a raridade de um card colecionável. Escolha exatamente uma destas: ${knownRarities.join(", ")}. Primeiro procure por uma palavra explícita de raridade no texto (em português; Bronze refere-se a Comum, Prata a Raro, Ouro a Lendário).

Se não houver palavra explícita, julgue comparando este item com TODOS os outros itens do assunto "${subcategoryName}" que você conhece - não apenas os que já foram cadastrados, já que a maioria ainda nem existe no sistema. A subcategoria pode ser qualquer tipo de assunto: uma obra de ficção (filme, anime, jogo), um grupo de pessoas/artistas, uma categoria de coisas do mundo real (animais, objetos, lugares, etc.) - adapte o julgamento ao tipo de assunto. A raridade é relativa ao conjunto completo desse assunto, não uma escala absoluta:
- O item mais central, icônico ou representativo do assunto é sempre a raridade mais alta disponível (ex.: o protagonista de uma obra, ou o animal/exemplo mais famoso e reconhecível de um grupo), mesmo que outro item pareça mais "marcante" isoladamente.
- Itens conhecidos mas secundários dentro do mesmo assunto ficam no meio.
- Itens obscuros, raros ou pouco conhecidos dentro do mesmo assunto ficam nas raridades mais baixas - mesmo que sejam visualmente vistosos, isso não os torna centrais ao assunto.
- Julgue pela relevância DENTRO do assunto específico da subcategoria, nunca por quão marcante ou "cool" o item parece à primeira vista.

Na dúvida mesmo assim, prefira a raridade mais comum da lista. Responda apenas com o JSON pedido.`

  const result = await generateJson<{ rarity: string }>({
    logTag: "cardInference",
    system,
    messages: [...RARITY_FEW_SHOT, { role: "user", content: `Subcategoria: ${subcategoryName}. Item: ${name}` }],
    responseSchema: {
      type: "object",
      properties: { rarity: { type: "string", enum: knownRarities } },
      required: ["rarity"],
    },
    maxOutputTokens: 50,
  })
  return result?.rarity ?? null
}
