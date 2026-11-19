import { listen } from '@tauri-apps/api/event'
import { isMock } from './index'
import { mockOn } from './mockBridge'

export async function onHostEvent<T>(name: string, handler: (payload: T) => void): Promise<() => void> {
  if (isMock) return mockOn(name, (payload) => handler(payload as T))
  return listen<T>(name, (event) => handler(event.payload))
}
