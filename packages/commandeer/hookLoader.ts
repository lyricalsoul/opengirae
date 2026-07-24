import { info, error } from "@girae/common/logger";
import { readdirSync } from "fs"
import { join } from "path"
import type { HookEventMap, HookEventName } from "@girae/common/hooks/types"
import type { Platform } from "@girae/common/commands/types"

const hookPath = join(__dirname, "hooks")

const loadedHookModules = await Promise.all(readdirSync(hookPath).map(async (file) => {
  const module = await import(join(hookPath, file))
  return module.default as { hooks?: Record<string, string> } & Record<string, any>
}))

info("commandeer", `Loaded ${loadedHookModules.length} hook modules`)

const handlersByEvent = new Map<string, Array<(event: any) => Promise<void>>>()
for (const mod of loadedHookModules) {
  if (!mod?.hooks) continue
  for (const [eventName, methodName] of Object.entries(mod.hooks)) {
    const handlers = handlersByEvent.get(eventName) ?? []
    handlers.push(mod[methodName].bind(mod))
    handlersByEvent.set(eventName, handlers)
  }
}

// Fires every registered listener for `eventName` in parallel - a listener that throws
// is logged and swallowed, same reasoning as settleReply(): one broken hook shouldn't
// take down the command that emitted it.
export async function emitHook<E extends HookEventName>(eventName: E, payload: HookEventMap[E]): Promise<void> {
  const handlers = handlersByEvent.get(eventName) ?? []
  await Promise.all(handlers.map(handler =>
    handler(payload).catch(e => error("commandeer", `hook '${eventName}' handler failed: ${e}`))
  ))
}

// Convenience for the three card-granting call sites (/girar, /girarauto, /trade):
// emits one 'cards:new' event per distinct card gained in a single draw/trade.
export async function emitCardsNew(
  userId: number, telegramId: string, displayName: string, platform: Platform,
  crossings: Array<{ cardId: number; previousCount: number; newCount: number }>,
): Promise<void> {
  for (const c of crossings) {
    await emitHook('cards:new', { userId, cardId: c.cardId, previousCount: c.previousCount, newCount: c.newCount, telegramId, displayName, platform })
  }
}
