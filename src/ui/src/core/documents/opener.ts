import type { DocMeta } from '../ipc/contract'

interface DocumentIO {
  openDocument(path: string): Promise<DocMeta>
  readDocument(docId: string): Promise<Uint8Array>
  closeDocument(docId: string): Promise<void>
}

// M0 单活动文档的所有权边界：串行处理宿主句柄，异步结果必须仍属于最新操作。
export class DocumentOpener {
  private sequence = 0
  private queue: Promise<void> = Promise.resolve()
  private active: DocMeta | undefined

  constructor(private io: DocumentIO,
    private commit: (doc: DocMeta, bytes: Uint8Array, current: () => boolean) => Promise<void>,
    private clear: () => void) {}

  private async release(): Promise<void> {
    const previous = this.active
    this.active = undefined
    if (previous) await this.io.closeDocument(previous.docId)
  }

  open(path: string): Promise<boolean> {
    const ticket = ++this.sequence
    this.clear()
    const current = () => ticket === this.sequence
    const operation = this.queue.then(async () => {
      if (!current()) return false
      await this.release()
      if (!current()) return false
      try {
        const document = await this.io.openDocument(path)
        this.active = document
        if (!current()) { await this.release(); return false }
        const bytes = await this.io.readDocument(document.docId)
        if (!current()) { await this.release(); return false }
        await this.commit(document, bytes, current)
        if (!current()) { await this.release(); return false }
        return true
      } catch (error) {
        await this.release()
        if (!current()) return false
        throw error
      }
    })
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  close(): Promise<void> {
    this.sequence += 1
    this.clear()
    const operation = this.queue.then(() => this.release())
    this.queue = operation.then(() => undefined, () => undefined)
    return operation
  }
}
