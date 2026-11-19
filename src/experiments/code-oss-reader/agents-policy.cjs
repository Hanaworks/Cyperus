// Desktop-only Agents window trimming for the pinned Code OSS checkout.
function replaceOnce(source, before, after = '') {
  if (source.split(before).length !== 2) throw Error(`Review upstream Agents window change: ${before.slice(0, 120)}`)
  return source.replace(before, after)
}

function replaceSection(source, start, end, replacement = '') {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first + start.length)
  if (first < 0 || last < 0 || source.indexOf(start, first + start.length) !== -1) {
    throw Error(`Review upstream Agents window section: ${start.trim()}`)
  }
  return source.slice(0, first) + replacement + source.slice(last)
}

function patchApplication(source) {
  const sessionLinkImport = "import { parseExternalOpenSessionLinkUri } from '../../platform/agentHost/common/openSessionLink.js';\n"
  const windowImport = "import { AgentsWindowOpenSource, isFolderToOpen, isWorkspaceToOpen, IWindowOpenable, parseExternalAgentsWindowNewSessionLinkUri } from '../../platform/window/common/window.js';\n"
  source = source.replace(sessionLinkImport, '')
  // The backend transform removes Agent Host imports, including this pure URL parser.
  source = replaceOnce(source, windowImport, windowImport.replace('AgentsWindowOpenSource, ', '') + sessionLinkImport)
  source = replaceOnce(source, 'if (!protocolUrl) {\n\t\t\t\tcontinue; // invalid',
    'if (!protocolUrl || this.isAgentsWindowProtocolUrl(protocolUrl.uri)) {\n\t\t\t\tcontinue;')
  source = replaceOnce(source, '\tprivate async handleProtocolUrl(', `\tprivate isAgentsWindowProtocolUrl(uri: URI): boolean {
		return !!(parseExternalOpenSessionLinkUri(uri, this.productService.urlProtocol)
			|| parseExternalAgentsWindowNewSessionLinkUri(uri, this.productService.urlProtocol));
	}

	private async handleProtocolUrl(`)
  source = replaceSection(source, '\t\tconst agentSessionLink = parseExternalOpenSessionLinkUri(uri,',
    "\t\t// Support 'workspace' URLs", `\t\tif (this.isAgentsWindowProtocolUrl(uri)) {
			return true;
		}

`)
  return replaceSection(source, '\t\t// Handle agents window first based on context',
    '\t\t\t// Openables can open as windows directly', '\t\tif (initialProtocolUrls) {\n')
}

function patchWindowsMainService(source) {
  source = replaceOnce(source, 'AgentsWindowOpenSource, IAgentsWindowDraft, ', '')
  source = replaceOnce(source, "import { VSBuffer } from '../../../base/common/buffer.js';\n")
  source = replaceOnce(source, "import { resolveAgentsWindowFolder, sendAgentsWindowOpenIntent } from './agentsWindow.js';\n")
  source = replaceSection(source, '\tasync openAgentsWindow(', '\tasync open(openConfig:', `\tasync openAgentsWindow(): Promise<ICodeWindow[]> {
		return [];
	}

`)
  source = replaceOnce(source, '\t\t\t\t\tif (lastSessionWindow.workspace) {', `\t\t\t\t\tif (lastSessionWindow.workspace) {
						if (isEqual(lastSessionWindow.workspace.configPath, this.environmentMainService.agentSessionsWorkspace)) {
							return undefined;
						}`)
  return replaceOnce(source,
    'isSessionsWindow: isWorkspaceIdentifier(options.workspace) && isEqual(options.workspace.configPath, this.environmentMainService.agentSessionsWorkspace),',
    'isSessionsWindow: false,')
}

function patchWindow(source) {
  source = replaceOnce(source, "import { join } from '../../../base/common/path.js';\n")
  source = replaceOnce(source, '\tprivate readonly _iconPath: URI | undefined;\n\tget iconPath(): URI | undefined { return this._iconPath; }',
    '\tget iconPath(): URI | undefined { return undefined; }')
  source = replaceSection(source, '\t\t\tif (config.isSessionsWindow) {', '\t\t\t// Create the browser window',
    '\n\t\t\tconst options = instantiationService.invokeFunction(defaultBrowserWindowOptions, this.windowState, undefined, webPreferences);\n\n')
  return replaceOnce(source, `\t\t} else if (configuration.isSessionsWindow) {
			windowUrl = FileAccess.asBrowserUri(\`vs/sessions/electron-browser/sessions\${this.environmentMainService.isBuilt ? '' : '-dev'}.html\`).toString(true);
`, '')
}

function patchHistory(source) {
  source = replaceOnce(source, "import { join } from '../../../base/common/path.js';\n")
  source = replaceOnce(source, "import { ChatAIDisabledSettingId } from '../../chat/common/chatSettings.js';\n")
  source = replaceOnce(source, "import { IConfigurationService } from '../../configuration/common/configuration.js';\n")
  source = replaceOnce(source, "import { getWorkspaceIdentifier } from '../common/workspaceIdentifier.js';\n")
  source = replaceOnce(source, ',\n\t\t@IConfigurationService private readonly configurationService: IConfigurationService\n', '\n')
  source = replaceSection(source, '\t\tconst result: Array<IRecentWorkspace | IRecentFolder> = [];',
    '\n\t}\n\n\tprivate isAgentSessionsWorkspace', '\t\treturn workspaces.filter(recent => !isRecentWorkspace(recent) || !this.isAgentSessionsWorkspace(recent.workspace));')
  source = source.replaceAll('canonicalizeAgentSessionsWorkspaces', 'filterAgentSessionsWorkspaces')
  source = replaceSection(source, '\n\t\tthis._register(this.configurationService.onDidChangeConfiguration(e => {', '\n\t}\n\n\tprivate async updateWindowsJumpList')
  return replaceSection(source, '\t\t// Agents Window (hidden when AI features are disabled)', '\t\tjumpList.push({')
}

function patchDesktopEntries(source) {
  for (const entry of ['vs/sessions/sessions.desktop.main', 'vs/sessions/electron-browser/sessions']) {
    source = replaceOnce(source, `\n\t'${entry}',\n`, '\n')
    source = replaceOnce(source, `\n\t\t\t\t'${entry}',\n`, '\n')
  }
  return source
}

const sourcePatches = Object.freeze(Object.fromEntries(Object.entries({
  'src/vs/code/electron-main/app.ts': patchApplication,
  'src/vs/platform/launch/electron-main/launchMainService.ts': source => replaceSection(source,
    '\t\t// Agents window\n', '\t\t// Start without file/folder arguments'),
  'src/vs/platform/environment/node/argv.ts': source => replaceSection(source,
    "\t'agents': { type: 'boolean', cat:", "\t'session-title-base64':", "\t'agents': { type: 'boolean', deprecates: ['sessions'] },\n"),
  'src/vs/platform/windows/electron-main/windowsMainService.ts': patchWindowsMainService,
  'src/vs/platform/windows/electron-main/windowImpl.ts': patchWindow,
  'src/vs/platform/workspaces/electron-main/workspacesHistoryMainService.ts': patchHistory,
  'build/next/index.ts': patchDesktopEntries,
  'build/next/resources.ts': source => replaceOnce(source, 'return desktopResourcePatterns;',
    "return desktopResourcePatterns.filter(pattern => !pattern.startsWith('vs/sessions/'));"),
  'build/gulpfile.vscode.ts': source => {
    source = replaceSection(source, "\t\t\t'vs/sessions/sessions.desktop.main.js',", '\t\t]);')
    return replaceOnce(source, "\t\t\t\t'resources/win32/sessions.ico',\n")
  },
}).map(([path, patch]) => [path, source => patch(source.replace(/\r\n/g, '\n'))])))

module.exports = { sourcePatches }
