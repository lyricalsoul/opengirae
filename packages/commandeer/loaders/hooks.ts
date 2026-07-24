import { join } from "path"
import { error } from "@girae/common/logger"
import type { HookEventMap, HookEventName } from "@girae/common/hooks/types"
import type { Platform } from "@girae/common/commands/types"
import { Loadable } from "./base"

class HooksLoader extends Loadable {
  protected readonly label = "hook modules"

  private handlersByEvent = new Map<string, Array<(event: any) => Promise<void>>>()

  async init(): Promise<void> {
    const entries = await this.importAll(join(__dirname, "..", "hooks"))

    for (const { module } of entries) {
      const mod = module as { hooks?: Record<string, string> } & Record<string, any>
      if (!mod?.hooks) continue
      for (const [eventName, methodName] of Object.entries(mod.hooks)) {
        const handlers = this.handlersByEvent.get(eventName) ?? []
        handlers.push(mod[methodName].bind(mod))
        this.handlersByEvent.set(eventName, handlers)
      }
    }

    this.logLoaded(entries.length)
  }

  // a throwing listener is logged and swallowed - one broken hook shouldn't take down the emitter.
  async emit<E extends HookEventName>(eventName: E, payload: HookEventMap[E]): Promise<void> {
    const handlers = this.handlersByEvent.get(eventName) ?? []
    await Promise.all(handlers.map(handler =>
      handler(payload).catch(e => error("commandeer", `hook '${eventName}' handler failed: ${e}`))
    ))
  }
}

export const hooksLoader = new HooksLoader()
await hooksLoader.init()

export const emitHook = hooksLoader.emit.bind(hooksLoader)

// emits one 'cards:new' event per distinct card gained in a single draw/trade.
export async function emitCardsNew(
  userId: number, telegramId: string, displayName: string, platform: Platform,
  crossings: Array<{ cardId: number; previousCount: number; newCount: number }>,
): Promise<void> {
  for (const c of crossings) {
    await emitHook('cards:new', { userId, cardId: c.cardId, previousCount: c.previousCount, newCount: c.newCount, telegramId, displayName, platform })
  }
}
