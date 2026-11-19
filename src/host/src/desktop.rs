//! Window persistence and explicitly isolated native verification profiles.
use crate::error::AppError;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::{
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

fn clamp(mut saved: Geometry, screens: &[Geometry]) -> Geometry {
    let Some(screen) = screens.iter().max_by_key(|screen| {
        let left = i64::from(saved.x).max(i64::from(screen.x));
        let top = i64::from(saved.y).max(i64::from(screen.y));
        let right = (i64::from(saved.x) + i64::from(saved.width))
            .min(i64::from(screen.x) + i64::from(screen.width));
        let bottom = (i64::from(saved.y) + i64::from(saved.height))
            .min(i64::from(screen.y) + i64::from(screen.height));
        (right - left).max(0) * (bottom - top).max(0)
    }) else {
        return saved;
    };
    saved.width = saved.width.max(640).min(screen.width.max(1));
    saved.height = saved.height.max(480).min(screen.height.max(1));
    saved.x = i64::from(saved.x).clamp(
        i64::from(screen.x),
        i64::from(screen.x) + i64::from(screen.width - saved.width),
    ) as i32;
    saved.y = i64::from(saved.y).clamp(
        i64::from(screen.y),
        i64::from(screen.y) + i64::from(screen.height - saved.height),
    ) as i32;
    saved
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct M1Config {
    pub profile_path: String,
    pub report_path: String,
    pub fixture_root: String,
    pub scenario: Option<serde_json::Value>,
}

#[derive(Default)]
pub struct Profile {
    config: Option<M1Config>,
    root: PathBuf,
}
impl Profile {
    pub fn from_args(root: &Path, args: &[String]) -> Result<Self, AppError> {
        let requested: Vec<_> = args
            .iter()
            .filter_map(|a| a.strip_prefix("--m1-profile="))
            .collect();
        if requested.is_empty() {
            return Ok(Self::default());
        }
        if requested.len() != 1 || !Path::new(requested[0]).is_absolute() {
            return Err(forbidden());
        }
        let benchmark = dunce::canonicalize(root.join("benchmarks"))?;
        let profile = dunce::canonicalize(requested[0])?;
        if !profile.is_dir() || profile == benchmark || !profile.starts_with(&benchmark) {
            return Err(forbidden());
        }
        let fixture = dunce::canonicalize(root.join("fixtures"))?;
        let mut state = Self {
            root: profile.clone(),
            config: Some(M1Config {
                profile_path: profile.to_string_lossy().into_owned(),
                report_path: profile.join("report.json").to_string_lossy().into_owned(),
                fixture_root: fixture.to_string_lossy().into_owned(),
                scenario: None,
            }),
        };
        let scenario_path = state.file("scenario.json")?.ok_or_else(forbidden)?;
        let scenario_bytes = (|| -> std::io::Result<Vec<u8>> {
            use std::io::Read;
            let file = std::fs::File::open(scenario_path)?;
            let mut bytes = Vec::new();
            file.take(64 * 1024 + 1).read_to_end(&mut bytes)?;
            Ok(bytes)
        })();
        let scenario = match scenario_bytes {
            Ok(bytes) if bytes.len() <= 64 * 1024 => {
                Some(serde_json::from_slice(&bytes).map_err(|_| forbidden())?)
            }
            Ok(_) => return Err(forbidden()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        state.config.as_mut().unwrap().scenario = scenario;
        Ok(state)
    }
    pub fn config(&self) -> Option<M1Config> {
        self.config.clone()
    }
    pub fn file(&self, name: &str) -> Result<Option<PathBuf>, AppError> {
        if self.config.is_none() {
            return Ok(None);
        }
        if dunce::canonicalize(&self.root)? != self.root {
            return Err(forbidden());
        }
        let path = self.root.join(name);
        for check in [&path, &path.with_extension("json.bak")] {
            match std::fs::symlink_metadata(check) {
                Ok(meta)
                    if !meta.is_file()
                        || meta.file_type().is_symlink()
                        || dunce::canonicalize(check)? != *check =>
                {
                    return Err(forbidden())
                }
                Ok(_) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        Ok(Some(path))
    }
    pub fn webview_directory(&self) -> Result<Option<PathBuf>, AppError> {
        if self.config.is_none() {
            return Ok(None);
        }
        let path = self.root.join("webview");
        if path.exists()
            && (std::fs::symlink_metadata(&path)?.file_type().is_symlink()
                || dunce::canonicalize(&path)? != path)
        {
            return Err(forbidden());
        }
        Ok(Some(path))
    }
}

fn forbidden() -> AppError {
    AppError::PathForbidden("仅允许已验证的 M1 隔离目录".into())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSnapshot {
    pub current: Geometry,
    pub restored: Option<Geometry>,
}

enum Save {
    Changed(Geometry),
    Flush(Geometry, mpsc::Sender<()>),
}
#[derive(Clone)]
pub struct DesktopState {
    snapshot: Arc<Mutex<DesktopSnapshot>>,
    save: mpsc::Sender<Save>,
}

impl DesktopState {
    pub fn attach(window: &tauri::WebviewWindow, path: PathBuf) -> Result<Self, AppError> {
        let restored = crate::workspace::load(&path)
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_value::<Geometry>(value).ok())
            .filter(|g| g.width > 0 && g.height > 0 && g.width < 100_000 && g.height < 100_000);
        let screens: Vec<_> = window
            .available_monitors()?
            .iter()
            .map(|m| {
                let work = m.work_area();
                Geometry {
                    x: work.position.x,
                    y: work.position.y,
                    width: work.size.width,
                    height: work.size.height,
                    maximized: false,
                }
            })
            .collect();
        let restored = restored.map(|g| clamp(g, &screens));
        if let Some(g) = &restored {
            apply(window, g)?;
        }
        let current = restored.clone().unwrap_or(capture(window, None)?);
        let (send, receive) = mpsc::channel();
        std::thread::Builder::new()
            .name("window-state-save".into())
            .spawn(move || {
                let write = |g: &Geometry| {
                    if let Err(error) = serde_json::to_value(g)
                        .map_err(|e| AppError::Internal(e.to_string()))
                        .and_then(|v| crate::workspace::save(&path, &v))
                    {
                        eprintln!("窗口状态保存失败: {}", error.code());
                        crate::diagnostics::record("window-save", error.code());
                    }
                };
                while let Ok(message) = receive.recv() {
                    let mut pending = match message {
                        Save::Changed(g) => g,
                        Save::Flush(g, ack) => {
                            write(&g);
                            let _ = ack.send(());
                            continue;
                        }
                    };
                    let deadline = Instant::now() + Duration::from_millis(500);
                    loop {
                        match receive
                            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                        {
                            Ok(Save::Changed(g)) => pending = g,
                            Ok(Save::Flush(g, ack)) => {
                                write(&g);
                                let _ = ack.send(());
                                pending = g;
                                break;
                            }
                            Err(_) => break,
                        }
                        if Instant::now() >= deadline {
                            break;
                        }
                    }
                    write(&pending);
                }
            })?;
        let state = Self {
            snapshot: Arc::new(Mutex::new(DesktopSnapshot { current, restored })),
            save: send,
        };
        let handle = window.clone();
        let events = state.clone();
        window.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
                    | tauri::WindowEvent::CloseRequested { .. }
            ) {
                let mut snapshot = events.snapshot.lock();
                if let Ok(current) = capture(&handle, Some(&snapshot.current)) {
                    snapshot.current = current.clone();
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        let (send, recv) = mpsc::channel();
                        let _ = events.save.send(Save::Flush(current, send));
                        let _ = recv.recv_timeout(Duration::from_secs(2));
                    } else {
                        let _ = events.save.send(Save::Changed(current));
                    }
                }
            }
        });
        Ok(state)
    }
    pub fn snapshot(&self, window: &tauri::WebviewWindow) -> Result<DesktopSnapshot, AppError> {
        let mut snapshot = self.snapshot.lock().clone();
        snapshot.current = capture(window, Some(&snapshot.current))?;
        Ok(snapshot)
    }
}

fn capture(
    window: &tauri::WebviewWindow,
    previous: Option<&Geometry>,
) -> Result<Geometry, AppError> {
    let maximized = window.is_maximized()?;
    if maximized || window.is_minimized()? {
        if let Some(previous) = previous {
            return Ok(Geometry {
                maximized,
                ..previous.clone()
            });
        }
    }
    let size = window.inner_size()?;
    let position = window.outer_position()?;
    Ok(Geometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
    })
}

fn apply(window: &tauri::WebviewWindow, g: &Geometry) -> Result<(), AppError> {
    window.unmaximize()?;
    window.set_size(tauri::PhysicalSize::new(g.width, g.height))?;
    window.set_position(tauri::PhysicalPosition::new(g.x, g.y))?;
    if g.maximized {
        window.maximize()?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_m1_config(profile: tauri::State<'_, Profile>) -> Option<M1Config> {
    profile.config()
}

#[tauri::command]
pub fn write_m1_report(
    profile: tauri::State<'_, Profile>,
    report: serde_json::Value,
) -> Result<(), AppError> {
    let path = profile.file("report.json")?.ok_or_else(forbidden)?;
    crate::workspace::save(&path, &report)
}

#[tauri::command]
pub fn get_desktop_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DesktopState>,
) -> Result<DesktopSnapshot, AppError> {
    state.snapshot(&window)
}

#[tauri::command]
pub fn m1_set_window_state(
    window: tauri::WebviewWindow,
    profile: tauri::State<'_, Profile>,
    state: Geometry,
) -> Result<(), AppError> {
    profile.file("window.json")?.ok_or_else(forbidden)?;
    if state.width < 640 || state.height < 480 || state.width > 16384 || state.height > 16384 {
        return Err(forbidden());
    }
    apply(&window, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disconnected_monitor_and_oversize_window_are_clamped() {
        let screen = Geometry {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
            maximized: false,
        };
        let saved = Geometry {
            x: 5000,
            y: -4000,
            width: 4000,
            height: 3000,
            maximized: true,
        };
        let got = clamp(saved, &[screen]);
        assert_eq!(
            (got.x, got.y, got.width, got.height, got.maximized),
            (0, 0, 1920, 1040, true)
        );
        let second = Geometry {
            x: -1600,
            y: 0,
            width: 1600,
            height: 900,
            maximized: false,
        };
        let saved = Geometry {
            x: -1500,
            y: 100,
            width: 900,
            height: 700,
            maximized: false,
        };
        assert_eq!(clamp(saved.clone(), &[second]), saved);
    }
    #[test]
    fn profile_requires_existing_directory_strictly_inside_benchmarks() {
        let root = std::env::temp_dir().join(format!("md-profile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("benchmarks/profile")).unwrap();
        std::fs::create_dir(root.join("fixtures")).unwrap();
        let args = |p: &Path| vec![format!("--m1-profile={}", p.display())];
        assert!(Profile::from_args(&root, &args(&root)).is_err());
        assert!(Profile::from_args(&root, &args(&root.join("benchmarks"))).is_err());
        assert!(Profile::from_args(&root, &args(&root.join("benchmarks/missing"))).is_err());
        let state = Profile::from_args(&root, &args(&root.join("benchmarks/profile"))).unwrap();
        assert_eq!(
            PathBuf::from(state.config.unwrap().report_path),
            root.join("benchmarks").join("profile").join("report.json")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
