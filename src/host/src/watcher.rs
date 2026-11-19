use crate::{
    documents::{DocumentChange, DocumentRegistry},
    error::AppError,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use parking_lot::Mutex;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

pub struct DocumentWatcher {
    debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
    parents: HashMap<PathBuf, usize>,
    documents: HashMap<String, PathBuf>,
}

impl DocumentWatcher {
    pub fn new(
        registry: &Arc<Mutex<DocumentRegistry>>,
        emit: impl Fn(Result<DocumentChange, AppError>) + Send + 'static,
    ) -> Result<Self, AppError> {
        // Weak ownership prevents the callback and managed state from retaining
        // one another after the window closes.
        let registry = Arc::downgrade(registry);
        let debouncer = new_debouncer(
            Duration::from_millis(120),
            None,
            move |result: DebounceEventResult| {
                let Some(registry) = registry.upgrade() else {
                    return;
                };
                match result {
                    Ok(events) => {
                        let paths: Vec<_> = events
                            .into_iter()
                            .filter(|event| !matches!(event.kind, EventKind::Access(_)))
                            .flat_map(|event| event.event.paths)
                            .map(|path| dunce::simplified(&path).to_path_buf())
                            .collect();
                        let changes = registry.lock().refresh_paths(&paths, true);
                        for change in changes {
                            emit(change.map_err(|error| AppError::WatchFailed(error.to_string())));
                        }
                    }
                    Err(errors) => {
                        for error in errors {
                            emit(Err(AppError::WatchFailed(error.to_string())));
                        }
                    }
                }
            },
        )
        .map_err(|error| AppError::WatchFailed(error.to_string()))?;
        Ok(Self {
            debouncer,
            parents: HashMap::new(),
            documents: HashMap::new(),
        })
    }

    pub fn add(&mut self, doc_id: &str, path: &Path) -> Result<(), AppError> {
        if self.documents.contains_key(doc_id) {
            return Ok(());
        }
        let parent = path
            .parent()
            .ok_or_else(|| AppError::WatchFailed("文档无父目录".into()))?
            .to_path_buf();
        if !self.parents.contains_key(&parent) {
            self.debouncer
                .watch(&parent, RecursiveMode::NonRecursive)
                .map_err(|error| AppError::WatchFailed(error.to_string()))?;
        }
        *self.parents.entry(parent.clone()).or_default() += 1;
        self.documents.insert(doc_id.into(), parent);
        Ok(())
    }

    pub fn remove(&mut self, doc_id: &str) -> Result<(), AppError> {
        if let Some(parent) = self.documents.remove(doc_id) {
            if let Some(count) = self.parents.get_mut(&parent) {
                *count -= 1;
                if *count == 0 {
                    self.parents.remove(&parent);
                    self.debouncer
                        .unwatch(&parent)
                        .map_err(|error| AppError::WatchFailed(error.to_string()))?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::mpsc, time::Instant};

    #[test]
    fn real_directory_watch_survives_overwrite_rename_delete_recreate_and_closes() {
        let root = std::env::temp_dir().join(format!("md-watch-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let path = root.join("watched.md");
        fs::write(&path, "# initial").unwrap();
        let registry = Arc::new(Mutex::new(DocumentRegistry::default()));
        let meta = registry.lock().open(path.to_str().unwrap()).unwrap();
        let (send, receive) = mpsc::channel();
        let mut watcher = DocumentWatcher::new(&registry, move |change| {
            let _ = send.send(change);
        })
        .unwrap();
        watcher.add(&meta.doc_id, Path::new(&meta.path)).unwrap();
        watcher.add(&meta.doc_id, Path::new(&meta.path)).unwrap();
        assert_eq!(watcher.parents.len(), 1);
        let wait = |gone: bool, after: u64| {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let change = receive
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .expect("watcher event")
                    .unwrap();
                if change.gone == gone && change.version > after {
                    return change.version;
                }
            }
        };
        fs::write(&path, "# overwritten").unwrap();
        let overwritten = wait(false, meta.version);
        assert_eq!(
            registry.lock().read(&meta.doc_id).unwrap(),
            b"# overwritten"
        );
        let temporary = root.join("temporary.md");
        fs::write(&temporary, "# replaced").unwrap();
        super::super::workspace::replace_for_test(&temporary, &path).unwrap();
        let renamed = wait(false, overwritten);
        assert_eq!(registry.lock().read(&meta.doc_id).unwrap(), b"# replaced");
        fs::remove_file(&path).unwrap();
        // A racing metadata read must not swallow the gone event.
        assert!(registry.lock().meta(&meta.doc_id).is_err());
        let gone = wait(true, renamed);
        fs::write(&path, "# recreated").unwrap();
        let recreated = wait(false, gone);
        assert_eq!(
            registry.lock().open(path.to_str().unwrap()).unwrap().doc_id,
            meta.doc_id
        );
        assert!(registry.lock().meta(&meta.doc_id).unwrap().version >= recreated);
        for index in 1..=20 {
            let bytes = format!("# burst {index}\n最终版本 {index}\n");
            if index % 2 == 0 {
                fs::write(&temporary, bytes).unwrap();
                super::super::workspace::replace_for_test(&temporary, &path).unwrap();
            } else {
                fs::write(&path, bytes).unwrap();
            }
        }
        let burst = wait(false, recreated);
        assert!(registry.lock().meta(&meta.doc_id).unwrap().version >= burst);
        assert_eq!(
            registry.lock().read(&meta.doc_id).unwrap(),
            "# burst 20\n最终版本 20\n".as_bytes()
        );
        let second_path = root.join("second.md");
        fs::write(&second_path, "# second").unwrap();
        let second = registry.lock().open(second_path.to_str().unwrap()).unwrap();
        watcher
            .add(&second.doc_id, Path::new(&second.path))
            .unwrap();
        watcher.remove(&meta.doc_id).unwrap();
        registry.lock().close(&meta.doc_id);
        assert_eq!(watcher.parents.len(), 1);
        watcher.remove(&second.doc_id).unwrap();
        registry.lock().close(&second.doc_id);
        assert!(watcher.parents.is_empty());
        assert!(watcher.documents.is_empty());
        drop(watcher);
        fs::remove_dir_all(root).unwrap();
    }
}
