/** Queue secondary launches until initial restoration finishes; never race two open batches. */
export class IncomingFiles {
  private pending: string[][] = []
  private ready = false
  private disposed = false
  private queue: Promise<void> = Promise.resolve()

  constructor(private open: (paths: string[]) => Promise<unknown>, private report: (error: unknown) => void) {}

  receive(input: unknown): void {
    if (this.disposed || !Array.isArray(input)) return
    const paths = [...new Set(input.filter((path): path is string => typeof path === 'string'
      && path.length <= 32768 && !path.startsWith('-') && !Array.from(path).some((char) => char.charCodeAt(0) < 32)
      && /\.(md|markdown|mdown|mkd)$/i.test(path)))]
    if (!paths.length) return
    if (this.ready) this.enqueue(paths)
    else this.pending.push(paths)
  }

  start(): Promise<void> {
    if (!this.disposed) {
      this.ready = true
      for (const paths of this.pending.splice(0)) this.enqueue(paths)
    }
    return this.flush()
  }

  flush(): Promise<void> { return this.queue }
  dispose(): void { this.disposed = true; this.pending = [] }

  private enqueue(paths: string[]): void {
    this.queue = this.queue.then(async () => {
      if (!this.disposed) await this.open(paths)
    }).catch((error: unknown) => { if (!this.disposed) this.report(error) })
  }
}
