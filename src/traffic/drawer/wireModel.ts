import type { BodyView, HeadView, RequestDetail, WireDir, WireSide } from "@/types";
import type { LiveContent, Segment } from "./live";

/**
 * 「内容」那一页要画的报文，**不管是实时收到的还是存下的，都整理成同一个样子**：
 * 客户端那一边一对（请求、回答），上游那一边每一跳一对。两种来源各说各的：
 *
 * · 存下的（`RequestDetail`）：报文头每段只留最后一遍；发给上游的请求体、上游的回答**只在和
 *   客户端那一边不一样时**另存（转换了格式、插件改写过、有回答钩子），一样的不存；失败了的那几
 *   跳只有报文头。
 * · 实时的（`LiveContent`）：只发要另存的那些正文，所以没收到的发给上游的请求体也是「和客户端
 *   那一边一样」。
 */

/** 一份正文 */
export interface Body {
  /**
   * 按到的先后一段一段（实时的：流的回答一段是一个或几个完整的事件）；存下的只有一段。
   * **实时的这个数组会接着长**（就地加），要整段的字用 `bodyText`
   */
  chunks: readonly string[];
  /** 原本多少字节 */
  bytes: number;
  /** 只有开头 */
  truncated: boolean;
  /** 还在长（实时的、请求还没结束） */
  growing: boolean;
  /**
   * 同一段又发了一遍时变（实时的）：读过的要从头读。存下的总是 0
   */
  epoch: number;
}

/** 一段的正文在不在、为什么不在 */
export type BodyState =
  | { kind: "body"; body: Body }
  /** 和客户端那一边一样，没有另存（发给上游的请求、上游的回答） */
  | { kind: "same" }
  /** 和插件改写之后的那一份一样（插件改过、没转换格式）：那一份请求结束后才看得到 */
  | { kind: "after_plugins" }
  /** 还没到 */
  | { kind: "pending" }
  /** 失败了的那一跳：正文不留 */
  | { kind: "not_kept" }
  /** 存下的记录里没有（过了保留期限、没留下） */
  | { kind: "not_saved" };

export interface Hop {
  head: HeadView | null;
  body: BodyState;
}

export interface Side {
  request: Hop;
  response: Hop;
}

export interface UpstreamHop extends Side {
  /** 第几跳，从 1 数 */
  attempt: number;
  /** 发往哪个上游（尝试链上的） */
  provider: string | null;
  /** 回答（或者正在回答）的那一跳：最后一跳 */
  serving: boolean;
}

export interface WireModel {
  client: Side;
  /** 有报文头的那几跳，从小到大 */
  upstream: UpstreamHop[];
  /** 插件改写过的请求（存下的才有）：「上游一侧」请求那一段能和原样对比 */
  afterPlugins: BodyView | null;
}

const stored = (b: BodyView): BodyState => ({
  kind: "body",
  body: { chunks: b.text === "" ? [] : [b.text], bytes: b.original_len, truncated: b.truncated, growing: false, epoch: 0 },
});

/** 拼好的整段：按数组和段数记着，没长就不再拼 */
const joined = new WeakMap<readonly string[], { n: number; text: string }>();

/** 一份正文的全文 */
export function bodyText(b: Body): string {
  const c = joined.get(b.chunks);
  if (c && c.n === b.chunks.length) return c.text;
  const text = b.chunks.length === 1 ? b.chunks[0]! : b.chunks.join("");
  joined.set(b.chunks, { n: b.chunks.length, text });
  return text;
}

function headOf(heads: readonly HeadView[], side: WireSide, dir: WireDir, attempt: number): HeadView | null {
  // 同一段只留最后一遍；万一有两个，取后一个
  let found: HeadView | null = null;
  for (const h of heads) if (h.side === side && h.dir === dir && h.attempt === attempt) found = h;
  return found;
}

const providerOf = (d: RequestDetail, attempt: number) => d.row.routing?.attempts[attempt - 1]?.provider ?? null;

/** 存下的详情：请求结束之后 */
export function fromDetail(d: RequestDetail): WireModel {
  const heads = d.heads;
  // 还在跑的（实时内容还没接上的那一会儿）：没有的是还没到，不是没存
  const missing: BodyState = d.in_flight ? { kind: "pending" } : { kind: "not_saved" };
  const client: Side = {
    request: { head: headOf(heads, "client", "request", 0), body: d.request_body ? stored(d.request_body) : missing },
    response: { head: headOf(heads, "client", "response", 0), body: d.response_body ? stored(d.response_body) : missing },
  };
  const attempts = new Set<number>();
  for (const h of heads) if (h.side === "upstream") attempts.add(h.attempt);
  // 没有报文头、却另存了发给上游的正文（插件改写过的）：那是最后一跳的
  if (attempts.size === 0 && (d.upstream_request_body || d.upstream_response_body || d.request_after_plugins)) {
    attempts.add(Math.max(1, d.row.routing?.attempts.length ?? 1));
  }
  const sorted = [...attempts].sort((a, b) => a - b);
  const last = sorted[sorted.length - 1];
  const upstream = sorted.map((attempt): UpstreamHop => {
    const serving = attempt === last;
    const sent = d.upstream_request_body ?? d.request_after_plugins;
    const request: BodyState = !serving
      ? { kind: "not_kept" }
      : sent
        ? stored(sent)
        : d.request_body
          ? { kind: "same" }
          : { kind: "not_saved" };
    const response: BodyState = !serving
      ? { kind: "not_kept" }
      : d.upstream_response_body
        ? stored(d.upstream_response_body)
        : d.response_body
          ? { kind: "same" }
          : { kind: "not_saved" };
    return {
      attempt,
      provider: providerOf(d, attempt),
      serving,
      request: { head: headOf(heads, "upstream", "request", attempt), body: request },
      response: { head: headOf(heads, "upstream", "response", attempt), body: response },
    };
  });
  return { client, upstream, afterPlugins: d.request_after_plugins };
}

function liveBody(s: Segment, growing: boolean): BodyState {
  return {
    kind: "body",
    body: { chunks: s.chunks, bytes: s.bytes, truncated: s.truncated, growing: growing && !s.truncated, epoch: s.sends },
  };
}

/**
 * 实时收到的。`d` 是此刻取到的详情（尝试链上的上游名、插件跑过没有）
 */
export function fromLive(live: LiveContent, d: RequestDetail): WireModel {
  const ended = live.end !== null || live.closed;
  const seg = (side: WireSide, dir: WireDir, attempt: number) => live.get(side, dir, attempt);
  const creq = seg("client", "request", 0);
  const cres = seg("client", "response", 0);
  const client: Side = {
    request: {
      head: creq?.head ?? null,
      // 客户端的请求体和报文头一起补发：有头没有正文的，是没留下来（请求记录没起来）
      body: creq?.hasBody ? liveBody(creq, false) : creq?.head || ended ? { kind: "not_saved" } : { kind: "pending" },
    },
    response: {
      head: cres?.head ?? null,
      body: cres?.hasBody ? liveBody(cres, !ended) : ended ? { kind: "not_saved" } : { kind: "pending" },
    },
  };
  const attempts = live.attempts();
  const last = attempts[attempts.length - 1];
  const upstream = attempts.map((attempt): UpstreamHop => {
    const serving = attempt === last;
    const req = seg("upstream", "request", attempt);
    const res = seg("upstream", "response", attempt);
    // 插件在这一跳上改过请求：发出去的就是改过的那一份，和它一样时不另发
    const rewritten = d.plugins.some((p) => p.hook === "request" && p.attempt === attempt - 1 && p.outcome === "changed");
    const request: BodyState = req?.hasBody
      ? liveBody(req, false)
      : !serving
        ? { kind: "not_kept" }
        : rewritten
          ? { kind: "after_plugins" }
          : { kind: "same" };
    const response: BodyState = res?.hasBody
      ? liveBody(res, serving && !ended)
      : serving && !ended
        ? { kind: "pending" }
        : { kind: "not_kept" };
    return {
      attempt,
      provider: providerOf(d, attempt),
      serving,
      request: { head: req?.head ?? null, body: request },
      response: { head: res?.head ?? null, body: response },
    };
  });
  return { client, upstream, afterPlugins: null };
}

/** 存下的详情里有没有这些报文（落盘了）：请求一结束取回来的那一份，正文可能晚几毫秒才到 */
export function landed(d: RequestDetail): boolean {
  return !d.in_flight && (d.heads.length > 0 || d.request_body !== null || d.response_body !== null);
}
