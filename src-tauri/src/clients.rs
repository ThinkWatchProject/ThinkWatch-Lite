//! 客户端页的几个命令。
//!
//! **界面只说是哪个客户端**，要写进剪贴板的地址、要打开的文件都由这一层
//! 去问 core 再动手 —— 界面递一段任意文字进剪贴板、递一个任意路径给访达，
//! 都是不该开的口子。

use crate::AppState;
use tw_api::ep;

use crate::error::{Out, text};

fn unknown(id: &str) -> String {
    tr!(
        format!("未知的客户端「{id}」"),
        format!("`{id}` is not a client we know")
    )
    .to_string()
}

/// 复制这个客户端要填的网关地址（它要的那种写法，有的带 `/v1`）。
#[tauri::command]
pub async fn copy_client_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let list = state
        .control
        .call::<ep::Clients>(&[], &())
        .await
        .map_err(text)?;
    let endpoint = list
        .clients
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.manual.endpoint.clone())
        .or_else(|| {
            list.manual
                .iter()
                .find(|m| m.id == id)
                .map(|m| m.setup.endpoint.clone())
        })
        .ok_or_else(|| unknown(&id))?;
    app.clipboard()
        .write_text(endpoint)
        .map_err(|e| e.to_string().into())
}

/// 在文件管理器里选中这个客户端的配置文件 —— 跟完符号链接的那一份，那才是
/// 真正会被改的。
#[tauri::command]
pub async fn reveal_client_config(state: tauri::State<'_, AppState>, id: String) -> Out<()> {
    let list = state
        .control
        .call::<ep::Clients>(&[], &())
        .await
        .map_err(text)?;
    let c = list
        .clients
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| unknown(&id))?;
    Ok(reveal(&c.real)?)
}

/// 把文件管理器打开到这个文件上，并且**选中它**。
///
/// 两个平台各有各的说法，而且**这段代码在 Windows 上编得过、只在运行时失败**
/// —— `open` 那个命令在那里根本不存在，而类型系统对此无话可说。这类坏法 CI
/// 也抓不到，它只会在用户点下那个按钮的时候出现。
#[cfg(target_os = "macos")]
fn reveal(path: &str) -> Result<(), String> {
    absolute(path)?;
    // **写全路径**，和 `dmg.rs` 里的 hdiutil 一样：按 `PATH` 找的话，谁在 `PATH`
    // 前面放一个同名程序，跑起来的就是它
    let st = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| e.to_string())?;
    if st.success() {
        Ok(())
    } else {
        Err(tr!(
            format!("无法在访达中显示 {path}"),
            format!("{path} could not be shown in Finder")
        )
        .to_string())
    }
}

#[cfg(windows)]
fn reveal(path: &str) -> Result<(), String> {
    absolute(path)?;
    // `/select,<路径>` 中间**没有空格**：explorer 把这一整串当成一个参数，
    // 写成 `/select, path` 的话它只会打开「文档」。
    std::process::Command::new(explorer())
        .arg(format!("/select,{path}"))
        // **不看退出码。**explorer.exe 即使成功也常常返回 1 —— 照着它判断的话，
        // 每一次都会告诉用户失败了，而窗口就在他眼前开着。起不来（`spawn`
        // 本身出错）才是真的失败。
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            tr!(
                format!("无法在文件资源管理器中显示 {path}：{e}"),
                format!("{path} could not be shown in File Explorer: {e}")
            )
            .to_string()
        })
}

/// explorer.exe 的全路径：Windows 目录由系统给出，不按 `PATH` 找，也不信
/// `%SystemRoot%` 这类谁都能改的环境变量。问不到时退回默认的安装位置。
#[cfg(windows)]
fn explorer() -> std::path::PathBuf {
    use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
    let mut buf = [0u16; 260];
    // SAFETY: 缓冲区和给出的长度一致；返回值是写入的字符数（不含结尾的 0），
    // 放不下时是需要的长度，那时它比缓冲区大
    let n = unsafe { GetWindowsDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
    let dir = if n > 0 && n < buf.len() {
        std::path::PathBuf::from(String::from_utf16_lossy(&buf[..n]))
    } else {
        std::path::PathBuf::from(r"C:\Windows")
    };
    dir.join("explorer.exe")
}

/// 只交给文件管理器一个绝对路径。路径来自 core，本来就是绝对的；这一道是为了
/// 一个以 `-` 开头的字符串永远不会被 `open` 当成选项
#[cfg(any(target_os = "macos", windows))]
fn absolute(path: &str) -> Result<(), String> {
    if std::path::Path::new(path).is_absolute() {
        Ok(())
    } else {
        Err(tr!(
            format!("配置文件的路径不是绝对路径：{path}"),
            format!("The configuration file path is not absolute: {path}")
        )
        .to_string())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn reveal(path: &str) -> Result<(), String> {
    Err(tr!(
        format!("这个平台上还不能打开文件管理器：{path}"),
        format!("Opening a file manager is not supported on this platform yet: {path}")
    )
    .to_string())
}
