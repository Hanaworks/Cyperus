import type { ParseOptions, ParseRequest, ParseResponse, ParseResult } from './contract'

interface Job {
  request: ParseRequest
  resolve: (result: ParseResult) => void
  reject: (error: Error) => void
  cancelled: boolean
}

function cancelled(): Error {
  const error = new Error('解析任务已被更新或取消')
  error.name = 'AbortError'
  return error
}

export class ParserClient {
  private worker: Worker
  private sequence = 0
  private active: Job | null = null
  private queue: Job[] = []
  private stopped: Error | null = null

  constructor() {
    this.worker = new Worker(new URL('../../workers/parse.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      const result = event.data
      const job = this.active
      if (!job || job.request.jobId !== result.jobId) return
      this.active = null
      if (!job.cancelled) {
        if (result.ok) job.resolve(result)
        else job.reject(new Error(result.message))
      }
      this.pump()
    }
    this.worker.onerror = (event) => this.stop(new Error(event.message || '解析进程启动失败'))
    this.worker.onmessageerror = () => this.stop(new Error('无法接收解析结果'))
  }

  parse(text: string, generation: number, docId = 'm0-active'): Promise<ParseResult> {
    const jobId = ++this.sequence
    const opts: ParseOptions = { html: true, math: true, alerts: true, mermaid: true,
      shikiThemeLight: 'github-light', shikiThemeDark: 'github-dark' }
    const promise = new Promise<ParseResult>((resolve, reject) => {
      if (this.stopped) { reject(this.stopped); return }
      this.cancel(docId)
      this.queue.push({ request: { jobId, docId, generation, text, opts }, resolve, reject, cancelled: false })
      this.pump()
    })
    // Observe fire-and-forget cancellation/disposal without changing the promise
    // returned to the caller: awaited failures still reject normally.
    void promise.catch(() => {})
    return promise
  }

  cancel(docId: string): void {
    for (const job of this.queue.filter((job) => job.request.docId === docId)) job.reject(cancelled())
    this.queue = this.queue.filter((job) => job.request.docId !== docId)
    if (this.active?.request.docId === docId && !this.active.cancelled) {
      this.active.cancelled = true
      this.active.reject(cancelled())
    }
  }

  private pump(): void {
    if (this.stopped || this.active) return
    const job = this.queue.shift()
    if (!job) return
    this.active = job
    try {
      this.worker.postMessage(job.request)
      // Structured cloning already transferred the payload to the worker. Do
      // not keep an extra reference to the source while the worker is busy.
      job.request = { ...job.request, text: '' }
    } catch (error) {
      this.active = null
      job.reject(error instanceof Error ? error : new Error(String(error)))
      this.pump()
    }
  }

  private stop(error: Error): void {
    if (this.stopped) return
    this.stopped = error
    this.worker.terminate()
    this.active?.reject(error)
    this.active = null
    for (const job of this.queue) job.reject(error)
    this.queue = []
  }

  dispose(): void { this.stop(new Error('阅读器已关闭')) }
}
