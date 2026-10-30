import type { Env, MarkdownIt, Token } from 'markdown-it'

// markdown-it 类型别名。
//
// markdown-it@15 同时导出类型的 MarkdownIt 与值的 MarkdownItCallable（默认导出）。
// 由于 tsconfig 启用了 verbatimModuleSyntax，必须用 import type 拿类型、
// 用默认导入拿构造器。这里集中一次，避免每个文件都写两条 import。
export type { Env as MdEnv, MarkdownIt, Token as MdToken }

// renderer 规则签名，与 markdown-it@15 的 RendererRule 对齐。
// 用宽松签名是为了避免依赖 Required<MarkdownItOptions> 的具体形状。
export type RendererRule = (
  tokens: Token[],
  idx: number,
  options: Readonly<Record<string, unknown>>,
  env: Env | undefined,
  renderer: unknown,
) => string

// 供需要显式标注实例类型的地方使用。
export type MarkdownItInstance = MarkdownIt
