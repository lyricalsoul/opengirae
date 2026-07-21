// Lowercases and strips diacritics so name lookups match regardless of accents ("musica" -> "Música")
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
