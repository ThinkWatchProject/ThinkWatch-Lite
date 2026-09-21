import type { FlaggedCall, RequestRow, SecurityEventView } from "@/types";

/**
 * 一条请求的安全记录 → 流量页上那两个徽标要的样子。
 *
 * 实时事件和历史记录说的是同一件事，只是来路不同：刚发生的那条由事件填，
 * 翻历史时由这里填。**两条路给出同一个形状**，徽标才不会因为关窗再开而
 * 变了样。
 */
export function marksFromEvents(
  events: SecurityEventView[] | undefined,
): Pick<RequestRow, "secrets" | "flagged"> {
  if (!events || events.length === 0) return {};
  const redact = events.filter((e) => e.guard === "redact");
  const tools = events.filter((e) => e.guard === "inspect_tools");
  return {
    secrets:
      redact.length > 0
        ? {
            replaced: redact.some((e) => e.action === "replaced"),
            items: redact.map((e) => ({
              rule: e.rule,
              custom: e.custom === true,
              kind: "",
              masked: e.excerpt,
              count: e.count,
            })),
          }
        : undefined,
    flagged:
      tools.length > 0
        ? tools.map(
            (e): FlaggedCall => ({
              tool: e.tool ?? "",
              rule: e.rule,
              custom: e.custom === true,
              excerpt: e.excerpt,
              blocked: e.action === "cut",
            }),
          )
        : undefined,
  };
}
