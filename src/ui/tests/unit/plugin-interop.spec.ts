import { expect, it } from 'vitest'
import { resolvePlugin } from '@/core/markdown/pluginInterop'

it('兼容直接函数与 Vite Worker 中的 CommonJS default 包装', () => {
  const plugin = () => undefined
  expect(resolvePlugin(plugin)).toBe(plugin)
  expect(resolvePlugin({ default: plugin })).toBe(plugin)
  expect(resolvePlugin({ default: { default: plugin } })).toBe(plugin)
  expect(() => resolvePlugin({ default: {} })).toThrow('Markdown 插件')
})
