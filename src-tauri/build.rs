fn main() {
    core_tag();
    // **Windows 的程序清单自己给**（`app.manifest`），比 tauri-build 默认的那份多一项：
    // 按每个显示器的 DPI 绘制。
    //
    // 默认那份只有 comctl32 第 6 版的依赖，进程的 DPI 设置要等 tao 建事件循环时用
    // `SetProcessDpiAwarenessContext` 设。而微软的文档要求这个设置**在进程出现任何界面
    // 之前**设好、之后再设会失败：Tauri 起来之前弹过系统对话框的那一次（切换实例、等它
    // 退出），tao 那一下就可能落空，整个应用按不感知 DPI 画、在缩放过的屏幕上发糊。写在清单里，进程
    // 一启动就是这一档，那几个对话框也跟着清楚。comctl32 的依赖原样保留：
    // `TaskDialogIndirect` 只在第 6 版里有（见 `dialog`）
    println!("cargo:rerun-if-changed=app.manifest");
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    if let Err(e) =
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
    {
        panic!("tauri-build: {e:#}");
    }
}

/// 这一版应用配的是哪一版 core：`Cargo.lock` 里锁到的 tw-api 的版本号。
///
/// 连远程 core 时版本对不上，界面要说出「本应用需要 core X」。**从锁文件读，不另写
/// 一份**。读版本号而不是 tag：临时钉在某个提交上（还没发版）时没有 tag，而 core 的
/// 各个 crate 和 twcore 共用同一个版本号
fn core_tag() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    let mut in_api = false;
    let mut version = None;
    for line in lock.lines() {
        if line.starts_with("name = ") {
            in_api = line == "name = \"tw-api\"";
        } else if in_api && let Some(v) = line.strip_prefix("version = ") {
            version = Some(v.trim_matches('"').to_string());
        }
    }
    println!(
        "cargo:rustc-env=TW_CORE_TAG={}",
        version.unwrap_or_else(|| "dev".into())
    );
}
