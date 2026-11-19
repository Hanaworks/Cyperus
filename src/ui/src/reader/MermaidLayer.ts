import type { MarkdownTheme } from '../core/theme/apply'
import { sanitizeSvg } from './svg'

type SvgRenderer = (id: string, code: string, theme: MarkdownTheme) => Promise<string>
let mermaidModule: Promise<typeof import('mermaid')> | undefined
let serial = 0

function validateSource(code: string): void {
  // M0 不接受图片/资源元数据、作者 CSS 或作者配置；须在 Mermaid 操作 DOM 前拒绝。
  if (/@\s*\{|!\s*\[|<\s*\/?\s*(?:img|image|picture|svg|foreignObject|iframe|object|embed|style|link|video|audio|source)\b/i.test(code)
    || /%%\s*\{|^\s*---(?:\r?\n|$)|\b(?:classDef|linkStyle|style)\s+/im.test(code)) {
    throw new Error('M0 暂不支持图表图片、资源元数据、自定义样式或配置')
  }
}

async function renderSvg(id: string, code: string, theme: MarkdownTheme): Promise<string> {
  mermaidModule ??= import('mermaid')
  const mermaid = (await mermaidModule).default
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict',
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges',
      'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'flowchart', 'htmlLabels', 'dompurifyConfig', 'look'],
    htmlLabels: false,
    theme: theme === 'light' ? 'default' : theme === 'paper' ? 'neutral' : 'dark',
    flowchart: { htmlLabels: false }, suppressErrorRendering: true,
  })
  return (await mermaid.render(id, code)).svg
}

function decodeCode(encoded: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))
}

export class MermaidLayer {
  private observer: IntersectionObserver | undefined
  private queue: HTMLElement[] = []
  private running = 0
  // 超时只结束该图的等待；Mermaid 无取消接口，真实任务仍占并发槽位。
  private timedOut = new Set<HTMLElement>()
  private pending = new Set<HTMLElement>()
  private stopped = false
  private settled: Array<() => void> = []
  private nodes: HTMLElement[]

  constructor(private article: HTMLElement, private theme: MarkdownTheme,
    private renderer: SvgRenderer = renderSvg, private timeoutMs = 5000) {
    this.nodes = [...article.querySelectorAll<HTMLElement>('.md-mermaid')]
    if (typeof IntersectionObserver === 'undefined') this.enqueue(this.nodes)
    else {
      this.observer = new IntersectionObserver((entries) => {
        this.enqueue(entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target as HTMLElement))
      }, { root: article.parentElement, rootMargin: '300px' })
      for (const node of this.nodes) this.observer.observe(node)
    }
  }

  private enqueue(nodes: HTMLElement[]): void {
    if (this.stopped) return
    for (const node of nodes) {
      if (node.dataset.state) continue
      node.dataset.state = 'queued'
      this.pending.add(node)
      this.queue.push(node)
      this.observer?.unobserve(node)
    }
    this.pump()
  }

  private pump(): void {
    while (!this.stopped && this.running < 2 && this.queue.length) {
      const node = this.queue.shift()
      if (node) void this.render(node)
    }
    if (this.queue.length && this.running === 2 && this.timedOut.size === this.running) {
      // 两个槽位均已超时；明确结束尚未开始的图，避免整体等待挂起。
      for (const node of this.queue.splice(0)) {
        let code = ''
        try { code = decodeCode(node.dataset.code ?? '') } catch { /* 损坏的编码没有可还原的源码。 */ }
        this.showError(node, code, '前序图表超时，未开始渲染')
        this.pending.delete(node)
      }
    }
    if (!this.pending.size) this.finishWaiters()
  }

  private finishWaiters(): void {
    for (const resolve of this.settled.splice(0)) resolve()
  }

  private showError(node: HTMLElement, code: string, message: string): void {
    if (this.stopped || !this.article.contains(node)) return
    node.dataset.state = 'error'
    const title = document.createElement('p')
    title.textContent = `图表暂时无法显示：${message}`
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = '查看图表源码'
    const pre = document.createElement('pre')
    pre.textContent = code
    details.append(summary, pre)
    node.replaceChildren(title, details)
  }

  private async render(node: HTMLElement): Promise<void> {
    this.running += 1
    node.dataset.state = 'running'
    let code = ''
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      this.timedOut.add(node)
      this.showError(node, code, '渲染超时')
      this.pending.delete(node)
      this.pump()
    }, this.timeoutMs)
    try {
      code = decodeCode(node.dataset.code ?? '')
      validateSource(code)
      const id = `md-graph-${++serial}`
      const svg = await this.renderer(id, code, this.theme)
      if (!this.stopped && !expired && this.article.contains(node)) {
        node.innerHTML = sanitizeSvg(svg, id)
        node.dataset.state = 'done'
      }
    } catch (error) {
      if (!expired) this.showError(node, code, error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
      this.timedOut.delete(node)
      this.running -= 1
      this.pending.delete(node)
      this.pump()
    }
  }

  renderAll(): Promise<void> {
    this.enqueue(this.nodes)
    if (this.stopped || !this.pending.size) return Promise.resolve()
    return new Promise((resolve) => this.settled.push(resolve))
  }

  /** Reconcile a virtualized article while keeping one shared two-slot queue. */
  refresh(): void {
    if (this.stopped) return
    const present = [...this.article.querySelectorAll<HTMLElement>('.md-mermaid')]
    const retained = new Set(present)
    const previous = new Set(this.nodes)
    for (const node of this.nodes) if (!retained.has(node)) {
      this.observer?.unobserve(node)
      this.pending.delete(node)
    }
    this.queue = this.queue.filter((node) => retained.has(node))
    this.nodes = present
    const added = present.filter((node) => !previous.has(node))
    if (this.observer) for (const node of added) this.observer.observe(node)
    else this.enqueue(added)
    this.pump()
  }

  dispose(): void {
    this.stopped = true
    this.observer?.disconnect()
    this.queue = []
    this.pending.clear()
    this.finishWaiters()
  }
}
