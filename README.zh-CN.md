<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logo-dark.png">
    <img src="docs/brand/logo.png" alt="ThinkWatch Lite" width="560">
  </picture>
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-750014?style=for-the-badge" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
  <img alt="Windows" src="https://img.shields.io/badge/Windows-0078D4?style=for-the-badge" />
  <img alt="Linux" src="https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black" />
  <a href="https://linux.do"><img alt="LINUX DO" src="https://img.shields.io/badge/LINUX_DO-Community-1A1A1A?style=for-the-badge" /></a>
</p>

# ThinkWatch Lite

**[English](README.md) | [中文](README.zh-CN.md)**

Claude Code、Codex 等 AI 客户端的本地网关，支持 macOS、Windows 与 Linux。客户端只需接入一次，此后更换上游或模型无需改动客户端配置。每个请求的费用与去向都有记录；发出前可替换其中的 API 密钥，中转站在回答中塞入的危险工具调用也可以在客户端执行前拦下。

**赞助商**：[想出现在这里吗？](mailto:fylorn@outlook.com?subject=ThinkWatch%20Lite%20Sponsorship)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/zh/overview-dark.png">
  <img src="docs/screenshots/zh/overview-light.png" alt="最近 7 天的概览：token、费用与请求数及其与前 7 天的对比，注明费用中的估算部分和无法计价的请求；按模型分层的趋势图，标出有失败的时段；以及按 token 与费用排列的模型">
</picture>

## 要点

- **一次接入，随时切换。** Claude Code、Claude Desktop、Codex、opencode、Pi、oh-my-pi、Grok Build、Qwen Code、Hermes Agent、Zed、Aider 与 DeepSeek Harness 可一键指向网关，写入前预览改动、备份原文件，随时可以还原；Cursor、Continue 与 Antigravity CLI 提供配置说明。此后切换上游只在网关中完成。
- **防范中转站。** 中转站能看到请求的全部内容，也能改写每一次回答。出站脱敏在请求发出前把 API 密钥、私钥、JWT、连接串口令、身份证号与银行卡号换成占位符，中转站拿不到原值。回答中若出现下载即执行、外发环境变量或凭据文件、读取私钥、写入开机启动项或定时任务之类的工具调用，工具调用审查会在客户端执行之前切断回答。内容过滤在请求发出前删除藏在不可见字符里的指令，也可以直接拒绝提示注入。各项防护出厂只记录，逐项切换后生效。
- **上游互相对照。** 每个上游都与服务同一模型的其他上游对照：回答中的模型名与发出的不同、报告的输入明显偏多或偏少、提示缓存读取偏低，都会在上游列表的那一行标出，悬停可见证据与样本数。
- **扫描 MCP、技能与钩子。** 十三款客户端的 MCP 服务器并列显示并标出第三方服务器；客户端配置、技能、钩子与项目指令中的隐藏字符、提示注入、危险命令与过宽权限会被找出。
- **每个请求都可追溯。** 命中的规则、尝试过的每个上游、API 格式转换与费用的计算依据都在请求详情中；已结束的请求可以重放到另一个上游，并排对比。全部请求记录都可以搜索，包括请求与回答的内容。
- **按规则分流，失败自动换。** 按模型、工具、图片、扩展思考等条件分流。回答开始前上游出错时换用下一个，同一会话固定使用同一上游，提示缓存保持有效。标题生成等辅助请求可在本地应答。
- **多种上游，接口互转。** API 密钥、Amazon Bedrock、ChatGPT 与 Z.ai 账号、OpenRouter 等中转服务与本机模型均可作为上游，Anthropic、OpenAI、Gemini 接口之间自动转换。
- **费用如实计算。** 估算的金额单独标注，无法计价的请求单独计数，不按零计入。
- **连接远程 core。** 网关也可以部署在 Linux 服务器上，应用经加密的控制通道连接。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/zh/security-dark.png">
  <img src="docs/screenshots/zh/security-light.png" alt="安全日志：请求发出前替换的凭据（其中一条由自定义规则命中）、被切断的下载即执行工具调用，以及记录在案的隐藏字符、删除命令与注入指令，每条都注明所属请求的密钥、客户端、模型与上游">
</picture>

## 安装

| 平台 | 安装 |
|---|---|
| macOS 12 及以上，Apple 芯片 | `brew install --cask thinkwatchproject/tap/thinkwatch-lite`，或 [`ThinkWatch-Lite-<版本>-darwin-arm64.dmg`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Windows 10 21H2 及以上，x64 | 安装版 [`ThinkWatch-Lite-<版本>-windows-x64-setup.exe`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest)，或绿色版 [`ThinkWatch-Lite-<版本>-windows-x64-portable.zip`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Windows 10 21H2 及以上，ARM64 | 安装版 [`ThinkWatch-Lite-<版本>-windows-arm64-setup.exe`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest)，或绿色版 [`ThinkWatch-Lite-<版本>-windows-arm64-portable.zip`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |
| Linux，x86_64 或 aarch64 | `curl -fsSL https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest/download/install.sh \| sh`，或 [`ThinkWatch-Lite-<版本>-linux-<架构>.AppImage`](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases/latest) |

网关 [ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core) 随应用一同安装。应用未经 Apple 与 Microsoft 签名，首次打开需要多一步操作，见[安装与更新](https://thinkwat.ch/zh-CN/docs/lite/install)，其中也说明了各种安装方式如何更新。界面提供英文与简体中文，应用自动更新（通过 Homebrew 安装的随 Homebrew 更新）。

### Windows 绿色版

解压后运行其中的 `ThinkWatch Lite.exe` 即可，无需安装，也不需要管理员权限。配置、密钥与请求记录保存在程序旁边的 `data\` 文件夹中，与安装版的数据互不相干，是两套独立的设置。程序所在的文件夹需要可以写入。

安装版与绿色版同一时间只运行一个，打开另一个时可以停止正在运行的那一个、改为启动它。`thinkwatch://` 链接与开机启动始终指向正在运行的那一个。

绿色版不经过系统卸载：先在应用的「设置 › 完全卸载」中完成卸载，还原已接管的客户端、移除开机启动等注册项，再删除整个文件夹。

### 卸载

在应用的「设置 › 完全卸载」中卸载，会还原已接管的客户端、取消开机启动，并可同时删除数据目录。之后在 macOS 上将应用移到废纸篓，在 Linux 上删除 AppImage 文件。

Windows 安装版也可以直接通过系统卸载：卸载程序先关闭 ThinkWatch Lite，完成同样的还原与清理。勾选「同时删除数据（配置、API 密钥、请求记录）」时一并删除 `%APPDATA%\ThinkWatch`；有客户端未能还原时数据目录保留，它的备份仍在其中。卸载程序以管理员身份运行，标准账户输入管理员密码卸载时，还原与删除的是管理员账户的客户端和数据，这种情况应先在应用内卸载。

## 文档

- [功能详解](https://thinkwat.ch/zh-CN/docs/lite/features)：逐页说明
- [安装与更新](https://thinkwat.ch/zh-CN/docs/lite/install)
- [连接远程 core](https://thinkwat.ch/zh-CN/docs/lite/remote-core)与[服务器部署](https://thinkwat.ch/zh-CN/docs/core/server-deployment)
- [导入链接](https://thinkwat.ch/zh-CN/docs/lite/import-links)（面向中转站与服务商）
- [架构](https://thinkwat.ch/zh-CN/docs/lite/architecture)

## 从源码运行

```bash
pnpm install
bash src-tauri/scripts/fetch-core.sh
pnpm tauri dev
```

`fetch-core.sh` 下载 `Cargo.lock` 钉住的 `twcore` 版本并放入 `src-tauri/resources/`。仓库结构与提交 PR 前要跑的检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
