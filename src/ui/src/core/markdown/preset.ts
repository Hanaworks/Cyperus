import type { MarkdownItOptions, MarkdownIt as MarkdownItType } from 'markdown-it'
import MarkdownIt from 'markdown-it'

// markdown-it 基础配置。
//
// 使用 default preset 而不是 commonmark（T05 实测结论）：
// commonmark preset 的规则集是硬编码子集，不含 table / strikethrough，
// 并且在它下面 linkify 选项不生效 —— 与 FR-003 的 GFM 要求冲突。
//
// 实测对照（markdown-it@15.0.3）：
//   commonmark: table=false strike=false linkify=false rawHtml=true
//   default:    table=true  strike=true  linkify=true  rawHtml=true
//
// 详见 docs/design/01-render-pipeline.md §2 与 findings-plugin-compat.md §2.6。

export const MARKDOWN_IT_OPTIONS: MarkdownItOptions = {
  html: true, // 原始 HTML 放行，由 DOMPurify 按需消毒（06-security.md）
  xhtmlOut: false,
  breaks: false, // 不做「单换行 = 硬换行」，保持 CommonMark 换行语义
  langPrefix: 'language-',
  linkify: true,
  typographer: false, // 关闭智能引号，避免破坏中文排版与代码片段
  quotes: '“”‘’',
  maxNesting: 100,
}

// 本项目使用的 preset 名称（见上方说明，必须是 default）。
export const PRESET = 'default' as const

// 创建渲染管线使用的基础 MarkdownIt 实例（尚未挂载插件）。
// 每个文档渲染前不要重复创建实例：markdown-it 实例可复用，
// 插件挂载由 core/markdown/index.ts 的单例负责。
export function createMarkdownIt(options: MarkdownItOptions = MARKDOWN_IT_OPTIONS): MarkdownItType {
  return new MarkdownIt(PRESET, options)
}

// 链接校验：在 markdown-it 默认白名单之上再加一层显式限制。
//
// markdown-it 默认已拦截 javascript: / vbscript: / file:，
// 并只允许部分 data:image/*。这里额外禁止 data:image/svg+xml
// （SVG 可内嵌脚本，属于 NFR-006 的禁止项）。
//
// 这是第一道防线；第二道是 DOMPurify（T25），第三道是 Rust 的 url_policy。
export function installLinkValidator(md: MarkdownItType): void {
  md.validateLink = (url: string): boolean => {
    const s = url.trim()
    const lower = s.toLowerCase()

    if (lower === '') return false
    if (lower.startsWith('javascript:')) return false
    if (lower.startsWith('vbscript:')) return false
    if (lower.startsWith('file:')) return false

    if (lower.startsWith('data:')) {
      // 只允许位图，明确排除 svg+xml（可含脚本）
      return /^data:image\/(png|jpe?g|gif|webp);/i.test(lower)
    }

    return true
  }
}
