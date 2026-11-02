// 应用错误类型。
//
// 设计要点（见 docs/design/07-ipc-contract.md §3.3）：
// - 每个变体映射到一个稳定的 E_* 错误码，前端不解析 message 文本
// - 序列化成 { code, message, detail }，与前端 IpcError 接口一一对应
// - 不实现 Serialize 的自动 derive，而是手写：需要把变体映射成错误码

use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("文件不存在: {0}")]
    FileNotFound(String),

    #[error("文件访问被拒绝: {0}")]
    FileAccess(String),

    #[error("文件过大: {0} 字节")]
    FileTooLarge(u64),

    #[error("不支持的编码")]
    Encoding,

    #[error("路径超出允许范围: {0}")]
    PathForbidden(String),

    #[error("文档未打开或已关闭")]
    DocUnknown,

    #[error("文件监听失败: {0}")]
    WatchFailed(String),

    #[error("资源被拒绝: {0}")]
    AssetForbidden(String),

    #[error("链接被阻止: {0}")]
    UrlBlocked(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl AppError {
    // 稳定的错误码。前端只依赖这些字面量，改动需要同步更新
    // src/ui/src/core/ipc/contract.ts 的 ErrorCode 联合类型。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::FileNotFound(_) => "E_FILE_NOT_FOUND",
            AppError::FileAccess(_) => "E_FILE_ACCESS",
            AppError::FileTooLarge(_) => "E_FILE_TOO_LARGE",
            AppError::Encoding => "E_ENCODING",
            AppError::PathForbidden(_) => "E_PATH_FORBIDDEN",
            AppError::DocUnknown => "E_DOC_UNKNOWN",
            AppError::WatchFailed(_) => "E_WATCH_FAILED",
            AppError::AssetForbidden(_) => "E_ASSET_FORBIDDEN",
            AppError::UrlBlocked(_) => "E_URL_BLOCKED",
            AppError::Internal(_) => "E_INTERNAL",
        }
    }

    // 可选的补充细节。目前只在内部错误里带，避免把路径等信息泄露给前端日志。
    fn detail(&self) -> Option<String> {
        match self {
            AppError::Internal(d) => Some(d.clone()),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 3)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        match self.detail() {
            Some(d) => s.serialize_field("detail", &d)?,
            None => s.serialize_field("detail", &Option::<String>::None)?,
        }
        s.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => AppError::FileNotFound(e.to_string()),
            std::io::ErrorKind::PermissionDenied => AppError::FileAccess(e.to_string()),
            _ => AppError::Internal(e.to_string()),
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

// 把命令体里的 panic 转成结构化错误，避免窗口假死。
//
// 关于 UnwindSafe 的说明：
// Tauri 的命令体里会捕获 AppHandle / State 等类型，这些类型内部含
// UnsafeCell（事件循环、资源表），因此**无法**满足 UnwindSafe。
// 但这不构成实际风险：panic 发生在命令自身的调用栈里，
// 我们只是把 panic 转成错误返回，不会在 panic 后继续使用被污染的状态。
//
// 因此这里用 AssertUnwindSafe 显式声明「我们知道自己在做什么」，
// 而不是要求调用方满足一个它们永远无法满足的 bound
// （那样会导致每个命令都要自己包一层，反而更易错）。
pub fn guard<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(r) => r,
        Err(payload) => {
            let msg = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "未知 panic".to_string());
            Err(AppError::Internal(format!("命令执行时发生 panic: {msg}")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 每个变体的错误码必须稳定：前端依赖这些字面量做分支。
    #[test]
    fn error_codes_are_stable() {
        assert_eq!(AppError::FileNotFound("x".into()).code(), "E_FILE_NOT_FOUND");
        assert_eq!(AppError::FileAccess("x".into()).code(), "E_FILE_ACCESS");
        assert_eq!(AppError::FileTooLarge(1).code(), "E_FILE_TOO_LARGE");
        assert_eq!(AppError::Encoding.code(), "E_ENCODING");
        assert_eq!(AppError::PathForbidden("x".into()).code(), "E_PATH_FORBIDDEN");
        assert_eq!(AppError::DocUnknown.code(), "E_DOC_UNKNOWN");
        assert_eq!(AppError::WatchFailed("x".into()).code(), "E_WATCH_FAILED");
        assert_eq!(AppError::AssetForbidden("x".into()).code(), "E_ASSET_FORBIDDEN");
        assert_eq!(AppError::UrlBlocked("x".into()).code(), "E_URL_BLOCKED");
        assert_eq!(AppError::Internal("x".into()).code(), "E_INTERNAL");
    }

    // 序列化形状必须与前端 IpcError 一致：{ code, message, detail }
    #[test]
    fn serializes_to_expected_shape() {
        let err = AppError::FileNotFound("D:/a.md".into());
        let v = serde_json::to_value(&err).expect("序列化失败");
        assert_eq!(v["code"], "E_FILE_NOT_FOUND");
        assert!(v["message"].as_str().unwrap().contains("D:/a.md"));
        assert!(v.get("detail").is_some(), "detail 字段必须存在（可为 null）");
    }

    // 内部错误要带 detail，其余不带
    #[test]
    fn internal_error_carries_detail() {
        let v = serde_json::to_value(AppError::Internal("boom".into())).unwrap();
        assert_eq!(v["detail"], "boom");

        let v2 = serde_json::to_value(AppError::DocUnknown).unwrap();
        assert!(v2["detail"].is_null());
    }

    // io 错误要按 kind 映射到正确变体
    #[test]
    fn io_errors_map_by_kind() {
        let e = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        assert_eq!(AppError::from(e).code(), "E_FILE_NOT_FOUND");

        let e = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope");
        assert_eq!(AppError::from(e).code(), "E_FILE_ACCESS");
    }

    // guard 必须把 panic 转成 E_INTERNAL，而不是让进程崩溃
    #[test]
    fn guard_converts_panic_to_internal_error() {
        let r = guard(|| -> Result<(), AppError> { panic!("故意 panic") });
        match r {
            Err(AppError::Internal(msg)) => assert!(msg.contains("故意 panic")),
            other => panic!("期望 Internal 错误，实际: {other:?}"),
        }
    }

    // guard 在正常路径下必须原样返回
    #[test]
    fn guard_passes_through_ok() {
        let r = guard(|| Ok::<i32, AppError>(42));
        assert_eq!(r.unwrap(), 42);
    }
}
