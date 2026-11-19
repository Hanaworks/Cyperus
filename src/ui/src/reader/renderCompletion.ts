export interface RenderCompletion {
  visitedSegments: number
  totalSegments: number
  graphs: { done: number; error: number; pending: number }
  cancelled: boolean
}

/** Only IDs and terminal states survive segment eviction; no DOM/SVG is retained. */
export class RenderProgress {
  private visited = new Set<number>()
  private graphs = new Map<number, 'done' | 'error'>()
  constructor(private total: number, private graphCount: number) {}
  visit(index: number): void { this.visited.add(index) }
  collect(root: HTMLElement): void {
    for (const node of root.querySelectorAll<HTMLElement>('.md-mermaid[data-mermaid-id]')) {
      const id = Number(/^md-mermaid-(\d+)$/.exec(node.dataset.mermaidId ?? '')?.[1])
      if (id < 1 || id > this.graphCount || !Number.isInteger(id)) continue
      if (node.dataset.state === 'done' || node.dataset.state === 'error') this.graphs.set(id, node.dataset.state)
    }
  }
  result(cancelled = false): RenderCompletion {
    const terminal = [...this.graphs.values()]
    return { visitedSegments: this.visited.size, totalSegments: this.total, cancelled,
      graphs: { done: terminal.filter((state) => state === 'done').length,
        error: terminal.filter((state) => state === 'error').length, pending: this.graphCount - terminal.length } }
  }
}
