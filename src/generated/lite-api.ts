// Generated from src-tauri/src/wire.rs (`tests/ts_bindings.rs`). Do not edit by hand.

import type { HookView, KeySyncFailed, KeySynced, McpView, ScanFinding, SkillView } from "./tw-api";

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

/**
 * 这台机器上发生的、界面要跟上的事（Tauri 事件 `local-event`）。
 *
 * **和 core 的事件流是两条路**：core 的说网关里的事，这条说这台机器上客户端的
 * 配置文件。连着哪个 core 都一样，这些文件总在这台机器上。
 */
export type LocalEvent = { "kind": "clients_changed", at_ms: number, } | { "kind": "scan_alert", alerts: Array<ScanFinding>, at_ms: number, };

/**
 * 把接管着的客户端改为指向另一个 core 之后：改好的、没改成的
 */
export type Retargeted = { synced: Array<KeySynced>, failed: Array<KeySyncFailed>, };

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

