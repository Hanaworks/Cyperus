import { expect, type Page } from '@playwright/test'
import type { AppTheme, MarkdownTheme } from '../../src/core/theme/apply'

/** Exercise the always-visible theme controls in the bottom status bar. */
export async function setThemes(page: Page, appTheme?: AppTheme, markdownTheme?: MarkdownTheme): Promise<void> {
  const statusbar = page.getByRole('contentinfo')
  await expect(statusbar).toBeVisible()
  if (appTheme) {
    await expect(statusbar.getByTestId('app-theme')).toBeVisible()
    await statusbar.getByTestId('app-theme').selectOption(appTheme)
    await expect(statusbar.getByTestId('app-theme')).toHaveValue(appTheme)
    await expect(page.locator('html')).toHaveAttribute('data-app-theme', appTheme)
  }
  if (markdownTheme) {
    await expect(statusbar.getByTestId('md-theme')).toBeVisible()
    await statusbar.getByTestId('md-theme').selectOption(markdownTheme)
    await expect(statusbar.getByTestId('md-theme')).toHaveValue(markdownTheme)
    await expect(page.locator('article.md-doc')).toHaveAttribute('data-md-theme', markdownTheme)
  }
}

export async function openFolderFromMenu(page: Page): Promise<void> {
  await page.getByTestId('menu-file').click()
  await page.getByRole('menuitem', { name: '打开文件夹…', exact: true }).click()
  await expect(page.getByRole('tree', { name: '文件浏览器' })).toBeVisible()
}
