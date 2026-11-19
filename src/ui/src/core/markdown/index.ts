import katexPlugin from '@vscode/markdown-it-katex'
import katex from 'katex'
import type { MarkdownIt } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import githubAlerts from 'markdown-it-github-alerts'
import type { BundledTheme, Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'
import type { ParseOptions, ParseResult, TocEntry } from '../render/contract'
import { installHeadingAnchors } from './anchors'
import type { MarkdownRenderEnv } from './augment'
import { installAugmentRules } from './augment'
import { resolvePlugin } from './pluginInterop'
import { COMMON_LANGS, installHighlighter } from './plugins'
import { createMarkdownIt, installLinkValidator, MARKDOWN_IT_OPTIONS } from './preset'
import { installTaskList } from './rules/taskList'
import { renderSegments, SEGMENT_THRESHOLD } from './segment'
import { extractToc } from './toc'

export type { BlockEntry, ParseOptions, ParseResult, TocEntry } from '../render/contract'
export { buildTocTree } from './toc'

export const DEFAULT_PARSE_OPTIONS: Readonly<ParseOptions> = Object.freeze({
  html: true,
  math: true,
  alerts: true,
  mermaid: true,
  shikiThemeLight: 'github-light',
  shikiThemeDark: 'github-dark',
})

export interface RenderMarkdownOptions extends Partial<ParseOptions> {
  jobId?: number
  generation?: number
}

interface Parser {
  key: string
  md: MarkdownIt
  unknownLangs: Set<string>
}

// 每个 Worker/模块实例只初始化一次高亮器；解析器在选项不变时复用。
let highlighterPromise: Promise<Highlighter | null> | undefined
const parserCache = new Map<boolean, Parser>()

async function getHighlighter(opts: ParseOptions): Promise<Highlighter | null> {
  highlighterPromise ??= createHighlighter({
    themes: ['github-light', 'github-dark'],
    langs: [...COMMON_LANGS],
  }).catch(() => null)

  const highlighter = await highlighterPromise
  if (!highlighter) return null

  try {
    for (const theme of [opts.shikiThemeLight, opts.shikiThemeDark]) {
      if (!highlighter.getLoadedThemes().includes(theme)) {
        await highlighter.loadTheme(theme as BundledTheme)
      }
    }
    return highlighter
  } catch {
    // 高亮资源失败时保留正文和纯文本代码块。
    return null
  }
}

function getParser(opts: ParseOptions, highlighter: Highlighter | null): Parser {
  const withHighlighting = highlighter !== null
  const key = JSON.stringify(opts)
  const cached = parserCache.get(withHighlighting)
  if (cached?.key === key) return cached

  const md = createMarkdownIt({ ...MARKDOWN_IT_OPTIONS, html: opts.html })
  const unknownLangs = new Set<string>()
  installLinkValidator(md)
  md.use(resolvePlugin(footnote))
  installHeadingAnchors(md)
  if (opts.alerts) md.use(resolvePlugin(githubAlerts))
  if (opts.math) md.use(resolvePlugin(katexPlugin), { katex, throwOnError: false, errorColor: '#cc0000' })
  installTaskList(md)
  if (highlighter) {
    installHighlighter(md, {
      highlighter,
      themeLight: opts.shikiThemeLight,
      themeDark: opts.shikiThemeDark,
      unknownLangs,
    })
  }
  installAugmentRules(md, { mermaid: opts.mermaid })

  const parser = { key, md, unknownLangs }
  parserCache.set(withHighlighting, parser)
  return parser
}

/** 提取源码编辑器的章节，不渲染 HTML 或加载代码高亮器。 */
export function parseMarkdownOutline(text: string): TocEntry[] {
  const { md } = getParser(DEFAULT_PARSE_OPTIONS, null)
  return extractToc(md.parse(text, {}))
}

/** 返回尚未消毒的 HTML 与元数据；插入 DOM 前由阅读层按 hasRawHtml 消毒。 */
export async function renderMarkdown(
  text: string,
  opts: RenderMarkdownOptions = {},
): Promise<ParseResult> {
  const options: ParseOptions = {
    html: opts.html ?? DEFAULT_PARSE_OPTIONS.html,
    math: opts.math ?? DEFAULT_PARSE_OPTIONS.math,
    alerts: opts.alerts ?? DEFAULT_PARSE_OPTIONS.alerts,
    mermaid: opts.mermaid ?? DEFAULT_PARSE_OPTIONS.mermaid,
    shikiThemeLight: opts.shikiThemeLight ?? DEFAULT_PARSE_OPTIONS.shikiThemeLight,
    shikiThemeDark: opts.shikiThemeDark ?? DEFAULT_PARSE_OPTIONS.shikiThemeDark,
  }
  const highlighter = await getHighlighter(options)
  const { md, unknownLangs } = getParser(options, highlighter)
  unknownLangs.clear()

  // 高亮器初始化不计入 parseMs；从这里起同步完成一次文档的全部解析与输出。
  const start = performance.now()
  const env: MarkdownRenderEnv = {}
  const tokens = md.parse(text, env)
  const toc = extractToc(tokens)
  const sourceBytes = new TextEncoder().encode(text).byteLength
  let html = sourceBytes < SEGMENT_THRESHOLD ? md.renderer.render(tokens, md.options, env) : ''
  // Small source can expand dramatically through syntax highlighting and math.
  const segments = sourceBytes >= SEGMENT_THRESHOLD || html.length >= SEGMENT_THRESHOLD
    ? renderSegments(md, tokens, env) : undefined
  if (segments) html = ''
  const htmlBytes = segments
    ? segments.reduce((sum, segment) => sum + new TextEncoder().encode(segment.html).byteLength, 0)
    : new TextEncoder().encode(html).byteLength

  return {
    ok: true,
    jobId: opts.jobId ?? 0,
    generation: opts.generation ?? 0,
    html,
    toc,
    blocks: env.blocks ?? [],
    mermaidCount: env.mermaidCount ?? 0,
    unknownLangs: [...unknownLangs],
    hasRawHtml: env.hasRawHtml ?? false,
    htmlBytes,
    sourceBytes,
    ...(segments ? { segments } : {}),
    parseMs: performance.now() - start,
  }
}
