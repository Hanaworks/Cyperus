// Worker 与渲染核心共用的消息类型。此模块不依赖 UI、DOM 或桌面宿主。
export interface ParseOptions {
  html: boolean
  math: boolean
  alerts: boolean
  mermaid: boolean
  shikiThemeLight: string
  shikiThemeDark: string
}

export interface ParseRequest {
  jobId: number
  docId: string
  generation: number
  text: string
  opts: ParseOptions
}

export interface TocEntry {
  level: number
  text: string
  id: string
  line: number
}

export interface BlockEntry {
  line: number
  endLine: number
  tag: string
}

export interface ParseResult {
  ok: true
  jobId: number
  generation: number
  html: string
  toc: TocEntry[]
  blocks: BlockEntry[]
  mermaidCount: number
  unknownLangs: string[]
  hasRawHtml: boolean
  htmlBytes: number
  parseMs: number
  sourceBytes?: number
  /** In segmented mode html is empty; these are the sole serialized HTML copies. */
  segments?: RenderSegment[]
}

export interface RenderSegment {
  html: string
  /** Derived temporary storage; never persisted in workspace reading state. */
  storageKey?: string
  htmlLength?: number
  htmlBytes?: number
  line: number
  endLine: number
  anchors: string[]
  oversized?: boolean
}

export interface ParseFailure {
  ok: false
  jobId: number
  generation: number
  message: string
  stack?: string
  parseMs: number
}

export type ParseResponse = ParseResult | ParseFailure
