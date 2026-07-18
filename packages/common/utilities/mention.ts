import type { Platform } from '../commands/types'
import { escapeMarkdown } from './markdown'

export function mention(platform: Platform, userId: string, name: string): string {
  if (platform === 'discord') return `<@${userId}>`
  return `[${escapeMarkdown(name)}](tg://user?id=${userId})`
}
