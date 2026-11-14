# macOS 全屏应用中菜单栏下拉菜单不可见

排查日期：2026-11-14；修复与验收：2026-11-15。

## 结论

用户确认普通桌面能打开菜单，全屏应用中只能看到菜单栏按钮高亮。2026-11-15 通过 `sw_vers` 核对，本机实际是 **macOS 27.2.1（26B131）**；上一轮将系统行为归因到 macOS 26 不准确。正在运行的安装版为 ThinkWatch Lite 2026.11.10。

证据指向 macOS 27 的原生菜单与全屏 Space、应用 activation policy 的兼容问题。Lite 主窗口打开后使用 Regular 模式；菜单可以开始跟踪，但其显示窗口未进入其他应用的全屏空间。主窗口关闭后切回 Accessory，在本机测试中能绕过问题。

## 选择与验证

| 方案 | 本机结果 |
| --- | --- |
| 修改菜单窗口及显示子窗口的空间属性 | 不稳定，未采用 |
| 在鼠标松开后，按屏幕坐标以 `inView: nil` 弹出菜单 | 用户实际点击确认仍不显示，未采用 |
| 独立 Accessory 进程持有原生菜单 | 用户确认测试探针能显示；随后确认编译后的真实 Rust 辅助进程菜单正常 |

公开的同类案例：[Codex #59930](https://github.com/openai/codex/issues/59930)、[Crossbow #346](https://github.com/Richard-Zhang1019/Crossbow/pull/346)。[macshot #511](https://github.com/sw33tLie/macshot/pull/511) 的屏幕坐标方案有其报告者的成功验证，但在本机未通过用户验收，因此没有采用。

## 已实现的修复

- `src-tauri/src/main.rs` 在初始化 Tauri、用户数据和 core 之前分流 `--menubar-helper`。
- `src-tauri/src/menubar/helper.rs` 在所有受支持的 macOS 上启动同一可执行文件的辅助模式。子进程保持 Accessory，复用现有 `macos.rs` 原生菜单实现，不启动 WebView 或 core。
- 主程序用匿名 stdin 管道传递状态快照、显示样式、语言和主题；子进程经 stdout 回传菜单开合与类型化动作。动作仍在主程序主线程上执行。
- 发送端与主队列接收端均只保留最新待处理快照，避免积压过期读数；主题只在变化时重新设置。
- 父进程退出或崩溃时，输入管道 EOF 立即结束辅助进程，即使菜单正在展开。辅助进程异常退出后，主程序等待 3 秒重新启动并重发最新快照。
- 按用户于 2026-11-15 的明确要求，移除系统版本判断及主应用中的进程内菜单分支，所有受支持的 macOS 统一走辅助进程。安装、刷新和隐藏使用同一路径。主窗口的 Dock 行为不变，不随菜单开合切换 activation policy。

`Action::Open` 的页面名使用 `Cow<'static, str>`：本地构建菜单仍可借用常量，管道解码时持有字符串，不泄漏内存。状态模型添加序列化支持，菜单渲染规则保持原样。

## 验收证据

- `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib menubar::`：71 项通过，包括新增的快照等价、动作往返、消息边界、异常数据和更新合并检查。
- `cargo build --locked --manifest-path src-tauri/Cargo.toml --bin thinkwatch-lite`：通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all --check` 与 `git diff --check`：通过。
- 真实辅助模式进程检查：启动、EOF 退出、错误输入退出，以及语言、主题、隐藏/显示样式切换通过。
- 用户在全屏应用中实际点击真实 Rust 辅助进程的“12.3K”测试菜单，确认菜单正常并点击了“打开主界面”。测试不操作正在运行的网关。
- 保留原生回归检查 `src-tauri/examples/menubar_helper_smoke.rs`。它在真正的辅助模式进程中打开 NSMenu 并触发第一项，收到 `Open(true)`、`Open(false)`、`Action(OpenMain)`，然后验证 EOF 退出；另一个场景验证菜单跟踪期间 EOF 也能退出。两项通过。

原生回归命令：

```sh
CARGO_INCREMENTAL=0 cargo run --locked --manifest-path src-tauri/Cargo.toml --example menubar_helper_smoke
```

程序触发的点击不能替代真实全屏鼠标验收，因此两种证据分别保留。按用户要求不安排旧系统测试；外接屏及完整安装包升级尚未验收。Debug 辅助进程在测试数据持续刷新时约 82 MiB RSS，发布构建内存未测量。

统一 macOS 路径后，在当前 macOS 27.2.1 上再次通过 `cargo clippy --all-targets -- -D warnings`、格式和差异检查。没有安排旧系统测试；上面的原生交互验收针对同一辅助进程实现。

## 交付与清理

修复保留在工作区源码，尚未提交或替换 `/Applications` 中的安装版；需重新打包安装后才会影响正在使用的版本。安装版 Lite（PID 2384）和 core（PID 2411）全程保持运行。

本轮临时目录为 `/tmp/twlite-fullscreen-fix.KdFsAv`，含探针、构建缓存、二进制、测试驱动和日志，验证完成后已删除。`du` 统计清理约 4.90 GiB 临时产物；清理前后 `df` 可用空间净增约 4.45 GiB（同盘有其他活动）。保留修复源码、回归检查和本文；活动工作区不移除，因此无需制作工作区归档。

统一 macOS 路径后的验证目录 `/tmp/twlite-unified-menubar.2PWIAb` 也已清理，包含构建缓存和 Clippy 日志；清理前确认验证已结束且无辅助测试进程占用。`du` 统计删除 1,196,624 KiB（约 1.14 GiB），前后 `df` 可用空间净增 981,976 KiB（约 0.94 GiB）。源码、本文和既有活动工作区依赖继续保留。
