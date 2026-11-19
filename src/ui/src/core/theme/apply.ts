export type AppTheme = 'light' | 'dark'
export type MarkdownTheme = 'light' | 'dark' | 'paper'

export function applyAppTheme(theme: AppTheme): void {
  document.documentElement.dataset.appTheme = theme
}

export function applyMarkdownTheme(article: HTMLElement, theme: MarkdownTheme): void {
  article.dataset.mdTheme = theme
}
