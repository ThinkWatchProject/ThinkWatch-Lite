import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SURFACES, type Surface } from "@/nav";
import type { TrafficView } from "@/traffic/view";
import { RequestsProvider, type RequestsStore, type RequestsView } from "@/useRequests";
import { Pages } from "./Pages";

const noop = () => {};

/** 实时请求列表：空的、不会变。连上之后有几页要从它取 */
const VIEW: RequestsView = {
  rows: [],
  seeded: false,
  seedError: undefined,
  settled: 0,
  locallyAnswered: 0,
  sessions: [],
};
const STORE: RequestsStore = { get: () => VIEW, subscribe: () => noop, reseed: async () => {} };

/** 内容区画出来之后，每一页自己那一层滚动容器（`fieldset` 里的第一层）的类名 */
function layerClass(tab: Surface, linked: boolean): string[] {
  const html = renderToStaticMarkup(
    <RequestsProvider value={STORE}>
      <Pages
        tab={tab}
        linked={linked}
        launching={!linked}
        core="running"
        local={{ text: "", short: "", tone: "ok" }}
        status={null}
        ov={null}
        ovError={null}
        nudge={0}
        broken={null}
        repair={{ fixes: [], repairing: false, repair: noop }}
        remoteLost={false}
        alerts={[]}
        onSeenAlerts={noop}
        securityFocus={null}
        traffic={{} as TrafficView}
        onLanded={noop}
        onChanged={noop}
        onRetry={noop}
        onOpenConfigFile={noop}
        onOpenHistory={noop}
      />
    </RequestsProvider>,
  );
  const cls = /<fieldset[^>]*><div class="([^"]*)"/.exec(html)?.[1];
  if (cls === undefined) throw new Error(`no page layer in ${html.slice(0, 200)}`);
  return cls.split(/\s+/);
}

describe("内容区的滚动层", () => {
  /**
   * **每一页的滚动层都是定位的。**不定位的话，页里没有定位祖先的绝对定位元素（读屏用的
   * `sr-only`）包含块是整个窗口，这一层裁不到它们：它们排在内容最底下，把文档撑得比窗口
   * 高。概览上按几下空格，这一层滚到底之后接着滚文档，整列连工具栏一起上移、露出半屏空白
   */
  it.each(SURFACES.flatMap((tab) => [true, false].map((linked) => [tab, linked] as const)))(
    "%s（连上：%s）是 relative",
    (tab, linked) => {
      const cls = layerClass(tab, linked);
      expect(cls).toContain("relative");
      expect(cls).toContain(tab === "requests" && linked ? "overflow-hidden" : "overflow-y-auto");
    },
  );
});
