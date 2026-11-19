//! Read-only, lazy folder enumeration. This registry never grants asset scope.
use crate::error::AppError;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{self, File, Metadata, OpenOptions},
    path::{Component, Path, PathBuf},
};

const MAX_ENTRIES: usize = 2000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRoot {
    pub root_id: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
}

#[derive(Debug, Serialize)]
pub struct DirectoryListing {
    pub entries: Vec<FolderEntry>,
    pub truncated: bool,
}

#[derive(Default)]
pub struct FolderRegistry {
    roots: HashMap<String, RegisteredRoot>,
}

struct RegisteredRoot {
    path: PathBuf,
    identity: FileIdentity,
}

#[derive(Debug, PartialEq, Eq)]
struct FileIdentity(u64, u64);

impl FolderRegistry {
    pub fn open(&mut self, path: &str) -> Result<FolderRoot, AppError> {
        let input = checked_path(path)?;
        // Check the supplied path before canonicalizing: otherwise a junction
        // would silently become an apparently safe canonical directory.
        let _input_pins = pin_directories(&input)?;
        let path = dunce::canonicalize(&input)?;
        let pins = pin_directories(&path)?;
        let identity = identity(pins.last().ok_or_else(forbidden)?)?;
        let root_id = uuid::Uuid::new_v4().to_string();
        let root = FolderRoot {
            root_id: root_id.clone(),
            path: path.to_string_lossy().into_owned(),
            name: path
                .file_name()
                .unwrap_or(path.as_os_str())
                .to_string_lossy()
                .into_owned(),
        };
        self.roots
            .insert(root_id, RegisteredRoot { path, identity });
        Ok(root)
    }
    pub fn list(&self, id: &str, path: &str) -> Result<DirectoryListing, AppError> {
        let root = self.roots.get(id).ok_or_else(forbidden)?;
        let path = checked_path(path)?;
        if !path.starts_with(&root.path) {
            return Err(forbidden());
        }
        // Pins exclude FILE_SHARE_DELETE on Windows. Every ancestor stays in
        // place from validation until enumeration completes (including errors).
        let root_pins = pin_directories(&root.path)?;
        if identity(root_pins.last().ok_or_else(forbidden)?)? != root.identity {
            return Err(AppError::PathForbidden(
                "根目录已替换，请重新打开文件夹".into(),
            ));
        }
        let _target_pins = pin_directories(&path)?;
        if dunce::canonicalize(&path)? != path {
            return Err(forbidden());
        }
        let mut entries = Vec::new();
        let mut truncated = false;
        for entry in fs::read_dir(&path)? {
            let entry = entry?;
            if entries.len() == MAX_ENTRIES {
                truncated = true;
                break;
            }
            let child = entry.path();
            let metadata = fs::symlink_metadata(&child)?;
            if is_link(&metadata) {
                return Err(forbidden());
            }
            let kind = if metadata.is_dir() {
                "directory"
            } else if is_markdown(&child) && metadata.is_file() {
                "markdown"
            } else {
                "file"
            };
            entries.push(FolderEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: child.to_string_lossy().into_owned(),
                kind,
            });
        }
        entries.sort_by(|a, b| {
            (a.kind != "directory")
                .cmp(&(b.kind != "directory"))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(DirectoryListing { entries, truncated })
    }
    pub fn close(&mut self, id: &str) {
        self.roots.remove(id);
    }
}

fn forbidden() -> AppError {
    AppError::PathForbidden("目录未授权、路径已改变或包含链接".into())
}

fn checked_path(path: &str) -> Result<PathBuf, AppError> {
    if path.is_empty() || path.contains('\0') || path.len() > 32768 {
        return Err(forbidden());
    }
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(forbidden());
    }
    for component in path.components() {
        match component {
            Component::ParentDir | Component::CurDir => return Err(forbidden()),
            Component::Normal(name) => {
                let name = name.to_string_lossy();
                // Exclude NTFS alternate streams and ambiguous Windows names.
                if name.contains(':') || name.ends_with([' ', '.']) {
                    return Err(forbidden());
                }
            }
            #[cfg(windows)]
            Component::Prefix(prefix) => {
                if !matches!(
                    prefix.kind(),
                    std::path::Prefix::Disk(_)
                        | std::path::Prefix::UNC(_, _)
                        | std::path::Prefix::VerbatimDisk(_)
                        | std::path::Prefix::VerbatimUNC(_, _)
                ) {
                    return Err(forbidden());
                }
            }
            _ => (),
        }
    }
    Ok(path)
}

fn is_markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
        matches!(
            s.to_ascii_lowercase().as_str(),
            "md" | "markdown" | "mdown" | "mkd"
        )
    })
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn pin_directories(path: &Path) -> Result<Vec<File>, AppError> {
    let mut current = PathBuf::new();
    let mut pins = Vec::new();
    for component in path.components() {
        current.push(component);
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        if is_link(&fs::symlink_metadata(&current)?) {
            return Err(forbidden());
        }
        let mut options = OpenOptions::new();
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options
                .access_mode(0)
                .share_mode(0x1 | 0x2)
                .custom_flags(0x0020_0000 | 0x0200_0000); // OPEN_REPARSE_POINT | BACKUP_SEMANTICS
        }
        #[cfg(not(windows))]
        options.read(true);
        let file = options.open(&current)?;
        let metadata = file.metadata()?;
        if !metadata.is_dir() || is_link(&metadata) {
            return Err(forbidden());
        }
        pins.push(file);
    }
    if pins.is_empty() {
        return Err(forbidden());
    }
    Ok(pins)
}

#[cfg(windows)]
fn identity(file: &File) -> Result<FileIdentity, AppError> {
    use std::{ffi::c_void, os::windows::io::AsRawHandle};
    #[repr(C)]
    #[derive(Default)]
    struct FileInformation {
        attributes: u32,
        creation: [u32; 2],
        access: [u32; 2],
        write: [u32; 2],
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(handle: *mut c_void, info: *mut FileInformation) -> i32;
    }
    let mut info = FileInformation::default();
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(FileIdentity(
        info.volume as u64,
        ((info.index_high as u64) << 32) | info.index_low as u64,
    ))
}

#[cfg(unix)]
fn identity(file: &File) -> Result<FileIdentity, AppError> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata()?;
    Ok(FileIdentity(metadata.dev(), metadata.ino()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("md-folder-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn lazy_listing_sorts_directories_then_files_and_preserves_other_files() {
        let dir = TestDir::new();
        fs::create_dir(dir.0.join("z-folder")).unwrap();
        fs::create_dir(dir.0.join("A-folder")).unwrap();
        fs::write(dir.0.join("b.MD"), b"# b").unwrap();
        fs::write(dir.0.join("A.txt"), b"other").unwrap();
        let mut registry = FolderRegistry::default();
        let root = registry.open(dir.0.to_str().unwrap()).unwrap();
        // Created after opening: enumeration must happen on demand, not at open.
        fs::write(dir.0.join("z-folder/late.markdown"), b"# late").unwrap();
        let listing = registry.list(&root.root_id, &root.path).unwrap();
        assert_eq!(
            listing
                .entries
                .iter()
                .map(|e| (e.name.as_str(), e.kind))
                .collect::<Vec<_>>(),
            [
                ("A-folder", "directory"),
                ("z-folder", "directory"),
                ("A.txt", "file"),
                ("b.MD", "markdown")
            ]
        );
        assert!(!listing.truncated);
        let nested = registry
            .list(&root.root_id, &listing.entries[1].path)
            .unwrap();
        assert_eq!(nested.entries[0].name, "late.markdown");
        let json = serde_json::to_value(root).unwrap();
        assert!(json.get("rootId").is_some());
    }

    #[test]
    fn rejects_unknown_closed_outside_and_parent_paths() {
        let dir = TestDir::new();
        let outside = TestDir::new();
        let mut registry = FolderRegistry::default();
        let root = registry.open(dir.0.to_str().unwrap()).unwrap();
        for path in [
            outside.0.clone(),
            dir.0.join(".."),
            dir.0.join("../outside"),
            dir.0.join("a:stream"),
        ] {
            assert_eq!(
                registry
                    .list(&root.root_id, path.to_str().unwrap())
                    .unwrap_err()
                    .code(),
                "E_PATH_FORBIDDEN"
            );
        }
        assert!(registry.list("unknown", &root.path).is_err());
        registry.close(&root.root_id);
        registry.close(&root.root_id);
        assert!(registry.list(&root.root_id, &root.path).is_err());
    }

    #[test]
    fn listing_is_bounded_and_reports_truncation() {
        let dir = TestDir::new();
        for i in 0..2001 {
            fs::write(dir.0.join(format!("{i:04}.md")), b"").unwrap();
        }
        let mut registry = FolderRegistry::default();
        let root = registry.open(dir.0.to_str().unwrap()).unwrap();
        let listing = registry.list(&root.root_id, &root.path).unwrap();
        assert_eq!(listing.entries.len(), 2000);
        assert!(listing.truncated);
    }

    #[test]
    fn replacing_root_invalidates_old_root_id_without_poisoning_new_open() {
        let dir = TestDir::new();
        let selected = dir.0.join("root");
        fs::create_dir(&selected).unwrap();
        let mut registry = FolderRegistry::default();
        let root = registry.open(selected.to_str().unwrap()).unwrap();
        fs::rename(&selected, dir.0.join("old-root")).unwrap();
        fs::create_dir(&selected).unwrap();
        fs::write(selected.join("replacement.md"), b"").unwrap();
        assert_eq!(
            registry.list(&root.root_id, &root.path).unwrap_err().code(),
            "E_PATH_FORBIDDEN"
        );
        let fresh = registry.open(selected.to_str().unwrap()).unwrap();
        assert_eq!(
            registry
                .list(&fresh.root_id, &fresh.path)
                .unwrap()
                .entries
                .len(),
            1
        );
    }

    #[cfg(windows)]
    #[test]
    fn long_windows_paths_returned_by_canonicalization_can_be_listed() {
        let dir = TestDir::new();
        let selected = dir
            .0
            .join("a".repeat(90))
            .join("b".repeat(90))
            .join("c".repeat(90));
        fs::create_dir_all(&selected).unwrap();
        fs::write(selected.join("文档.md"), b"# title").unwrap();
        let mut registry = FolderRegistry::default();
        let root = registry.open(selected.to_str().unwrap()).unwrap();
        assert_eq!(
            registry.list(&root.root_id, &root.path).unwrap().entries[0].name,
            "文档.md"
        );
    }

    #[cfg(windows)]
    #[test]
    fn junction_roots_ancestors_and_children_are_rejected_even_inside_root() {
        use std::os::windows::process::CommandExt;
        let dir = TestDir::new();
        fs::create_dir(dir.0.join("real")).unwrap();
        fs::create_dir(dir.0.join("real/sub")).unwrap();
        let link = dir.0.join("link");
        let output = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(dir.0.join("real"))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let mut registry = FolderRegistry::default();
        assert_eq!(
            registry.open(link.to_str().unwrap()).unwrap_err().code(),
            "E_PATH_FORBIDDEN"
        );
        assert_eq!(
            registry
                .open(link.join("sub").to_str().unwrap())
                .unwrap_err()
                .code(),
            "E_PATH_FORBIDDEN"
        );
        let root = registry.open(dir.0.to_str().unwrap()).unwrap();
        assert_eq!(
            registry
                .list(&root.root_id, link.to_str().unwrap())
                .unwrap_err()
                .code(),
            "E_PATH_FORBIDDEN"
        );
        assert_eq!(
            registry.list(&root.root_id, &root.path).unwrap_err().code(),
            "E_PATH_FORBIDDEN"
        );
        fs::remove_dir(link).unwrap();
        assert!(registry.list(&root.root_id, &root.path).is_ok());
    }
}
