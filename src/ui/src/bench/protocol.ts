export interface OpenMetrics {
  parseMs: number
  htmlBytes: number
  mermaidCount: number
  hasRawHtml: boolean
  firstPaintMs: number
  fullRenderMs: number | null
}
export interface M0Hooks {
  openText(text: string, name: string): Promise<OpenMetrics>
  close(): Promise<void>
  renderAll(): Promise<RenderCompletion>
  stats(): { parseCount: number; parseMs: number; cache?: { budgetBytes: number; retainedHtmlBytes: number; storedHtmlBytes: number; overBudgetBytes: number }; segments?: number }
}
declare global { interface Window { __M0__?: M0Hooks } }

import type { RenderCompletion } from '../reader/renderCompletion'

export type { RenderCompletion } from '../reader/renderCompletion'
