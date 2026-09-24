import type { ReactNode } from "react";
import { textOf } from "@/i18n";
import type { ConnectError } from "./api";
import { connText } from "./connection.i18n";

/** 句中的配置项、命令：等宽 */
export function code(text: string): ReactNode {
  return <code className="font-mono">{text}</code>;
}

/**
 * 连不上的原因说成两句：**发生了什么**，和**下一步做什么**。
 *
 * 四种都给出下一步（设计稿 ③）。「被关闭」只能说「可能」：core 对允许列表之外的地址
 * accept 之后直接关、一个字节不回，应用分不出那是不是唯一的原因。
 */
export function describeError(e: ConnectError): { title: string; next: ReactNode } {
  const t = textOf(connText);
  switch (e.kind) {
    case "unreachable":
      return { title: t.unreachable(e.addr), next: t.unreachableNext(code) };
    case "timeout":
      return { title: t.unreachable(e.addr), next: t.timeoutNext(code) };
    case "closed":
      return { title: t.closed, next: t.closedNext(code) };
    case "wrong_key":
      return { title: t.wrongKey, next: t.wrongKeyNext(code) };
    case "version_mismatch":
      return { title: t.mismatch(e.theirs, e.ours), next: t.mismatchNext };
  }
}

/** 未连接页「原因」那一格：一个短语，不带下一步（下一步是页面上的按钮） */
export function shortReason(e: ConnectError): string {
  const t = textOf(connText);
  switch (e.kind) {
    case "timeout":
      return t.reasonTimeout;
    case "unreachable":
      return t.reasonUnreachable;
    case "closed":
      return t.closed;
    case "wrong_key":
      return t.wrongKey;
    case "version_mismatch":
      return t.mismatch(e.theirs, e.ours);
  }
}

/** 本机那一条的名字按界面语言写，远程的用用户起的名字 */
export function profileName(p: { local: boolean; name: string }): string {
  return p.local ? textOf(connText).local : p.name;
}
