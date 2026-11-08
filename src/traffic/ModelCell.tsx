import { useText } from "@/i18n";
import type { RequestRow } from "@/types";
import { Tip } from "@/ui/tip";
import { Lines } from "./cells";
import { trafficText } from "./Traffic.i18n";
import { NAME_PX } from "./virtual";

/** 发给上游的名字在主行；只有发生改名，才在下面补上请求名。两行共用同一列宽。 */
export function ModelCell({ r }: { r: Pick<RequestRow, "model" | "sentModel"> }) {
  const t = useText(trafficText);
  const requested = r.model ?? "—";
  const sent = r.sentModel || requested;
  const changed = sent !== requested;
  return (
    <Tip lazy text={changed ? <Lines lines={[t.sentModel(sent), t.requestedModel(requested)]} /> : requested}>
      <div className="flex flex-col" style={{ maxWidth: NAME_PX.model }}>
        <span className="truncate">{sent}</span>
        {changed && <span className="truncate tw-label text-muted-foreground">{t.requestedModel(requested)}</span>}
      </div>
    </Tip>
  );
}
