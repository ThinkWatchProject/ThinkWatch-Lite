import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Surface } from "@/nav";
import type { ConfigFocus } from "@/configLocate";
import type { LogFocus } from "@/security/SecurityPage";
import type { TrafficView } from "@/traffic/view";
import type { ConfigFix, ConfigRejection, CoreStatus, Overview, ScanFinding } from "@/types";
import { useRequestRows, useRequestsView, useReseed, useSessionViews, useSettled } from "@/useRequests";
import { useBusyKeys } from "@/keys/live";
import { ConfigBroken, Unlinked } from "@/connection/Unlinked";
import { Page, PageHeader } from "@/ui/page";
import { ErrorState, TableSkeleton } from "@/ui/states";
import type { CoreLine } from "./describe";
import { lazyPart, usePart, type Part } from "./lazyPart";

/*
  每一页各是一块，用到时才载入（见 `lazyPart`）。**页面的模块只在这里引用**：别处静态
  引用一页的话，那一页就又被打回主界面那一块里。
*/
const OverviewPart = lazyPart(() => import("@/overview/OverviewPage").then((m) => m.default));
const TrafficPart = lazyPart(() => import("@/traffic/TrafficPage").then((m) => m.default));
const ClientsPart = lazyPart(() => import("@/clients/ClientsPage").then((m) => m.default));
const KeysPart = lazyPart(() => import("@/keys/KeysPage").then((m) => m.default));
const UpstreamsPart = lazyPart(() => import("@/upstreams/UpstreamsPage").then((m) => m.default));
const RoutingPart = lazyPart(() => import("@/routing/RoutingPage").then((m) => m.default));
const SecurityPart = lazyPart(() => import("@/security/SecurityPage").then((m) => m.default));
const McpPart = lazyPart(() => import("@/mcp/McpPage").then((m) => m.default));
const PluginsPart = lazyPart(() => import("@/plugins/PluginsPage").then((m) => m.default));
const SettingsPart = lazyPart(() => import("@/settings/SettingsPage").then((m) => m.SettingsPage));

const PARTS: Record<Surface, { preload: () => Promise<unknown> }> = {
  dashboard: OverviewPart,
  requests: TrafficPart,
  clients: ClientsPart,
  keys: KeysPart,
  upstreams: UpstreamsPart,
  routing: RoutingPart,
  security: SecurityPart,
  mcp: McpPart,
  plugins: PluginsPart,
  settings: SettingsPart,
};

/** 先把这一页载入（落地页：和连 core 同时进行，交接时已经在了） */
export function preloadPage(s: Surface): void {
  void PARTS[s].preload().catch(() => {});
}

/** 把每一页都载入。交接之后空闲下来时做，第一次换到哪一页都不用等 */
export function preloadPages(): void {
  for (const s of Object.keys(PARTS) as Surface[]) preloadPage(s);
}

/** 页面那一块还没载入完时等多久才画骨架：快的那一下什么都不画，不闪（同 `LoadingState`） */
const PART_DELAY_MS = 180;

/** 页面那一块还在载入。和「还没取到概览」同一个样子：空页头占住边距，内容是表格骨架 */
function PartLoading() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setOn(true), PART_DELAY_MS);
    return () => clearTimeout(h);
  }, []);
  return on ? (
    <Page>
      <PageHeader />
      <TableSkeleton rows={6} cols={4} />
    </Page>
  ) : null;
}

/**
 * 一页：那一块载入完才画，没好时是 `PartLoading`。**包了一层 `memo`**：外壳因为别的事
 * 重画（开命令面板、换横幅）时，页面不跟着重画 —— 它们拿到的回调都是稳定的引用。
 */
function route<P extends object>(part: Part<P>) {
  return memo(function Route(props: P) {
    const C = usePart(part);
    return C ? <C {...props} /> : <PartLoading />;
  });
}

const UpstreamsPage = route(UpstreamsPart);
const RoutingPage = route(RoutingPart);
const McpPage = route(McpPart);
const PluginsPage = route(PluginsPart);
const SettingsPage = route(SettingsPart);

/*
  下面几个把实时请求列表里的一样接到那一页上。**订阅在这一层**：请求列表每一帧都在变，
  订阅放在外壳的话，外壳和眼前那一页跟着整个重画。它们也都是 `memo` 的。
*/

/** 概览：库里多了请求（`settled`）、手动刷新（`nudge`）时重取 */
const OverviewRoute = memo(function OverviewRoute({
  ov,
  nudge,
  onLanded,
}: {
  ov: Overview | null;
  nudge: number;
  onLanded: () => void;
}) {
  const settled = useSettled();
  const C = usePart(OverviewPart);
  return C ? <C tick={settled + nudge} ov={ov} onLanded={onLanded} /> : <PartLoading />;
});

const SecurityRoute = memo(function SecurityRoute({
  configVersion,
  nudge,
  focus,
  onChanged,
}: {
  configVersion: string;
  nudge: number;
  focus: LogFocus | null;
  onChanged: () => void;
}) {
  const settled = useSettled();
  const C = usePart(SecurityPart);
  return C ? (
    <C configVersion={configVersion} tick={settled + nudge} focus={focus} onChanged={onChanged} />
  ) : (
    <PartLoading />
  );
});

/** 客户端页、密钥页：哪几把密钥此刻有请求在跑（只在这一组变了时重画） */
const ClientsRoute = memo(function ClientsRoute({ providers }: { providers: Overview["providers"] | undefined }) {
  const busy = useBusyKeys();
  const C = usePart(ClientsPart);
  return C ? <C busy={busy} providers={providers} /> : <PartLoading />;
});

const KeysRoute = memo(function KeysRoute({
  ov,
  onChanged,
  onOpenConfigFile,
}: {
  ov: Overview;
  onChanged: () => void;
  onOpenConfigFile: (focus: ConfigFocus | null) => void;
}) {
  const busy = useBusyKeys();
  const C = usePart(KeysPart);
  return C ? <C ov={ov} busy={busy} onChanged={onChanged} onOpenConfigFile={onOpenConfigFile} /> : <PartLoading />;
});

const pickSeeded = (v: { seeded: boolean }) => v.seeded;
const pickSeedError = (v: { seedError: unknown }) => v.seedError;
const pickLocal = (v: { locallyAnswered: number }) => v.locallyAnswered;

/** 流量页：整份请求列表和会话汇总 */
const TrafficRoute = memo(function TrafficRoute({ status, view }: { status: CoreStatus | null; view: TrafficView }) {
  const rows = useRequestRows();
  const seeded = useRequestsView(pickSeeded);
  const seedError = useRequestsView(pickSeedError);
  const reseed = useReseed();
  const locallyAnswered = useRequestsView(pickLocal);
  const sessions = useSessionViews();
  const C = usePart(TrafficPart);
  return C ? (
    <C
      rows={rows}
      seeded={seeded}
      seedError={seedError}
      onRetry={reseed}
      locallyAnswered={locallyAnswered}
      sessions={sessions}
      status={status}
      view={view}
    />
  ) : (
    <PartLoading />
  );
});

/**
 * 内容区：眼前那一页。
 *
 * 断线时整块只读：`fieldset disabled` 让里面的按钮、输入框、下拉一起失效，读、滚动、
 * 悬停说明照旧。设置页不整页只读：连接管理在那里，断线时正要来这里（换密钥、切回本机）；
 * 那一页里改服务器配置的几节自己只读，见 `SettingsPage`
 */
export function Pages({
  tab,
  linked,
  launching,
  core,
  local,
  status,
  ov,
  ovError,
  nudge,
  broken,
  repair,
  remoteLost,
  alerts,
  onSeenAlerts,
  securityFocus,
  traffic,
  onLanded,
  onChanged,
  onRetry,
  onOpenConfigFile,
  onOpenHistory,
}: {
  tab: Surface;
  linked: boolean;
  /** 启动画面还盖着 */
  launching: boolean;
  /** `core_state` 的字符串 */
  core: string;
  /** 本机 core 此刻怎么样（`describeCore`） */
  local: CoreLine;
  status: CoreStatus | null;
  ov: Overview | null;
  ovError: unknown;
  nudge: number;
  /** 安全模式下 core 拒收的那份配置。在的时候各页换成出错页 */
  broken: ConfigRejection | null;
  repair: { fixes: ConfigFix[]; repairing: boolean; repair: () => void };
  remoteLost: boolean;
  alerts: ScanFinding[];
  onSeenAlerts: () => void;
  securityFocus: LogFocus | null;
  traffic: TrafficView;
  onLanded: () => void;
  onChanged: () => void;
  /** 概览读失败时「重试」 */
  onRetry: () => void;
  onOpenConfigFile: (focus: ConfigFocus | null) => void;
  onOpenHistory: () => void;
}) {
  /** 还没取到概览时的占位：空页头占住边距，内容是表格骨架；读失败了是「读取失败」和重试 */
  const skeleton = (
    <Page>
      <PageHeader />
      {ovError !== null ? <ErrorState error={ovError} onRetry={onRetry} /> : <TableSkeleton rows={6} cols={4} />}
    </Page>
  );

  return (
    <fieldset
      disabled={remoteLost && tab !== "settings"}
      className={cn(
        "m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0 transition-opacity",
        remoteLost && tab !== "settings" && "opacity-60",
      )}
    >
      {/*
        每一页自己的滚动层，换页时淡入并上移 4px（`motion-page`）。流量页在
        自己那一层里横竖都滚（表头靠它吸顶），这一层不能再滚。
      */}
      <div
        key={linked ? tab : `unlinked-${tab}`}
        className={cn(
          "flex min-h-0 flex-1 flex-col motion-page",
          tab === "requests" && linked ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {/*
          **还没连上时这里什么都不画**：整窗盖着启动画面。连上之后各页在它下面
          挂上、开始取数，交接时数据已经在了（见 `useCoreLink` 的 `handover`）。**控制面
          一答应就交接** —— 哪怕网关还没起来（安全模式下配置、回滚都能用）。
        */}
        {!linked ? (
          launching ? null : tab === "settings" ? (
            <SettingsPage ov={null} status={null} local={local} linked={false} onChanged={onChanged} />
          ) : (
            <Unlinked core={core} />
          )
        ) : broken && tab !== "settings" ? (
          <ConfigBroken
            rejection={broken}
            path={status?.config_path ?? ""}
            fixes={repair.fixes}
            repairing={repair.repairing}
            onRepair={repair.repair}
            onOpenFile={() => onOpenConfigFile(null)}
            onHistory={onOpenHistory}
          />
        ) : broken ? (
          <SettingsPage ov={null} status={null} local={local} linked={false} onChanged={onChanged} />
        ) : tab === "dashboard" ? (
          <OverviewRoute ov={ov} nudge={nudge} onLanded={onLanded} />
        ) : tab === "clients" ? (
          <ClientsRoute providers={ov?.providers} />
        ) : tab === "mcp" ? (
          <McpPage alerts={alerts} onSeen={onSeenAlerts} />
        ) : tab === "security" ? (
          ov ? (
            <SecurityRoute
              configVersion={ov.config_version}
              nudge={nudge}
              focus={securityFocus}
              onChanged={onChanged}
            />
          ) : (
            skeleton
          )
        ) : tab === "keys" ? (
          ov ? (
            <KeysRoute ov={ov} onChanged={onChanged} onOpenConfigFile={onOpenConfigFile} />
          ) : (
            skeleton
          )
        ) : tab === "routing" ? (
          ov ? (
            <RoutingPage ov={ov} onChanged={onChanged} onOpenConfigFile={onOpenConfigFile} />
          ) : (
            skeleton
          )
        ) : tab === "upstreams" ? (
          ov ? (
            <UpstreamsPage ov={ov} onChanged={onChanged} onOpenConfigFile={onOpenConfigFile} />
          ) : (
            skeleton
          )
        ) : tab === "plugins" ? (
          ov ? (
            <PluginsPage ov={ov} onChanged={onChanged} />
          ) : (
            skeleton
          )
        ) : tab === "settings" ? (
          <SettingsPage ov={ov} status={status} local={local} linked coreReadOnly={remoteLost} onChanged={onChanged} />
        ) : (
          <TrafficRoute status={status} view={traffic} />
        )}
      </div>
    </fieldset>
  );
}
