import DOMPurify from 'dompurify'

// 只放行数学与代码高亮需要的局部排版样式。作者 HTML 不能定位到应用外壳或加载 CSS URL。
const STYLE_PROPERTIES = new Set([
  'height', 'width', 'min-width', 'max-width', 'vertical-align', 'top', 'left', 'right', 'bottom',
  'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'padding-left', 'padding-right',
  'padding-top', 'padding-bottom', 'border-bottom-width', 'border-top-width', 'border-left-width',
  'border-right-width', 'border-style', 'font-size', 'line-height', 'color', 'background-color',
  'display', '--shiki-light', '--shiki-dark', '--shiki-light-bg', '--shiki-dark-bg',
])

export function filterInlineStyle(style: string): string {
  return style.split(';').filter((declaration) => {
    const colon = declaration.indexOf(':')
    const name = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim()
    return colon > 0 && STYLE_PROPERTIES.has(name) && /^[\w\s#.,%()+-]+$/.test(value)
      && !/(?:url|expression|image-set|attr)\s*\(/i.test(value)
  }).join(';')
}

DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName !== 'style') return
  data.attrValue = filterInlineStyle(data.attrValue)
  if (!data.attrValue) data.keepAttr = false
})

export function renderInto(article: HTMLElement, result: { html: string; hasRawHtml: boolean }): void {
  const html = result.hasRawHtml ? DOMPurify.sanitize(result.html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'foreignObject', 'video', 'audio', 'source', 'image', 'use', 'feImage', 'feimage', 'area', 'map'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    ADD_ATTR: ['data-src-line', 'data-src-end', 'data-mermaid-id', 'data-code', 'data-md-image', 'data-md-external'],
  }) : result.html
  const template = document.createElement('template')
  template.innerHTML = html
  for (const input of template.content.querySelectorAll('input')) {
    if (input.type === 'checkbox') { input.disabled = true; input.removeAttribute('src') }
    else input.remove()
  }
  for (const element of template.content.querySelectorAll('[background],[poster],[srcset]')) {
    element.removeAttribute('background')
    element.removeAttribute('poster')
    element.removeAttribute('srcset')
  }
  // template 内容处于惰性状态：授权前不让图片发出相对路径或远程请求。
  for (const image of template.content.querySelectorAll('img')) {
    image.dataset.mdSrc = image.getAttribute('src') ?? ''
    image.dataset.mdImage = '1'
    image.removeAttribute('src')
  }
  article.replaceChildren(template.content)
}

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'foreignObject', 'script'],
  })
}
