import type { MarkdownIt as MarkdownItType, Token } from 'markdown-it'
import type { BundledLanguage, Highlighter } from 'shiki'

// Shiki 高亮的语言加载与降级策略。
//
// 为什么需要这一层：
// T05 实测，@shikijs/markdown-it@4.5.0 在遇到未加载的语言时会抛异常
// （ShikiError: Language 'x' not found），而这个异常发生在 markdown-it 的
// fence 渲染回调里，会中断整篇文档的渲染。这与 FR-011（局部失败不得拖垮全文）
// 直接冲突。
//
// 因此必须在调用 Shiki 之前判断语言是否已加载：
// - 已加载 → 正常高亮
// - 未加载 → 记录语言名，返回空串，让 markdown-it 回退到纯文本渲染
//
// 同时异步加载该语言，使「同一个未知语言第二次出现」时能正常高亮。
//
// 实测陷阱：highlighter.loadLanguage() 对不存在于 bundle 的语言会同步抛错
// （ShikiError: Language 'x' is not included in this bundle），而不是返回
// rejected promise。所以 void promise.catch(...) 接不住它，
// 必须把调用本身包在 try/catch 里。

// 首批预载语言，与 docs/design/01-render-pipeline.md §3.2 的 COMMON_LANGS 对齐。
export const COMMON_LANGS: readonly BundledLanguage[] = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'jsx',
  'kotlin',
  'lua',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'toml',
  'tsx',
  'typescript',
  'xml',
  'yaml',
] as const

export interface HighlightContext {
  highlighter: Highlighter
  themeLight: string
  themeDark: string
  // 本次渲染中遇到的未加载语言（去重后由调用方汇总进 ParseResult）
  unknownLangs: Set<string>
  // 语言别名（js → javascript）
  aliases?: Readonly<Record<string, string>>
}

const DEFAULT_ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  kt: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  'c#': 'csharp',
  text: 'plaintext',
  txt: 'plaintext',
}

function resolveLang(raw: string, aliases: Readonly<Record<string, string>>): string {
  const lower = raw.toLowerCase()
  return aliases[lower] ?? lower
}

// 构造一个安全的 highlight 回调。
//
// 关键约束：本函数绝不抛异常。任何内部错误都退化为纯文本输出，
// 保证单块失败不影响整篇（FR-011）。
export function createHighlightFn(ctx: HighlightContext) {
  const aliases = ctx.aliases ?? DEFAULT_ALIASES
  const loaded = new Set<string>(ctx.highlighter.getLoadedLanguages() as string[])
  // 已经尝试过且确认不存在的语言，避免每次渲染都重试
  const permanentlyUnknown = new Set<string>()

  return (code: string, info: string): string => {
    const raw = info.trim().split(/\s+/)[0]
    if (!raw) return ''
    // mermaid 由 augment 规则改写为占位 div，不走高亮
    if (raw.toLowerCase() === 'mermaid') return ''

    const lang = resolveLang(raw, aliases)

    if (!loaded.has(lang)) {
      ctx.unknownLangs.add(raw)

      if (!permanentlyUnknown.has(lang)) {
        try {
          // loadLanguage 在语言不在 bundle 内时同步抛错，必须就地捕获
          const result = ctx.highlighter.loadLanguage(lang as BundledLanguage)
          if (result && typeof (result as Promise<void>).catch === 'function') {
            void (result as Promise<void>)
              .then(() => {
                loaded.add(lang)
              })
              .catch(() => {
                permanentlyUnknown.add(lang)
              })
          } else {
            loaded.add(lang)
          }
        } catch {
          // 同步抛错 = 该语言确实不存在于 bundle
          permanentlyUnknown.add(lang)
        }
      }

      // 返回空串 → 调用方的 fence renderer 会走纯文本分支
      return ''
    }

    try {
      return ctx.highlighter.codeToHtml(code, {
        lang,
        themes: { light: ctx.themeLight, dark: ctx.themeDark },
        defaultColor: false,
      })
    } catch {
      // 高亮本身失败（语法过于异常等）→ 纯文本，绝不让异常冒泡
      return ''
    }
  }
}

// 把安全高亮函数接到 markdown-it 的 fence 渲染规则上。
//
// 不用 @shikijs/markdown-it 插件的默认行为，原因是：
// - 插件默认对未知语言抛错，与 FR-011 冲突；
// - 它把 defaultColor 等选项固化，不便按文档切换主题。
//
// 代价：自己接管 fence 渲染，需自行处理 pre 包装与转义。
export function installHighlighter(md: MarkdownItType, ctx: HighlightContext): void {
  const highlight = createHighlightFn(ctx)

  md.renderer.rules.fence = (tokens: Token[], idx: number): string => {
    const token = tokens[idx]
    if (!token) return ''

    const raw = token.info.trim().split(/\s+/)[0]
    const lang = raw ? resolveLang(raw, DEFAULT_ALIASES) : undefined

    // mermaid：T06 的 augment 规则会把它改成占位 div；此处先退化为代码块
    if (lang === 'mermaid') {
      const escaped = md.utils.escapeHtml(token.content)
      return `<pre class="md-code md-code--mermaid"><code class="language-mermaid">${escaped}</code></pre>\n`
    }

    const highlighted = highlight(token.content, token.info)

    if (highlighted) {
      // Shiki 已产出完整 pre，直接使用
      return `${highlighted}\n`
    }

    // 降级：纯文本代码块
    const escaped = md.utils.escapeHtml(token.content)
    const langAttr = raw ? ` class="language-${md.utils.escapeHtml(raw)}"` : ''
    return `<pre class="md-code md-code--plain"><code${langAttr}>${escaped}</code></pre>\n`
  }
}
