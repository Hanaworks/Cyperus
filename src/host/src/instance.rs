//! A pre-WebView Windows broker. A private named pipe is both the election and
//! the event-driven transport; no discovery polling or plugin dependency.
use crate::error::AppError;
use parking_lot::Mutex;
use std::{path::Path, sync::Arc};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct Queue {
    ready: bool,
    paths: Vec<String>,
}
impl Queue {
    fn drain(&mut self) -> Vec<String> {
        self.ready = true;
        std::mem::take(&mut self.paths)
    }
}
#[derive(Default)]
struct Pending {
    queue: Queue,
    app: Option<tauri::AppHandle>,
}
#[derive(Clone, Default)]
pub struct Incoming(Arc<Mutex<Pending>>);
impl Incoming {
    pub fn new(paths: Vec<String>) -> Self {
        Self(Arc::new(Mutex::new(Pending {
            queue: Queue {
                paths,
                ready: false,
            },
            ..Default::default()
        })))
    }
    pub fn attach(&self, app: tauri::AppHandle) {
        self.0.lock().app = Some(app);
    }
    pub fn ready(&self) -> Vec<String> {
        self.0.lock().queue.drain()
    }
    pub fn deliver(&self, paths: Vec<String>) {
        let mut pending = self.0.lock();
        if let Some(app) = &pending.app {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            if pending.queue.ready
                && app
                    .emit("app:open-files", serde_json::json!({"paths": &paths}))
                    .is_ok()
            {
                return;
            }
        }
        pending.queue.paths.extend(paths);
    }
}

pub fn paths_from(args: &[String], cwd: &Path) -> Vec<String> {
    crate::startup_paths_from(args.iter().cloned())
        .into_iter()
        .map(|p| cwd.join(p).to_string_lossy().into_owned())
        .collect()
}

#[cfg(not(windows))]
pub fn start(
    _key: &str,
    _paths: &[String],
    _deliver: impl Fn(Vec<String>) + Send + 'static,
) -> Result<bool, AppError> {
    Ok(true)
}

#[cfg(windows)]
pub fn start(
    key: &str,
    paths: &[String],
    deliver: impl Fn(Vec<String>) + Send + 'static,
) -> Result<bool, AppError> {
    native::start(key, paths, deliver)
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::{
        ffi::c_void,
        hash::{Hash, Hasher},
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        ptr,
        time::{Duration, Instant},
    };
    const CONNECTION_TIMEOUT: Duration = Duration::from_secs(2);
    const CLIENT_TIMEOUT: Duration = Duration::from_secs(10);
    const OVERLAPPED_FLAG: u32 = 0x4000_0000;
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: Handle,
    }
    struct Operation {
        // Heap storage remains stable until completion/cancellation is observed.
        overlapped: Box<Overlapped>,
        _event: OwnedHandle,
    }
    #[repr(C)]
    struct Security {
        length: u32,
        descriptor: Handle,
        inherit: i32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn LocalFree(memory: Handle) -> Handle;
        fn CreateNamedPipeW(
            name: *const u16,
            open: u32,
            mode: u32,
            instances: u32,
            output: u32,
            input: u32,
            timeout: u32,
            security: *const Security,
        ) -> Handle;
        fn ConnectNamedPipe(pipe: Handle, overlapped: *mut Overlapped) -> i32;
        fn DisconnectNamedPipe(pipe: Handle) -> i32;
        fn WaitNamedPipeW(name: *const u16, timeout: u32) -> i32;
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            security: Handle,
            disposition: u32,
            flags: u32,
            template: Handle,
        ) -> Handle;
        fn CreateEventW(
            security: Handle,
            manual_reset: i32,
            initial: i32,
            name: *const u16,
        ) -> Handle;
        fn ReadFile(
            pipe: Handle,
            buffer: *mut u8,
            length: u32,
            read: *mut u32,
            overlapped: *mut Overlapped,
        ) -> i32;
        fn WriteFile(
            pipe: Handle,
            buffer: *const u8,
            length: u32,
            written: *mut u32,
            overlapped: *mut Overlapped,
        ) -> i32;
        fn WaitForSingleObject(handle: Handle, timeout: u32) -> u32;
        fn GetOverlappedResult(
            pipe: Handle,
            overlapped: *mut Overlapped,
            transferred: *mut u32,
            wait: i32,
        ) -> i32;
        fn CancelIoEx(pipe: Handle, overlapped: *mut Overlapped) -> i32;
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(
            token: Handle,
            class: u32,
            info: Handle,
            length: u32,
            required: *mut u32,
        ) -> i32;
        fn ConvertSidToStringSidW(sid: Handle, result: *mut *mut u16) -> i32;
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text: *const u16,
            revision: u32,
            result: *mut Handle,
            size: *mut u32,
        ) -> i32;
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    fn error() -> AppError {
        std::io::Error::last_os_error().into()
    }
    fn timeout() -> std::io::Error {
        std::io::Error::new(std::io::ErrorKind::TimedOut, "启动通信超时")
    }
    impl Operation {
        fn new() -> Result<Self, AppError> {
            let event = unsafe { CreateEventW(ptr::null_mut(), 1, 0, ptr::null()) };
            if event.is_null() {
                return Err(error());
            }
            Ok(Self {
                overlapped: Box::new(Overlapped {
                    event,
                    ..Default::default()
                }),
                _event: unsafe { OwnedHandle::from_raw_handle(event) },
            })
        }
        fn wait(
            &mut self,
            pipe: &OwnedHandle,
            deadline: Option<Instant>,
        ) -> std::io::Result<usize> {
            let millis = deadline
                .map(|end| {
                    end.saturating_duration_since(Instant::now())
                        .as_millis()
                        .min(u32::MAX as u128 - 1) as u32
                })
                .unwrap_or(u32::MAX);
            let result = unsafe { WaitForSingleObject(self.overlapped.event, millis) };
            let mut transferred = 0;
            if result != 0 {
                let failure = if result == 258 {
                    timeout()
                } else {
                    std::io::Error::last_os_error()
                };
                unsafe {
                    // Cancellation is asynchronous. Observe its completion before
                    // freeing OVERLAPPED or the caller's input/output buffer.
                    CancelIoEx(pipe.as_raw_handle(), &mut *self.overlapped);
                    GetOverlappedResult(
                        pipe.as_raw_handle(),
                        &mut *self.overlapped,
                        &mut transferred,
                        1,
                    );
                }
                return Err(failure);
            }
            if unsafe {
                GetOverlappedResult(
                    pipe.as_raw_handle(),
                    &mut *self.overlapped,
                    &mut transferred,
                    0,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error());
            }
            Ok(transferred as usize)
        }
    }
    fn accept(pipe: &OwnedHandle) -> Result<bool, AppError> {
        let mut operation = Operation::new()?;
        if unsafe { ConnectNamedPipe(pipe.as_raw_handle(), &mut *operation.overlapped) } != 0 {
            return Ok(true);
        }
        match std::io::Error::last_os_error().raw_os_error() {
            Some(535) => Ok(true),        // Client connected before accept was submitted.
            Some(232 | 109) => Ok(false), // It also closed before accept; reset this instance.
            Some(997) => match operation.wait(pipe, None) {
                // Idle: one kernel event wait, no timer.
                Ok(_) => Ok(true),
                Err(e) if matches!(e.raw_os_error(), Some(232 | 109)) => Ok(false),
                Err(e) => Err(e.into()),
            },
            _ => Err(error()),
        }
    }
    unsafe fn transfer(
        pipe: &OwnedHandle,
        buffer: *mut u8,
        length: usize,
        write: bool,
        deadline: Instant,
    ) -> Result<usize, AppError> {
        if Instant::now() >= deadline {
            return Err(timeout().into());
        }
        let mut operation = Operation::new()?;
        let mut transferred = 0;
        let completed = if write {
            WriteFile(
                pipe.as_raw_handle(),
                buffer,
                length as u32,
                &mut transferred,
                &mut *operation.overlapped,
            )
        } else {
            ReadFile(
                pipe.as_raw_handle(),
                buffer,
                length as u32,
                &mut transferred,
                &mut *operation.overlapped,
            )
        };
        if completed != 0 {
            return Ok(transferred as usize);
        }
        if std::io::Error::last_os_error().raw_os_error() != Some(997) {
            return Err(error());
        }
        operation.wait(pipe, Some(deadline)).map_err(Into::into)
    }
    fn read_exact(
        pipe: &OwnedHandle,
        mut bytes: &mut [u8],
        deadline: Instant,
    ) -> Result<(), AppError> {
        while !bytes.is_empty() {
            let count =
                unsafe { transfer(pipe, bytes.as_mut_ptr(), bytes.len(), false, deadline)? };
            if count == 0 {
                return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof).into());
            }
            bytes = &mut bytes[count..];
        }
        Ok(())
    }
    fn write_all(pipe: &OwnedHandle, mut bytes: &[u8], deadline: Instant) -> Result<(), AppError> {
        while !bytes.is_empty() {
            let count =
                unsafe { transfer(pipe, bytes.as_ptr().cast_mut(), bytes.len(), true, deadline)? };
            if count == 0 {
                return Err(std::io::Error::from(std::io::ErrorKind::WriteZero).into());
            }
            bytes = &bytes[count..];
        }
        Ok(())
    }
    fn sid() -> Result<String, AppError> {
        unsafe {
            let mut token = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), 8, &mut token) == 0 {
                return Err(error());
            }
            let mut required = 0;
            GetTokenInformation(token, 1, ptr::null_mut(), 0, &mut required);
            let mut buffer =
                vec![0usize; (required as usize).div_ceil(std::mem::size_of::<usize>())];
            let ok = GetTokenInformation(
                token,
                1,
                buffer.as_mut_ptr().cast(),
                required,
                &mut required,
            );
            let result = if ok == 0 {
                Err(error())
            } else {
                let mut text = ptr::null_mut();
                if ConvertSidToStringSidW(buffer[0] as Handle, &mut text) == 0 {
                    Err(error())
                } else {
                    let mut length = 0;
                    while *text.add(length) != 0 {
                        length += 1;
                    }
                    let value = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
                    LocalFree(text.cast());
                    Ok(value)
                }
            };
            CloseHandle(token);
            result
        }
    }
    pub(super) fn start(
        key: &str,
        paths: &[String],
        deliver: impl Fn(Vec<String>) + Send + 'static,
    ) -> Result<bool, AppError> {
        let user = sid()?;
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        key.to_lowercase().hash(&mut hash);
        let name = wide(&format!(
            r"\\.\pipe\markdown-preview-{user}-{:016x}",
            hash.finish()
        ));
        let sddl = wide(&format!("D:P(A;;GA;;;{user})"));
        unsafe {
            let mut descriptor = ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                ptr::null_mut(),
            ) == 0
            {
                return Err(error());
            }
            let security = Security {
                length: std::mem::size_of::<Security>() as u32,
                descriptor,
                inherit: 0,
            };
            // DUPLEX | FIRST_PIPE_INSTANCE | OVERLAPPED; byte mode, reject remote clients.
            let pipe = CreateNamedPipeW(
                name.as_ptr(),
                3 | 0x0008_0000 | OVERLAPPED_FLAG,
                8,
                1,
                4096,
                262144,
                10000,
                &security,
            );
            let create_error = std::io::Error::last_os_error();
            LocalFree(descriptor);
            if pipe as isize == -1 {
                if !matches!(create_error.raw_os_error(), Some(5 | 231)) {
                    return Err(create_error.into());
                }
                let open = || {
                    CreateFileW(
                        name.as_ptr(),
                        0xC000_0000,
                        0,
                        ptr::null_mut(),
                        3,
                        0x0011_0000 | OVERLAPPED_FLAG,
                        ptr::null_mut(),
                    )
                };
                let deadline = Instant::now() + CLIENT_TIMEOUT;
                let handle = loop {
                    let handle = open();
                    if handle as isize != -1 {
                        break handle;
                    }
                    if std::io::Error::last_os_error().raw_os_error() != Some(231) {
                        return Err(error());
                    }
                    let remaining = deadline
                        .saturating_duration_since(std::time::Instant::now())
                        .as_millis();
                    if remaining == 0 {
                        return Err(AppError::Internal("主实例繁忙，请稍后重试".into()));
                    }
                    // Several waiters can wake together; the loser waits for the
                    // next availability notification, still under one deadline.
                    if WaitNamedPipeW(name.as_ptr(), remaining.min(10000) as u32) == 0 {
                        return Err(error());
                    }
                };
                let client = OwnedHandle::from_raw_handle(handle);
                let bytes =
                    serde_json::to_vec(paths).map_err(|e| AppError::Internal(e.to_string()))?;
                if bytes.len() > 262144 {
                    return Err(AppError::PathForbidden("启动文件列表过长".into()));
                }
                write_all(&client, &(bytes.len() as u32).to_le_bytes(), deadline)?;
                write_all(&client, &bytes, deadline)?;
                let mut ack = [0];
                read_exact(&client, &mut ack, deadline)?;
                if ack != [1] {
                    return Err(AppError::Internal("主实例拒绝启动请求".into()));
                }
                return Ok(false);
            }
            let server = OwnedHandle::from_raw_handle(pipe);
            std::thread::Builder::new()
                .name("single-instance".into())
                .spawn(move || {
                    loop {
                        match accept(&server) {
                            Ok(true) => (),
                            Ok(false) => {
                                DisconnectNamedPipe(server.as_raw_handle());
                                continue;
                            }
                            Err(_) => break,
                        }
                        let deadline = Instant::now() + CONNECTION_TIMEOUT;
                        let received = (|| -> Result<Vec<String>, AppError> {
                            let mut length = [0; 4];
                            read_exact(&server, &mut length, deadline)?;
                            let length = u32::from_le_bytes(length) as usize;
                            if length > 262144 {
                                return Err(AppError::PathForbidden("启动消息过长".into()));
                            }
                            let mut bytes = vec![0; length];
                            read_exact(&server, &mut bytes, deadline)?;
                            let paths: Vec<String> = serde_json::from_slice(&bytes)
                                .map_err(|e| AppError::Internal(e.to_string()))?;
                            if paths.len() > 256
                                || paths.iter().any(|p| {
                                    p.len() > 32768
                                        || p.contains('\0')
                                        || !Path::new(p).is_absolute()
                                        || !crate::documents::is_markdown(Path::new(p))
                                })
                            {
                                return Err(AppError::PathForbidden("启动路径无效".into()));
                            }
                            Ok(paths)
                        })();
                        match received {
                            Ok(paths) => {
                                deliver(paths);
                                let _ = write_all(&server, &[1], deadline);
                            }
                            Err(_) => {
                                let _ = write_all(&server, &[0], deadline);
                            }
                        }
                        // Allow the acknowledged client to consume the response and
                        // close, under the same connection deadline. A stuck client
                        // cannot monopolize the broker even after sending valid JSON.
                        let mut end = [0];
                        let _ = read_exact(&server, &mut end, deadline);
                        DisconnectNamedPipe(server.as_raw_handle());
                    }
                })?;
            Ok(true)
        }
    }

    #[cfg(test)]
    mod deadline_tests {
        use super::*;
        use std::{
            fs::File,
            io::{Read, Write},
        };
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };

        fn pipe_name(key: &str) -> Vec<u16> {
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            key.to_lowercase().hash(&mut hash);
            wide(&format!(
                r"\\.\pipe\markdown-preview-{}-{:016x}",
                sid().unwrap(),
                hash.finish()
            ))
        }
        fn raw_client(key: &str) -> File {
            let name = pipe_name(key);
            let handle = unsafe {
                CreateFileW(
                    name.as_ptr(),
                    0xC000_0000,
                    0,
                    ptr::null_mut(),
                    3,
                    0x0011_0000,
                    ptr::null_mut(),
                )
            };
            assert_ne!(handle as isize, -1, "{}", std::io::Error::last_os_error());
            unsafe { File::from_raw_handle(handle) }
        }

        #[test]
        fn stalled_header_body_and_unread_ack_do_not_block_the_next_launch() {
            for bytes in [
                vec![1, 0],
                vec![9, 0, 0, 0, b'['],
                vec![2, 0, 0, 0, b'[', b']'],
            ] {
                let key = uuid::Uuid::new_v4().to_string();
                let (delivered, deliveries) = mpsc::channel();
                assert!(start(&key, &[], move |paths| {
                    let _ = delivered.send(paths);
                })
                .unwrap());
                let mut stalled = raw_client(&key);
                stalled.write_all(&bytes).unwrap();
                let path = std::env::current_dir()
                    .unwrap()
                    .join("after-stall.md")
                    .to_string_lossy()
                    .into_owned();
                let (finished, result) = mpsc::channel();
                let started = Instant::now();
                let follower = path.clone();
                std::thread::spawn(move || {
                    let _ = finished.send(start(&key, &[follower], |_| {}));
                });
                let result = result.recv_timeout(Duration::from_secs(4));
                // Close even on RED so the intentionally stalled thread can finish.
                drop(stalled);
                assert!(
                    result
                        .expect("next launch must outlive a stalled client")
                        .unwrap()
                        == false
                );
                assert!(started.elapsed() < Duration::from_secs(4));
                let mut observed = deliveries.recv_timeout(Duration::from_secs(1)).unwrap();
                if observed.is_empty() {
                    observed = deliveries.recv_timeout(Duration::from_secs(1)).unwrap();
                }
                assert_eq!(observed, [path]);
            }
        }

        #[test]
        fn disconnected_truncated_request_is_rejected_and_server_recovers() {
            let key = uuid::Uuid::new_v4().to_string();
            let (delivered, deliveries) = mpsc::channel();
            assert!(start(&key, &[], move |paths| {
                let _ = delivered.send(paths);
            })
            .unwrap());
            let mut truncated = raw_client(&key);
            truncated.write_all(&[9, 0, 0, 0, b'[']).unwrap();
            drop(truncated);
            let path = std::env::current_dir()
                .unwrap()
                .join("after-truncation.md")
                .to_string_lossy()
                .into_owned();
            assert!(!start(&key, std::slice::from_ref(&path), |_| {}).unwrap());
            assert_eq!(
                deliveries.recv_timeout(Duration::from_secs(1)).unwrap(),
                [path]
            );
            assert!(deliveries.try_recv().is_err());
        }

        #[test]
        fn secondary_exits_with_timeout_when_primary_never_acknowledges() {
            let key = uuid::Uuid::new_v4().to_string();
            let name = pipe_name(&key);
            let (ready, initialized) = mpsc::channel();
            let (release, released) = mpsc::channel();
            let primary = std::thread::spawn(move || {
                let handle = unsafe {
                    CreateNamedPipeW(
                        name.as_ptr(),
                        3 | 0x0008_0000,
                        8,
                        1,
                        4096,
                        262144,
                        10000,
                        ptr::null(),
                    )
                };
                assert_ne!(handle as isize, -1);
                let mut pipe = unsafe { File::from_raw_handle(handle) };
                ready.send(()).unwrap();
                assert!(
                    unsafe { ConnectNamedPipe(handle, ptr::null_mut()) } != 0
                        || std::io::Error::last_os_error().raw_os_error() == Some(535)
                );
                let mut length = [0; 4];
                pipe.read_exact(&mut length).unwrap();
                let mut body = vec![0; u32::from_le_bytes(length) as usize];
                pipe.read_exact(&mut body).unwrap();
                released.recv_timeout(Duration::from_secs(15)).unwrap();
            });
            initialized.recv_timeout(Duration::from_secs(2)).unwrap();
            let (finished, result) = mpsc::channel();
            let started = Instant::now();
            std::thread::spawn(move || {
                let _ = finished.send(start(&key, &[], |_| {}));
            });
            let result = result.recv_timeout(CLIENT_TIMEOUT + Duration::from_secs(2));
            release.send(()).unwrap();
            primary.join().unwrap();
            let error = result
                .expect("secondary must have an acknowledgement deadline")
                .unwrap_err();
            assert!(error.to_string().contains("超时"), "{error}");
            assert!(started.elapsed() >= CLIENT_TIMEOUT - Duration::from_millis(100));
            assert!(started.elapsed() < CLIENT_TIMEOUT + Duration::from_secs(2));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_and_pre_ready_delivery_are_drained_once() {
        let mut queue = Queue {
            paths: vec!["first.md".into()],
            ready: false,
        };
        queue.paths.push("second.md".into());
        assert_eq!(queue.drain(), ["first.md", "second.md"]);
        assert!(queue.drain().is_empty());
    }
    #[test]
    fn relative_argv_uses_sender_working_directory_and_filters_options() {
        let cwd = std::env::current_dir().unwrap();
        let paths = paths_from(
            &[
                "sub/a.md".into(),
                "--m1-profile=x.md".into(),
                "x.txt".into(),
            ],
            &cwd,
        );
        assert_eq!(paths, [cwd.join("sub/a.md").to_string_lossy()]);
    }
    #[cfg(windows)]
    #[test]
    fn native_pipe_elects_one_primary_and_forwards_before_ui_exists() {
        let key = uuid::Uuid::new_v4().to_string();
        let (send, receive) = std::sync::mpsc::channel();
        assert!(start(&key, &[], move |paths| {
            send.send(paths).unwrap();
        })
        .unwrap());
        let path = std::env::current_dir()
            .unwrap()
            .join("中文.md")
            .to_string_lossy()
            .into_owned();
        assert!(!start(&key, std::slice::from_ref(&path), |_| panic!(
            "secondary must not receive"
        ))
        .unwrap());
        assert_eq!(
            receive
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            [path]
        );
    }
    #[cfg(windows)]
    #[test]
    fn concurrent_native_launches_elect_exactly_one_primary() {
        let key = uuid::Uuid::new_v4().to_string();
        let barrier = Arc::new(std::sync::Barrier::new(10));
        let (send, receive) = std::sync::mpsc::channel();
        let threads: Vec<_> = (0..10)
            .map(|index| {
                let (key, barrier, send) = (key.clone(), barrier.clone(), send.clone());
                std::thread::spawn(move || {
                    let path = std::env::current_dir()
                        .unwrap()
                        .join(format!("{index}.md"))
                        .to_string_lossy()
                        .into_owned();
                    barrier.wait();
                    start(&key, &[path], move |paths| {
                        let _ = send.send(paths);
                    })
                    .unwrap()
                })
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .map(|t| t.join().unwrap() as usize)
                .sum::<usize>(),
            1
        );
        for _ in 0..9 {
            assert_eq!(
                receive
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .unwrap()
                    .len(),
                1
            );
        }
    }
}
