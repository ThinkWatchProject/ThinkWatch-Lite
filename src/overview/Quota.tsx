import type { Dashboard, Overview } from "@/types";

/**
 * 额度与余额：订阅的额度窗口和各家余额，此刻的状态，不跟时间范围走。
 *
 * 占位：等这一块换上。
 */
export function Quota(_: { d: Dashboard; ov: Overview | null }) {
  return null;
}

/** 有没有一家上游说得出额度或余额。没有的话这一块不出现，「去向」占满一行 */
export function hasQuota(_d: Dashboard, _ov: Overview | null): boolean {
  return false;
}
