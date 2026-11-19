// The Reader desktop has no terminal backend contribution. Remove the unused
// local PTY process and IPC channel while keeping the shared workbench APIs.
function replaceOnce(source, pattern, replacement = '') {
  const matches = source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))
  const [first, second] = matches
  if (!first || second) throw Error(`Review upstream Reader terminal change: ${pattern}`)
  return source.replace(pattern, replacement)
}

function patchApplication(source) {
  source = replaceOnce(source, /^import \{ ILocalPtyService, LocalReconnectConstants, TerminalIpcChannels, TerminalSettingId \} from '[^']+\/terminal\/common\/terminal\.js';\n/m)
  source = replaceOnce(source, /^import \{ createLocalPtyChannel \} from '[^']+\/localPtyChannel\.js';\n/m)
  source = replaceOnce(source, /^import \{ ElectronPtyHostStarter \} from '[^']+\/electronPtyHostStarter\.js';\n/m)
  source = replaceOnce(source, /^import \{ PtyHostService \} from '[^']+\/ptyHostService\.js';\n/m)
  source = replaceOnce(source, /^\t{4}appInstantiationService\.invokeFunction\(accessor => accessor\.get\(ILocalPtyService\)\.getLatency\(\)\),?\n/m)
  source = replaceOnce(source, /^\t\t\/\/ Terminal\n\t\tconst ptyHostStarter = [\s\S]+?\n\t\tservices\.set\(ILocalPtyService, ptyHostService\);\n\n/m)
  return replaceOnce(source, /^\t\t\/\/ Terminal\n\t\tconst ptyHostChannel = [^\n]+\n\t\tmainProcessElectronServer\.registerChannel\(TerminalIpcChannels\.LocalPty, ptyHostChannel\);\n\n/m)
}

function patchDesktopContribution(source) {
  source = replaceOnce(source.replace(/\r\n/g, '\n'), /^import \{ registerMainProcessRemoteService \} from '[^']+';\n/m)
  source = replaceOnce(source, /^import \{ ILocalPtyService, TerminalIpcChannels \} from '[^']+';\n/m)
  return replaceOnce(source, /^registerMainProcessRemoteService\(ILocalPtyService, TerminalIpcChannels\.LocalPty\);\n/m)
}

const sourcePatches = Object.freeze(Object.fromEntries(Object.entries({
  'src/vs/code/electron-main/app.ts': patchApplication,
  'build/next/index.ts': source => replaceOnce(source,
    /(^const desktopEntryPoints = \[\n[^\]]*)^\t'vs\/platform\/terminal\/node\/ptyHostMain',\n/m, '$1'),
  'build/next/resources.ts': source => replaceOnce(source,
    /(^const desktopResourcePatterns = \[\n[^\]]*?)(?:^\t'vs\/workbench\/contrib\/terminal\/common\/scripts\/[^\n]+\n)+/m, '$1'),
}).map(([path, patch]) => [path, source => patch(source.replace(/\r\n/g, '\n'))])))

module.exports = { sourcePatches, patchDesktopContribution }
