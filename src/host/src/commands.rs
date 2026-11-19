use crate::{
    documents::{DocMeta, DocumentRegistry, ResolvedAsset},
    error::{guard, AppError},
    folders::{DirectoryListing, FolderRegistry, FolderRoot},
    links::{self, ResolvedLink},
    m0::{M0Config, M0State},
    watcher::DocumentWatcher,
    workspace,
};
use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};

fn parse_selected_files(buffer: &[u16]) -> Result<Vec<String>, AppError> {
    let invalid = || AppError::PathForbidden("文件选择器返回无效路径".into());
    let mut parts = Vec::new();
    let mut offset = 0;
    loop {
        let end = buffer
            .get(offset..)
            .and_then(|s| s.iter().position(|c| *c == 0))
            .ok_or_else(invalid)?;
        if end == 0 {
            break;
        }
        parts.push(String::from_utf16(&buffer[offset..offset + end]).map_err(|_| invalid())?);
        offset += end + 1;
    }
    if parts.is_empty() {
        return Ok(vec![]);
    }
    let root = parts.remove(0);
    if !std::path::Path::new(&root).is_absolute() {
        return Err(invalid());
    }
    if parts.is_empty() {
        return Ok(vec![root]);
    }
    parts
        .into_iter()
        .map(|name| {
            if name.contains(['/', '\\', ':']) || name == "." || name == ".." {
                return Err(invalid());
            }
            Ok(std::path::Path::new(&root)
                .join(name)
                .to_string_lossy()
                .into_owned())
        })
        .collect()
}

#[cfg(test)]
mod picker_tests {
    use super::*;
    #[test]
    fn parses_cancel_single_and_multi_select_without_losing_unicode() {
        assert!(parse_selected_files(&[0, 0]).unwrap().is_empty());
        let single: Vec<u16> = "D:\\文档\\a.md\0\0".encode_utf16().collect();
        assert_eq!(parse_selected_files(&single).unwrap(), ["D:\\文档\\a.md"]);
        let multiple: Vec<u16> = "D:\\文档\0a.md\0中文.markdown\0\0".encode_utf16().collect();
        assert_eq!(
            parse_selected_files(&multiple).unwrap(),
            ["D:\\文档\\a.md", "D:\\文档\\中文.markdown"]
        );
    }
    #[test]
    fn rejects_unterminated_invalid_utf16_and_multi_select_path_injection() {
        assert!(parse_selected_files(&[65]).is_err());
        assert!(parse_selected_files(&[0xd800, 0, 0]).is_err());
        for name in [
            "../escape.md",
            "sub\\escape.md",
            "D:\\escape.md",
            "x:stream.md",
        ] {
            let buffer: Vec<u16> = format!("D:\\docs\0{name}\0\0").encode_utf16().collect();
            assert!(parse_selected_files(&buffer).is_err(), "{name}");
        }
    }
}

#[derive(Clone, Default)]
pub struct DocumentState(
    Arc<Mutex<DocumentRegistry>>,
    Arc<Mutex<Option<DocumentWatcher>>>,
);

impl DocumentState {
    pub fn start_watcher(&self, app: tauri::AppHandle) -> Result<(), AppError> {
        let watcher = DocumentWatcher::new(&self.0, move |change| {
            let result = match change {
                Ok(change) if change.gone => app.emit("doc:gone", serde_json::json!({"docId":change.doc_id,"version":change.version})),
                Ok(change) => app.emit("doc:changed", serde_json::json!({"docId":change.doc_id,"version":change.version,"kind":"modify"})),
                Err(error) => app.emit("app:error", &error),
            };
            if let Err(error) = result {
                eprintln!("无法发送文档事件: {error}");
            }
        })?;
        *self.1.lock() = Some(watcher);
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct WorkspaceState(Arc<Mutex<()>>);

#[derive(Clone, Default)]
pub struct FolderState(Arc<Mutex<FolderRegistry>>);

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tauri::async_runtime::spawn_blocking(move || guard(f))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn open_folder(
    state: State<'_, FolderState>,
    path: String,
) -> Result<FolderRoot, AppError> {
    let state = state.inner().clone();
    blocking(move || state.0.lock().open(&path)).await
}

#[tauri::command]
pub async fn list_directory(
    state: State<'_, FolderState>,
    root_id: String,
    path: String,
) -> Result<DirectoryListing, AppError> {
    let state = state.inner().clone();
    blocking(move || state.0.lock().list(&root_id, &path)).await
}

#[tauri::command]
pub async fn close_folder(state: State<'_, FolderState>, root_id: String) -> Result<(), AppError> {
    let state = state.inner().clone();
    blocking(move || {
        state.0.lock().close(&root_id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn open_document(
    state: State<'_, DocumentState>,
    path: String,
) -> Result<DocMeta, AppError> {
    let state = state.inner().clone();
    blocking(move || {
        let mut watcher = state.1.lock();
        let watcher = watcher
            .as_mut()
            .ok_or_else(|| AppError::WatchFailed("文件监听未启动".into()))?;
        let mut registry = state.0.lock();
        let meta = registry.open(&path)?;
        if let Err(error) = watcher.add(&meta.doc_id, std::path::Path::new(&meta.path)) {
            registry.close(&meta.doc_id);
            return Err(error);
        }
        Ok(meta)
    })
    .await
}

#[tauri::command]
pub async fn read_document(
    state: State<'_, DocumentState>,
    doc_id: String,
) -> Result<tauri::ipc::Response, AppError> {
    let state = state.inner().clone();
    blocking(move || state.0.lock().read(&doc_id).map(tauri::ipc::Response::new)).await
}

#[tauri::command]
pub async fn read_document_meta(
    state: State<'_, DocumentState>,
    doc_id: String,
) -> Result<DocMeta, AppError> {
    let state = state.inner().clone();
    blocking(move || state.0.lock().meta(&doc_id)).await
}

#[tauri::command]
pub async fn close_document(
    state: State<'_, DocumentState>,
    doc_id: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    blocking(move || {
        // Keep the same lifecycle lock order as open_document so a concurrent
        // reopen cannot register a watcher between unwatch and registry close.
        let mut watcher = state.1.lock();
        let removed = watcher.as_mut().map(|watcher| watcher.remove(&doc_id));
        state.0.lock().close(&doc_id);
        if let Some(result) = removed {
            result?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn resolve_link(
    state: State<'_, DocumentState>,
    doc_id: String,
    href: String,
) -> Result<ResolvedLink, AppError> {
    let state = state.inner().clone();
    blocking(move || {
        let registry = state.0.lock();
        let root = registry
            .path(&doc_id)?
            .parent()
            .ok_or_else(|| AppError::PathForbidden("无文档目录".into()))?;
        Ok(links::resolve(root, &href))
    })
    .await
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), AppError> {
    blocking(move || links::open_with_system(&links::checked_url(&url)?)).await
}

#[tauri::command]
pub async fn open_path_with_system(
    state: State<'_, DocumentState>,
    doc_id: String,
    path: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    blocking(move || {
        let registry = state.0.lock();
        let root = registry
            .path(&doc_id)?
            .parent()
            .ok_or_else(|| AppError::PathForbidden("无文档目录".into()))?;
        let path = links::checked_attachment(root, &path)?;
        links::open_with_system(&path.to_string_lossy())
    })
    .await
}

#[tauri::command]
pub async fn reveal_document(
    state: State<'_, DocumentState>,
    doc_id: String,
) -> Result<(), AppError> {
    let state = state.inner().clone();
    blocking(move || {
        let registry = state.0.lock();
        links::reveal(registry.path(&doc_id)?)
    })
    .await
}

#[tauri::command]
pub async fn load_workspace_state(
    app: tauri::AppHandle,
    state: State<'_, WorkspaceState>,
    m0: State<'_, M0State>,
    profile: State<'_, crate::desktop::Profile>,
) -> Result<Option<serde_json::Value>, AppError> {
    let path = match profile.file("workspace.json")?.or(m0.workspace_path()?) {
        Some(path) => path,
        None => app.path().app_config_dir()?.join("workspace.json"),
    };
    let state = state.inner().clone();
    blocking(move || {
        let _lock = state.0.lock();
        workspace::load(&path)
    })
    .await
}

#[tauri::command]
pub async fn save_workspace_state(
    app: tauri::AppHandle,
    workspace_state: State<'_, WorkspaceState>,
    m0: State<'_, M0State>,
    profile: State<'_, crate::desktop::Profile>,
    state: serde_json::Value,
) -> Result<(), AppError> {
    let path = match profile.file("workspace.json")?.or(m0.workspace_path()?) {
        Some(path) => path,
        None => app.path().app_config_dir()?.join("workspace.json"),
    };
    let workspace_state = workspace_state.inner().clone();
    blocking(move || {
        let _lock = workspace_state.0.lock();
        workspace::save(&path, &state)
    })
    .await
}

#[tauri::command]
pub async fn resolve_assets(
    app: tauri::AppHandle,
    state: State<'_, DocumentState>,
    doc_id: String,
    raws: Vec<String>,
) -> Result<Vec<ResolvedAsset>, AppError> {
    let state = state.inner().clone();
    blocking(move || {
        let results = state.0.lock().resolve_assets(&doc_id, raws)?;
        // The initial scope is empty. Reads never grant directory access.
        // Only each canonical file which passed the resource guard is authorized.
        let scope = app.asset_protocol_scope();
        for result in &results {
            if let Some(path) = &result.abs_path {
                scope
                    .allow_file(path)
                    .map_err(|e| AppError::AssetForbidden(e.to_string()))?;
            }
        }
        Ok(results)
    })
    .await
}

#[tauri::command]
pub fn get_m0_config(state: State<'_, M0State>) -> Option<M0Config> {
    state.config()
}

#[tauri::command]
pub fn write_m0_report(
    state: State<'_, M0State>,
    report: serde_json::Value,
) -> Result<(), AppError> {
    guard(|| state.write(report))
}

#[tauri::command]
pub async fn select_document(window: tauri::WebviewWindow) -> Result<Option<String>, AppError> {
    #[cfg(windows)]
    {
        let hwnd = window
            .hwnd()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .0 as isize;
        blocking(move || choose_documents(hwnd, false).map(|paths| paths.into_iter().next())).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(None)
    }
}

#[tauri::command]
pub async fn select_files(window: tauri::WebviewWindow) -> Result<Vec<String>, AppError> {
    #[cfg(windows)]
    {
        let hwnd = window
            .hwnd()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .0 as isize;
        blocking(move || choose_documents(hwnd, true)).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn select_folder(window: tauri::WebviewWindow) -> Result<Option<String>, AppError> {
    #[cfg(windows)]
    {
        let hwnd = window
            .hwnd()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .0 as isize;
        blocking(move || choose_folder(hwnd)).await
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(None)
    }
}

#[cfg(windows)]
fn choose_documents(owner: isize, multiple: bool) -> Result<Vec<String>, AppError> {
    use std::ffi::c_void;
    #[repr(C)]
    struct OpenFileName {
        struct_size: u32,
        owner: *mut c_void,
        instance: *mut c_void,
        filter: *const u16,
        custom_filter: *mut u16,
        max_custom_filter: u32,
        filter_index: u32,
        file: *mut u16,
        max_file: u32,
        file_title: *mut u16,
        max_file_title: u32,
        initial_dir: *const u16,
        title: *const u16,
        flags: u32,
        file_offset: u16,
        file_extension: u16,
        default_ext: *const u16,
        custom_data: isize,
        hook: Option<unsafe extern "system" fn(*mut c_void, u32, usize, isize) -> usize>,
        template: *const u16,
        reserved: *mut c_void,
        reserved_value: u32,
        flags_ex: u32,
    }
    #[link(name = "comdlg32")]
    extern "system" {
        fn GetOpenFileNameW(file: *mut OpenFileName) -> i32;
        fn CommDlgExtendedError() -> u32;
    }
    let filter: Vec<u16> =
        "Markdown (*.md;*.markdown;*.mdown;*.mkd)\0*.md;*.markdown;*.mdown;*.mkd\0\0"
            .encode_utf16()
            .collect();
    let mut file = vec![0u16; 262144];
    // OPENFILENAMEW permits NULL for all unused optional pointers and callbacks.
    let mut dialog: OpenFileName = unsafe { std::mem::zeroed() };
    dialog.struct_size = std::mem::size_of::<OpenFileName>() as u32;
    dialog.owner = owner as *mut c_void;
    dialog.filter = filter.as_ptr();
    dialog.filter_index = 1;
    dialog.file = file.as_mut_ptr();
    dialog.max_file = file.len() as u32;
    dialog.flags = 0x1000 | 0x800 | 0x80000 | 0x8 | 0x02000000;
    if multiple {
        dialog.flags |= 0x200;
    } // OFN_ALLOWMULTISELECT, Explorer NUL-separated format
    if unsafe { GetOpenFileNameW(&mut dialog) } == 0 {
        let error = unsafe { CommDlgExtendedError() };
        return if error == 0 {
            Ok(vec![])
        } else {
            Err(AppError::Internal(format!("文件选择器错误: {error}")))
        };
    }
    parse_selected_files(&file)
}

#[cfg(windows)]
fn choose_folder(owner: isize) -> Result<Option<String>, AppError> {
    use std::ffi::c_void;
    #[repr(C)]
    struct BrowseInfo {
        owner: *mut c_void,
        root: *const c_void,
        display_name: *mut u16,
        title: *const u16,
        flags: u32,
        callback: Option<unsafe extern "system" fn(*mut c_void, u32, isize, isize) -> i32>,
        parameter: isize,
        image: i32,
    }
    #[link(name = "shell32")]
    extern "system" {
        fn SHBrowseForFolderW(info: *mut BrowseInfo) -> *mut c_void;
        fn SHGetPathFromIDListEx(id: *const c_void, path: *mut u16, length: u32, flags: u32)
            -> i32;
    }
    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, flags: u32) -> i32;
        fn CoUninitialize();
        fn CoTaskMemFree(memory: *mut c_void);
    }
    // Each blocking-pool thread may already have a COM apartment; balance only
    // successful initializations, including S_FALSE (already initialized STA).
    let initialized = unsafe { CoInitializeEx(std::ptr::null_mut(), 0x2 | 0x4) };
    if initialized < 0 {
        return Err(AppError::Internal(format!(
            "无法初始化文件夹选择器: {initialized}"
        )));
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    let _apartment = Apartment;
    let title: Vec<u16> = "打开 Markdown 文件夹\0".encode_utf16().collect();
    let mut display = vec![0u16; 260];
    let mut info = BrowseInfo {
        owner: owner as *mut c_void,
        root: std::ptr::null(),
        display_name: display.as_mut_ptr(),
        title: title.as_ptr(),
        flags: 0x1 | 0x10 | 0x40,
        callback: None,
        parameter: 0,
        image: 0,
    };
    let selected = unsafe { SHBrowseForFolderW(&mut info) };
    if selected.is_null() {
        return Ok(None);
    }
    let mut path = vec![0u16; 32768];
    let result =
        unsafe { SHGetPathFromIDListEx(selected, path.as_mut_ptr(), path.len() as u32, 0) };
    unsafe { CoTaskMemFree(selected) };
    if result == 0 {
        return Err(AppError::PathForbidden("无法读取所选文件夹路径".into()));
    }
    let end = path.iter().position(|c| *c == 0).unwrap_or(path.len());
    String::from_utf16(&path[..end])
        .map(Some)
        .map_err(|_| AppError::PathForbidden("无效文件夹名".into()))
}
