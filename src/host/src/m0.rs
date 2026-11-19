//! Explicitly enabled local verification output; never an arbitrary file writer.
use crate::error::AppError;
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M0Config {
    pub fixture_root: String,
    pub report_path: String,
}

#[derive(Default)]
pub struct M0State {
    config: Option<M0Config>,
    benchmark_root: PathBuf,
}

impl M0State {
    pub fn from_args(
        root: &Path,
        args: impl IntoIterator<Item = String>,
    ) -> Result<Self, AppError> {
        let reports: Vec<_> = args
            .into_iter()
            .filter_map(|arg| arg.strip_prefix("--m0-report=").map(str::to_owned))
            .collect();
        if reports.is_empty() {
            return Ok(Self::default());
        }
        if reports.len() != 1 {
            return Err(forbidden());
        }
        let benchmark_root = dunce::canonicalize(root.join("benchmarks"))?;
        let report = checked_report_path(&benchmark_root, Path::new(&reports[0]))?;
        let fixtures = dunce::canonicalize(root.join("fixtures"))?;
        Ok(Self {
            config: Some(M0Config {
                fixture_root: fixtures.to_string_lossy().into_owned(),
                report_path: report.to_string_lossy().into_owned(),
            }),
            benchmark_root,
        })
    }
    pub fn config(&self) -> Option<M0Config> {
        self.config.clone()
    }
    pub fn workspace_path(&self) -> Result<Option<PathBuf>, AppError> {
        let Some(config) = &self.config else {
            return Ok(None);
        };
        let report = Path::new(&config.report_path);
        let stem = report
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(forbidden)?;
        let path = report.with_file_name(format!("{stem}-workspace.local.json"));
        checked_report_path(&self.benchmark_root, &path).map(Some)
    }
    pub fn write(&self, report: serde_json::Value) -> Result<(), AppError> {
        let config = self.config.as_ref().ok_or_else(forbidden)?;
        let path = checked_report_path(&self.benchmark_root, Path::new(&config.report_path))?;
        let bytes =
            serde_json::to_vec_pretty(&report).map_err(|e| AppError::Internal(e.to_string()))?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(forbidden());
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        file.write_all(&bytes)?;
        Ok(())
    }
}

fn forbidden() -> AppError {
    AppError::PathForbidden("仅允许显式启用的 M0 报告路径".into())
}

fn checked_report_path(root: &Path, requested: &Path) -> Result<PathBuf, AppError> {
    if !requested.is_absolute() || requested.extension().and_then(|s| s.to_str()) != Some("json") {
        return Err(forbidden());
    }
    let parent = dunce::canonicalize(requested.parent().ok_or_else(forbidden)?)?;
    if !parent.starts_with(root) {
        return Err(forbidden());
    }
    let target = parent.join(requested.file_name().ok_or_else(forbidden)?);
    match fs::symlink_metadata(&target) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => return Err(forbidden()),
        Ok(_) if dunce::canonicalize(&target)? != target => return Err(forbidden()),
        Ok(_) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e.into()),
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Project(PathBuf);
    impl Project {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("md-preview-m0-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            fs::create_dir(path.join("benchmarks")).unwrap();
            fs::create_dir(path.join("fixtures")).unwrap();
            Self(path)
        }
        fn state(&self, path: &Path) -> Result<M0State, AppError> {
            M0State::from_args(&self.0, [format!("--m0-report={}", path.display())])
        }
    }
    impl Drop for Project {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn normal_startup_has_no_config_or_write_permission() {
        let state = M0State::from_args(Path::new("missing-root"), ["file.md".into()]).unwrap();
        assert!(state.config().is_none());
        assert!(state.workspace_path().unwrap().is_none());
        assert_eq!(
            state
                .write(serde_json::json!({"ok": true}))
                .unwrap_err()
                .code(),
            "E_PATH_FORBIDDEN"
        );
    }

    #[test]
    fn enabled_report_writes_only_the_preset_benchmark_path() {
        let project = Project::new();
        let report = project.0.join("benchmarks/native-m0.json");
        let state = project.state(&report).unwrap();
        assert_eq!(
            state.workspace_path().unwrap().unwrap(),
            project.0.join("benchmarks/native-m0-workspace.local.json")
        );
        let config = serde_json::to_value(state.config().unwrap()).unwrap();
        assert_eq!(
            config["fixtureRoot"],
            dunce::canonicalize(project.0.join("fixtures"))
                .unwrap()
                .to_str()
                .unwrap()
        );
        assert_eq!(
            PathBuf::from(config["reportPath"].as_str().unwrap()),
            report
        );
        state
            .write(serde_json::json!({"ok": true, "bytes": 52_429_974}))
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(report).unwrap()).unwrap(),
            serde_json::json!({"ok": true, "bytes": 52_429_974})
        );
    }

    #[test]
    fn report_path_cannot_escape_benchmarks_or_use_duplicate_flags() {
        let project = Project::new();
        for path in [
            project.0.join("outside.json"),
            project.0.join("benchmarks/../escape.json"),
            PathBuf::from("relative.json"),
        ] {
            assert!(project.state(&path).is_err(), "{}", path.display());
        }
        assert!(
            M0State::from_args(&project.0, ["--m0-report=a".into(), "--m0-report=b".into()])
                .is_err()
        );
    }

    #[test]
    fn report_payload_is_bounded_before_writing() {
        let project = Project::new();
        let report = project.0.join("benchmarks/native.json");
        let state = project.state(&report).unwrap();
        assert!(state.config().is_some());
        assert!(state
            .write(serde_json::Value::String("x".repeat(2 * 1024 * 1024)))
            .is_err());
        assert!(!report.exists());
    }
}
