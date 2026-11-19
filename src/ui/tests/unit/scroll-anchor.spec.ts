// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { captureAnchor, restoreAnchor } from '@/reader/scrollAnchor'

function rect(top: number, height = 100): DOMRect { return { top, bottom: top + height, height } as DOMRect }
it('restores the same paragraph after lines and blocks are inserted before it', () => {
  const viewport = document.createElement('div')
  viewport.getBoundingClientRect = () => rect(0, 600)
  const article = document.createElement('article')
  viewport.append(article)
  article.innerHTML = '<p data-src-line="2">old</p><p data-src-line="4">Keep reading here</p><p data-src-line="6">tail</p>'
  Array.from(article.children).forEach((node, index) => { node.getBoundingClientRect = () => rect(index * 100 - 125) })
  viewport.scrollTop = 125
  const anchor = captureAnchor(article, viewport)
  expect(anchor).toEqual({ text: 'Keep reading here', line: 4, ratio: 0.25 })
  if (!anchor) throw new Error('Expected reading anchor')
  article.innerHTML = '<p data-src-line="2">new</p><p data-src-line="4">old</p><p data-src-line="6">Keep reading here</p><p data-src-line="8">tail</p>'
  Array.from(article.children).forEach((node, index) => { node.getBoundingClientRect = () => rect(index * 100 - viewport.scrollTop) })
  expect(restoreAnchor(article, viewport, anchor)).toBe(true)
  expect(viewport.scrollTop).toBe(225)
})

it('falls back to the closest source line when the old text was deleted', () => {
  const viewport = document.createElement('div')
  viewport.getBoundingClientRect = () => rect(0)
  const article = document.createElement('article')
  article.innerHTML = '<p data-src-line="10">changed</p><p data-src-line="30">later</p>'
  Array.from(article.children).forEach((node, index) => { node.getBoundingClientRect = () => rect(100 + index * 100) })
  expect(restoreAnchor(article, viewport, { text: 'deleted', line: 11, ratio: 0.5 })).toBe(true)
  expect(viewport.scrollTop).toBe(150)
})
