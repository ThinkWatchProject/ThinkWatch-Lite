import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { useText } from "@/i18n";
import { clientsText } from "./clients.i18n";
import { hostOf, type ClientState, type Reason, type Status } from "./status";

/**
 * 每一档用哪种语气。**颜色只给要留意的几档** —— 未接管是常态，灰着；使用中绿、
 * 等待黄、未生效红（2026-09-22 定下的配色）。
 */
const TONE: Record<ClientState, StatusTone> = {
  in_use: "ok",
  waiting: "warn",
  broken: "error",
  idle: "idle",
  absent: "idle",
};

/**
 * 状态：一个圆点、一个词。
 *
 * `live`：刚接管、正等着第一个请求 —— 点带脉冲，这件事此刻正在发生。等久了（要重启
 * 才生效、或者手动配置的一直没用上）就不再跳：一个一直在跳的点等于没说话。
 *
 * `manual` 时「未接管」写成「未配置」：手动配置的客户端谈不上接管。
 */
export function ClientStatus({ status, manual, live }: { status: Status; manual?: boolean; live?: boolean }) {
  const t = useText(clientsText);
  const label = {
    in_use: t.inUse,
    waiting: t.waiting,
    broken: t.broken,
    idle: manual ? t.notSet : t.idle,
    absent: t.absent,
  }[status.state];
  return (
    <StatusLabel tone={TONE[status.state]} pulse={live && status.state === "waiting"} muted={status.state === "absent"}>
      {label}
    </StatusLabel>
  );
}

/** 状态下面那一行：为什么没生效、还差什么、当前指向哪里 */
export function reasonText(reason: Reason | undefined, t: typeof clientsText.zh): string | null {
  if (!reason) return null;
  switch (reason.kind) {
    case "moved":
      return t.moved(hostOf(reason.endpoint));
    case "shadowed":
      return t.shadowed(reason.file);
    case "silent":
      return t.silent;
    case "restart":
      return t.restart;
    case "local":
      return t.pointsAtLocal(hostOf(reason.endpoint));
    case "stale":
      return t.stale(hostOf(reason.endpoint));
  }
}
