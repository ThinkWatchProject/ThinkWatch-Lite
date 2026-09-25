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
manual: ManualSetup, };

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

export type KeySyncFailed = { client: string, name: string, error: Msg, };

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
caveat: Msg, };

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
why_not?: Msg | null, };

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
 * 同一次改动还要写的另外几份文件，和上面那一份一起落盘、一起失败。
 * DeepSeek Harness 的密钥在它自己的凭据文件里，就在这儿
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
 * 客户端页上「WSL · <发行版>」那一组。
 */
export type WslGroup = { 
/**
 * 发行版的名字（`Ubuntu`）。对这一组的命令都带着它
 */
distro: string, network: WslNetwork, 
/**
 * 读不到这个发行版时的原因。**这时其余几项都是空的**，界面写「无法读取」
 */
error?: Msg | null, 
/**
 * 这个发行版里的客户端（第一批：Claude Code、Codex）
 */
clients: Array<DetectedClient>, 
/**
 * 这个发行版里的客户端该连的地址。算不出来时是空串，原因在 `base_error`
 */
gateway_base: string, 
/**
 * 地址算不出来的原因（NAT 模式下找不到 WSL 的虚拟网卡）
 */
base_error?: Msg | null, 
/**
 * 接管着、还指着旧地址的客户端 id（NAT 模式下 WSL 重启之后）。点一下「重新
 * 指向」就改到 `gateway_base`
 */
stale: Array<string>, 
/**
 * 防火墙里放行 WSL 的那条规则缺了时，要在管理员 PowerShell 里执行的命令
 */
firewall?: string | null, };

/**
 * WSL 里的一个发行版用哪种网络。决定写进客户端的是哪个地址。
 */
export type WslNetwork = "wsl1" | "nat" | "mirrored";

/**
 * 客户端页的 WSL 部分。**和 `ClientsResponse` 分开取**：读 WSL 会把发行版唤醒，
 * 所以只在打开这一页、动过它之后取，不跟着每个请求刷新。
 */
export type WslResponse = { 
/**
 * 注册表里登记着的发行版，按注册表里的顺序。不在 Windows 上时是空的
 */
distros: Array<WslGroup>, };

