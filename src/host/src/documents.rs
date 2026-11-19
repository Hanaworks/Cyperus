//! Versioned document reads and resource confinement. No content cache.

use crate::error::AppError;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_DOCUMENT_BYTES: u64 = 200 * 1024 * 1024;
const SEGMENT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ASSET_BATCH: usize = 500;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocMeta {
    pub doc_id: String,
    pub path: String,
    pub dir: String,
    pub name: String,
    pub size: u64,
    pub mtime_ms: u64,
    pub encoding: String,
    pub had_bom: bool,
    pub version: u64,
    pub too_large: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAsset {
    pub raw: String,
    pub verdict: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abs_path: Option<String>,
}

#[derive(Default)]
pub struct DocumentRegistry {
    by_id: HashMap<String, PathBuf>,
    by_path: HashMap<PathBuf, String>,
    revisions: HashMap<String, Revision>,
}

#[derive(Clone, Debug, PartialEq)]
struct Fingerprint {
    size: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
}

#[derive(Debug)]
struct Revision {
    version: u64,
    emitted_version: u64,
    fingerprint: Option<Fingerprint>,
}

#[derive(Clone, Debug)]
pub struct DocumentChange {
    pub doc_id: String,
    pub version: u64,
    pub gone: bool,
}

fn fingerprint(path: &Path) -> Result<Option<Fingerprint>, AppError> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some(Fingerprint {
            size: metadata.len(),
            modified: metadata.modified()?,
            created: metadata.created().ok(),
        })),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

// Editors can temporarily deny access or remove a file while replacing it.
// Keep retries short and bounded; a genuinely missing file still reports gone.
fn retry_read<T>(mut read: impl FnMut() -> Result<T, AppError>) -> Result<T, AppError> {
    for delay in [20, 40, 80] {
        match read() {
            Err(AppError::FileNotFound(_) | AppError::FileAccess(_)) => {
                std::thread::sleep(Duration::from_millis(delay));
            }
            result => return result,
        }
    }
    read()
}

impl DocumentRegistry {
    pub fn open(&mut self, path: &str) -> Result<DocMeta, AppError> {
        if path.is_empty() || path.contains('\0') || path.len() > 32768 {
            return Err(AppError::PathForbidden("无效文档路径".into()));
        }
        let path = dunce::canonicalize(path)?;
        if !is_markdown(&path) {
            return Err(AppError::PathForbidden("仅支持 Markdown 文档".into()));
        }
        let id = self
            .by_path
            .get(&path)
            .cloned()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut meta = retry_read(|| document_meta(&id, &path))?;
        let current = fingerprint(&path)?;
        let revision = self.revisions.entry(id.clone()).or_insert(Revision {
            version: 1,
            emitted_version: 1,
            fingerprint: current.clone(),
        });
        if revision.fingerprint != current {
            revision.version += 1;
            revision.fingerprint = current;
        }
        meta.version = revision.version;
        self.by_path.insert(path.clone(), id.clone());
        self.by_id.insert(id, path);
        Ok(meta)
    }

    pub fn path(&self, doc_id: &str) -> Result<&Path, AppError> {
        let path = self.by_id.get(doc_id).ok_or(AppError::DocUnknown)?;
        // Recheck before every read: a stored file must not become an escaping symlink.
        if dunce::canonicalize(path)? != *path {
            return Err(AppError::PathForbidden("文档路径已改变".into()));
        }
        Ok(path)
    }

    pub fn read(&mut self, doc_id: &str) -> Result<Vec<u8>, AppError> {
        retry_read(|| self.read_once(doc_id))
    }

    fn read_once(&mut self, doc_id: &str) -> Result<Vec<u8>, AppError> {
        self.refresh(doc_id, false)?;
        let path = self.path(doc_id)?.to_path_buf();
        let before = fingerprint(&path)?;
        let mut file = checked_file(&path)?;
        let mut bytes = Vec::with_capacity(file.metadata()?.len().min(MAX_DOCUMENT_BYTES) as usize);
        // Bound allocation even if the file grows after the metadata check.
        (&mut file)
            .take(MAX_DOCUMENT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(AppError::FileTooLarge(bytes.len() as u64));
        }
        let after = fingerprint(&path)?;
        self.refresh(doc_id, false)?;
        if before != after || dunce::canonicalize(&path)? != path {
            return Err(AppError::FileAccess("文档正在保存，请稍后重试".into()));
        }
        crate::encoding::detect(&bytes, true)?;
        Ok(bytes)
    }

    pub fn meta(&mut self, doc_id: &str) -> Result<DocMeta, AppError> {
        retry_read(|| {
            self.refresh(doc_id, false)?;
            let before = self
                .revisions
                .get(doc_id)
                .ok_or(AppError::DocUnknown)?
                .fingerprint
                .clone();
            let mut meta = document_meta(doc_id, self.path(doc_id)?)?;
            self.refresh(doc_id, false)?;
            let revision = self.revisions.get(doc_id).ok_or(AppError::DocUnknown)?;
            if revision.fingerprint != before {
                return Err(AppError::FileAccess("文档正在保存，请稍后重试".into()));
            }
            meta.version = revision.version;
            Ok(meta)
        })
    }

    fn refresh(&mut self, doc_id: &str, force: bool) -> Result<(), AppError> {
        let path = self.by_id.get(doc_id).ok_or(AppError::DocUnknown)?;
        let current = fingerprint(path)?;
        let revision = self.revisions.get_mut(doc_id).ok_or(AppError::DocUnknown)?;
        if current != revision.fingerprint || (force && current.is_some()) {
            revision.version += 1;
            revision.fingerprint = current;
        }
        Ok(())
    }

    pub fn refresh_paths(
        &mut self,
        paths: &[PathBuf],
        force: bool,
    ) -> Vec<Result<DocumentChange, AppError>> {
        let ids: Vec<_> = self
            .by_id
            .iter()
            .filter(|(_, path)| {
                paths
                    .iter()
                    .any(|changed| path == &changed || path.starts_with(changed))
            })
            .map(|(id, _)| id.clone())
            .collect();
        let mut changes = Vec::new();
        for id in ids {
            if let Err(error) = retry_read(|| self.refresh(&id, force)) {
                changes.push(Err(error));
                continue;
            }
            let revision = self.revisions.get_mut(&id).expect("registered revision");
            // A metadata read may already have observed deletion before notify.
            // It must not consume the notification that other readers need.
            if revision.version > revision.emitted_version {
                revision.emitted_version = revision.version;
                changes.push(Ok(DocumentChange {
                    doc_id: id,
                    version: revision.version,
                    gone: revision.fingerprint.is_none(),
                }));
            }
        }
        changes
    }

    pub fn close(&mut self, doc_id: &str) {
        if let Some(path) = self.by_id.remove(doc_id) {
            self.by_path.remove(&path);
            self.revisions.remove(doc_id);
        }
    }

    pub fn resolve_assets(
        &self,
        doc_id: &str,
        raws: Vec<String>,
    ) -> Result<Vec<ResolvedAsset>, AppError> {
        let root = self
            .path(doc_id)?
            .parent()
            .ok_or_else(|| AppError::PathForbidden("无文档目录".into()))?;
        if raws.len() > MAX_ASSET_BATCH {
            return Err(AppError::AssetForbidden("每批最多 500 个资源".into()));
        }
        Ok(raws
            .into_iter()
            .map(|raw| resolve_asset(root, raw))
            .collect())
    }
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        matches!(
            e.to_ascii_lowercase().as_str(),
            "md" | "markdown" | "mdown" | "mkd"
        )
    })
}

fn checked_file(path: &Path) -> Result<File, AppError> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(AppError::PathForbidden("文档不是普通文件".into()));
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(AppError::FileTooLarge(metadata.len()));
    }
    Ok(file)
}

fn document_meta(doc_id: &str, path: &Path) -> Result<DocMeta, AppError> {
    let mut file = checked_file(path)?;
    let metadata = file.metadata()?;
    let mut prefix = Vec::new();
    (&mut file)
        .take(crate::encoding::SAMPLE_BYTES as u64)
        .read_to_end(&mut prefix)?;
    let detected = crate::encoding::detect(&prefix, metadata.len() == prefix.len() as u64)?;
    Ok(DocMeta {
        doc_id: doc_id.into(),
        path: path.to_string_lossy().into_owned(),
        dir: path
            .parent()
            .ok_or_else(|| AppError::PathForbidden("无文档目录".into()))?
            .to_string_lossy()
            .into_owned(),
        name: path
            .file_name()
            .ok_or_else(|| AppError::PathForbidden("无文档名".into()))?
            .to_string_lossy()
            .into_owned(),
        size: metadata.len(),
        mtime_ms: metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        encoding: detected.label.into(),
        had_bom: detected.had_bom,
        version: 1, // The registry supplies the current revision.
        too_large: metadata.len() > SEGMENT_BYTES,
    })
}

pub(crate) fn resolve_asset(root: &Path, raw: String) -> ResolvedAsset {
    let mut result = ResolvedAsset {
        raw,
        verdict: "invalid",
        abs_path: None,
    };
    let raw = &result.raw;
    if raw.is_empty() || raw.len() > 4096 {
        return result;
    }
    // percent_decode_str intentionally leaves malformed escapes unchanged; reject them first.
    let bytes = raw.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && (i + 2 >= bytes.len()
                || !bytes[i + 1].is_ascii_hexdigit()
                || !bytes[i + 2].is_ascii_hexdigit())
        {
            return result;
        }
    }
    let Ok(decoded) = percent_encoding::percent_decode_str(raw).decode_utf8() else {
        return result;
    };
    let normalized = decoded.replace('\\', "/");
    if normalized.contains('\0') {
        return result;
    }
    if normalized.starts_with('/')
        || (normalized.as_bytes().get(1) == Some(&b':')
            && normalized.as_bytes()[0].is_ascii_alphabetic())
    {
        result.verdict = "outside";
        return result;
    }
    if normalized.contains(':') || normalized.contains(['?', '#']) {
        return result;
    }
    let mut target = root.to_path_buf();
    for component in Path::new(&normalized).components() {
        match component {
            Component::CurDir => (),
            Component::ParentDir => {
                if target == root {
                    result.verdict = "outside";
                    return result;
                }
                target.pop();
            }
            Component::Normal(part) => {
                target.push(part);
                // Reject symlink and junction components, even when they currently point inside.
                if let Ok(metadata) = fs::symlink_metadata(&target) {
                    if metadata.file_type().is_symlink() {
                        result.verdict = "outside";
                        return result;
                    }
                }
            }
            _ => {
                result.verdict = "outside";
                return result;
            }
        }
    }
    match dunce::canonicalize(&target) {
        Ok(path) if !path.starts_with(root) => result.verdict = "outside",
        Ok(path) if path.is_file() => {
            result.verdict = "ok";
            result.abs_path = Some(path.to_string_lossy().into_owned());
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => result.verdict = "notFound",
        Err(_) => (),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("md-preview-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
        fn open(&self, registry: &mut DocumentRegistry) -> DocMeta {
            registry
                .open(self.write("文档.MD", b"# title\n").to_str().unwrap())
                .unwrap()
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn open_deduplicates_canonical_paths_and_serializes_the_contract() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        let again = registry
            .open(dir.0.join(".").join("文档.MD").to_str().unwrap())
            .unwrap();
        assert_eq!(meta.doc_id, again.doc_id);
        assert_eq!(meta.name, "文档.MD");
        assert_eq!(
            meta.path,
            dunce::canonicalize(dir.0.join("文档.MD"))
                .unwrap()
                .to_str()
                .unwrap()
        );
        assert_eq!(meta.size, 8);
        assert!(meta.mtime_ms > 0);
        let json = serde_json::to_value(meta).unwrap();
        let keys: Vec<_> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(
            keys,
            [
                "dir", "docId", "encoding", "hadBom", "mtimeMs", "name", "path", "size",
                "tooLarge", "version"
            ]
        );
    }

    #[test]
    fn raw_reads_preserve_utf8_bom_and_meta_refreshes_file_size() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let path = dir.write("bom.md", b"\xef\xbb\xbf# hello\n");
        let meta = registry.open(path.to_str().unwrap()).unwrap();
        assert_eq!(meta.encoding, "utf-8");
        assert!(meta.had_bom);
        assert_eq!(
            registry.read(&meta.doc_id).unwrap(),
            b"\xef\xbb\xbf# hello\n"
        );
        fs::write(path, "# 中文\n").unwrap();
        let refreshed = registry.meta(&meta.doc_id).unwrap();
        assert_eq!(refreshed.size, 9);
        assert_eq!(refreshed.encoding, "utf-8");
        assert!(!refreshed.had_bom);
        assert!(refreshed.version > meta.version);
    }

    #[test]
    fn deletion_and_recreation_keep_registration_and_increase_version() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        fs::remove_file(&meta.path).unwrap();
        let gone: Vec<_> = registry
            .refresh_paths(&[PathBuf::from(&meta.path)], false)
            .into_iter()
            .map(Result::unwrap)
            .collect();
        assert_eq!(gone.len(), 1);
        assert!(gone[0].gone);
        assert!(gone[0].version > meta.version);
        assert_eq!(
            registry.read(&meta.doc_id).unwrap_err().code(),
            "E_FILE_NOT_FOUND"
        );
        fs::write(&meta.path, "# restored").unwrap();
        let changed: Vec<_> = registry
            .refresh_paths(&[PathBuf::from(&meta.path)], false)
            .into_iter()
            .map(Result::unwrap)
            .collect();
        assert_eq!(changed.len(), 1);
        assert!(!changed[0].gone);
        assert!(changed[0].version > gone[0].version);
        assert_eq!(registry.open(&meta.path).unwrap().doc_id, meta.doc_id);
        assert_eq!(registry.read(&meta.doc_id).unwrap(), b"# restored");
    }

    #[cfg(windows)]
    #[test]
    fn transient_editor_lock_is_retried_but_permanent_missing_is_bounded() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        let locked = fs::OpenOptions::new()
            .write(true)
            .share_mode(0)
            .open(&meta.path)
            .unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(45));
            drop(locked);
        });
        let result = registry.read(&meta.doc_id);
        release.join().unwrap();
        assert_eq!(result.unwrap(), b"# title\n");
        fs::remove_file(&meta.path).unwrap();
        let started = std::time::Instant::now();
        assert_eq!(
            registry.read(&meta.doc_id).unwrap_err().code(),
            "E_FILE_NOT_FOUND"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn open_rejects_missing_non_markdown_and_oversize_files() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        assert_eq!(
            registry
                .open(dir.0.join("gone.md").to_str().unwrap())
                .unwrap_err()
                .code(),
            "E_FILE_NOT_FOUND"
        );
        let txt = dir.write("secret.txt", b"secret");
        assert_eq!(
            registry.open(txt.to_str().unwrap()).unwrap_err().code(),
            "E_PATH_FORBIDDEN"
        );
        let huge = dir.write("huge.md", b"");
        fs::OpenOptions::new()
            .write(true)
            .open(&huge)
            .unwrap()
            .set_len(MAX_DOCUMENT_BYTES + 1)
            .unwrap();
        assert_eq!(
            registry.open(huge.to_str().unwrap()).unwrap_err().code(),
            "E_FILE_TOO_LARGE"
        );
    }

    #[test]
    fn close_removes_both_indexes_and_is_idempotent() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        registry.close(&meta.doc_id);
        registry.close(&meta.doc_id);
        assert_eq!(
            registry.read(&meta.doc_id).unwrap_err().code(),
            "E_DOC_UNKNOWN"
        );
        assert_eq!(
            registry.meta(&meta.doc_id).unwrap_err().code(),
            "E_DOC_UNKNOWN"
        );
        assert_ne!(registry.open(&meta.path).unwrap().doc_id, meta.doc_id);
    }

    #[test]
    fn malformed_utf16_is_an_encoding_error_without_lossy_conversion() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let path = dir.write("legacy.md", b"# ok");
        let meta = registry.open(path.to_str().unwrap()).unwrap();
        fs::write(path, [0xff, 0xfe, 0x61]).unwrap();
        assert_eq!(
            registry.read(&meta.doc_id).unwrap_err().code(),
            "E_ENCODING"
        );
        assert_eq!(
            registry.meta(&meta.doc_id).unwrap_err().code(),
            "E_ENCODING"
        );
    }

    #[test]
    fn multiencoding_raw_reads_and_binary_rejection() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let text = "# 中文\n你好，世界！";
        let mut le = vec![0xff, 0xfe];
        let mut be = vec![0xfe, 0xff];
        for word in text.encode_utf16() {
            le.extend(word.to_le_bytes());
            be.extend(word.to_be_bytes());
        }
        let (gb, _, errors) = encoding_rs::GB18030.encode(text);
        assert!(!errors);
        for (index, (bytes, label, bom)) in [
            (le, "utf-16le", true),
            (be, "utf-16be", true),
            (gb.into_owned(), "gb18030", false),
            (vec![0xd6, 0xd0, 0xce, 0xc4], "gb18030", false),
        ]
        .into_iter()
        .enumerate()
        {
            let path = dir.write(&format!("{index}.md"), &bytes);
            let meta = registry.open(path.to_str().unwrap()).unwrap();
            assert_eq!(meta.encoding, label);
            assert_eq!(meta.had_bom, bom);
            assert_eq!(registry.read(&meta.doc_id).unwrap(), bytes);
        }
        for bytes in [
            b"# text\0binary".as_slice(),
            b"PK\x03\x04zip",
            b"\xef\xbb\xbf\xff",
        ] {
            let path = dir.write("binary.md", bytes);
            assert_eq!(
                registry.open(path.to_str().unwrap()).unwrap_err().code(),
                "E_ENCODING"
            );
        }
    }

    #[test]
    fn fifty_mb_fixture_returns_exact_raw_bytes() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/generated/50mb.md");
        let mut registry = DocumentRegistry::default();
        let meta = registry.open(path.to_str().unwrap()).unwrap();
        let bytes = registry.read(&meta.doc_id).unwrap();
        assert_eq!(bytes.len(), 52_429_974);
        assert_eq!(bytes, fs::read(path).unwrap());
    }

    #[test]
    fn assets_resolve_unicode_percent_encoding_and_preserve_result_order() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        let image = dir.write("中文 image.png", b"image");
        fs::create_dir(dir.0.join("sub")).unwrap();
        let raws = [
            "./%E4%B8%AD%E6%96%87%20image.png",
            "sub/../中文 image.png",
            "missing.png",
            "sub",
        ];
        let results = registry
            .resolve_assets(&meta.doc_id, raws.iter().map(|s| s.to_string()).collect())
            .unwrap();
        assert_eq!(
            results.iter().map(|r| r.raw.as_str()).collect::<Vec<_>>(),
            raws
        );
        assert_eq!(
            results.iter().map(|r| r.verdict).collect::<Vec<_>>(),
            ["ok", "ok", "notFound", "invalid"]
        );
        assert_eq!(
            results[0].abs_path.as_deref(),
            dunce::canonicalize(image).unwrap().to_str()
        );
        assert!(serde_json::to_value(&results[2])
            .unwrap()
            .get("absPath")
            .is_none());
    }

    #[test]
    fn asset_guard_blocks_traversal_absolute_paths_and_schemes() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        let cases = [
            ("../outside.png", "outside"),
            ("%2e%2e%2fsecret.png", "outside"),
            ("C:\\Windows\\win.ini", "outside"),
            ("/etc/passwd", "outside"),
            ("\\\\server\\share.png", "outside"),
            ("https://example.com/a.png", "invalid"),
            ("javascript:alert(1)", "invalid"),
            ("file:///a.png", "invalid"),
            ("a.png:secret", "invalid"),
            ("%00.png", "invalid"),
            ("bad%FF.png", "invalid"),
            ("bad%QQ.png", "invalid"),
            ("", "invalid"),
        ];
        let results = registry
            .resolve_assets(
                &meta.doc_id,
                cases.iter().map(|(raw, _)| raw.to_string()).collect(),
            )
            .unwrap();
        for (result, (_, verdict)) in results.iter().zip(cases) {
            assert_eq!(result.verdict, verdict, "{}", result.raw);
        }
    }

    #[test]
    fn asset_batch_is_bounded_and_closed_documents_cannot_resolve() {
        let dir = TestDir::new();
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        assert_eq!(
            registry
                .resolve_assets(&meta.doc_id, vec!["x.png".into(); 501])
                .unwrap_err()
                .code(),
            "E_ASSET_FORBIDDEN"
        );
        assert_eq!(
            registry
                .resolve_assets(&meta.doc_id, vec!["x.png".into(); 500])
                .unwrap()
                .len(),
            500
        );
        registry.close(&meta.doc_id);
        assert_eq!(
            registry
                .resolve_assets(&meta.doc_id, vec![])
                .unwrap_err()
                .code(),
            "E_DOC_UNKNOWN"
        );
    }

    #[cfg(windows)]
    #[test]
    fn junctions_cannot_escape_the_document_scope() {
        use std::os::windows::process::CommandExt;
        let dir = TestDir::new();
        let outside = TestDir::new();
        outside.write("secret.png", b"secret");
        let mut registry = DocumentRegistry::default();
        let meta = dir.open(&mut registry);
        let junction = dir.0.join("escape");
        let output = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside.0)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let results = registry
            .resolve_assets(&meta.doc_id, vec!["escape/secret.png".into()])
            .unwrap();
        assert_eq!(results[0].verdict, "outside");
        assert!(results[0].abs_path.is_none());
        fs::remove_dir(junction).unwrap();
        let inside = dir.0.join("images");
        fs::create_dir(&inside).unwrap();
        fs::write(inside.join("safe.png"), b"image").unwrap();
        let junction = dir.0.join("linked-images");
        let output = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&inside)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(output.status.success());
        let results = registry
            .resolve_assets(&meta.doc_id, vec!["linked-images/safe.png".into()])
            .unwrap();
        assert_eq!(results[0].verdict, "outside");
        fs::remove_dir(junction).unwrap();
    }
}
