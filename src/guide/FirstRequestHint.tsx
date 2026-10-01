import { useText } from "@/i18n";
import { useNav } from "@/nav";
import { Button } from "@/ui/button";
import { guideText } from "./guide.i18n";
import { Hint } from "./Hint";
import { useSetupSeen } from "./hints";
import { useFirstRequest } from "./useFirstRequest";

/**
 * 「开始使用」走完的那一刻：第一条请求到了，指给人去看它。
 *
 * **只对看过「开始使用」的人说**（见 `hints.ts` 的 `setupSeen`）。按钮打开的是最新
 * 那一条 —— 说完这句之前又来了几条也无妨，要看的就是一条真实的请求长什么样。
 */
export function FirstRequestHint({ when, className }: { when: boolean; className?: string }) {
  const t = useText(guideText);
  const nav = useNav();
  const seen = useSetupSeen();
  const { latestId } = useFirstRequest();
  return (
    <Hint
      id="first-request"
      when={when && seen && latestId !== null}
      title={t.firstRequestTitle}
      className={className}
      action={
        <Button
          size="sm"
          variant="outline"
          onClick={() => latestId !== null && nav.open("requests", { request: latestId })}
        >
          {t.viewRequest}
        </Button>
      }
    >
      {t.firstRequestBody}
    </Hint>
  );
}
