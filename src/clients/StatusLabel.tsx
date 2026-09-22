import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { clientsText } from "./clients.i18n";
import { hostOf, type ClientState, type Reason, type Status } from "./status";

const DOT: Record<ClientState, string> = {
  in_use: "bg-success",
  waiting: "bg-warning",
  broken: "bg-destructive",
  idle: "bg-muted-foreground/60",
  absent: "bg-muted-foreground/40",
};

const TEXT: Record<ClientState, string> = {
  in_use: "text-success",
  waiting: "text-warning",
  broken: "text-destructive",
  idle: "",
  absent: "text-muted-foreground",
};

/**
 * 状态：一个圆点、一个词。**颜色只给要留意的几档** —— 未接管是常态，灰着；
 * 使用中绿、等待黄、未生效红。
 *
 * `manual` 时「未接管」写成「未配置」：手动配置的客户端谈不上接管。
 */
export function StatusLabel({ status, manual }: { status: Status; manual?: boolean }) {
  const t = useText(clientsText);
  const label = {
    in_use: t.inUse,
    waiting: t.waiting,
    broken: t.broken,
    idle: manual ? t.notSet : t.idle,
    absent: t.absent,
  }[status.state];
  return (
    <span className={cn("inline-flex items-center gap-1.5", TEXT[status.state])}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[status.state])} />
      {label}
    </span>
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
  }
}
