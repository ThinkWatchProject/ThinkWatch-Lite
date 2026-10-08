/**
 * `core-state` 事件（和 `core_state` 命令）那个字符串，拆成界面能直接判断的样子。
 *
 * 字符串是 Rust 那边一处拼的（`gateway::describe_state`，连远程时 `connection::describe_active`，
 * 找不到程序时 `core_state` 命令）：
 *
 * · `starting` · `running:<pid>`（连着远程时 pid 是 0）· `restarting:<第几次>:<几毫秒后>`
 * · `safe_mode` / `safe_mode:<pid>`（带 pid 是控制面答应了）· `stopped`
 * · `exited:<原因>` · `failed:<原因>` · `missing:<原因>` · `unlinked`（连着的远程没连上）
 *
 * **只在这里拆。**原来五处各自 `startsWith`，有的判 `running:`、有的判 `running`，安全模式有的
 * 带冒号有的不带：哪天格式一变，几处会悄悄说出不一样的话。认不出的字符串归成 `unknown`，
 * 各处照「不在跑」处理。
 */
export type CoreState =
  | { kind: "starting" }
  | { kind: "running"; pid: number }
  | { kind: "restarting"; attempt: number; inMs: number }
  /** `pid` 不是 null：控制面答应了，界面可以连上去（改配置、一键修复） */
  | { kind: "safe_mode"; pid: number | null }
  | { kind: "stopped" }
  | { kind: "exited"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "missing"; reason: string }
  | { kind: "unlinked" }
  | { kind: "unknown"; raw: string };

export function parseCoreState(raw: string): CoreState {
  const at = raw.indexOf(":");
  const head = at < 0 ? raw : raw.slice(0, at);
  const rest = at < 0 ? null : raw.slice(at + 1);
  switch (head) {
    case "starting":
    case "stopped":
    case "unlinked":
      return rest === null ? { kind: head } : { kind: "unknown", raw };
    case "running":
      return rest === null ? { kind: "unknown", raw } : { kind: "running", pid: Number(rest) };
    case "restarting": {
      // 缺了的那一段按第 1 次、马上算：说「正在进行第 undefined 次重启」不如说个保守的数
      const [attempt, inMs] = (rest ?? "").split(":");
      return { kind: "restarting", attempt: Number(attempt || 1), inMs: Number(inMs || 0) };
    }
    case "safe_mode":
      return { kind: "safe_mode", pid: rest ? Number(rest) : null };
    // 原因里自己可能带冒号（路径、「pid 7」），所以只切第一个
    case "exited":
    case "failed":
    case "missing":
      return { kind: head, reason: rest ?? "" };
    default:
      return { kind: "unknown", raw };
  }
}

/** core 在跑：请求在转发，各处该取数、对账 */
export function isRunning(s: CoreState): boolean {
  return s.kind === "running";
}

/**
 * 控制面答应了：可以去读状态、读配置。**安全模式下控制面答应了的也算** —— 一启动就进了
 * 安全模式的那次，界面要连上它，才说得出哪儿错了
 */
export function controlUp(s: CoreState): boolean {
  return s.kind === "running" || (s.kind === "safe_mode" && s.pid !== null);
}
