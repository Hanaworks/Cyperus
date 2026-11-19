//! Bounded JSON persistence. Callers choose only the application's config path;
//! standalone helpers accept a path so tests never touch a user's settings.
use crate::error::AppError;
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

const MAX_STATE_BYTES: u64 = 2 * 1024 * 1024;

fn read_valid(path: &Path) -> Result<Option<Value>, AppError> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if file.metadata()?.len() > MAX_STATE_BYTES {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_STATE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Ok(None);
    }
    Ok(serde_json::from_slice(&bytes).ok())
}

pub fn load(path: &Path) -> Result<Option<Value>, AppError> {
    match read_valid(path)? {
        Some(value) => Ok(Some(value)),
        None => read_valid(&path.with_extension("json.bak")),
    }
}

pub fn save(path: &Path, state: &Value) -> Result<(), AppError> {
    let bytes = serde_json::to_vec(state).map_err(|e| AppError::Internal(e.to_string()))?;
    if bytes.len() as u64 > MAX_STATE_BYTES {
        return Err(AppError::FileTooLarge(bytes.len() as u64));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::PathForbidden("无设置目录".into()))?;
    fs::create_dir_all(parent)?;
    // Preserve the last valid primary before replacing it. Corrupt input never
    // overwrites a usable backup. Unique temporary files also survive stale temps.
    if let Some(previous) = read_valid(path)? {
        let previous =
            serde_json::to_vec(&previous).map_err(|e| AppError::Internal(e.to_string()))?;
        atomic_write(&path.with_extension("json.bak"), &previous)?;
    }
    atomic_write(path, &bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        replace(&temporary, path)?;
        #[cfg(unix)]
        File::open(path.parent().expect("has parent"))?.sync_all()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(windows)]
fn replace(source: &Path, destination: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<_> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // REPLACE_EXISTING | WRITE_THROUGH; never delete the current file first.
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 1 | 8) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace(source: &Path, destination: &Path) -> Result<(), AppError> {
    Ok(fs::rename(source, destination)?)
}

#[cfg(test)]
pub(crate) fn replace_for_test(source: &Path, destination: &Path) -> Result<(), AppError> {
    replace(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_replaces_recovers_corruption_and_bounds_input() {
        let root = std::env::temp_dir().join(format!("md-workspace-{}", uuid::Uuid::new_v4()));
        let path = root.join("workspace.json");
        assert_eq!(load(&path).unwrap(), None);
        let first = serde_json::json!({"schemaVersion":1,"theme":"dark"});
        save(&path, &first).unwrap();
        assert_eq!(load(&path).unwrap(), Some(first.clone()));
        let second = serde_json::json!({"schemaVersion":1,"theme":"light"});
        save(&path, &second).unwrap();
        assert_eq!(load(&path).unwrap(), Some(second));
        fs::write(&path, "{broken").unwrap();
        assert_eq!(load(&path).unwrap(), Some(first));
        fs::write(path.with_extension("json.bak"), "broken too").unwrap();
        assert_eq!(load(&path).unwrap(), None);
        let huge = serde_json::json!({"oversize":"x".repeat(MAX_STATE_BYTES as usize)});
        assert!(save(&path, &huge).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{broken");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 2);
        fs::write(&path, vec![b' '; MAX_STATE_BYTES as usize + 1]).unwrap();
        assert_eq!(load(&path).unwrap(), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_atomic_replace_preserves_primary_and_cleans_temporary_file() {
        let root =
            std::env::temp_dir().join(format!("md-workspace-failure-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("workspace.json");
        fs::create_dir(&path).unwrap();
        fs::write(path.join("marker"), b"preserved").unwrap();
        assert!(atomic_write(&path, b"{}").is_err());
        assert_eq!(fs::read(path.join("marker")).unwrap(), b"preserved");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
