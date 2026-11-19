import { describe, expect, it } from 'vitest'
import { createWindowBridge, type NativeWindowHandle } from '../../src/core/ipc/windowBridge'

function nativeWindow() {
  const calls: string[] = []
  let maximized = false
  let resized: (() => void) | undefined
  let removed = 0
  const handle: NativeWindowHandle = {
    async minimize() { calls.push('minimize') },
    async toggleMaximize() { maximized = !maximized; calls.push('toggleMaximize'); resized?.() },
    async close() { calls.push('close') },
    async isMaximized() { return maximized },
    async onResized(callback) { resized = callback; return () => { removed += 1; resized = undefined } },
  }
  return { handle, calls, resize: () => resized?.(), removed: () => removed }
}

async function settled() { for (let index = 0; index < 12; index += 1) await Promise.resolve() }

describe('native window controls', () => {
  it('runs the actual native actions and observes maximize changes until disposed', async () => {
    const native = nativeWindow()
    const bridge = createWindowBridge(native.handle)
    const states: boolean[] = []
    const errors: unknown[] = []
    const dispose = bridge.watchMaximized((state) => states.push(state), (error) => errors.push(error))
    await settled()
    expect(bridge.available).toBe(true)
    expect(states).toEqual([false])
    await bridge.minimize()
    await bridge.toggleMaximize()
    await settled()
    await bridge.close()
    expect(native.calls).toEqual(['minimize', 'toggleMaximize', 'close'])
    expect(states).toEqual([false, true])
    dispose()
    dispose()
    native.resize()
    await settled()
    expect(native.removed()).toBe(1)
    expect(states).toEqual([false, true])
    expect(errors).toEqual([])
  })

  it('removes a listener that resolves after its owner unmounts', async () => {
    const native = nativeWindow()
    let attach: ((stop: () => void) => void) | undefined
    let removed = false
    native.handle.onResized = () => new Promise((resolve) => { attach = resolve })
    const states: boolean[] = []
    const dispose = createWindowBridge(native.handle).watchMaximized((value) => states.push(value), () => undefined)
    await settled()
    dispose()
    attach?.(() => { removed = true })
    await settled()
    expect(removed).toBe(true)
    expect(states).toEqual([])
  })

  it('reports native query and registration failures while preserving action rejections', async () => {
    const native = nativeWindow()
    const failure = new Error('native unavailable')
    native.handle.isMaximized = async () => { throw failure }
    native.handle.close = async () => { throw failure }
    const errors: unknown[] = []
    const bridge = createWindowBridge(native.handle)
    const dispose = bridge.watchMaximized(() => undefined, (error) => errors.push(error))
    await settled()
    expect(errors).toEqual([failure])
    await expect(bridge.close()).rejects.toBe(failure)
    dispose()
    expect(native.removed()).toBe(1)
    native.handle.onResized = async () => { throw failure }
    const stop = bridge.watchMaximized(() => undefined, (error) => errors.push(error))
    await settled()
    expect(errors).toEqual([failure, failure])
    stop()
  })

  it('suppresses a pending query result and failure after disposal', async () => {
    const native = nativeWindow()
    let fail: ((error: Error) => void) | undefined
    native.handle.isMaximized = () => new Promise((_resolve, reject) => { fail = reject })
    const errors: unknown[] = []
    const states: boolean[] = []
    const dispose = createWindowBridge(native.handle).watchMaximized((state) => states.push(state), (error) => errors.push(error))
    await settled()
    dispose()
    fail?.(new Error('late native error'))
    await settled()
    expect(errors).toEqual([])
    expect(states).toEqual([])
  })

  it('exposes unavailable controls in a browser without pretending to act', async () => {
    const bridge = createWindowBridge(null)
    expect(bridge.available).toBe(false)
    await expect(bridge.minimize()).rejects.toThrow('桌面应用')
    await expect(bridge.toggleMaximize()).rejects.toThrow('桌面应用')
    await expect(bridge.close()).rejects.toThrow('桌面应用')
    expect(() => bridge.watchMaximized(() => undefined, () => undefined)()).not.toThrow()
  })
})
