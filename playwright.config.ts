import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright 配置。
 *
 * 默认跑「纯浏览器模式」：用 `VITE_IPC_MOCK=1` 启动 Vite dev server，
 * 不依赖 Tauri / Rust。这样 E2E 可在任何机器上跑。
 *
 * 真实 Tauri 窗口内的验证是手工验收项（见 docs/design/09-testing.md §10）。
 */
export default defineConfig({
  testDir: './src/ui/tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:1420',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // 与设计文档 08-performance.md §1 的基准窗口一致
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    command: 'pnpm --dir src/ui dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      VITE_IPC_MOCK: '1',
    },
  },
})
