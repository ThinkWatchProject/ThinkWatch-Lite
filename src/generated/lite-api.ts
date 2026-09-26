// Generated from src-tauri/src/wire.rs (`tests/ts_bindings.rs`). Do not edit by hand.

import type { CostBucketGroup, CostGroup, Msg } from "./tw-api";

export type AdoptResponse = { real: string, backup: string, created: boolean, 
/**
 * 不至于失败、但用户该知道的事（符号链接、权限太松……）
 */
warnings: Array<Msg>, 
/**
 * 改动什么时候生效
 */
takes_effect: TakesEffect, };

/**
 * 一个客户端的配置位置：「更改路径…」那个对话框。
 *
 * **三处跟着同一个目录一起换**（`tw_adopt::locations`）：改一处，其余几处按这个
 * 客户端的布局换到同一个目录下，改之前一起列出来（[`LocationChange`]）。
 */
export type ClientLocations = { client: string, name: string, 
/**
 * 接管着：先还原才能换 —— 接管的文件会跟着换，而接管记录在原来那个文件旁边
 */
adopted: boolean, rows: Array<LocationView>, };

export type ClientsResponse = { clients: Array<DetectedClient>, manual: Array<ManualClient>, 
/**
 * 客户端该连的地址
 */
gateway_base: string, 
/**
 * config.yaml 里有哪几把网关密钥可选
 */
keys: Array<string>, };

/**
 * 一个客户端此刻的样子。
 */
export type DetectedClient = { id: string, name: string, 
/**
 * 用户认得的那个路径
 */
path: string, 
/**
 * 跟完符号链接的真身。**和 `path` 不同时要显示出来** —— 用户以为
 * 在改 ~/.claude/settings.json，实际写的可能是他 dotfiles 仓库里
 * 的那份，而那是个会被 git 提交的地方
 */
real: string, installed: boolean, has_config: boolean, adopted_at_ms: number | null, 
/**
 * 配置里此刻的端点。**读出来的**，不是拿我们自己的记录充数
 */
endpoint: string | null, shadows: Array<string>, takes_effect: TakesEffect, 
/**
 * 接管之后要不要在「一直没收到请求」时提示。
 *
 * **需要重开终端的客户端不提示** —— 用户可能一整天都没重开过，那时
 * 弹「是不是没生效」是狼来了
 */
warns_when_silent: boolean, 
/**
 * `measured`（在本机实际运行验证过）| `fields_only`（字段名查证过，
 * 没有在本机实际运行验证）
 */
verified: Verification, 
/**
 * 接管之后会失去或改变的功能
 */
costs: Array<Msg>, 
/**
 * 配置里写着的模型清单和网关此刻对它那把密钥答的不一样了（上游或路由变了）。
 * 只有把模型写进配置的客户端（opencode）会是 `true`；点一下走一遍接管的
 * 「差异 → 确认 → 写入」重写它，**不在后台悄悄改**
 */
models_stale: boolean, 
/**
 * 配置位置能换（行菜单里给「更改路径…」，见 [`ClientLocations`]）。Claude Desktop、
 * DeepSeek Harness 和 WSL 里的不能
 */
movable: boolean, 
/**
 * 为它生成的那把网关密钥（取消接管之后仍然记着）。还没有就不给
 */
key?: string | null, 
/**
 * 最后一次收到**那把密钥**的请求。**接管有没有真的生效，只有它能证明。**
 *
 * 按密钥算，不按请求头里自报的客户端标识 —— 后者可以伪造，而「接好了没有」
 * 要的正是一个不能伪造的答案。没有密钥就没有这个值
 */
last_seen_ms?: number | null, 
/**
 * 手动配置的方法：没检测到它（配置文件不在默认位置）时照着做
 */
manual: ManualSetup, 
/**
 * 这台电脑上它由组织统一管理，接管不了：给出的这句话说明原因。**这时不给
 * 接管按钮**。只有 Claude Desktop 会有
 */
managed?: Msg | null, };

/**
 * 配置文件里的一处改动。
 */
export type FieldChange = { 
/**
 * `set` | `remove`
 */
op: FieldOp, 
/**
 * 字段路径，按层级用 `.` 连起来：`env.ANTHROPIC_BASE_URL`
 */
path: string, 
/**
 * 要写入的值。写的是网关密钥时不给
 */
value?: string | null, 
/**
 * 这一项是网关密钥。**值不回显**，哪怕是打码的；界面写成「密钥 xxx」
 */
secret?: boolean, };

/**
 * 对一个字段做什么。
 */
export type FieldOp = "set" | "remove";

/**
 * 一次改动里的另一份文件：改哪个、改哪几项、完整的前后原文。**密钥已打码。**
 */
export type FilePlanView = { path: string, 
/**
 * 改之前的原文。没有 = 这个文件本来不存在，会新建（还原时：会删掉）
 */
before: string | null, after: string, fields: Array<FieldChange>, 
/**
 * 这一份已经是这样了
 */
noop: boolean, 
/**
 * 还原时这个文件会被整个删掉（当初就是接管时建的，还原后又空了）
 */
deletes?: boolean, };

/**
 * 一条诊断发现的结论。
 */
export type FindingLevel = "blocking" | "suspect" | "clear";

/**
 * 一条诊断发现。
 */
export type FindingView = { level: FindingLevel, title: Msg, detail: Msg, 
/**
 * 用户可以自己执行的下一步。**我们不替他执行。**
 */
fix: Msg | null, };

export type HookView = { client: string, event: string, command: string, source: string, };

/**
 * 换完之后的结果：core 换好的那把，加上**这台机器上**跟着改好、或者没能改好的客户端。
 */
export type KeyRotation = { 
/**
 * 配置的新版本
 */
version: string, 
/**
 * 新的密钥值。**只在这里给一次**，之后列表里只有脱敏的
 */
key: string, 
/**
 * 跟着改好的客户端。空的就是没有客户端在用它
 */
synced: Array<KeySynced>, 
/**
 * 同步不上的客户端。**密钥已经换了**，这些要用户自己去改
 */
failed: Array<KeySyncFailed>, };

export type KeySyncFailed = { 
/**
 * 客户端 id。改为指向服务器时整个 WSL 发行版读不到，是空的：那时 `name` 是
 * 那个发行版（`WSL · Ubuntu`），`error` 说为什么读不到
 */
client: string, 
/**
 * 界面上显示的名字，WSL 里的带着发行版（`Claude Code (WSL · Ubuntu)`）
 */
name: string, error: Msg, };

export type KeySynced = { 
/**
 * 客户端 id（`claude-code` …）
 */
client: string, 
/**
 * 界面上显示的名字
 */
name: string, takes_effect: TakesEffect, 
/**
 * 改之前的全文备份在哪
 */
backup: string, };

/**
 * 每把密钥一段时间里的用量（`key_usage`）：合计，和同一个时间窗按格子分的走势。
 *
 * **两样一起给。**密钥页、客户端页上它们是同一格（次数、费用和一条小柱图），
 * 分两次取的话那一格会在几十毫秒里跳两次。
 */
export type KeyUsage = { 
/**
 * 时间窗的起点，**原样回传**：界面补空格从它数起，和取数时算的是同一个
 */
since_ms: number, 
/**
 * 一格多宽
 */
bucket_ms: number, 
/**
 * 每把密钥的合计，`name` 是密钥名
 */
totals: Array<CostGroup>, 
/**
 * 按格子分。**稀疏的**：没有请求的格子不在里面，由界面补
 */
buckets: Array<CostBucketGroup>, };

/**
 * 这台机器上发生的、界面要跟上的事（Tauri 事件 `local-event`）。
 *
 * **和 core 的事件流是两条路**：core 的说网关里的事，这条说这台机器上客户端的
 * 配置文件。连着哪个 core 都一样，这些文件总在这台机器上。
 */
export type LocalEvent = { "kind": "clients_changed", at_ms: number, } | { "kind": "scan_alert", alerts: Array<ScanFinding>, at_ms: number, };

/**
 * 改之前要说的一处：从哪儿换到哪儿。
 */
export type LocationChange = { roles: Array<LocationRole>, dir: boolean, from: string, to: string, };

/**
 * 改的是哪一项、改成什么。`~/…` 按 home 展开
 */
export type LocationEdit = { role: LocationRole, path: string, };

/**
 * 客户端配置位置里的一项。
 */
export type LocationRole = "config" | "mcp" | "scan";

/**
 * 一处配置位置，和接管、MCP 管理、安全扫描里用到它的那几项。
 */
export type LocationView = { 
/**
 * 用到它的几项，按 接管 → MCP 管理 → 安全扫描 排。同一个文件的几项在同一行
 * （Codex 的 `config.toml` 既是接管的也是 MCP 的）
 */
roles: Array<LocationRole>, 
/**
 * 文件夹（安全扫描看的那一处）还是文件
 */
dir: boolean, path: string, default: string, };

/**
 * 接管不了、只能给指引的。
 */
export type ManualClient = { 
/**
 * `cursor` / `continue` / `antigravity-cli`。为它生成专用密钥时用
 */
id: string, name: string, 
/**
 * 为它生成的那把网关密钥。还没有就不给
 */
key?: string | null, 
/**
 * 最后一次收到那把密钥的请求
 */
last_seen_ms?: number | null, setup: ManualSetup, 
/**
 * 配完还漏什么（Cursor 的补全不经过网关之类）
 */
caveat: Msg, 
/**
 * MCP 管理、安全扫描的位置能换（Cursor、Antigravity CLI），见 [`ClientLocations`]
 */
movable: boolean, };

/**
 * 手动配置一个客户端的方法。
 *
 * **地址和密钥不写进句子里**：界面各给一个复制按钮。写进句子的话，用户
 * 得从一句话里抠出一段 URL，而密钥根本不该出现在一句说明里。
 */
export type ManualSetup = { 
/**
 * 按顺序做的几步
 */
steps: Array<Msg>, 
/**
 * 要写进配置文件的字段，就是接管时写的那几项。只有能接管的客户端有；
 * 密钥那一项不给值（`secret` 为真），界面换成密钥的复制按钮
 */
fields: Array<FieldChange>, 
/**
 * 要填的网关地址，这个客户端要的写法（有的带 `/v1`）
 */
endpoint: string, };

/**
 * MCP 矩阵上的一下。
 */
export type McpOp = "copy" | "remove";

/**
 * 在矩阵上点一下。
 */
export type McpOpRequest = { 
/**
 * `copy` 或 `remove`
 */
op: McpOp, name: string, 
/**
 * `copy` 时从哪个客户端取
 */
from: string | null, 
/**
 * 写到（或从中删掉）哪个客户端
 */
to: string, };

/**
 * 哪些客户端能被写入，哪些只能看。
 */
export type McpTargetView = { client: string, name: string, path: string, 
/**
 * 能不能往里写。**不能写的照样在清单里** —— 看得见是第一目标
 */
copyable: boolean, 
/**
 * 不能写的话，为什么。能写的时候没有
 */
why_not?: Msg | null, 
/**
 * 配置位置能换（MCP 页的右键菜单里给「更改路径…」），见 [`ClientLocations`]
 */
movable: boolean, };

export type McpView = { name: string, client: string, command: string, args: Array<string>, 
/**
 * 远端型的地址
 */
url: string | null, 
/**
 * **只有名字，没有值**
 */
env_keys: Array<string>, enabled: boolean, source: string, 
/**
 * 远端而且不在本机
 */
third_party: boolean, };

/**
 * 算好但还没落盘的改动。**UI 拿它画 diff 让用户确认。**
 */
export type PlanView = { client: string, path: string, 
/**
 * 改之前的原文，**密钥已打码**。
 */
before: string | null, 
/**
 * 改之后的原文，**密钥已打码 —— 落盘写的是真值**。
 *
 * 界面上永远不显示真正的密钥，diff 里也不行：用户会截图这一屏来问
 * 「这样对吗」。
 */
after: string, notes: Array<Msg>, shadows: Array<string>, 
/**
 * 已经是这样了，什么都不用改
 */
noop: boolean, carries_secret: boolean, 
/**
 * 这次会改哪些字段。diff 之外再给一份摘要
 */
fields: Array<FieldChange>, 
/**
 * 写进去的是哪把网关密钥（还原时是留下来的那把）。MCP 的改动没有
 */
key?: string | null, 
/**
 * 那把密钥要在接管的那一刻新建（此前没有为这个客户端留着的）
 */
key_created?: boolean, 
/**
 * 同一次改动还要写的另外几份文件，和上面那一份一起落盘、一起失败，按落盘的
 * 顺序。DeepSeek Harness 的密钥在它自己的凭据文件里；Claude Desktop 一次改
 * 四个，`path` 那一个是它配置库里的那一份，其余三个在这里
 */
also?: Array<FilePlanView>, };

/**
 * 把接管着的客户端改为指向另一个 core 之后：改好的、没改成的
 */
export type Retargeted = { synced: Array<KeySynced>, failed: Array<KeySyncFailed>, };

/**
 * 一处发现。
 */
export type ScanFinding = { level: ScanLevel, 
/**
 * 哪条规则命中的
 */
rule: string, 
/**
 * `hooks` | `mcp` | `skill` | `command` | `agent` | `instructions`
 */
kind: ScanSource, client: string, path: string, 
/**
 * 第几行，从 1 开始
 */
line: number, title: Msg, detail: Msg, 
/**
 * 命中的那一行，**不可见字符已经换成可见记号**
 */
excerpt: string, };

/**
 * 一处扫描发现有多要紧。
 */
export type ScanLevel = "high" | "medium" | "low";

/**
 * 扫一次的结果：用户级的配置面，此刻磁盘上的样子。
 *
 * **不存任何东西**：页面关了就没了。**只扫用户级的**：界面递不进一个目录来 ——
 * 那等于给 webview 开一个「读这台机器上任意目录」的口子。
 */
export type ScanReport = { findings: Array<ScanFinding>, mcp: Array<McpView>, skills: Array<SkillView>, hooks: Array<HookView>, 
/**
 * 同名但配置不同的 MCP server 名字（矩阵上要标记号）
 */
conflicting: Array<string>, 
/**
 * 读不动的文件。**要显示** —— 悄悄跳过会给人「查过了」的错觉
 */
unreadable: Array<string>, scanned: number, };

/**
 * 扫描发现出在客户端配置面的哪一类东西里。
 */
export type ScanSource = "hooks" | "mcp" | "skill" | "command" | "agent" | "instructions";

export type SkillView = { name: string, client: string, path: string, allowed_tools: Array<string>, };

/**
 * 改了客户端的配置之后，什么时候生效。
 */
export type TakesEffect = "immediately" | "on_restart";

/**
 * 完全卸载的一步（`uninstall` 交回的是一串）：做成了没有，和给用户看的那句话。
 *
 * **成败要单独给，不能让界面从句子里猜。**对话框的标题要说「卸载完成」还是
 * 「有几项没做成」，没做成的那几行要标出来；句子是按语言拼的，拿来判断成败
 * 换一种语言就失效。说明性的几句（数据目录已保留、现在可以删应用了）算成。
 */
export type UninstallStep = { ok: boolean, text: string, };

/**
 * 一个客户端的接管方式验证到什么程度。
 */
export type Verification = "measured" | "fields_only";

/**
 * 卸载时不改回的 `.wslconfig`：它此刻是 mirrored，是在这里改的。
 */
export type WslConfigKept = { 
/**
 * `C:\Users\u\.wslconfig`
 */
path: string, 
/**
 * 改之前的全文备份。**这个文件是这里新建的**（改之前没有）时不给
 */
backup?: string | null, };

/**
 * 把 WSL 2 改成 mirrored 网络的那一份改动（`%USERPROFILE%\.wslconfig`）。
 * **UI 拿它画差异让用户确认**，确认之后才写。
 */
export type WslConfigPlan = { 
/**
 * `C:\Users\u\.wslconfig`
 */
path: string, 
/**
 * 改之前的原文。没有这个文件（要新建）时不给
 */
before?: string | null, after: string, 
/**
 * 改的是哪一项：`wsl2.networkingMode`（写在旧位置的是 `experimental.networkingMode`）
 */
field: string, 
/**
 * 已经是 mirrored 了，什么都不用改
 */
noop: boolean, };

/**
 * 客户端页上「WSL · <发行版>」那一组。
 */
export type WslGroup = { 
/**
 * 发行版的名字（`Ubuntu`）。对这一组的命令都带着它
 */
distro: string, network: WslNetwork, 
/**
 * 此刻能不能接管：WSL 1、mirrored 能，连着远程 core 时都能。**不能的时候不给
 * 接管和手动配置**，接管过的照样能还原
 */
adoptable: boolean, 
/**
 * 读不到这个发行版时的原因。**这时 `clients` 是空的**，界面写「无法读取」
 */
error?: Msg | null, 
/**
 * 这个发行版里的客户端（第一批：Claude Code、Codex）
 */
clients: Array<DetectedClient>, 
/**
 * 这个发行版里的客户端该连的地址：和这台电脑上的一样
 */
gateway_base: string, };

/**
 * WSL 里的一个发行版用哪种网络；本机时，不能接管的那几种说明卡在哪一步。
 *
 * WSL 里的客户端写的地址和这台电脑上的一样（本机时是 `127.0.0.1`），够得着它的
 * 只有 WSL 1 和 mirrored。其余几种界面上说明原因，能动手的给按钮（改为 mirrored、
 * 重启 WSL）。
 */
export type WslNetwork = { "kind": "wsl1" } | { "kind": "mirrored" } | { "kind": "nat", wsl_version: string | null, } | { "kind": "restart" } | { "kind": "fallback" } | { "kind": "old_windows" } | { "kind": "old_wsl", wsl_version: string, };

/**
 * 客户端页的 WSL 部分。**和 `ClientsResponse` 分开取**：读 WSL 会把发行版唤醒，
 * 所以只在打开这一页、动过它之后取，不跟着每个请求刷新。
 */
export type WslResponse = { 
/**
 * 注册表里登记着的发行版，按注册表里的顺序。不在 Windows 上时是空的
 */
distros: Array<WslGroup>, };

