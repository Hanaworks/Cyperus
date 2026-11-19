// 标题锚点 id 生成与去重。
//
// 为什么不用有状态 slugger（T05 实测结论）：
// markdown-it-anchor 的 slugify 选项挂在 MarkdownIt 实例上，而实例跨文档复用。
// 若传入有状态的 slugger（github-slugger 实例，或返回闭包的工厂），则：
//   第一次渲染： id="重复标题", id="重复标题-1"
//   第二次渲染同一文档： id="重复标题-2", id="重复标题-3"   ← 漂移
// 后果是目录跳转失效、切换标签后锚点位置变化、视觉回归莫名失败。
//
// 本模块的方案：
// 1. slugify：无状态，纯函数，只把标题文本转成基础 slug。
// 2. dedupeIds：纯函数，在一次渲染内对基础 slug 序列去重。
// 两者都不持有跨渲染状态，因此同一实例渲染任意次同一文档，产出完全一致。

// 把标题文本转为基础 slug。
//
// 规则（顺序重要）：
// 1. 去首尾空白
// 2. 转小写
// 3. 先移除非法字符（保留空白，以便下一步合并）
// 4. 空白序列 → 单个连字符
// 5. 合并连续连字符
// 6. 去掉首尾连字符
//
// 第 3 步必须在第 4 步之前：否则 emoji 被移除后会留下前导连字符，
// 例如 slugify('目标 🎯') 会得到 '-目标'。这是 T05 实测发现的缺陷。
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 在单次渲染内为标题 id 去重。纯函数，无状态。
// 去重格式与 GitHub 一致：base、base-1、base-2 ……
export function dedupeIds(bases: readonly string[]): string[] {
  const nextSuffix = new Map<string, number>()
  const used = new Set<string>()
  const out: string[] = []

  for (const input of bases) {
    const base = input || 'section'
    let suffix = nextSuffix.get(base) ?? 0
    let id = suffix === 0 ? base : `${base}-${suffix}`

    // 数字后缀也可能来自真实标题，例如 foo / foo / foo-1。
    while (used.has(id)) {
      suffix += 1
      id = `${base}-${suffix}`
    }

    nextSuffix.set(base, suffix + 1)
    used.add(id)
    out.push(id)
  }

  return out
}

// 判断某个 fence 的语言标识是否应交给代码高亮器。
// 返回 false 的情况：无语言标识、mermaid（由 augment 规则改写为占位 div）。
export function shouldHighlight(lang: string | undefined): boolean {
  if (!lang) return false
  const normalized = lang.trim().toLowerCase().split(/\s+/)[0]
  if (!normalized) return false
  return normalized !== 'mermaid'
}

// 从 fence 的 info 字符串提取语言标识（ ```js title="x" → js ）。
export function fenceLang(info: string | undefined): string | undefined {
  if (!info) return undefined
  const first = info.trim().split(/\s+/)[0]
  return first || undefined
}

// 判断 token 流中是否存在原始 HTML。
// 这是「按需消毒」的判定依据：只有存在 html_block 或 html_inline 时才需要跑 DOMPurify。
export function hasRawHtmlToken(
  tokens: ReadonlyArray<{ type: string; children?: ReadonlyArray<{ type: string }> | null }>,
): boolean {
  for (const token of tokens) {
    if (token.type === 'html_block' || token.type === 'html_inline') return true
    if (token.children) {
      for (const child of token.children) {
        if (child.type === 'html_inline') return true
      }
    }
  }
  return false
}
