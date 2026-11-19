import { renderMarkdown } from '../core/markdown'
import type { ParseRequest, ParseResponse } from '../core/render/contract'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null
  postMessage(result: ParseResponse): void
}

scope.onmessage = (event) => {
  const request = event.data
  const start = performance.now()
  void renderMarkdown(request.text, {
    ...request.opts, jobId: request.jobId, generation: request.generation,
  }).then((result) => scope.postMessage(result)).catch((error: unknown) => {
    scope.postMessage({ ok: false, jobId: request.jobId, generation: request.generation,
      message: error instanceof Error ? error.message : String(error), parseMs: performance.now() - start })
  })
}
