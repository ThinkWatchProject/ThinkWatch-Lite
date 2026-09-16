<p align="center">
  <img src="https://img.shields.io/badge/Tauri_2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/License-MIT-750014?style=for-the-badge" />
  <img src="https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white" />
</p>

# ThinkWatch Lite

**[English](README.md) | [中文](README.zh-CN.md)**

**本地 AI API 网关的桌面端。** 一个菜单栏应用，托管
[ThinkWatch Core](https://github.com/ThinkWatchProject/ThinkWatch-Core)，
把它的配置、流量和花费摆到你眼前。

**先做 macOS，Apple Silicon。** 其他系统等 macOS 版做完再适配。

## 安装

```bash
brew install --cask thinkwatchproject/tap/thinkwatch-lite
```

网关在包里，没有第二样东西要装。

也可以从
[release 页面](https://github.com/ThinkWatchProject/ThinkWatch-Lite/releases)
下载 `ThinkWatch-Lite-<版本>-arm64.dmg`，核对旁边那份 sha256，打开它，把
ThinkWatch Lite 拖进「应用程序」。这样会多一步：这个包**没有经过 Apple 注册
开发者签名**，macOS 会把它标记为隔离并拒绝打开，要去掉这个属性。

```bash
xattr -dr com.apple.quarantine "/Applications/ThinkWatch Lite.app"
```

不用终端的话：第一次打开被拒绝之后，在「系统设置 › 隐私与安全性」里点
「仍要打开」。

除了从磁盘映像里把应用拷出来，[cask](https://github.com/ThinkWatchProject/homebrew-tap)
做的也就是去掉这个属性。

### 更新

默认不开。在「设置」里打开之后，每六小时检查一次，只读取一份版本清单，不
下载其他任何内容。真去下载的那个包，在替换任何东西之前会先用编译进应用里
的那把公钥验签。

Homebrew 装的实例不自己替换：Homebrew 记着它放进 `/Applications` 的是哪一
版，应用把它盖掉之后，下一次 `brew upgrade` 会把旧的那版写回来。这种情况下
应用只提示有新版本，升级交给 `brew upgrade --cask thinkwatch-lite`。

也可以从源码跑：

```bash
pnpm install
pnpm tauri dev
```

## 它解决什么

把 Claude Code、Codex，或者任何说 Anthropic / OpenAI API 的东西指向一个
本地端口，这就是看接下来发生了什么的那个窗口：

- **一次会话花了多少，以及那个数字有多可信。** 实测、估算、算不出价钱是
  三个分开的数字，绝不相加。价目表的快照日期就标在合计旁边 —— 一个两个月
  前的价目表算出来的数，和昨天的不是一回事。
- **每个请求去了哪儿、为什么。** 命中的规则按名字说，经过的策略组，以及
  完整的故障转移链，每一跳带着原因和耗时。
- **跟着它出去的还有什么。** 被抓到正发往不受信任上游的密钥、做过的脱敏、
  看起来危险的工具调用 —— 请求体和响应体在上屏之前就已经打过码。
- **配置有两种改法。** 改一个值用表单，结构性的改动用 CodeMirror 编辑器。
  两条路走同一个 span 补丁层，所以改一个字段就只有那一行变，你的注释一字
  不动。
- **菜单栏那 50 像素。** 今日花费，或者订阅账号的剩余额度 —— 渲染成图片，
  因为菜单栏放不下两行文字。

## 目录

```
src/              React 19 + Tailwind 4 前端
src-tauri/        Tauri 2 外壳：托管 core、渲染菜单栏
```

网关本体在 ThinkWatch Core 里；这个仓库不含任何路由、转发或计费逻辑，
它通过一个 unix socket 和 core 说话。

## 许可

MIT，见 [LICENSE](LICENSE)。
