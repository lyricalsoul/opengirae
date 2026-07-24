import type { HookEventName } from './types'

// registers a static method as a listener for `eventName`, collected by hookLoader.ts.
export function Hook(eventName: HookEventName) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    if (!target.hooks) target.hooks = {}
    target.hooks[eventName] = propertyKey
  }
}
