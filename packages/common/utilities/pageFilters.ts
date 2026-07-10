export interface FilterDef<T> {
  id: string
  emoji: string
  description: string
  match: (item: T) => boolean
}

export function parseFilterArg(arg: string): { active: string[], rest: string } {
  const sep = arg.indexOf(':')
  if (sep === -1) return { active: [], rest: arg }
  return { active: arg.slice(0, sep).split('').filter(Boolean), rest: arg.slice(sep + 1) }
}

export function buildFilterArg(active: string[], rest: string): string {
  return `${active.join('')}:${rest}`
}

export function toggleFilterArg(arg: string, id: string): string {
  const { active, rest } = parseFilterArg(arg)
  const next = active.includes(id) ? active.filter(a => a !== id) : [...active, id]
  return buildFilterArg(next, rest)
}

export function applyFilters<T>(items: T[], defs: FilterDef<T>[], active: string[]): T[] {
  const activeDefs = defs.filter(d => active.includes(d.id))
  if (activeDefs.length === 0) return items
  return items.filter(item => activeDefs.every(d => d.match(item)))
}

export function filterAdviceText<T>(defs: FilterDef<T>[], active: string[], resultCount: number, noun: string): string {
  const activeDefs = defs.filter(d => active.includes(d.id))
  if (activeDefs.length === 0) return ''

  const descs = activeDefs.map(d => d.description)
  const joined = descs.length === 1 ? descs[0] : `${descs.slice(0, -1).join(', ')} e ${descs.slice(-1)}`
  return `🔎 Mostrando apenas ${noun} **${joined}** (\`${resultCount}\` resultados)\n`
}

export function filterButtonsRow<T>(defs: FilterDef<T>[], active: string[], rest: string, page: number = 0) {
  return defs.map(d => ({
    text: active.includes(d.id) ? '✅' : d.emoji,
    arg: buildFilterArg(active.includes(d.id) ? active.filter(a => a !== d.id) : [...active, d.id], rest),
    page,
  }))
}
