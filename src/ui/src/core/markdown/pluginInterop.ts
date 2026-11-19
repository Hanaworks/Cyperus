/** CJS 插件在 Node 与 Vite Worker 中可能有不同层数的 default 包装。 */
export function resolvePlugin<T>(plugin: T): T {
  let value: unknown = plugin
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof value === 'function') return value as T
    if (!value || typeof value !== 'object' || !('default' in value)) break
    value = value.default
  }
  throw new Error('Markdown 插件初始化失败')
}
