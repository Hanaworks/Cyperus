import { expect, test } from '@playwright/test'

// Phase 0 / T02+T05 冒烟验证。
//
// 在**真实浏览器**里加载应用外壳，确认：
// - 页面能渲染（不是白屏）
// - IPC 桥接走的是 mockBridge
// - fixtures 被 Vite 正确收集（说明 glob 路径正确）
//
// 这不是完整 E2E（那是 T40），只是「骨架能跑起来」的证据。

test.describe('Phase 0 骨架冒烟', () => {
  test('页面加载并渲染外壳', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')

    // 外壳可见
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator('.workbench-titlebar')).toContainText('Cyperus')
    await expect(page.locator('.workbench-titlebar').getByRole('menubar')).toHaveCount(1)
    await expect(page.getByRole('menubar', { name: '应用菜单' })).toBeVisible()
    await expect(page.getByTestId('command-center')).toHaveCount(0)
    const statusbar = page.getByRole('contentinfo')
    await expect(statusbar.getByRole('combobox', { name: '界面主题', exact: true })).toBeVisible()
    await expect(statusbar.getByRole('combobox', { name: '正文主题', exact: true })).toBeVisible()
    await expect(statusbar.getByTestId('app-theme')).toHaveValue('light')
    await expect(statusbar.getByTestId('md-theme')).toHaveValue('light')
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')

    // 走的是 mockBridge
    await expect(page.getByTestId('fixture-select')).toBeVisible()

    // 通过帮助菜单读取实时桥接信息。
    await page.getByTestId('menu-help').click()
    await page.getByRole('menuitem', { name: '环境信息', exact: true }).click()
    const diagnostics = statusbar.getByRole('dialog', { name: '环境信息', exact: true })
    await expect(diagnostics).toBeVisible()
    await expect(diagnostics).toContainText('应用版本')
    await expect(diagnostics).toContainText('0.1.0-mock')
    await page.keyboard.press('Escape')
    await expect(diagnostics).toBeHidden()

    expect(errors, `页面有 JS 错误：\n${errors.join('\n')}`).toEqual([])
  })

  test('fixtures 被正确收集并列出', async ({ page }) => {
    await page.goto('/')

    const list = page.getByTestId('fixture-select')

    // 关键夹具都应出现（证明 import.meta.glob 的相对路径正确）
    for (const name of [
      'basic.md',
      'extended.md',
      'links.md',
      'theme.md',
      'cjk-typography.md',
      'html-safety.md',
    ]) {
      await expect(list, `夹具列表缺少 ${name}`).toContainText(name)
    }

    // tabs/ 子目录也应被递归收集
    await expect(list).toContainText('tabs/a.md')
    await expect(list).toContainText('tabs/t.md')
  })

  test('页面无外部网络请求（离线可用）', async ({ page }) => {
    const external: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (
        !url.startsWith('http://127.0.0.1:1420') &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:')
      ) {
        external.push(url)
      }
    })

    await page.goto('/')
    await expect(page.locator('.app-shell')).toBeVisible()
    await page.waitForTimeout(1500)

    expect(external, `存在外部网络请求：\n${external.join('\n')}`).toEqual([])
  })
})
