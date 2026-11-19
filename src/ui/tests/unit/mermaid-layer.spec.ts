// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidLayer } from '@/reader/MermaidLayer'

// SVG 安全策略交由真实浏览器验证；本文件只验证调度和生命周期。
vi.mock('@/reader/svg', () => ({ sanitizeSvg: (svg: string) => svg }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error(`Missing test value at index ${index}`)
  return value
}

function articleWith(codes: string[]) {
  const article = document.createElement('article')
  const nodes = codes.map((code) => {
    const node = document.createElement('div')
    node.className = 'md-mermaid'
    node.dataset.code = Buffer.from(code, 'utf8').toString('base64')
    node.textContent = '正在准备图表'
    article.append(node)
    return node
  })
  document.body.append(article)
  return { article, nodes }
}

async function flushPromises() {
  // 完成注入 renderer 与 MermaidLayer 两层 Promise 的后续操作。
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('Mermaid 图表调度与生命周期', () => {
  const layers: MermaidLayer[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    // 显式覆盖 happy-dom 的占位实现，走无 IntersectionObserver 的渲染路径。
    vi.stubGlobal('IntersectionObserver', undefined)
  })

  afterEach(() => {
    for (const layer of layers.splice(0)) layer.dispose()
    document.body.replaceChildren()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function layerFor(article: HTMLElement, renderer: ConstructorParameters<typeof MermaidLayer>[2], timeoutMs = 100) {
    const layer = new MermaidLayer(article, 'paper', renderer, timeoutMs)
    layers.push(layer)
    return layer
  }

  it('newly mounted segments share existing rendering slots after distant DOM is removed', async () => {
    const { article, nodes } = articleWith(['one', 'two'])
    const tasks = [deferred<string>(), deferred<string>(), deferred<string>()]
    const renderer = vi.fn(() => at(tasks, renderer.mock.calls.length - 1).promise)
    const layer = layerFor(article, renderer)
    const next = document.createElement('div')
    next.className = 'md-mermaid'
    next.dataset.code = btoa('three')
    article.append(next)
    at(nodes, 0).remove()
    layer.refresh()
    expect(renderer).toHaveBeenCalledTimes(2)
    expect(next.dataset.state).toBe('queued')
    at(tasks, 0).resolve('<svg/>')
    await flushPromises()
    expect(renderer).toHaveBeenCalledTimes(3)
    at(tasks, 1).resolve('<svg/>')
    at(tasks, 2).resolve('<svg/>')
    await layer.renderAll()
    expect(next.dataset.state).toBe('done')
  })

  it('最多同时执行两个真实渲染任务，并在空出槽位后继续队列', async () => {
    const { article, nodes } = articleWith(['one', 'two', 'three', 'four', 'five'])
    const tasks = Array.from({ length: 5 }, () => deferred<string>())
    let active = 0
    let maximumActive = 0
    const renderer = vi.fn(async () => {
      const task = at(tasks, renderer.mock.calls.length - 1)
      maximumActive = Math.max(maximumActive, ++active)
      try { return await task.promise } finally { active -= 1 }
    })
    const layer = layerFor(article, renderer)
    const finished = layer.renderAll()

    expect(renderer).toHaveBeenCalledTimes(2)
    expect(nodes.map((node) => node.dataset.state)).toEqual(['running', 'running', 'queued', 'queued', 'queued'])

    for (let index = 0; index < tasks.length; index += 1) {
      at(tasks, index).resolve(`<svg><text>${index}</text></svg>`)
      await flushPromises()
      expect(renderer.mock.calls.length).toBe(Math.min(index + 3, tasks.length))
    }
    await finished
    expect(maximumActive).toBe(2)
    expect(active).toBe(0)
    expect(nodes.every((node) => node.dataset.state === 'done')).toBe(true)
  })

  it('以 UTF-8 还原含中文和 emoji 的完整源码，并传递正文主题', async () => {
    const code = 'flowchart TD\n  开始["你好，世界 🧭"] --> 结束["第二行"]'
    const { article, nodes } = articleWith([code])
    const renderer = vi.fn(async () => '<svg><text>你好，世界 🧭</text></svg>')
    const layer = layerFor(article, renderer)

    await layer.renderAll()

    expect(renderer).toHaveBeenCalledWith(expect.stringMatching(/^md-graph-\d+$/), code, 'paper')
    expect(at(nodes, 0).dataset.state).toBe('done')
    expect(at(nodes, 0).querySelector('svg text')?.textContent).toBe('你好，世界 🧭')
  })

  it('单图失败保留可读源码，且不阻断后续图表', async () => {
    const code = 'flowchart TD\n  A["<script>坏源码</script>"]'
    const { article, nodes } = articleWith([code, 'valid-one', 'valid-two'])
    const renderer = vi.fn(async (_id: string, source: string) => {
      if (source === code) throw new Error('语法错误')
      return `<svg><text>${source}</text></svg>`
    })
    const layer = layerFor(article, renderer)

    await layer.renderAll()

    expect(renderer).toHaveBeenCalledTimes(3)
    expect(nodes.map((node) => node.dataset.state)).toEqual(['error', 'done', 'done'])
    expect(at(nodes, 0).querySelector('p')?.textContent).toContain('语法错误')
    expect(at(nodes, 0).querySelector('details pre')?.textContent).toBe(code)
    expect(at(nodes, 0).querySelector('script')).toBeNull()
  })

  it.each([
    'flowchart TD\n A@{ img: "https://example.test/leak.png", label: "X" }',
    'flowchart TD\n A["`![X](https://example.test/leak.png)`"]',
    'flowchart TD\n A["<img src=https://example.test/leak.png>"]',
    '%%{init: {"themeCSS":"body {display:none}"}}%%\ngraph TD; A-->B',
    '---\nconfig:\n  securityLevel: loose\n---\ngraph TD; A-->B',
    'graph TD; A-->B; classDef default fill:url(https://example.test/leak.svg)',
    'graph TD; A-->B; style A fill:red',
    'graph TD; A-->B; linkStyle 0 stroke:red',
  ])('资源、样式与配置输入在调用 renderer 前拒绝：%s', async (code) => {
    const { article, nodes } = articleWith([code])
    const renderer = vi.fn(async () => '<svg/>')
    const layer = layerFor(article, renderer)

    await layer.renderAll()

    expect(renderer).not.toHaveBeenCalled()
    expect(at(nodes, 0).dataset.state).toBe('error')
    expect(at(nodes, 0).querySelector('p')?.textContent).toContain('不支持')
    expect(at(nodes, 0).querySelector('pre')?.textContent).toBe(code)
  })

  it('dispose 立即释放等待者，迟到结果不改旧 DOM，也不启动排队任务', async () => {
    const { article, nodes } = articleWith(['one', 'two', 'queued'])
    const tasks = [deferred<string>(), deferred<string>()]
    const renderer = vi.fn(() => at(tasks, renderer.mock.calls.length - 1).promise)
    const layer = layerFor(article, renderer)
    const finished = layer.renderAll()
    layer.dispose()
    await finished
    const oldMarkup = article.innerHTML

    at(tasks, 0).resolve('<svg><text>迟到成功</text></svg>')
    at(tasks, 1).reject(new Error('迟到失败'))
    await flushPromises()
    await vi.advanceTimersByTimeAsync(200)

    expect(article.innerHTML).toBe(oldMarkup)
    expect(at(nodes, 0).querySelector('svg')).toBeNull()
    expect(renderer).toHaveBeenCalledTimes(2)
    await layer.renderAll()
  })

  it('正文已替换时，迟到结果不插回已移除的图表节点', async () => {
    const { article, nodes } = articleWith(['old'])
    const task = deferred<string>()
    const layer = layerFor(article, () => task.promise)
    const finished = layer.renderAll()
    const original = at(nodes, 0).innerHTML
    article.replaceChildren(document.createTextNode('新正文'))

    task.resolve('<svg><text>旧图</text></svg>')
    await finished

    expect(article.textContent).toBe('新正文')
    expect(at(nodes, 0).innerHTML).toBe(original)
  })

  it('一张图超时不会提前完成整体等待；其他图仍可完成并接续队列', async () => {
    const { article, nodes } = articleWith(['stuck', 'quick', 'slow', 'queued'])
    const tasks = Array.from({ length: 4 }, () => deferred<string>())
    const renderer = vi.fn(() => at(tasks, renderer.mock.calls.length - 1).promise)
    const layer = layerFor(article, renderer)
    let finished = false
    const completion = layer.renderAll().then(() => { finished = true })

    await vi.advanceTimersByTimeAsync(25)
    at(tasks, 1).resolve('<svg>quick</svg>')
    await flushPromises()
    expect(renderer).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(75)
    expect(nodes.map((node) => node.dataset.state)).toEqual(['error', 'done', 'running', 'queued'])
    expect(finished).toBe(false)

    await vi.advanceTimersByTimeAsync(10)
    at(tasks, 2).resolve('<svg>slow</svg>')
    await flushPromises()
    expect(renderer).toHaveBeenCalledTimes(4)
    at(tasks, 3).resolve('<svg>queued</svg>')
    await flushPromises()
    expect(finished).toBe(true)
    expect(nodes.map((node) => node.dataset.state)).toEqual(['error', 'done', 'done', 'done'])
    await completion
  })

  it('两个真实任务均超时后，不超额启动；排队图说明未开始原因且整体等待结束', async () => {
    const { article, nodes } = articleWith(['stuck-one', 'stuck-two', 'never-started', 'also-not-started'])
    const tasks = [deferred<string>(), deferred<string>()]
    const renderer = vi.fn(() => at(tasks, renderer.mock.calls.length - 1).promise)
    const layer = layerFor(article, renderer)
    let finished = false
    void layer.renderAll().then(() => { finished = true })

    await vi.advanceTimersByTimeAsync(100)

    expect(renderer).toHaveBeenCalledTimes(2)
    expect(finished).toBe(true)
    expect(nodes.map((node) => node.dataset.state)).toEqual(['error', 'error', 'error', 'error'])
    expect(at(nodes, 2).textContent).toContain('前序图表超时，未开始渲染')
    expect(at(nodes, 2).querySelector('details pre')?.textContent).toBe('never-started')
    const terminalMarkup = article.innerHTML

    at(tasks, 0).resolve('<svg>迟到</svg>')
    at(tasks, 1).reject(new Error('迟到错误'))
    await flushPromises()

    expect(article.innerHTML).toBe(terminalMarkup)
    expect(renderer).toHaveBeenCalledTimes(2)
  })

  it('已超时的真实任务未结束时，重复 renderAll 仍按全部图的终态立即完成', async () => {
    const { article } = articleWith(['stuck-one', 'stuck-two'])
    const layer = layerFor(article, () => new Promise<string>(() => {}))
    void layer.renderAll()
    await vi.advanceTimersByTimeAsync(100)
    let finished = false

    void layer.renderAll().then(() => { finished = true })
    await flushPromises()

    expect(finished).toBe(true)
  })
})
