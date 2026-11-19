import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const cache = join(homedir(), 'AppData/Local/ms-playwright')
const executablePath = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
  .sort().reverse().map((name) => join(cache, name, 'chrome-win64/chrome.exe')).find(existsSync)
const browser = await chromium.launch(executablePath ? { executablePath } : {})
try {
  const page = await browser.newPage()
  const config = JSON.parse(readFileSync('src/host/tauri.conf.json', 'utf8'))
  if (config.app.security.freezePrototype || process.argv.includes('--freeze')) {
    await page.addInitScript(() => Object.freeze(Object.prototype))
  }
  const errors = []
  page.on('pageerror', (error) => errors.push(error.stack))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('http://127.0.0.1:1422/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src ipc: http://ipc.localhost; worker-src 'self' blob:; object-src 'none'" } })
  })
  await page.goto('http://127.0.0.1:1422/')
  await page.waitForTimeout(1000)
  console.log(JSON.stringify({ errors, text: (await page.locator('body').textContent())?.slice(0, 1500) }))
  if (errors.length || await page.locator('.app-shell').count() !== 1) process.exitCode = 1
} finally { await browser.close() }
