import createDOMPurify from 'dompurify'

// 正文 HTML 的样式钩子不适用于 SVG 描边、填充；实例之间不能共享钩子。
const svgPurifier = createDOMPurify(window)
const PAINT_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'color',
  'background-color', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'text-decoration', 'text-transform',
  'white-space', 'word-break', 'overflow-wrap', 'letter-spacing', 'line-height', 'display', 'visibility',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'vertical-align',
  'marker-start', 'marker-mid', 'marker-end', 'paint-order', 'shape-rendering', 'text-rendering',
])
const LOCAL_REFERENCE = /^#[A-Za-z_][\w:.-]*$/

function safeValue(value: string): boolean {
  // 只允许文档内片段引用；CSS 转义、变量和其他资源函数都不进入正文。
  const withoutLocalUrls = value.replace(/url\(\s*(['"]?)#[A-Za-z_][\w:.-]*\1\s*\)/gi, '')
  return /^[\w\s#.,%()'"/+-]*$/.test(withoutLocalUrls)
    && !/(?:url|image|image-set|cross-fade|expression|var|attr|env|paint)\s*\(/i.test(withoutLocalUrls)
    && !value.includes('/*')
}

function safeDeclarations(style: CSSStyleDeclaration): string {
  const declarations: string[] = []
  for (const property of Array.from(style)) {
    const value = style.getPropertyValue(property).trim()
    if (PAINT_PROPERTIES.has(property) && safeValue(value)) {
      declarations.push(`${property}:${value}${style.getPropertyPriority(property) ? ' !important' : ''}`)
    }
  }
  return declarations.join(';')
}

svgPurifier.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style') {
    const element = document.createElement('span')
    element.style.cssText = data.attrValue
    data.attrValue = safeDeclarations(element.style)
    if (!data.attrValue) data.keepAttr = false
  } else if (/^(?:href|xlink:href)$/.test(data.attrName)) {
    if (!LOCAL_REFERENCE.test(data.attrValue)) data.keepAttr = false
  } else if ((PAINT_PROPERTIES.has(data.attrName) || ['clip-path', 'filter', 'cursor'].includes(data.attrName))
    && !safeValue(data.attrValue)) {
    data.keepAttr = false
  }
})

function scopedStyles(css: string, id: string): string {
  const sheet = new CSSStyleSheet()
  // 构造样式表只解析，不应用、不加载 @import；仅转抄验证后的普通规则。
  sheet.replaceSync(css)
  const rules: string[] = []
  const prefix = `#${id}`
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSStyleRule)) continue
    const selectors = rule.selectorText.split(',').map((selector) => selector.trim())
    if (!selectors.every((selector) => selector === prefix
      || (selector.startsWith(prefix) && /^\s+[^+~|\s]/.test(selector.slice(prefix.length))))) continue
    const declarations = safeDeclarations(rule.style)
    if (declarations) rules.push(`${selectors.join(',')}{${declarations}}`)
  }
  return rules.join('\n')
}

/** 仅保留当前生成图表内的静态绘制样式，丢弃资源元素与外链。 */
export function sanitizeSvg(svg: string, id: string): string {
  if (!/^md-graph-\d+$/.test(id)) throw new Error('图表标识无效')
  const source = document.createElement('template')
  source.innerHTML = svg
  const css = Array.from(source.content.querySelectorAll('style'), (style) => scopedStyles(style.textContent ?? '', id)).join('\n')
  const clean = svgPurifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['style', 'foreignObject', 'script', 'image', 'feImage', 'use', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['src', 'srcset', 'onload', 'onerror'],
  })
  const template = document.createElement('template')
  template.innerHTML = clean
  const root = template.content.firstElementChild
  if (!(root instanceof SVGSVGElement) || root.id !== id) throw new Error('图表输出无效')
  if (css) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = css
    root.prepend(style)
  }
  return template.innerHTML
}
