import type { FlaggedCall, RequestRow, SecurityEventView } from "@/types";

/**
 * 一条请求的安全记录 → 流量页上那几个徽标要的样子：已脱敏 / 含凭据、已拦截 / 可疑调用、
 * 已删除。
 *
 * 实时事件和历史记录说的是同一件事，只是来路不同：刚发生的那条由事件填，
 * 翻历史时由这里填。**两条路给出同一个形状**，徽标才不会因为关窗再开而
 * 变了样。
 */
export function marksFromEvents(
  events: SecurityEventView[] | undefined,
): Pick<RequestRow, "secrets" | "flagged" | "stripped"> {
  if (!events || events.length === 0) return {};
  const redact = events.filter((e) => e.guard === "redact");
  const tools = events.filter((e) => e.guard === "inspect_tools");
  // 内容过滤只有删过文字的上徽标，和实时那一路（`applyEvent`）一样
  const stripped = events.filter((e) => e.guard === "content" && e.action === "stripped");
  return {
    secrets:
      redact.length > 0
        ? {
            replaced: redact.some((e) => e.action === "replaced"),
            items: redact.map((e) => ({
              rule: e.rule,
              custom: e.custom === true,
              masked: e.excerpt,
              count: e.count,
              // 和实时事件那一项（`SecretItem.detail`）同一个形状
              detail: {
                direction: e.direction,
                locations: e.locations,
                more_locations: e.more_locations,
                rule_snapshot: e.rule_snapshot,
                outcome_detail: e.outcome_detail,
              },
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
    stripped:
      stripped.length > 0
        ? stripped.map((e) => ({ rule: e.rule, custom: e.custom === true, count: e.count }))
        : undefined,
  };
}
