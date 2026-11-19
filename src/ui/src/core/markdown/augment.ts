import type { Env, MarkdownIt, Token } from 'markdown-it'
import type { BlockEntry } from '../render/contract'

export interface MarkdownRenderEnv extends Env {
  blocks?: BlockEntry[]
  mermaidCount?: number
  hasRawHtml?: boolean
}

function visitTokens(tokens: readonly Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token)
    if (token.children) visitTokens(token.children, visit)
  }
}

function isMermaid(token: Token): boolean {
  return token.type === 'fence' && token.info.trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid'
}

function sourceBlockTag(token: Token, mermaid: boolean): string | undefined {
  if (token.type === 'fence' || token.type === 'code_block') {
    return mermaid && isMermaid(token) ? 'div' : 'pre'
  }
  if (token.type === 'math_block') return 'p'
  if (token.nesting === 1 || token.type === 'hr') return token.tag
  return undefined
}

function encodeCode(code: string): string {
  // Worker 原生 API；逐字节拼接避免大图表展开参数造成 RangeError。
  const bytes = new TextEncoder().encode(code)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** 安装到插件链最后；所有统计都属于单次 parse，允许调用方复用 env。 */
export function installAugmentRules(md: MarkdownIt, options: { mermaid: boolean }): void {
  md.core.ruler.push('augment_00_env', (state) => {
    const env: MarkdownRenderEnv = state.env
    env.blocks = []
    env.mermaidCount = 0
    env.hasRawHtml = false
    // 必须早于 Mermaid 改写；任务列表使用专用 token，不冒充作者 HTML。
    visitTokens(state.tokens, (token) => {
      if (token.type === 'html_block' || token.type === 'html_inline') env.hasRawHtml = true
      // github-alerts 在 inline 解析前提取标题，绕过 markdown-it 的 HTML 开关。
      // 关闭 HTML 时按文本转义；开启时，标题里的作者标签也必须要求消毒。
      if (token.type === 'alert_open') {
        const title = String(token.meta?.title ?? '')
        if (!state.md.options.html) {
          token.meta = { ...token.meta, title: md.utils.escapeHtml(title) }
        } else if (title.includes('<')) {
          env.hasRawHtml = true
        }
      }
    })
  })

  md.core.ruler.push('augment_10_blocks', (state) => {
    const env: MarkdownRenderEnv = state.env
    for (const token of state.tokens) {
      if (token.level !== 0 || !token.map || token.hidden) continue
      const tag = sourceBlockTag(token, options.mermaid)
      if (tag === undefined) continue

      const line = token.map[0] + 1
      const endLine = token.map[1]
      token.attrSet('data-src-line', String(line))
      token.attrSet('data-src-end', String(endLine))
      env.blocks?.push({ line, endLine, tag })
    }
  })

  md.core.ruler.push('augment_20_mermaid', (state) => {
    if (!options.mermaid) return
    const env: MarkdownRenderEnv = state.env
    visitTokens(state.tokens, (token) => {
      if (!isMermaid(token)) return
      const number = (env.mermaidCount ?? 0) + 1
      env.mermaidCount = number
      token.type = 'md_mermaid'
      token.tag = 'div'
      token.attrJoin('class', 'md-mermaid')
      token.attrSet('data-mermaid-id', `md-mermaid-${number}`)
      token.attrSet('data-code', encodeCode(token.content))
    })
  })

  md.renderer.rules.md_mermaid = (tokens, index, _options, _env, renderer) => {
    const token = tokens[index]
    return token ? `<div${renderer.renderAttrs(token)}></div>\n` : ''
  }

  md.core.ruler.push('augment_30_inline', (state) => {
    visitTokens(state.tokens, (token) => {
      if (token.type === 'link_open' && /^(?:https?:\/\/|mailto:)/i.test(String(token.attrGet('href') ?? ''))) {
        token.attrSet('rel', 'noopener noreferrer')
        token.attrSet('data-md-external', '1')
      }
      if (token.type === 'image') {
        token.attrSet('loading', 'lazy')
        token.attrSet('decoding', 'async')
        token.attrSet('data-md-image', '1')
      }
    })
  })

  // 默认 fence 把 token attrs 放在 code；Alert、KaTeX 忽略 attrs。
  // 只修正这些已知 renderer 的外层容器，代码文本始终由原 renderer 转义。
  for (const [rule, tag] of [['fence', 'pre'], ['code_block', 'pre'], ['alert_open', 'div'], ['math_block', 'p']] as const) {
    const render = md.renderer.rules[rule]
    if (!render) continue
    md.renderer.rules[rule] = (tokens, index, renderOptions, env, renderer) => {
      let html = render(tokens, index, renderOptions, env, renderer)
      const token = tokens[index]
      if (!token?.attrGet('data-src-line')) return html
      if (rule === 'fence') {
        html = html.replace(/<code\b[^>]*>/, (code) => code.replace(/\sdata-src-(?:line|end)="[^"]*"/g, ''))
      }
      return html.replace(new RegExp(`<${tag}\\b[^>]*>`), (opening) => {
        let attrs = ''
        for (const name of ['data-src-line', 'data-src-end']) {
          const value = token.attrGet(name)
          if (value !== null && !opening.includes(` ${name}=`)) {
            attrs += ` ${name}="${md.utils.escapeHtml(String(value))}"`
          }
        }
        return `${opening.slice(0, -1)}${attrs}>`
      })
    }
  }
}
