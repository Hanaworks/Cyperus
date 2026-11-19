import { invoke } from '@tauri-apps/api/core'
import { bridge } from '../core/ipc'
import type { M0Hooks } from './protocol'

function waitForImage(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      observer.disconnect()
      image.removeEventListener('load', finish)
      image.removeEventListener('error', finish)
      resolve()
    }
    const check = () => {
      if (image.getAttribute('src')) {
        image.loading = 'eager'
        if (image.complete) finish()
      } else if (!image.dataset.mdSrc || image.alt.endsWith('（资源不可用）')) finish()
    }
    // DOM ready deliberately excludes resolveAssets. Observe its eventual src
    // or unavailable placeholder before waiting for the image's load/error.
    const observer = new MutationObserver(check)
    const timer = setTimeout(finish, 2500)
    observer.observe(image, { attributes: true, attributeFilter: ['src', 'alt'] })
    image.addEventListener('load', finish)
    image.addEventListener('error', finish)
    check()
  })
}

async function recordWorkspace(report: Record<string, unknown>, verify?: () => Promise<Record<string, unknown>>): Promise<void> {
  if (!verify) return
  report.stage = 'workbench'
  try { report.workbench = await verify() }
  catch (error) { (report.errors as string[]).push('UX: ' + String(error)) }
}

export async function runNativeProbe(
  config: { fixtureRoot: string; reportPath: string }, hooks: M0Hooks,
  openPath: (path: string) => Promise<boolean>,
  verifyWorkspace?: () => Promise<Record<string, unknown>>,
): Promise<void> {
  const report: Record<string, unknown> = { date: new Date().toISOString(), stage: 'ipc', env: await bridge.getEnvInfo(), ipc: [], fixtures: [], errors: [] }
  const ipc = report.ipc as unknown[]
  const fixtures = report.fixtures as unknown[]
  const errors = report.errors as string[]
  await invoke('write_m0_report', { report })
  for (const name of ['100kb', '1mb', '10mb', '50mb']) {
    try {
      const doc = await bridge.openDocument(`${config.fixtureRoot}/generated/${name}.md`)
      const start = performance.now()
      const raw = await invoke<unknown>('read_document', { docId: doc.docId })
      const isArrayBuffer = raw instanceof ArrayBuffer
      const byteLength = isArrayBuffer ? raw.byteLength : -1
      ipc.push({ name, expectedBytes: doc.size, byteLength, isArrayBuffer, readMs: performance.now() - start, ok: isArrayBuffer && byteLength === doc.size })
      await bridge.closeDocument(doc.docId)
    } catch (error) { errors.push(`IPC ${name}: ${String(error)}`) }
    await invoke('write_m0_report', { report })
  }
  report.stage = 'fixtures'
  for (const name of ['basic.md', 'extended.md', 'theme.md', 'cjk-typography.md', 'links.md', 'html-safety.md', 'tabs/a.md']) {
    try {
      if (!await openPath(`${config.fixtureRoot}/${name}`)) throw new Error('文档打开失败')
      const completed = await hooks.renderAll()
      if (completed.cancelled) throw new Error('全文遍历被新的阅读操作中断')
      const article = document.querySelector('article.md-doc')
      const images = [...(article?.querySelectorAll('img') ?? [])]
      await Promise.all(images.map(waitForImage))
      const before = hooks.stats().parseCount
      const app = document.querySelector<HTMLSelectElement>('[data-testid="app-theme"]')
      if (app) { app.value = app.value === 'dark' ? 'light' : 'dark'; app.dispatchEvent(new Event('change', { bubbles: true })) }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      fixtures.push({ name, headings: article?.querySelectorAll('h1,h2,h3,h4,h5,h6').length ?? 0,
        hasShiki: !!article?.querySelector('.shiki'), hasMath: !!article?.querySelector('.katex'),
        mermaidDone: completed.graphs.done, mermaidErrors: completed.graphs.error,
        mermaidPending: completed.graphs.pending, visitedSegments: completed.visitedSegments, totalSegments: completed.totalSegments,
        imagesLoaded: images.filter((image) => image.naturalWidth > 0).length,
        images: images.map((image) => ({ alt: image.alt, src: image.getAttribute('src'), width: image.naturalWidth })),
        themeDidNotParse: before === hooks.stats().parseCount, ...hooks.stats() })
    } catch (error) { errors.push(`${name}: ${String(error)}`) }
    await invoke('write_m0_report', { report })
  }
  await recordWorkspace(report, verifyWorkspace)
  report.complete = true
  report.stage = 'complete'
  await invoke('write_m0_report', { report })
}
