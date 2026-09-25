import type { ReactNode } from "react";
import { textOf } from "@/i18n";
import type { ConnectError } from "./api";
import { connText } from "./connection.i18n";

/** 句中的配置项、命令：等宽 */
export function code(text: string): ReactNode {
  return <code className="font-mono">{text}</code>;
}

/**
 * 在服务器上装本应用需要的那一版 core 的命令。未连接页和连接对话框给的都是这一条。
 *
 * **指定版本，不是「升级到最新」。**服务器上的 core 必须是这一版应用配的那一版，而服务器
 * 可能比应用新 —— 这时升级到最新什么也不会改变。`twcore upgrade --version` 装指定的那一版，
 * 比服务器上现有的旧也照装。`--restart`：服务由 systemd 管着时当场重启成这一版。二进制在
 * `/usr/local/bin`，重启服务也要 root，所以带 `sudo`
 */
export function coreInstallCommand(version: string): string {
  return `sudo twcore upgrade --version ${version} --restart`;
}

/**
 * 连不上的原因说成两句：**发生了什么**，和**下一步做什么**。
 *
 * 四种都给出下一步（设计稿 ③）。「被关闭」只能说「可能」：core 对允许列表之外的地址
 * accept 之后直接关、一个字节不回，应用分不出那是不是唯一的原因。
 *
 * `required` 是这一版应用配的 core（`ConnView.required_core`），版本不一致时的下一步用它
 * 写出命令。**不用错误里的 `ours`**：两边版本号相同、协议不同时（没发版的构建之间），
 * 它带着协议号，不是一个能装的版本
 */
export function describeError(e: ConnectError, required: string): { title: string; next: ReactNode } {
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
      return { title: t.mismatch(e.theirs, e.ours), next: t.mismatchNext(code, coreInstallCommand(required)) };
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

/**
 * 连接的名字：**界面上显示连接名都经它**。本机那一条按界面语言写（`connText.local`，
 * 英文按平台），不用 Rust 给的 —— 换语言时这里当场换，不等下一次推送；远程的用用户起的名字
 */
export function profileName(p: { local: boolean; name: string }): string {
  return p.local ? textOf(connText).local : p.name;
}
