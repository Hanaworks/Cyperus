// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/core/markdown'

describe('large document segmentation', () => {
  it('keeps complete lists, tables, footnotes and full navigation while removing duplicate HTML', async () => {
    const text = '# Start\n\n' + (`A paragraph ${'x'.repeat(1000)}\n\n`).repeat(8300)
      + '# End\n\n- one\n  - nested\n- two\n\n| a | b |\n|---|---|\n| c | d |\n\nref[^n]\n\n[^n]: note\n'
    const result = await renderMarkdown(text)
    expect(result.segments?.length).toBeGreaterThan(3)
    expect(result.html).toBe('')
    expect(result.toc.map((entry) => entry.id)).toEqual(['start', 'end'])
    const html = (result.segments ?? []).map((segment) => segment.html).join('')
    expect(result.htmlBytes).toBe(new TextEncoder().encode(html).byteLength)
    expect(html).toContain('id="fn1"')
    const tail = result.segments?.find((segment) => segment.html.includes('<table'))
    expect(tail?.html).toContain('</table>')
    expect(tail?.html).toContain('</ul>')
    expect(result.segments?.flatMap((segment) => segment.anchors)).toContain('fn1')
  }, 30_000)

  it('keeps ordinary document HTML and structure unchanged', async () => {
    const result = await renderMarkdown('# Simple\n\nbody')
    expect(result.segments).toBeUndefined()
    expect(result.html).toContain('<h1')
  })
})
