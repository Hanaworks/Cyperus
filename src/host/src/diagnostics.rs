//! Small content-free error log, separate from workspace/window state.
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
static PATH: OnceLock<Mutex<PathBuf>> = OnceLock::new();
const LIMIT: u64 = 256 * 1024;

pub fn initialize(path: PathBuf) {
    let _ = PATH.set(Mutex::new(path));
}
pub fn record(stage: &str, code: &str) {
    if let Some(path) = PATH.get().and_then(|path| path.lock().ok()) {
        let _ = append(&path, stage, code);
    }
}
fn append(path: &Path, stage: &str, code: &str) -> std::io::Result<()> {
    use std::io::Write;
    // The only callers use static codes/stages. Never accept error messages,
    // document paths, argv, or document contents in this log.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let backup = path.with_extension("log.bak");
    for target in [path, &backup] {
        if let Ok(meta) = std::fs::symlink_metadata(target) {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(std::io::Error::other("invalid log target"));
            }
        }
    }
    if std::fs::metadata(path).is_ok_and(|m| m.len() >= LIMIT) {
        match std::fs::remove_file(&backup) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e),
        }
        std::fs::rename(path, backup)?;
    }
    let time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(
        file,
        "{time} {} {stage} {code}",
        option_env!("BUILD_REVISION").unwrap_or("unknown")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotates_a_bounded_log_without_document_text() {
        let root = std::env::temp_dir().join(format!("md-log-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("errors.log");
        std::fs::write(&path, vec![b'x'; LIMIT as usize]).unwrap();
        append(&path, "command", "E_ENCODING").unwrap();
        let value = std::fs::read_to_string(&path).unwrap();
        assert!(value.len() < 1024);
        assert!(value.contains("command E_ENCODING"));
        assert_eq!(
            std::fs::metadata(path.with_extension("log.bak"))
                .unwrap()
                .len(),
            LIMIT
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
