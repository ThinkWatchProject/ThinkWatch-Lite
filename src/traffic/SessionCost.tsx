import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import type { SessionView } from "@/types";
import { sessionsText } from "./Sessions.i18n";
import { costCell } from "./costCell";

/**
 * 一次会话的费用，在组头上。**一行，一个数**：写什么见 `costCell`。
 *
 * 有说明的金额带虚线下划线，和请求行里估算的金额同一个记号；「无法计价」
 * 本来就淡一档，悬停照样有说明。
 */
export function SessionCost({ s }: { s: SessionView }) {
  const c = costCell(s, useText(sessionsText));
  if (c.notes.length === 0) return <>{c.text}</>;
  return (
    <Tip text={<Lines lines={c.notes} />}>
      <span
        className={
          c.muted
            ? "text-muted-foreground"
            : "underline decoration-dotted underline-offset-2"
        }
      >
        {c.text}
      </span>
    </Tip>
  );
}

/** 悬停里的几句话，一句一段。气泡本身是横排的 flex，要包成一块 */
function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-1">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
