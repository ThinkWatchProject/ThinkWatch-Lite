import type { ReactNode } from "react";
import { call } from "@/control";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/resource";
import { Button } from "@/ui/button";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { StatusDot } from "@/ui/status-dot";
import { IconLocal, IconRemote } from "@/ui/icons";
import { useText } from "@/i18n";
import { useConnections } from "@/connection/ConnectionProvider";
import { ConnectionsSection, linkStatus, type LinkStatus } from "@/connection/ConnectionsSection";
import { currentProfile } from "@/connection/api";
import { connText } from "@/connection/connection.i18n";
import { profileName } from "@/connection/describe";
import { remoteText } from "@/connection/remote.i18n";
import { remoteStatus, type Tone } from "@/connection/Switcher";
import { useRemote } from "@/connection/useRemote";
import type { CoreStatus, Overview } from "@/types";
import { AboutSection } from "./AboutSection";
import { APP_KEYS, settingsApi } from "./api";
import { GeneralSection } from "./GeneralSection";
import { generalText } from "./GeneralSection.i18n";
import { kitText } from "./kit.i18n";
import {
  ErrorRow,
  OfflineRow,
  RowSkeleton,
  SettingsCard,
  SettingsGroup,
  SettingsShell,
  useSettingsNav,
  type IndexItem,
} from "./kit";
import { ListenSection, levelOf } from "./ListenSection";
import { listenText } from "./ListenSection.i18n";
import { RetentionSection } from "./RetentionSection";
import { retentionText } from "./RetentionSection.i18n";
import { settingsText } from "./SettingsPage.i18n";
import { UninstallSection } from "./UninstallSection";

/**
 * 设置。
 *
 * **两类东西，两种改法。**连接、通用（语言、外观、菜单栏、开机启动、提醒）改的是
 * 这个应用，点一下就换；网关监听、日志保留改的是 config.yaml，改完点保存才生效 ——
 * 它们改错的代价是客户端连不上、或者日志被删。上游、路由、密钥这些要天天看、常常改
 * 的，各有自己的页。
 *
 * 左边一列目录，跟着滚动点亮当前那一节；改了没存的节在目录上挂一个点。连着远程 core
 * 时分成两组（设计稿 ⑧）：这台 Mac 上的应用，和服务器的配置 —— 混在一起的话，「语言」
 * 和「监听」挨着，分不清哪一项改的是服务器。
 *
 * **连接那一节不依赖 core**：没连上 core 时整页照样打开（连接管理就在这里），只有改
 * 配置文件的两节说明现在改不了。
 */
export function SettingsPage({
  ov,
  status,
  local: localCore,
  linked,
  coreReadOnly = false,
  onChanged,
}: {
  ov: Overview | null;
  status: CoreStatus | null;
  /** 本机 core 此刻怎么样，和侧栏左下角同一句（App 的 `describeCore`）。连本机时连接那一行和页头写它 */
  local: { text: string; tone: Tone };
  /** 控制面答应了。没有的话改配置文件的两节画成「连接后可修改」 */
  linked: boolean;
  /** 连着的远程 core 断了：改它配置的几节只读，应用自己的设置照常能改 */
  coreReadOnly?: boolean;
  /** 存完监听、日志保留之后叫一声，状态和概览跟着重读 */
  onChanged: () => void;
}) {
  const t = useText(settingsText);
  const ct = useText(connText);
  const rt = useText(remoteText);
  const gt = useText(generalText);
  const lt = useText(listenText);
  const et = useText(retentionText);
  const remote = useRemote();
  const local = linkStatus(localCore);

  /*
    改配置文件的两节要概览（`ov`，外壳读的）。外壳读失败时只是留着 null、等下一次再读；
    这里自己再问一遍：问到了就先用它，问不到就在这两节里说出来、给重试 —— 不让骨架一直转
  */
  const probe = useResource(linked && !ov ? "settings:overview" : null, () => call("Overview", null));
  const view = ov ?? probe.data ?? null;
  const pending: Pending = !linked
    ? { kind: "offline" }
    : probe.error !== undefined
      ? {
          kind: "failed",
          error: probe.error,
          retrying: probe.loading,
          retry: () => {
            void probe.reload();
            // 外壳那一份也重读：读到了这两节就换回外壳的
            onChanged();
          },
        }
      : { kind: "loading" };

  const items: IndexItem[] = remote
    ? [
        { id: "connections", label: ct.title, caption: t.here },
        { id: "general", label: gt.title },
        { id: "about", label: t.about },
        { id: "uninstall", label: t.uninstall },
        { id: "listen", label: lt.title, caption: remote.name },
        { id: "retention", label: et.title },
      ]
    : [
        { id: "connections", label: ct.title },
        { id: "general", label: gt.title },
        { id: "listen", label: lt.title },
        { id: "retention", label: et.title },
        { id: "about", label: t.about },
        { id: "uninstall", label: t.uninstall },
      ];

  const server = (
    /*
      断线时这两节只读：`fieldset disabled` 让里面的按钮、输入框、下拉一起失效，读、
      滚动、悬停说明照旧。应用自己的那几节不受影响
    */
    <fieldset
      disabled={coreReadOnly}
      className={cn("m-0 flex min-w-0 flex-col gap-8 border-0 p-0 transition-opacity", coreReadOnly && "opacity-60")}
    >
      {view ? (
        <ListenSection
          view={view.listen}
          status={status}
          configVersion={view.config_version}
          note={remote ? rt.controlReadOnly : undefined}
          onChanged={onChanged}
        />
      ) : (
        <Placeholder id="listen" title={lt.title} state={pending} rows={3} />
      )}
      {view ? (
        <RetentionSection retention={view.retention} configVersion={view.config_version} onChanged={onChanged} />
      ) : (
        <Placeholder id="retention" title={et.title} description={et.intro} state={pending} rows={3} />
      )}
    </fieldset>
  );

  return (
    <Page width="wide">
      <SettingsShell
        items={items}
        header={
          <PageHeader title={t.title} summary={<Summary local={local} status={status} ov={view} linked={linked} />} />
        }
      >
        {remote ? (
          <>
            <ScopeHeading icon={<IconLocal />}>{rt.appGroup}</ScopeHeading>
            <ConnectionsSection local={local} />
            <GeneralSection />
            <AboutSection remote={remote} linked={linked} />
            <UninstallSection remote={remote} />
            <ScopeHeading icon={<IconRemote />}>{rt.serverGroup(remote.name)}</ScopeHeading>
            {server}
          </>
        ) : (
          <>
            <ConnectionsSection local={local} />
            <GeneralSection />
            {server}
            <AboutSection remote={null} linked={linked} />
            <UninstallSection remote={null} />
          </>
        )}
      </SettingsShell>
    </Page>
  );
}

/**
 * 页头下面那一行：连的是哪个 core、它此刻怎么样；网关在哪个地址、谁能连；这个应用
 * 是哪一版，有新版本时点过去就是「关于」。只有状态和数，不写说明。
 */
function Summary({
  local,
  status,
  ov,
  linked,
}: {
  local: LinkStatus;
  status: CoreStatus | null;
  ov: Overview | null;
  linked: boolean;
}) {
  const t = useText(settingsText);
  const ct = useText(connText);
  const { view } = useConnections();
  const { jump } = useSettingsNav();
  const update = useResource(APP_KEYS.update, settingsApi.update);
  const p = view ? currentProfile(view) : undefined;
  const remote = p && !p.local && view ? remoteStatus(view) : null;
  const state = remote ? linkStatus(remote) : local;
  const name = p ? profileName(p) : ct.local;
  /**
   * 网关地址和侧栏左下角写同一个：连着远程时是这台 Mac 连过去要用的那个（服务器的
   * 主机名加网关端口），不是服务器上绑的 `0.0.0.0`
   */
  const addr = remote && view?.link.kind === "connected" ? remote.addr : (status?.gateway_addr ?? null);
  const scope = ov ? levelOf(ov.listen.bind) : null;
  const offer = update.data?.offer ?? null;

  // 状态、地址换了（刚存完监听、刚连上）：新的那一句淡入，不是原地跳字
  return (
    <>
      <SummaryItem
        lead={<StatusDot tone={state.tone} />}
        value={name}
        label={
          <span key={state.text} className="motion-fade">
            {state.text}
          </span>
        }
      />
      {linked && status && (
        <SummaryItem
          value={
            <span key={addr ?? ""} className="font-mono select-text motion-fade">
              {addr ?? t.notListening}
            </span>
          }
          label={scope === "local" ? t.scopeLocal : scope === "lan" ? t.scopeLan : scope === "all" ? t.scopeAll : ""}
        />
      )}
      {offer ? (
        // 有新版本：点过去就是「关于」，更新的按钮在那里
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-mx-1.5 h-6 px-1.5 font-normal"
          onClick={() => jump("about")}
        >
          <SummaryItem lead={<StatusDot tone="warn" />} value={offer.version} label={t.available} />
        </Button>
      ) : (
        update.data && <SummaryItem label={t.versionIs(update.data.version)} />
      )}
    </>
  );
}

/** 连着远程时两组之间的分隔：这台 Mac 上的应用 / 服务器的配置 */
function ScopeHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="-mb-4 flex items-center gap-2 border-b border-border pb-1.5 tw-label font-medium text-muted-foreground first:mt-0 [&_svg]:size-3.5">
      {icon}
      <span className="truncate">{children}</span>
    </div>
  );
}

/** 改配置文件的两节在拿到概览之前是什么情况 */
type Pending =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "failed"; error: unknown; retrying: boolean; retry: () => void };

/**
 * 改配置文件的两节在概览到之前的样子：在读就是骨架（数据马上到），没连上就说连接后
 * 可修改，读不出来就说出来、给重试 —— 不画一张什么都读不出来的表单。
 */
function Placeholder({
  id,
  title,
  description,
  state,
  rows,
}: {
  id: string;
  title: string;
  description?: string;
  state: Pending;
  rows: number;
}) {
  const kt = useText(kitText);
  return (
    <SettingsGroup id={id} title={title} description={description}>
      <SettingsCard>
        {state.kind === "offline" ? (
          <OfflineRow />
        ) : state.kind === "failed" ? (
          <ErrorRow title={kt.configFailed} error={state.error} retrying={state.retrying} onRetry={state.retry} />
        ) : (
          Array.from({ length: rows }, (_, i) => <RowSkeleton key={i} control={i === 0 ? "w-36" : "w-24"} />)
        )}
      </SettingsCard>
    </SettingsGroup>
  );
}
