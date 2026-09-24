import type { DetectedClient, ManualClient } from "@/types";

/**
 * 一个客户端此刻在哪一档。
 *
 * - `in_use` 使用中：接管之后收到过**它自己那把密钥**的请求
 * - `waiting` 等待首个请求：接管了，还没收到
 * - `broken` 未生效：地址被改走了、被更高优先级的配置覆盖，或者即时生效的
 *   客户端接管五分钟仍无请求
 * - `idle` 未接管：装了，没指向本网关
 * - `absent` 未检测到：没找到它
 */
export type ClientState = "in_use" | "waiting" | "broken" | "idle" | "absent";

export type Reason =
  /** 配置里的地址已经不是本网关了（用户在编辑器里改回去了） */
  | { kind: "moved"; endpoint: string }
  /** 有一份优先级更高的配置文件在 */
  | { kind: "shadowed"; file: string }
  /** 接管五分钟了，一个请求都没有 */
  | { kind: "silent" }
  /** 还没生效，要重启客户端 */
  | { kind: "restart" }
  /** 连着远程 core，而它还指着这台机器上（已经停了的）网关 */
  | { kind: "local"; endpoint: string };

export interface Status {
  state: ClientState;
  reason?: Reason;
}

/** 接管之后多久没请求算「未生效」。**只对即时生效的客户端** —— 要重开终端的，用户可能一整天都没重开过 */
export const SILENCE_MS = 5 * 60 * 1000;

/**
 * 按 core 给的事实定档。
 *
 * **收到过请求排在最前面。**有一份优先级更高的文件「可能」盖住我们的设置，
 * 而请求已经带着这把密钥来了 —— 证据比怀疑可靠，这时它就是在用。
 */
export function statusOf(
  c: DetectedClient,
  gatewayBase: string,
  now = Date.now(),
  /** 连着远程 core：还指着本机网关的单独说，它们的请求落在一个停了的网关上 */
  remote = false,
): Status {
  if (!c.installed) return { state: "absent" };
  const adoptedAt = c.adopted_at_ms;
  if (adoptedAt == null) return { state: "idle" };
  if (remote && c.endpoint && isLoopback(c.endpoint)) {
    return { state: "broken", reason: { kind: "local", endpoint: c.endpoint } };
  }
  if (c.last_seen_ms != null && c.last_seen_ms > adoptedAt) return { state: "in_use" };
  if (c.endpoint && !pointsHere(c.endpoint, gatewayBase)) {
    return { state: "broken", reason: { kind: "moved", endpoint: c.endpoint } };
  }
  const shadow = c.shadows[0];
  if (shadow) return { state: "broken", reason: { kind: "shadowed", file: shadow } };
  if (c.warns_when_silent && now - adoptedAt > SILENCE_MS) {
    return { state: "broken", reason: { kind: "silent" } };
  }
  return c.takes_effect === "on_restart"
    ? { state: "waiting", reason: { kind: "restart" } }
    : { state: "waiting" };
}

/**
 * 手动配置的客户端没法检测，只能看它那把密钥：有过请求就是在用，建了密钥还没
 * 请求就是在等，连密钥都没有就是还没配。
 */
export function manualStatusOf(m: ManualClient): Status {
  if (m.last_seen_ms != null) return { state: "in_use" };
  if (m.key) return { state: "waiting" };
  return { state: "idle" };
}

/** 这个地址是不是本网关（带不带 `/v1` 都算） */
export function pointsHere(endpoint: string, gatewayBase: string): boolean {
  const base = gatewayBase.replace(/\/+$/, "");
  const e = endpoint.replace(/\/+$/, "");
  return e === base || e.startsWith(`${base}/`);
}

/** 地址只留主机和端口：`https://api.anthropic.com/v1` → `api.anthropic.com` */
export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host || endpoint;
  } catch {
    return endpoint;
  }
}

/** 这个地址指的是不是这台机器：`127.0.0.1`、`localhost`、`[::1]`。和 Rust 侧 `ops::is_loopback` 同一个判断 */
export function isLoopback(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
}
