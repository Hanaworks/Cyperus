import { parentPort } from 'node:worker_threads'
import { parseMarkdownOutline, renderMarkdown } from '../../ui/src/core/markdown/index.ts'

let queue = Promise.resolve()
parentPort.on('message', ({ id, text, generation, outlineOnly }) => {
  queue = queue.then(async () => {
    try {
      const result = outlineOnly ? parseMarkdownOutline(text) : await renderMarkdown(text, { jobId: id, generation })
      parentPort.postMessage({ id, result })
    }
    catch (error) { parentPort.postMessage({ id, error: String(error) }) }
  })
})
