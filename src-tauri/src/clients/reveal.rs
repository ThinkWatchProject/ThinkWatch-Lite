//! 在文件管理器里选中一个文件。每个平台各有各的说法。

/// 把文件管理器打开到这个文件上，并且**选中它**。
///
/// 每个平台各有各的说法，而且**这段代码在 Windows 上编得过、只在运行时失败**
/// —— `open` 那个命令在那里根本不存在，而类型系统对此无话可说。这类坏法 CI
/// 也抓不到，它只会在用户点下那个按钮的时候出现。
#[cfg(target_os = "macos")]
pub fn reveal(path: &str) -> Result<(), String> {
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
pub fn reveal(path: &str) -> Result<(), String> {
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

/// 只交给文件管理器一个绝对路径。路径是检测出来的，本来就是绝对的；这一道是为了
/// 一个以 `-` 开头的字符串永远不会被 `open` 当成选项
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
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

/// Linux 上交给 opener 插件：它问 `org.freedesktop.FileManager1.ShowItems`
/// —— Nautilus、Dolphin、Nemo、Thunar 都实现了这个接口，打开所在目录并选中
/// 那个文件。
///
/// **插件自己的退路不作数。**`ShowItems` 失败时它改问 portal 的
/// `OpenDirectory`，但那个方法要的是一个文件描述符（`h`），插件传的是 URI
/// 字符串，签名对不上，每次都会被拒。所以两样都失败时由这里用 `xdg-open`
/// 打开所在目录：选不中那个文件，但至少到了那里。
#[cfg(target_os = "linux")]
pub fn reveal(path: &str) -> Result<(), String> {
    absolute(path)?;
    let Err(first) = tauri_plugin_opener::reveal_item_in_dir(path) else {
        return Ok(());
    };
    tracing::warn!(%path, "FileManager1.ShowItems failed, opening the folder instead: {first}");
    let dir = std::path::Path::new(path)
        .parent()
        .unwrap_or(std::path::Path::new("/"));
    // **写全路径**，理由同 macOS 的 `open`。不就地等它：有的桌面上 xdg-open
    // 要等文件管理器退出才返回。等在一条单独的线程上，只为收尸 —— 不等的话
    // 每点一次就留一个僵尸进程，直到应用退出
    std::process::Command::new("/usr/bin/xdg-open")
        .arg(dir)
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || child.wait());
        })
        .map_err(|e| {
            tr!(
                format!("无法在文件管理器中显示 {path}：{e}"),
                format!("{path} could not be shown in the file manager: {e}")
            )
            .to_string()
        })
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn reveal(path: &str) -> Result<(), String> {
    Err(tr!(
        format!("这个平台上还不能打开文件管理器：{path}"),
        format!("Opening a file manager is not supported on this platform yet: {path}")
    )
    .to_string())
}
