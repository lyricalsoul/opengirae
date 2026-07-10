// markdown escaping for telegram mainly
export function escapeMarkdown(text: string): string {
  return text.replace(/[&<>*_`[\]\\]/g, (c) => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      default: return `\\${c}`
    }
  })
}
