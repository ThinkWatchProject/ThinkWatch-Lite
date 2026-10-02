/**
 * PROVISIONAL —— core 的 `SessionTranscript`（`GET /sessions/{id}/transcript`）还没有发版。
 *
 * 在它发版之前，会话「对话」那一页要的类型和端点都在这一个文件里，照 core 那边定下的
 * 契约手写。**这是全仓库唯一一处手写的控制面类型**：发版以后它们由 core 生成进
 * `src/generated/tw-api.ts`（那个文件永远不手改），这个文件随之删掉。端点已在 core 的
 * main 上（ThinkWatch-Core#251，`CONTROL_API_VERSION` 32），生成的类型和下面一致 ——
 * 包括 `TranscriptTurn.id` 是字符串、`TurnView.id` 是数，两边按 `viewsById` 对上。
 *
 * 接入步骤（core 发版、lite 升级钉点的那个 PR 里做）：
 *
 * 1. 升级 `src-tauri/Cargo.toml` 里 tw-api 的 tag（和 twcore 一起，协议版本要相等），
 *    重新生成类型：`UPDATE_TS=1 cargo test --manifest-path src-tauri/Cargo.toml --test ts_bindings`。
 *    生成的 `ENDPOINTS.SessionTranscript`、`Endpoints.SessionTranscript` 应和下面的
 *    `SESSION_TRANSCRIPT`、`SessionTranscriptEndpoint` 一致；不一致的话以生成的为准。
 * 2. 两份白名单一起加上 `SessionTranscript`（`the_frontend_lists_the_same_endpoints` 核对
 *    二者相同）：`src/control.ts` 的 `WEBVIEW_ENDPOINTS`、`src-tauri/src/call.rs` 的
 *    `webview_endpoints![…]`（`SessionDetail` 后面，两处都留着 TODO）。
 * 3. 截图流水线的 mock 按端点名映射，缺一个就编译不过：`scripts/shots/mock/core.ts` 的
 *    `CORE` 里加 `SessionTranscript`（`pnpm typecheck` 连它一起查）。
 * 4. 删掉这个文件，引用它的地方改成：类型从 `@/types` 引（`Transcript`、`TranscriptTurn`、
 *    `TranscriptMessage`、`TranscriptPart`、`TranscriptRole`、`TranscriptGap`），
 *    取数改成 `call("SessionTranscript", null, id)`。引用它的只有 `Conversation.tsx`、
 *    `transcript.ts` 和 `transcript.test.ts`：`grep -rn "transcript.provisional" src`。
 *
 * 5. 预览用的 mock（`.claude/preview/full`，不在仓库里）按名字在 `mock/commands.ts` 里先答了
 *    它；接入以后挪进 `mock/core.ts` 的 `CORE`。
 *
 * 在那之前，应用里调这个端点会被 Rust 那一层拒绝（不在白名单上），「对话」那一页显示
 * 读取失败。
 */
import { invoke } from "@tauri-apps/api/core";

/** 一次会话按对话的样子重放出来：开头的系统提示，然后一轮一轮 */
export type Transcript = {
  session: string;
  /** 第一条可读的那一轮的系统提示。没有就是 `null` */
  system: string | null;
  turns: Array<TranscriptTurn>;
};

/** 一轮 = 一条请求和它的回答 */
export type TranscriptTurn = {
  /** 请求 id。和 `SessionDetail.turns` 同一批 id、同一个顺序 */
  id: string;
  /**
   * 这条请求的历史没有接着上一条可读的那一轮往下走（例如上下文被压缩过）。这时
   * `input` 是它带着的整段历史，不只是新的那几条
   */
  restart: boolean;
  /** 系统提示和上一条可读的那一轮不同了：新的那一份。没变就是 `null` */
  system_changed: string | null;
  /** 这条请求里新出现的消息 */
  input: Array<TranscriptMessage>;
  /** 回答 */
  output: Array<TranscriptPart>;
  /** 这一轮有哪些部分显示不出来 */
  gaps: Array<TranscriptGap>;
};

export type TranscriptMessage = { role: TranscriptRole; parts: Array<TranscriptPart> };

export type TranscriptRole = "user" | "assistant" | "tool" | "system";

export type TranscriptPart =
  | { kind: "text"; text: string }
  /** 可能是空的：响应里只有签名，没有思考的正文 */
  | { kind: "thinking"; text: string }
  /** `input` 是参数的 JSON 原文 */
  | { kind: "tool_call"; id: string; name: string; input: string }
  | { kind: "tool_result"; call_id: string; text: string; is_error: boolean }
  | { kind: "image"; media_type: string | null; bytes: number | null }
  | { kind: "other"; label: string };

export type TranscriptGap =
  | "request_missing"
  | "request_truncated"
  | "response_missing"
  | "response_truncated"
  | "response_unreadable";

/** 端点的样子，和生成的 `ENDPOINTS` 里一项同形 */
export const SESSION_TRANSCRIPT = {
  name: "SessionTranscript",
  method: "GET",
  path: "/sessions/{id}/transcript",
  params: ["id"],
  format: "json",
} as const;

/** 请求和响应，和生成的 `Endpoints` 里一项同形 */
export type SessionTranscriptEndpoint = { req: null; res: Transcript };

/**
 * 取一次会话的对话。接入以后就是 `call("SessionTranscript", null, id)`：走的是同一个
 * `call` 命令、同样的参数，只是端点名还不在 `WebviewEndpoint` 里，类型查不到它。
 */
export function fetchTranscript(session: string): Promise<Transcript> {
  return invoke<SessionTranscriptEndpoint["res"]>("call", {
    endpoint: SESSION_TRANSCRIPT.name,
    params: [session],
    req: null,
  });
}
