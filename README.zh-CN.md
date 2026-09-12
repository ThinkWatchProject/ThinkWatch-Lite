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

**只做 macOS，不分发构建产物。** 没有签名的 `.app`，没有安装包，没有
release 页面 —— 从源码跑。这是一个明确的范围决定，不是一个待填的坑。

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
DESIGN.md         设计与规格的记录 —— 每个决定，以及为什么
```

网关本体在 ThinkWatch Core 里；这个仓库不含任何路由、转发或计费逻辑，
它通过一个 unix socket 和 core 说话。

## DESIGN.md

`DESIGN.md` 是规格，也是设计记录 —— 不是生成的文档，也不是 changelog。
它记着每个决定背后的推理，包括那些后来被推翻的，以及第一次的答案为什么
是错的。要改这里的行为，它是第一个该读、也是该回写的文件。

## 许可

MIT，见 [LICENSE](LICENSE)。
