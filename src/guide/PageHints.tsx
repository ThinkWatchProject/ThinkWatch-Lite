import { useClients } from "@/clients/data";
import { useText } from "@/i18n";
import { useNav } from "@/nav";
import { Button } from "@/ui/button";
import { guideText } from "./guide.i18n";
import { Hint } from "./Hint";
import { useFirstRequest } from "./useFirstRequest";

/**
 * 各页的下一步提示。**条件都是此刻的事实**，事实一变（接进来了、请求到了）就自己收起；
 * 每一条点过「不再显示」就不再出现。放在各页的 PageHeader 下面、内容上面。
 *
 * 「接进来了」的口径和概览的「开始使用」一致：接管的、按说明手动配了密钥的都算。
 */
function useConnected() {
  const clients = useClients();
  const d = clients.data;
  if (d === undefined) return { known: false, adopted: [] as { name: string }[], any: false };
  const adopted = d.clients.filter((c) => c.adopted_at_ms != null);
  return { known: true, adopted, any: adopted.length > 0 || d.manual.some((m) => m.key != null) };
}

/** 上游页：有了上游，还没有客户端接进来，也还没有请求 */
export function NextClientsHint({ upstreams, className }: { upstreams: number; className?: string }) {
  const t = useText(guideText);
  const nav = useNav();
  const connected = useConnected();
  const { used } = useFirstRequest();
  return (
    <Hint
      id="next-clients"
      when={upstreams > 0 && connected.known && !connected.any && used === false}
      title={t.nextClientsTitle}
      className={className}
      action={
        <Button size="sm" variant="outline" onClick={() => nav.open("clients")}>
          {t.goClients}
        </Button>
      }
    >
      {t.nextClientsBody}
    </Hint>
  );
}

/**
 * 客户端页的两条，一次只说一条：还没有上游时先说上游；有了上游、接进来了、还没有
 * 请求时，说去客户端里发一条消息。
 */
export function ClientsPageHints({ upstreams, className }: { upstreams: number | undefined; className?: string }) {
  const t = useText(guideText);
  const nav = useNav();
  const connected = useConnected();
  const { used } = useFirstRequest();
  const names = connected.adopted.map((c) => c.name).join(t.listSep);
  return (
    <>
      <Hint
        id="next-upstream"
        when={upstreams === 0}
        title={t.nextUpstreamTitle}
        className={className}
        action={
          <Button size="sm" variant="outline" onClick={() => nav.open("upstreams", { create: "upstream" })}>
            {t.newUpstream}
          </Button>
        }
      >
        {t.nextUpstreamBody}
      </Hint>
      <Hint
        id="next-request"
        when={upstreams !== undefined && upstreams > 0 && connected.adopted.length > 0 && used === false}
        title={t.nextRequestTitle}
        className={className}
        action={
          <Button size="sm" variant="outline" onClick={() => nav.open("requests")}>
            {t.goTraffic}
          </Button>
        }
      >
        {t.nextRequestBody(names)}
      </Hint>
    </>
  );
}

/** 流量页：表里有请求了，说一句点开能看到什么 */
export function OpenRowHint({ when, className }: { when: boolean; className?: string }) {
  const t = useText(guideText);
  return (
    <Hint id="traffic-open-row" when={when} title={t.openRowTitle} className={className}>
      {t.openRowBody}
    </Hint>
  );
}

/** 安全页：有防护停在「观察」。`count` 是此刻停在那儿的项数 */
export function ObserveHint({ count, className }: { count: number; className?: string }) {
  const t = useText(guideText);
  return (
    <Hint id="security-observe" when={count > 0} title={t.observeTitle(count)} className={className}>
      {t.observeBody}
    </Hint>
  );
}
