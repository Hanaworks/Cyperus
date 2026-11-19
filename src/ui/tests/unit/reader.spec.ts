// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyAppTheme, applyMarkdownTheme } from '@/core/theme/apply'
import { filterInlineStyle } from '@/reader/renderInto'

describe('阅读视图安全插入与主题隔离', () => {
  it('原始 HTML 在插入前清理脚本、事件、样式与危险协议', () => {
    // DOMPurify 的真实 DOM 行为由浏览器 E2E 验证；这里验证项目自己的样式策略。
    expect(filterInlineStyle('position:fixed;background:url(https://bad.test);color:expression(evil())')).toBe('')
    expect(filterInlineStyle('color:u\\72l(https://bad.test);--custom: url(x)')).toBe('')
  })

  it('保留生成的复选框、定位标记及数学所需的安全样式', () => {
    expect(filterInlineStyle('height:1em;vertical-align:-0.2em;--shiki-light:#abc')).toBe('height:1em;vertical-align:-0.2em;--shiki-light:#abc')
  })

  it('外壳和正文主题独立设置，不替换正文节点', () => {
    const article = document.createElement('article')
    article.innerHTML = '<p>正文</p>'
    const content = article.firstChild
    applyMarkdownTheme(article, 'paper')
    applyAppTheme('dark')
    expect(article.dataset.mdTheme).toBe('paper')
    expect(document.documentElement.dataset.appTheme).toBe('dark')
    expect(article.firstChild).toBe(content)
    applyMarkdownTheme(article, 'light')
    expect(document.documentElement.dataset.appTheme).toBe('dark')
  })
})
