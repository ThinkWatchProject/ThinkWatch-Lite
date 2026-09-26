# Interface text: conventions and terminology

The interface ships in Simplified Chinese and English. Rust decides which one
is in use (the choice in Settings, otherwise the system's preferred language)
and injects it before the page loads; see `src/i18n/index.ts` and
`src-tauri/src/i18n.rs`.

## Where text lives

- Text shown in the window is never written inside a component. It lives in a
  file next to it: `Foo.tsx` → `Foo.i18n.ts` (`Foo.i18n.tsx` when a value
  needs JSX), exporting `fooText = messages(zh, en)`.
- The English object must have exactly the shape of the Chinese one. A missing
  key, an extra key or a parameter of the wrong type is a compile error.
- Inside a component: `const t = useText(fooText)`, then `t.title`,
  `t.failed(3)`.
- Outside a component (label tables, formatters): `textOf(fooText)` at the
  moment of the call. Never store its result in a module-level constant — it
  would keep the language that was current when the module loaded.
- Words used everywhere (Cancel, Save, Delete, Close…) come from
  `commonText` in `src/i18n/common.i18n.ts`.
- `src/i18n.test.ts` fails when a string or JSX text containing Chinese appears
  anywhere else, and lists the files still waiting to be migrated.
- Rust: `tr!("中文", "English")` keeps both versions side by side.
- Identifiers are not translated: model, upstream, route, key and group names,
  protocol names, file paths, config keys, HTTP status codes.

## Chinese

Written, declarative register. No first person, and the user is not
addressed as 你. Costs are 费用. Details: `src/copy.test.ts` enforces the
known colloquialisms.

## English

- **Sentence case** everywhere in the window: headings, buttons, tabs,
  labels, menu items ("New upstream", "Version history"). The native tray menu
  follows the macOS convention and uses title case.
- **Declarative and neutral.** State facts and results; avoid "we"; prefer an
  impersonal sentence over addressing the user. Actions are imperative verbs
  ("Save", "Delete upstream", "Restore").
- A trailing ellipsis marks a button or menu item that opens a dialog asking
  for more input ("Connect…"), as in the Chinese text.
- No exclamation marks, no colloquial phrasing, no filler ("Please", "simply",
  "just").
- Counts take the plural into account: write a function, `(n: number) =>
  n === 1 ? "1 request" : `${n} requests``.
- Keep the English about as short as the Chinese; tables and badges are sized
  for it.

## Terminology

| 中文 | English | Notes |
|---|---|---|
| 概览 | Overview | sidebar |
| 流量 | Traffic | sidebar; the list of requests |
| 会话 | Sessions / session | |
| 轮次 / 轮 | turns / turn | one request within a session |
| 上下文峰值 | peak context | |
| 缓存节省 | cache savings | |
| 发现 | Findings | sidebar |
| 防护 | Protection | sidebar |
| 上游 | Upstreams / upstream | |
| 代理 | Proxies / proxy | outbound proxy for an upstream |
| 价目表 | Price sheets / price sheet | 默认价目表 = default price sheet |
| 密钥 | Keys / key | a gateway key held by a client; 网关密钥 = gateway key |
| 路由 | Routing (page) / route | 默认路由 = default route |
| 规则 | rule | 兜底 = catch-all rule |
| 策略组 | group | |
| 按顺序 / 手动选择 / 轮询 / 延迟最低 / 费用最低 | In order / Manual / Round robin / Lowest latency / Lowest cost | group kinds |
| 全部上游 | All upstreams | |
| 网关 | Gateway | |
| 客户端 | Clients / client | |
| 接管 / 还原 | Connect / Restore | pointing a client's config at the gateway, and undoing it |
| 已接管 / 未接管 | Connected / Not connected | |
| 设置 | Settings | |
| 试算 | Dry run | |
| 费用 | cost | never "spend" |
| 实测 / 估算 | measured / estimated | |
| 无法计价 | unpriced | no price is known for the model |
| 无用量 | no usage | the upstream reported no token usage |
| 订阅 / 订阅额度 | subscription / subscription quota | |
| 额度 | usage limit / quota | ChatGPT windows: "usage limit" |
| 重置卡 | reset credit | |
| 5 小时 / 每周 / 每月 | 5h / Weekly / Monthly | quota windows; notices write 5-hour / weekly / monthly inside a sentence |
| 积分 | credits | the unit of a GLM Coding Plan billed in credits: 剩余 1,976 / 2,000 积分 = 1,976 / 2,000 credits left; not the ChatGPT reset credits |
| 次 | calls | the monthly window of the older GLM plans counts MCP calls: 剩余 960 / 1,000 次 = 960 / 1,000 calls left |
| 会话日志 | session log | the whole conversation DeepSeek Harness attaches to each request |
| 按量计费 / 不计费 | Per token / Free | billing: the only two modes; subscription accounts are billed per token |
| 首字节 | time to first byte (TTFB) | column headers may use "TTFB" |
| 延迟 / 总耗时 / 生成用时 | latency / total time / generation time | |
| 故障转移 | failover | |
| 尝试链 | attempts | |
| 命中规则 / 经过策略组 | Matched rule / Via group | |
| 格式转换 / 丢弃字段 | format conversion / dropped fields | |
| 出站脱敏 / 脱敏 / 已脱敏 | outbound redaction / redaction / Redacted | |
| 工具调用审查 | tool-call inspection | |
| 可疑工具调用 / 已拦截 | suspicious tool call / Blocked | |
| 配置面扫描 | config scan | scanning client configuration files |
| 关闭 / 观察 / 拦截 | Off / Observe / Enforce | the three modes of every defense |
| 官方端点 / 非官方端点 | Official endpoint / Unofficial endpoint | |
| 熔断中 / 已停用 | Circuit open / Disabled | upstream state |
| 链路测速 / 推理测速 | Connection test / Inference test | |
| 连通性检查 / 预热 / 生成标题 / 话题识别 / 输入建议 | Health check / Warm-up / Title generation / Topic detection / Suggestions | auxiliary requests (probes) |
| 辅助请求 | auxiliary requests | |
| 本地应答 | answered locally | |
| 提醒 | Notices | the bell |
| 系统通知 / 仅在应用内 | System notification / In app only | |
| 配置文件 / 版本历史 | Config file / Version history | |
| 安全模式 | safe mode | |
| 运行中 / 启动中 / 重启中 / 已停止 | Running / Starting / Restarting / Stopped | |
| 开机启动 | Launch at login | |
| 诊断包 | diagnostics bundle | |
| 数据目录 | data directory | |
| 缓存读取 / 新输入 / 缓存写入 | cache reads / uncached input / cache writes | |
| 命中（率） / 净节省 / 读写比 | hit rate / net savings / read/write ratio | |
| 账号 / 登录 / 重新登录 | account / sign in / sign in again | |
| 凭据 | credential | |
| 请求头 | headers | |
