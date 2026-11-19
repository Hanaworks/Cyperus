// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { DocumentSearch } from '@/reader/search'

describe('当前正文搜索', () => {
  it('恢复匹配序号只重建高亮，保留阅读位置并夹紧过期序号', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>read read read</p>'
    const reveal = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      const search = new DocumentSearch(root)
      expect(search.update('read', 2, false)).toEqual({ count: 3, current: 2 })
      expect([...root.querySelectorAll('mark')].map((mark) => mark.classList.contains('md-search-current'))).toEqual([false, true, false])
      expect(reveal).not.toHaveBeenCalled()
      expect(search.update('read', 99, false)).toEqual({ count: 3, current: 3 })
      expect(search.update('read', -2, false)).toEqual({ count: 3, current: 1 })
      expect(search.move(1)).toEqual({ count: 3, current: 2 })
      expect(reveal).toHaveBeenCalled()
      search.clear()
    } finally { reveal.mockRestore() }
  })

  it('跨行内样式匹配并保留原始结构，清理后正文完全恢复', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>中<strong>文阅</strong>读 中文阅读</p><pre><code>中文阅读</code></pre>'
    const before = root.innerHTML
    const search = new DocumentSearch(root)
    expect(search.update('中文阅读')).toEqual({ count: 3, current: 1 })
    expect(root.querySelector('strong')?.textContent).toBe('文阅')
    expect(search.move(1)).toEqual({ count: 3, current: 2 })
    expect(search.move(-1)).toEqual({ count: 3, current: 1 })
    search.clear()
    expect(root.innerHTML).toBe(before)
  })

  it('不搜索脚本、隐藏数学副本或图表，并且不跨段落误匹配', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>hello</p><p>world</p><script>hello</script><svg><text>hello</text></svg><span class="katex-mathml">hello</span>'
    const search = new DocumentSearch(root)
    expect(search.update('hello')).toEqual({ count: 1, current: 1 })
    expect(search.update('helloworld')).toEqual({ count: 0, current: 0 })
    expect(search.update('')).toEqual({ count: 0, current: 0 })
    search.clear()
    expect(root.querySelector('script')?.textContent).toBe('hello')
  })

  it('大小写不敏感、匹配循环定位，查询改变会清除旧高亮', () => {
    const root = document.createElement('article')
    root.innerHTML = '<p>Read READ read.</p>'
    const search = new DocumentSearch(root)
    expect(search.update('read')).toEqual({ count: 3, current: 1 })
    expect(search.move(-1)).toEqual({ count: 3, current: 3 })
    expect(search.move(1)).toEqual({ count: 3, current: 1 })
    expect(search.update('missing')).toEqual({ count: 0, current: 0 })
    expect(root.querySelectorAll('mark')).toHaveLength(0)
  })
})
