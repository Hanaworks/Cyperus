const vscode = acquireVsCodeApi()
let pending

function prepareDocument(text) {
  // Work with a detached document to preserve the original html/body
  // attributes. The outer webview's CSP already disallows remote resources.
  const content = new DOMParser().parseFromString(text, 'text/html')
  for (const element of content.querySelectorAll('script, iframe, frame, frameset, object, embed, portal, fencedframe, base, meta, template, svg animate, svg animateMotion, svg animateTransform, svg set')) {
    element.remove()
  }
  const assets = []
  const targets = []
  function queue(element, attribute, kind, url) {
    if (!url || assets.length >= 64) return
    assets.push({ kind, url })
    targets.push({ element, attribute })
  }
  for (const element of content.querySelectorAll('*')) {
    if (element.localName === 'link') {
      if (element.getAttribute('rel')?.trim().toLowerCase() !== 'stylesheet') {
        element.remove()
        continue
      }
      queue(element, 'href', 'stylesheet', element.getAttribute('href'))
    }
    if (element.localName === 'img') {
      const src = element.getAttribute('src')?.trim()
      if (src && !/^data:image\//i.test(src)) queue(element, 'src', 'image', src)
    }
    for (const { name, value } of [...element.attributes]) {
      const fragment = (name === 'href' || name === 'xlink:href') && value.startsWith('#')
      const embeddedImage = name === 'src' && element.localName === 'img' && /^data:image\//i.test(value)
      if (!fragment && !embeddedImage && (
        name.startsWith('on') || ['href', 'xlink:href', 'xml:base', 'src', 'srcset', 'srcdoc', 'target', 'action', 'formaction', 'formtarget', 'ping', 'download', 'autofocus'].includes(name)
      )) element.removeAttribute(name)
    }
  }
  const policy = content.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = "default-src 'none'; style-src 'unsafe-inline' data:; img-src data:; base-uri 'none'; form-action 'none'"
  content.head.prepend(policy)
  return { content, assets, targets }
}

function render(job, urls) {
  job.targets.forEach(({ element, attribute }, index) => {
    if (urls[index]) element.setAttribute(attribute, urls[index])
  })
  const frame = document.createElement('iframe')
  // The trusted parent may inspect the layout for QA; the child cannot run
  // scripts or open other windows, submit forms, or navigate its parent.
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.title = document.documentElement.lang === 'zh-CN' ? '静态 HTML 预览' : 'Static HTML Preview'
  if (job.test) {
    frame.addEventListener('load', () => {
      const probe = frame.contentDocument?.querySelector('.preview-probe')
      if (!probe) return
      vscode.postMessage({ type: 'painted', generation: job.generation, sample: {
        text: probe.textContent,
        color: frame.contentWindow.getComputedStyle(probe).color,
        imageWidth: frame.contentDocument.querySelector('img')?.naturalWidth,
        blockedLink: !frame.contentDocument.querySelector('a[href^="https:"]'),
      } })
    })
  }
  frame.srcdoc = `<!doctype html>${job.content.documentElement.outerHTML}`
  document.body.replaceChildren(frame)
}

window.addEventListener('message', ({ data }) => {
  if (data?.type === 'document') {
    pending = { ...prepareDocument(data.text), generation: data.generation, test: data.test }
    if (pending.assets.length) vscode.postMessage({ type: 'assets', generation: pending.generation, assets: pending.assets })
    else render(pending, [])
  } else if (data?.type === 'assets' && pending?.generation === data.generation) {
    render(pending, data.urls)
  } else if (data?.type === 'error') {
    pending = undefined
    const message = document.createElement('p')
    message.textContent = data.message
    document.body.replaceChildren(message)
  }
})
vscode.postMessage({ type: 'ready' })
