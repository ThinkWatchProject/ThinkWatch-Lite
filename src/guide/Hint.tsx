import type { ReactNode } from "react";
import { LightbulbIcon } from "lucide-react";
import { useText } from "@/i18n";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { guideText } from "./guide.i18n";
import { useHint, type HintId } from "./hints";

/**
 * 一条引导提示：页内的一块（`Banner` 的 inline 摆法），灯泡图标，右边是下一步的按钮
 * 和「不再显示」。
 *
 * **灯泡只用在这里**：一个图标一种意思，看到它就知道这是一句提示、不是故障。
 * 「不再显示」写成字，不用 ×（× 只管关闭）。条件不再成立时它自己收起，点过「不再显示」
 * 就不再出现（见 `hints.ts`）。
 */
export function Hint({
  id,
  when,
  title,
  children,
  action,
  className,
}: {
  id: HintId;
  /** 此刻该不该说：数据没到时传 false */
  when: boolean;
  title: ReactNode;
  children?: ReactNode;
  /** 下一步的那个按钮（`size="sm" variant="outline"`） */
  action?: ReactNode;
  className?: string;
}) {
  const t = useText(guideText);
  const { show, dismiss } = useHint(id, when);
  return (
    <Banner
      show={show}
      layout="inline"
      tone="info"
      icon={<LightbulbIcon />}
      title={title}
      className={className}
      actions={
        <>
          {action}
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={dismiss}>
            {t.hide}
          </Button>
        </>
      }
    >
      {children}
    </Banner>
  );
}
