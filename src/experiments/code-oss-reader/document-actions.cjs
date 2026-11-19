async function reopenSingleEditor(host, uri, editorId) {
  const group = host.window.tabGroups.activeTabGroup
  const current = group.activeTab?.input
  if (current?.uri?.toString() !== uri.toString()) {
    await host.commands.executeCommand('vscode.openWith', uri, editorId, { preview: false })
    return
  }
  // Native reopen expands a tab multiselection. Reopening the current input
  // first clears that selection, without creating a duplicate or losing its index.
  await host.commands.executeCommand('vscode.openWith', uri, current.viewType ?? 'default', { viewColumn: group.viewColumn, preview: false })
  if (host.window.tabGroups.activeTabGroup.activeTab?.input?.uri?.toString() !== uri.toString()) throw Error('当前文件已切换，请重试')
  await host.commands.executeCommand('reopenActiveEditorWith', editorId, uri)
}

module.exports = { reopenSingleEditor }
