<p align="center">
  <img src="https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/License-MIT-750014?style=for-the-badge" />
  <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
  <img src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" />
</p>

# ThinkWatch Lite

**[English](README.md) | [中文](README.zh-CN.md)**

ThinkWatch Lite 是运行本地 AI API 网关的桌面应用，常驻 macOS 菜单栏、Windows
通知区域或 Linux 系统托盘。Claude Code、Codex CLI 等使用 Anthropic、OpenAI、Gemini API 的客户端
把请求发给这个网关，Lite 展示每个请求的费用、由哪个上游处理及其原因，以及随请求
发出的内容。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png">
  <img src="docs/screenshots/overview-light.png" alt="ThinkWatch Lite 的用量概览：token、费用与请求数，按模型分层的 24 小时趋势，模型排行与缓存命中率">
</picture>

支持 macOS 12 及以上版本（仅限 Apple Silicon）、Windows 10 21H2 及以上版本
（x64 或 ARM64），以及 Ubuntu 22.04、Debian 12、Fedora 36 及以上版本的 Linux
（x86_64 或 aarch64）。

## 安装

| 平台 | 下载 |
|---|---|
| macOS，Apple Silicon | `brew install --cask thinkwatchproject/tap/thinkwatch-lite`，或 [`ThinkWatch-Lite-<版本>-arm64.dmg`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Windows，x64 | [`ThinkWatch-Lite-<版本>-x64-setup.exe`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Windows，ARM64 | [`ThinkWatch-Lite-<版本>-arm64-setup.exe`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Linux，x86_64 或 aarch64 | `curl -fsSL https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest/download/install.sh \| sh`，或 [`ThinkWatch-Lite-<版本>-<架构>.AppImage`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |

官网的 [Lite 页面](https://thinkwat.ch/zh-CN/lite#install)提供最新版本的直接下载，
Windows 和 Linux 会自动选对架构。网关
[ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core) 随应用一起
安装，无需另行安装。

### macOS

```bash
brew install --cask thinkwatchproject/tap/thinkwatch-lite
```

也可以从 [最新版本的 release 页面](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest)
下载 `ThinkWatch-Lite-<版本>-arm64.dmg`，与同页发布的 sha256 校验值核对后，将
ThinkWatch Lite 拖入「应用程序」。应用**未经 Apple 注册开发者签名**，macOS 会
为下载的副本添加隔离属性并拒绝打开，需先移除该属性：

```bash
xattr -dr com.apple.quarantine "/Applications/ThinkWatch Lite.app"
```

也可以在首次打开被拒绝后，前往「系统设置 › 隐私与安全性」点击「仍要打开」。
[Homebrew cask](https://github.com/ThinkWatchProject/homebrew-tap) 在安装时会
自动完成这一步，此外只是把应用从磁盘映像复制到「应用程序」。

### Windows

从 [最新版本的 release 页面](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest)
下载与本机架构对应的安装程序：大多数电脑用 `ThinkWatch-Lite-<版本>-x64-setup.exe`，
ARM 处理器的电脑用 `ThinkWatch-Lite-<版本>-arm64-setup.exe`。下载后与同页发布的
sha256 校验值核对：

```powershell
Get-FileHash .\ThinkWatch-Lite-<版本>-x64-setup.exe
```

安装程序为所有用户安装，装入 Program Files，因此 Windows 会请求管理员权限。
需要 Windows 10 21H2 及以上版本；缺少 WebView2 时安装程序会自动下载（Windows 11
已自带）。

安装程序**未经代码签名**，项目也不会购买证书。运行下载的安装程序时，SmartScreen
会显示全屏的蓝色警告「Windows 已保护你的电脑」，依次点击「更多信息」→「仍要运行」
即可继续安装。

安装后应用常驻通知区域，数据保存在 `%APPDATA%\ThinkWatch`。

### Linux

```bash
curl -fsSL https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest/download/install.sh | sh
```

脚本下载与本机架构对应的 AppImage，与同页发布的 sha256 校验值核对后安装为
`~/Applications/ThinkWatch-Lite.AppImage` 并启动。再次运行即用最新版本覆盖旧版本。

手动安装时，从 [最新版本的 release 页面](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest)
下载 `ThinkWatch-Lite-<版本>-x86_64.AppImage` 或 `ThinkWatch-Lite-<版本>-aarch64.AppImage`，
用 `sha256sum -c` 核对后允许其执行（`chmod +x`，或在文件管理器的「属性」中勾选
「允许作为程序执行文件」），然后打开。AppImage 应放在当前用户可写的目录中（如
`~/Applications`），以便自动更新替换。首次启动时会把 ThinkWatch Lite 添加到应用
菜单，同时注册图标和 `thinkwatch://` 链接。Linux 版只发布 AppImage，不提供 deb、
rpm、Flatpak 或 Snap 包。

AppImage 通过 FUSE 挂载自身，需要 fuse3 软件包中的 `fusermount3`（不需要
libfuse2）。多数桌面系统已自带；如缺少：

| 发行版 | 命令 |
|---|---|
| Ubuntu、Debian | `sudo apt install fuse3` |
| Fedora | `sudo dnf install fuse3` |
| Arch Linux | `sudo pacman -S fuse3` |
| openSUSE | `sudo zypper install fuse3` |

托盘图标依赖 AppIndicator。Ubuntu 已自带对应的 GNOME 扩展；Fedora 原生 GNOME
没有，需要另行安装 AppIndicator 扩展。没有托盘时，关闭窗口后网关继续运行，从应用
菜单再次启动 ThinkWatch Lite 即可重新打开窗口。数据保存在 `~/.thinkwatch`。

- **NVIDIA 显卡在 Wayland 下窗口空白**：以 `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  启动应用。
- **局域网内其他机器无法连接网关**：Fedora 默认启用的 firewalld 会拦截网关端口，
  需放行该端口；网关监听局域网时，设置页会给出相应提示。
- **卸载**：先在「设置 › 完全卸载」中卸载，恢复应用接管过的客户端配置，并删除开机
  启动项和应用菜单项；再删除 AppImage 文件。

## 功能

### 用量与费用

按任意时间范围统计 token、费用与请求数，按模型分层，并给出缓存命中率、缓存
带来的净节省和各模型的延迟分位。实测费用、估算费用与无法计价的请求分别列出，
从不相加；ChatGPT 这类订阅账号同样按价目表计价，本地模型等可设为不计费；每个
请求都注明计价所用的价目表及其数据日期。

### 路由与故障转移

路由规则按模型、密钥、token 数、工具、图片等条件把请求交给某个上游或策略组。
每个请求都记录命中的规则、经过的策略组，以及每一次尝试的状态与耗时。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/requests-dark.png">
  <img src="docs/screenshots/requests-light.png" alt="流量页与请求详情：主上游返回 529 后，请求自动转移到 openrouter，并完成 Anthropic Messages 到 OpenAI Chat Completions 的格式转换">
</picture>

试算按给定的请求条件逐条匹配规则，说明请求会交给哪个上游、为什么，不发出请求，
也不产生费用。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dry-run-dark.png">
  <img src="docs/screenshots/dry-run-light.png" alt="路由试算：前两条规则未命中及其原因，第三条规则命中，请求转发至策略组并按顺序尝试两个上游">
</picture>

### 上游

支持 API 密钥、在应用内登录的 ChatGPT 账号（显示订阅额度与重置时间）、
OpenRouter 等中转服务，以及本机模型。客户端与上游的 API 格式不同时，请求在
Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 与 Gemini 之间
自动转换，无法转换的字段会逐一列出。上游可以经出站代理访问，也可以按自定义
价目表计价。

API 密钥和请求头的值可以写成 `${变量名}`，读取系统环境变量。macOS 上读的是登录
shell 里的环境变量，`~/.zshrc` 等文件中 `export` 的变量都会生效，Linux 同理（`~/.bashrc`、
`~/.profile` 等）；Windows 上读
的是系统设置里配置的环境变量。修改变量后，重新打开应用即可生效。代理相关的
变量（`HTTPS_PROXY` 等）和 `PATH` 不会被读取。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/upstreams-dark.png">
  <img src="docs/screenshots/upstreams-light.png" alt="上游列表：API 密钥上游、ChatGPT 账号（Plus，5 小时额度已用 34%）、经代理访问的 OpenRouter、DeepSeek、Gemini 与本机 Ollama，以及各自 24 小时的请求数、费用与首字节延迟">
</picture>

### 安全

- **出站脱敏**：请求发出之前，替换其中的密钥、私钥与连接串，并在响应中还原。
- **工具调用审查**：上游返回的工具调用中出现可直接获得执行权限的命令时，在流中
  切断。
- **隐藏字符**：用户消息或工具结果中含有 Unicode 标签字符、双向控制符时，拒绝
  发出请求。
- **内容过滤**：用户消息或工具结果命中关键词或正则规则时，拒绝发出请求。出厂只启用
  三条明确要求「忽略先前指令」的规则。
- **输出长度**：回答超过设定的字符数时，流式回答在超出处切断，非流式回答整份不返回。

各项防护对所有上游生效，各有「关闭 / 观察 / 拦截」三档；输出长度出厂为「关闭」，
其余出厂为「观察」。安全页列出全部规则：内置规则可以逐条停用，也可以添加自定义
规则（内容过滤可用关键词或正则表达式，其余为正则表达式），任何规则都可以先拿一段
文本试过。各项防护命中的内容都记入日志。

### MCP

MCP 页并排列出各客户端配置的 MCP server，可以把一个 server 复制到其他客户端，或
从某个客户端移除，写入前先显示改动。同一页列出 skill 与 hook，并扫描客户端配置
文件中的隐藏字符、注入内容与危险命令。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/findings-dark.png">
  <img src="docs/screenshots/findings-light.png" alt="发现页：hook 中下载并执行远程脚本的命令、skill 中隐藏的零宽字符、某上游命中高危规则的比例上升，以及各客户端的 MCP server 配置">
</picture>

### 客户端接管

Claude Code、Codex、opencode、Zed 与 Aider 可以在应用内一键指向网关。写入
前先显示改动差异并完整备份原文件，只修改端点与密钥两个字段，随时可以还原。
Cursor、Continue 与 Gemini CLI 提供逐步的手动配置说明。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/clients-dark.png">
  <img src="docs/screenshots/clients-light.png" alt="客户端页：已接管并收到请求的 Claude Code 与 Codex、尚未接管的 opencode，以及需手动配置的客户端">
</picture>

### 菜单栏与系统通知

菜单栏常驻显示今日 token 与今日费用，额度紧张时数字变橙、用完变红；设置里可以改为
仅标识或仅数值。点开是原生菜单：网关状态、未读的提醒、各订阅账号的额度与重置时间、
今日用量、进行中的请求，以及切换手动选择的上游、复制网关地址和默认密钥、撤销上一次
配置修改、检查更新等常用操作，不必先打开主界面。
网关停止转发、订阅额度用完、凭据失效等情况会发送系统通知；上游无法连接多半有回退
接住，只记录在应用内。提醒可以整体设为系统通知、仅在应用内显示或关闭。标为已读的
提醒不再计入铃铛上的数字，但在问题解决或清空列表之前仍留在列表中。

Windows 上图标位于通知区域：悬停显示网关状态与今日 token、费用；左键打开主界面，
右键打开同一份菜单，其中的额度条改为文字。提醒以 Windows 原生通知发送。

Linux 上图标位于系统托盘：点击打开同一份菜单，第一项为「打开主界面」，
额度条同样改为文字。提醒通过桌面环境的通知服务发送。

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/menubar-cost-dark.png">
    <img src="docs/screenshots/menubar-cost-light.png" alt="菜单栏：今日费用 $24.72，输出速率 47 token/秒" width="210">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/menubar-quota-dark.png">
    <img src="docs/screenshots/menubar-quota-light.png" alt="菜单栏：订阅额度已用 34%，2 小时后重置" width="210">
  </picture>
</p>

## 更新

应用启动后不久检查一次新版本，此后每天检查一次，只读取一份很小的版本清单。
可以在「设置」中关闭。

有新版本时会弹出一个小窗口，之后的处理方式取决于安装方式。

**在 macOS 上从 release 页面下载安装的**：点击一次安装按钮，其余步骤自动完成——
下载更新包，用编译进应用的公钥验签，等待网关正在处理的请求结束（最多三分钟），
然后替换并重新启动。正在输出的 Claude Code 任务不会因更新而中断。

**Windows 上**：同样点击一次即可。应用下载新版本的安装程序，用编译进应用的公钥
验签，同样等待进行中的请求结束，然后运行安装程序，安装完成后新版本自动启动。应用
为所有用户安装，因此每次更新 Windows 都会请求管理员权限；拒绝则继续运行当前版本。

**Linux 上**：同样点击一次即可，不需要输入密码。应用下载新版本的 AppImage，用
编译进应用的公钥验签，等待进行中的请求结束，然后替换自身文件并重新启动。AppImage
须位于当前用户可写的目录中。

**用 Homebrew 安装的**：窗口给出更新命令和复制按钮，应用不会替换自身。Homebrew
记录着它放入 `/Applications` 的版本，应用自行替换后，下一次 `brew upgrade` 会
把旧版本写回。这个窗口只在 tap 已包含新版本时才会出现，因此给出的命令一定有
可安装的内容：

```bash
brew update && brew upgrade --cask thinkwatch-lite
```

命令先执行 `brew update`，是因为 `brew upgrade` 自身最多每天刷新一次 tap。

## 从源码运行

```bash
pnpm install
pnpm tauri dev
```

提交代码前的检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 目录

```
src/              React 19 + Tailwind 4 前端
src-tauri/        Tauri 2 外壳：托管 core、渲染菜单栏
```

网关本体位于 ThinkWatch Core；本仓库不包含路由、转发或计费逻辑。与 core 的
通信在 macOS 和 Linux 上走 unix socket，在 Windows 上走回环端口，两者都带一个每次启动
生成的凭据。

## 许可证

MIT，见 [LICENSE](LICENSE)。
