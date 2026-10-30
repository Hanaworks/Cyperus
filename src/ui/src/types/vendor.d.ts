// 第三方无类型包的本地声明。
//
// `markdown-it-footnote@4.0.0` 不附带 TypeScript 声明，且
// `@types/markdown-it-footnote` 未随 markdown-it@15 更新（仍约束旧的
// `markdown-it/lib/*` 内部路径）。这里给出最小可用的本地声明，
// 只声明我们实际使用的形状（`PluginSimple`）。
//
// 若将来官方提供类型，删除本文件并改为依赖官方包。

declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it'

  const footnote: PluginSimple
  export default footnote
}
