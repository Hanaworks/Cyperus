import type { ParseResult, RenderSegment } from './contract'

export interface StoredPart { key: string; html: string }
export interface SegmentStorageBackend {
  put(parts: readonly StoredPart[]): Promise<void>
  get(key: string): Promise<string>
  delete(keys: readonly string[]): Promise<void>
  dispose(): Promise<void>
}

/** Owns derived storage keys, never an in-memory copy of stored HTML. */
export class SegmentStore {
  private keys = new Set<string>()
  private writes = new Set<Promise<ParseResult>>()
  private disposed = false
  private disposal: Promise<void> | undefined
  constructor(private backend: SegmentStorageBackend) {}

  spill(result: ParseResult): Promise<ParseResult> {
    const task = this.write(result)
    this.writes.add(task)
    void task.then(() => this.writes.delete(task), () => this.writes.delete(task))
    return task
  }

  private async write(result: ParseResult): Promise<ParseResult> {
    if (this.disposed) throw new Error('临时文档存储已关闭')
    const segments: RenderSegment[] = result.segments?.length ? result.segments : [{ html: result.html,
      line: result.blocks[0]?.line ?? 1, endLine: result.blocks.at(-1)?.endLine ?? 1,
      anchors: result.toc.map((heading) => heading.id), oversized: true }]
    const group = crypto.randomUUID()
    const parts = segments.map((segment, index) => ({ key: `${group}/${index}`, html: segment.html }))
    const descriptors = segments.map((segment, index) => ({ ...segment, html: '', storageKey: parts[index]?.key ?? '',
      htmlLength: segment.html.length, htmlBytes: new TextEncoder().encode(segment.html).byteLength }))
    await this.backend.put(parts)
    if (this.disposed) {
      await this.backend.delete(parts.map((part) => part.key))
      throw new Error('临时文档存储已关闭')
    }
    for (const part of parts) this.keys.add(part.key)
    // Clear the original references too; an awaited parser promise can still
    // temporarily hold the original result object after publication.
    result.html = ''
    for (const segment of segments) segment.html = ''
    result.segments = descriptors
    result.htmlBytes = descriptors.reduce((sum, segment) => sum + segment.htmlBytes, 0)
    return result
  }

  async read(segment: RenderSegment): Promise<string> {
    if (!segment.storageKey) return segment.html
    if (this.disposed || !this.keys.has(segment.storageKey)) throw new Error('临时文档内容已释放，请重新打开文档。')
    return this.backend.get(segment.storageKey)
  }

  async release(result: ParseResult): Promise<void> {
    const keys = result.segments?.flatMap((segment) => segment.storageKey ? [segment.storageKey] : []) ?? []
    if (!keys.length) return
    for (const key of keys) this.keys.delete(key)
    await this.backend.delete(keys)
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.disposal = this.finishDisposal()
    return this.disposal
  }

  private async finishDisposal(): Promise<void> {
    await Promise.allSettled([...this.writes])
    try { await this.backend.delete([...this.keys]) }
    finally { this.keys.clear(); await this.backend.dispose() }
  }
}

const databaseName = 'markdown-preview-derived-segments-v1'
const leasePrefix = 'markdown-preview-segment-owner:'
const lifetimeMs = 24 * 60 * 60 * 1000
interface Owner { id: string; lastSeen: number }
interface StoredRecord { key: string; owner: string; html: string }

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('临时文档存储事务中断'))
    transaction.onerror = () => reject(transaction.error ?? new Error('临时文档存储失败（可能空间不足）'))
  })
}

/** IndexedDB is derived temporary data, not a workspace/document persistence layer. */
export class IndexedDbSegmentBackend implements SegmentStorageBackend {
  private owner = crypto.randomUUID()
  private ready: Promise<IDBDatabase> | undefined
  private releaseLease: (() => void) | undefined
  private disposed = false
  constructor(private factory: IDBFactory | undefined = globalThis.indexedDB,
    private locks: LockManager | undefined = globalThis.navigator?.locks) {}

  private database(): Promise<IDBDatabase> {
    if (this.disposed) return Promise.reject(new Error('临时文档存储已关闭'))
    this.ready ??= this.open()
    return this.ready
  }

  private async open(): Promise<IDBDatabase> {
    const factory = this.factory
    if (!factory) throw new Error('此环境无法使用长文档临时存储，请使用桌面应用或允许本地存储。')
    if (this.locks) await new Promise<void>((resolve, reject) => {
      void this.locks?.request(leasePrefix + this.owner, () => new Promise<void>((release) => {
        this.releaseLease = release
        resolve()
      })).catch(reject)
    })
    let database: IDBDatabase | undefined
    try {
      database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(databaseName, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          db.createObjectStore('owners', { keyPath: 'id' })
          db.createObjectStore('parts', { keyPath: 'key' }).createIndex('owner', 'owner')
        }
        request.onerror = () => reject(request.error ?? new Error('无法打开临时文档存储'))
        request.onsuccess = () => resolve(request.result)
      })
      // A held Web Lock protects an idle live reader without polling/heartbeats.
      // Without locks, other owners cannot safely be declared dead, so keep them.
      const held = this.locks ? new Set((await this.locks.query()).held?.map((lock) => lock.name)) : null
      const transaction = database.transaction(['owners', 'parts'], 'readwrite')
      const done = transactionDone(transaction)
      const owners = transaction.objectStore('owners')
      const parts = transaction.objectStore('parts')
      if (held) {
        const cursor = owners.openCursor()
        cursor.onsuccess = () => {
          const entry = cursor.result
          if (!entry) return
          const owner = entry.value as Owner
          if (owner.lastSeen < Date.now() - lifetimeMs && !held.has(leasePrefix + owner.id)) {
            const records = parts.index('owner').openCursor(IDBKeyRange.only(owner.id))
            records.onsuccess = () => { const record = records.result; if (record) { record.delete(); record.continue() } }
            entry.delete()
          }
          entry.continue()
        }
      }
      owners.put({ id: this.owner, lastSeen: Date.now() } satisfies Owner)
      await done
      return database
    } catch (error) {
      database?.close()
      this.releaseLease?.()
      throw error
    }
  }

  async put(parts: readonly StoredPart[]): Promise<void> {
    const db = await this.database()
    const transaction = db.transaction(['parts', 'owners'], 'readwrite')
    const done = transactionDone(transaction)
    for (const part of parts) transaction.objectStore('parts').put({
      key: `${this.owner}/${part.key}`, owner: this.owner, html: part.html,
    } satisfies StoredRecord)
    transaction.objectStore('owners').put({ id: this.owner, lastSeen: Date.now() } satisfies Owner)
    await done
  }

  async get(key: string): Promise<string> {
    const db = await this.database()
    const transaction = db.transaction(['parts', 'owners'], 'readwrite')
    const done = transactionDone(transaction)
    const request = transaction.objectStore('parts').get(`${this.owner}/${key}`)
    transaction.objectStore('owners').put({ id: this.owner, lastSeen: Date.now() } satisfies Owner)
    await done
    const record = request.result as StoredRecord | undefined
    if (!record) throw new Error('临时文档内容不可用，请刷新文档。')
    return record.html
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (!this.ready) return
    const db = await this.ready
    const transaction = db.transaction('parts', 'readwrite')
    const done = transactionDone(transaction)
    for (const key of keys) transaction.objectStore('parts').delete(`${this.owner}/${key}`)
    await done
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      if (!this.ready) return
      const db = await this.ready
      try {
        const transaction = db.transaction(['owners', 'parts'], 'readwrite')
        const done = transactionDone(transaction)
        const cursor = transaction.objectStore('parts').index('owner').openCursor(IDBKeyRange.only(this.owner))
        cursor.onsuccess = () => { const entry = cursor.result; if (entry) { entry.delete(); entry.continue() } }
        transaction.objectStore('owners').delete(this.owner)
        await done
      } finally { db.close() }
    } finally { this.releaseLease?.() }
  }
}

let shared: SegmentStore | undefined
export function defaultSegmentStore(): SegmentStore {
  shared ??= new SegmentStore(new IndexedDbSegmentBackend())
  return shared
}
export function readSegmentHtml(segment: RenderSegment): Promise<string> {
  return segment.storageKey ? defaultSegmentStore().read(segment) : Promise.resolve(segment.html)
}
export async function disposeSegmentStore(): Promise<void> {
  const current = shared
  shared = undefined
  await current?.dispose()
}
