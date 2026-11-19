import type { MarkdownIt as MarkdownItType, Token } from 'markdown-it'
import { dedupeIds, slugify } from './slug'

// 标题锚点插件。
//
// 不用 markdown-it-anchor 的理由（T05 实测）：
// 它的 slugify 选项挂在 MarkdownIt 实例上，而实例跨文档复用。
// 有状态的 slugger 会导致同一文档第二次渲染时 id 全部漂移
// （重复标题 → 重复标题-1），目录跳转随之失效。
//
// 自研实现的关键：每次 core rule 执行时重新建立去重状态，
// 不依赖 env、模块级或实例级变量。因此即使调用方复用 env：
// - 同一实例渲染任意次同一文档 → id 完全一致
// - 并发渲染不同文档 → 互不干扰
//
// 产出的 token 与 markdown-it-anchor 兼容：给 heading_open 设 id 属性，
// 并附加 tabindex="-1"（便于程序化聚焦与滚动定位）。

// 挂载标题锚点规则。
//
// 必须用 md.core.ruler.after('inline', ...) 注册：此时标题的 inline token
// 已解析完成，可以拿到纯文本内容来生成 slug。
export function installHeadingAnchors(md: MarkdownItType): void {
  md.core.ruler.after('inline', 'md_heading_anchors', (state) => {
    const tokens = state.tokens
    const headings: Token[] = []
    const bases: string[] = []

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]
      if (token?.type !== 'heading_open') continue

      const inline = tokens[i + 1]
      if (inline?.type !== 'inline') continue

      headings.push(token)
      bases.push(slugify(headingText(inline)))
    }

    const ids = dedupeIds(bases)
    headings.forEach((token, index) => {
      const id = ids[index]
      if (id === undefined) return
      token.attrSet('id', id)
      // 便于 scrollIntoView 后程序化聚焦，不进入 Tab 序列
      token.attrSet('tabindex', '-1')
    })
  })
}

// 从 inline token 提取标题的纯文本（跳过标记，保留文字）。
export function headingText(inline: {
  content: string
  children?: ReadonlyArray<{ type: string; content: string }> | null
}): string {
  if (!inline.children) return inline.content

  let out = ''
  for (const child of inline.children) {
    // 跳过纯标记 token（emphasis_open 等的 content 为空），
    // text / code_inline 的文字都算标题文本
    if (child.type === 'text' || child.type === 'code_inline') {
      out += child.content
    } else if (child.type === 'image') {
      // 图片标题用 alt 文本（content 存的是 alt）
      out += child.content
    }
  }

  return out || inline.content
}

// 供测试与调试使用：对一组标题文本计算去重后的 id 序列。
// 与 installHeadingAnchors 里的逻辑一致，但不需要构造 token 流。
export function computeHeadingIds(texts: readonly string[]): string[] {
  return dedupeIds(texts.map(slugify))
}
