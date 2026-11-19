// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import WorkbenchStatusbar from '../../src/app/WorkbenchStatusbar.vue'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); document.body.replaceChildren() })

function mount() {
  const linkTarget = ref('')
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(WorkbenchStatusbar, {
    appTheme: 'light', markdownTheme: 'light', folderName: '', folderPath: '', documentLabel: 'docs › a.md',
    documentPath: 'D:/docs/a.md', documentName: 'a.md', encoding: 'utf-8', headingCount: 1, tabCount: 1,
    loadingName: '', linkTarget: linkTarget.value,
    env: { appVersion: '0.1.0', tauriVersion: '2', rustVersion: '1', os: 'windows', osVersion: 'Windows', webviewVersion: '156', locale: 'zh-CN' },
  }) })
  app.mount(host)
  cleanups.push(() => app.unmount())
  return { host, linkTarget }
}

it('shows hovered link as text then restores the document path', async () => {
  const { host, linkTarget } = mount()
  linkTarget.value = '<img src=x onerror=alert(1)>'
  await nextTick()
  expect(host.querySelector('[aria-label="链接目标"]')?.textContent).toBe(linkTarget.value)
  expect(host.querySelector('.status-location img')).toBeNull()
  expect(host.querySelector('[aria-label="文档路径"]')).toBeNull()
  linkTarget.value = ''
  await nextTick()
  expect(host.querySelector('[aria-label="文档路径"]')?.textContent).toBe('docs › a.md')
})

it('presents readable environment labels plus display and font information', async () => {
  const { host } = mount()
  host.querySelector<HTMLButtonElement>('[data-testid="status-environment"]')?.click()
  await nextTick()
  const dialog = host.querySelector('[role="dialog"]')
  expect(dialog?.textContent).toContain('应用版本')
  expect(dialog?.textContent).toContain('显示比例')
  expect(dialog?.textContent).toContain('界面字体')
  expect(dialog?.textContent).toContain('156')
})
