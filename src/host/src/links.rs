use crate::{
    documents::{is_markdown, resolve_asset},
    error::AppError,
};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResolvedLink {
    Anchor {
        anchor: String,
    },
    LocalMd {
        abs_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
    },
    Asset {
        abs_path: String,
    },
    External {
        url: String,
    },
    Blocked {
        reason: &'static str,
    },
}

fn decode(raw: &str) -> Result<String, AppError> {
    let bytes = raw.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && (index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit())
        {
            return Err(AppError::UrlBlocked("无效百分号编码".into()));
        }
    }
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| AppError::UrlBlocked("无效 UTF-8".into()))?;
    if decoded.chars().any(char::is_control) {
        return Err(AppError::UrlBlocked("链接含控制字符".into()));
    }
    Ok(decoded.into_owned())
}

pub fn checked_url(raw: &str) -> Result<String, AppError> {
    if raw.is_empty() || raw.len() > 4096 || raw != raw.trim() || raw.contains('\\') {
        return Err(AppError::UrlBlocked("无效外部链接".into()));
    }
    let decoded = decode(raw)?;
    if decoded.contains('\\') {
        return Err(AppError::UrlBlocked("无效外部链接".into()));
    }
    let url = tauri::Url::parse(raw).map_err(|_| AppError::UrlBlocked("无效外部链接".into()))?;
    match url.scheme() {
        "http" | "https"
            if url.host_str().is_some()
                && raw.split_once(':').is_some_and(|(_, rest)| {
                    rest.starts_with("//") && !rest.starts_with("///")
                }) =>
        {
            Ok(url.to_string())
        }
        "mailto" if !url.path().is_empty() && !url.path().starts_with('/') => Ok(url.to_string()),
        _ => Err(AppError::UrlBlocked("不支持的链接类型".into())),
    }
}

fn attachment_allowed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "pdf" | "txt"
            )
        })
}

pub fn resolve(root: &Path, href: &str) -> ResolvedLink {
    let href = href.trim();
    let blocked = |reason| ResolvedLink::Blocked { reason };
    if href.is_empty() {
        return blocked("empty");
    }
    if href.len() > 4096 || decode(href).is_err() {
        return blocked("invalid-path");
    }
    if let Some(anchor) = href.strip_prefix('#') {
        return ResolvedLink::Anchor {
            anchor: decode(anchor).expect("already validated"),
        };
    }
    if href.starts_with(['/', '\\'])
        || (href.as_bytes().get(1) == Some(&b':') && href.as_bytes()[0].is_ascii_alphabetic())
    {
        return blocked("outside-scope");
    }
    if let Some((scheme, _)) = href.split_once(':') {
        return match scheme.to_ascii_lowercase().as_str() {
            "http" | "https" | "mailto" => checked_url(href)
                .map(|url| ResolvedLink::External { url })
                .unwrap_or_else(|_| blocked("invalid-path")),
            "javascript" | "vbscript" | "data" | "file" | "asset" => blocked("scheme"),
            _ => blocked("unknown-scheme"),
        };
    }
    // Split before decoding so an encoded # or ? in a filename stays a filename.
    let (path_query, fragment) = href
        .split_once('#')
        .map_or((href, None), |(p, f)| (p, Some(f)));
    let raw_path = path_query.split_once('?').map_or(path_query, |(p, _)| p);
    let result = resolve_asset(root, raw_path.into());
    match result.verdict {
        "outside" => blocked("outside-scope"),
        "notFound" => blocked("target-not-found"),
        "ok" => {
            let path = result.abs_path.expect("allowed asset has canonical path");
            if is_markdown(Path::new(&path)) {
                ResolvedLink::LocalMd {
                    abs_path: path,
                    anchor: fragment.map(|f| decode(f).expect("already validated")),
                }
            } else if attachment_allowed(Path::new(&path)) {
                ResolvedLink::Asset { abs_path: path }
            } else {
                blocked("invalid-path")
            }
        }
        _ => blocked("invalid-path"),
    }
}

// The IPC receives the absolute path returned by resolve_link. Convert it back
// to a relative spelling and run the full guard again immediately before open.
pub fn checked_attachment(root: &Path, path: &str) -> Result<PathBuf, AppError> {
    if path.len() > 32768 || path.chars().any(char::is_control) {
        return Err(AppError::AssetForbidden("无效附件路径".into()));
    }
    let path = Path::new(path);
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::AssetForbidden("附件超出文档目录".into()))?;
    // Encode literal reserved characters to avoid a second interpretation of %.
    const RESERVED: &percent_encoding::AsciiSet =
        &percent_encoding::CONTROLS.add(b'%').add(b'#').add(b'?');
    let raw =
        percent_encoding::utf8_percent_encode(&relative.to_string_lossy(), RESERVED).to_string();
    let result = resolve_asset(root, raw);
    if result.verdict != "ok" {
        return Err(AppError::AssetForbidden("附件路径无效或已改变".into()));
    }
    let canonical = PathBuf::from(result.abs_path.expect("allowed path"));
    if canonical != path || !attachment_allowed(&canonical) {
        return Err(AppError::AssetForbidden(
            "不允许打开该附件类型或路径".into(),
        ));
    }
    Ok(canonical)
}

#[cfg(windows)]
pub fn open_with_system(target: &str) -> Result<(), AppError> {
    use std::ffi::c_void;
    if target.chars().any(char::is_control) {
        return Err(AppError::UrlBlocked("无效打开目标".into()));
    }
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            owner: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }
    let operation: Vec<_> = "open\0".encode_utf16().collect();
    let target: Vec<_> = target.encode_utf16().chain(Some(0)).collect();
    // No command interpreter, arguments, or working directory from the document.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    } as isize;
    if result <= 32 {
        return Err(AppError::Internal(format!("系统无法打开目标 ({result})")));
    }
    Ok(())
}

#[cfg(windows)]
pub fn reveal(path: &Path) -> Result<(), AppError> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt};
    #[link(name = "shell32")]
    extern "system" {
        fn SHParseDisplayName(
            name: *const u16,
            bind: *mut c_void,
            id: *mut *mut c_void,
            attributes: u32,
            out_attributes: *mut u32,
        ) -> i32;
        fn SHOpenFolderAndSelectItems(
            folder: *const c_void,
            count: u32,
            children: *const *const c_void,
            flags: u32,
        ) -> i32;
    }
    #[link(name = "ole32")]
    extern "system" {
        fn CoInitializeEx(reserved: *mut c_void, flags: u32) -> i32;
        fn CoUninitialize();
        fn CoTaskMemFree(memory: *mut c_void);
    }
    let initialized = unsafe { CoInitializeEx(std::ptr::null_mut(), 2) };
    // RPC_E_CHANGED_MODE means this blocking thread already has another apartment.
    if initialized < 0 && initialized != 0x80010106_u32 as i32 {
        return Err(AppError::Internal("无法打开文件位置".into()));
    }
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut id = std::ptr::null_mut();
    let parsed = unsafe {
        SHParseDisplayName(
            wide.as_ptr(),
            std::ptr::null_mut(),
            &mut id,
            0,
            std::ptr::null_mut(),
        )
    };
    let result = if parsed >= 0 {
        unsafe { SHOpenFolderAndSelectItems(id, 0, std::ptr::null(), 0) }
    } else {
        parsed
    };
    unsafe {
        if !id.is_null() {
            CoTaskMemFree(id);
        }
        if initialized >= 0 {
            CoUninitialize();
        }
    }
    if result < 0 {
        Err(AppError::Internal(format!("无法打开文件位置 ({result})")))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn open_with_system(_target: &str) -> Result<(), AppError> {
    Err(AppError::Internal("当前平台暂不支持系统打开".into()))
}
#[cfg(not(windows))]
pub fn reveal(_path: &Path) -> Result<(), AppError> {
    Err(AppError::Internal("当前平台暂不支持文件定位".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn external_policy_rejects_protocols_controls_and_mail_header_injection() {
        for input in [
            "https://example.com/a?q=1#x",
            "HTTP://example.com",
            "mailto:a@example.com?subject=Hello%20there",
        ] {
            assert!(checked_url(input).is_ok(), "{input}");
        }
        for input in [
            "javascript:alert(1)",
            "file:///C:/a.md",
            "data:text/html,x",
            "https:",
            "https:///",
            "mailto:",
            "mailto:a@b?subject=x%0d%0aBcc:evil@x",
            "https://a/\n",
            "https://a/%00",
            "https://a/%QQ",
            "\\\\server\\share",
            "https://a/\\b",
        ] {
            assert!(checked_url(input).is_err(), "{input}");
        }
    }

    #[test]
    fn links_decode_fragments_and_paths_once_and_reject_unsafe_targets() {
        let root = std::env::temp_dir().join(format!("md-links-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("中文.MD"), "# 章节").unwrap();
        fs::write(root.join("hello.pdf"), "pdf").unwrap();
        fs::write(root.join("run.exe"), "exe").unwrap();
        fs::write(root.join("run.lnk"), "link").unwrap();
        fs::write(root.join("percent%20name.md"), "# literal").unwrap();
        let root = dunce::canonicalize(root).unwrap();
        assert_eq!(
            serde_json::to_value(resolve(&root, "#%E4%B8%AD%E6%96%87")).unwrap(),
            serde_json::json!({"kind":"anchor","anchor":"中文"})
        );
        let local = serde_json::to_value(resolve(
            &root,
            "./%E4%B8%AD%E6%96%87.MD?query=1#%E7%AB%A0%E8%8A%82",
        ))
        .unwrap();
        assert_eq!(local["kind"], "localMd");
        assert_eq!(local["anchor"], "章节");
        assert_eq!(local["absPath"], root.join("中文.MD").to_str().unwrap());
        assert!(matches!(
            resolve(&root, "percent%2520name.md"),
            ResolvedLink::LocalMd { .. }
        ));
        assert!(matches!(
            resolve(&root, "hello.pdf"),
            ResolvedLink::Asset { .. }
        ));
        for (raw, reason) in [
            ("", "empty"),
            ("../x.md", "outside-scope"),
            ("C:\\x.md", "outside-scope"),
            ("\\\\server\\x.md", "outside-scope"),
            ("file:///x.md", "scheme"),
            ("chrome://settings", "unknown-scheme"),
            ("missing.md", "target-not-found"),
            ("run.exe", "invalid-path"),
            ("run.lnk", "invalid-path"),
            ("bad%QQ.md", "invalid-path"),
        ] {
            assert_eq!(
                serde_json::to_value(resolve(&root, raw)).unwrap(),
                serde_json::json!({"kind":"blocked","reason":reason}),
                "{raw}"
            );
        }
        assert!(checked_attachment(&root, root.join("hello.pdf").to_str().unwrap()).is_ok());
        assert!(checked_attachment(&root, root.join("run.exe").to_str().unwrap()).is_err());
        assert!(checked_attachment(
            &root,
            root.parent().unwrap().join("outside.pdf").to_str().unwrap()
        )
        .is_err());
        assert!(checked_attachment(&root, "hello.pdf").is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
