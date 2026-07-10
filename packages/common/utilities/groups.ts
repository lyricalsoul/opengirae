// splits a flat list into rows of the given sizes (in order); any leftover items form one final row
export function groups<T>(items: T[], sizes: number[]): T[][] {
  const rows: T[][] = []
  let i = 0
  for (const size of sizes) {
    if (i >= items.length) break
    rows.push(items.slice(i, i + size))
    i += size
  }
  if (i < items.length) rows.push(items.slice(i))
  return rows
}
