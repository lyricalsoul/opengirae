import type { HookEventName } from './types'

// Registers a static method as a listener for `eventName`, collected by
// packages/commandeer/hookLoader.ts the same way @QuickView/@Page register onto
// their host class - one listener method per event per class; multiple hook files
// (or classes) can each listen to the same event, aggregated at load time.
export function Hook(eventName: HookEventName) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.hooks) target.hooks = {}
    target.hooks[eventName] = propertyKey
  }
}
