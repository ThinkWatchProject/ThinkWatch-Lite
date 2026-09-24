import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { IconRoute } from "@/ui/icons";
import { AnimatedNumber } from "@/ui/motion";
import { undoable } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { EmptyState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Count } from "@/ui/count";
import { useResource } from "@/lib/resource";
import { useText } from "@/i18n";
import { targetLabel } from "@/labels";
import { useNav, useNavParams } from "@/nav";
import type { GroupView, Overview, RouteInput } from "@/types";
import { DeleteDialog } from "@/upstreams/DeleteDialog";
import { api } from "./api";
import type { ChainFocus } from "./chain";
import { ChainMap, useChainFocus } from "./ChainMap";
import { DryRunDialog, type DryRunTarget } from "./DryRunDialog";
import { GroupDialog, type GroupDialogMode } from "./GroupDialog";
import { GroupTable, groupRefs } from "./GroupTable";
import { DeleteRouteDialog, SetDefaultDialog } from "./RouteConfirmDialogs";
import { RouteDialog, type RouteDialogMode } from "./RouteDialog";
import { ProbesTab } from "./ProbesTab";
import { RouteTable } from "./RouteTable";
import { routingText } from "./routing.i18n";
import { routingPageText } from "./RoutingPage.i18n";
import { useFlights } from "./useFlights";

export type RoutingTab = "routes" | "groups" | "probes";

type DialogState =
  | null
  | { kind: "route"; mode: RouteDialogMode }
  | { kind: "set-default"; name: string }
  | { kind: "delete-route"; name: string }
  | { kind: "group"; mode: GroupDialogMode }
  | { kind: "delete-group"; name: string };

/** 刚保存过的那一行：闪一下，说明改动落在了哪儿 */
type Flash = { kind: "route" | "group"; name: string } | null;

/**
 * 路由页：路由、策略组、辅助请求三个标签，顶上是路由图。
 *
 * **路由是配给密钥的**：一把密钥使用一条路由，没指定的使用默认路由。策略组
 * 只被路由规则引用，所以和路由放在同一页，引用关系在页内闭合 —— 和上游页里
 * 代理、价目表的做法一样。列表只读，新建与编辑都在对话框里完成，一次保存
 * 一个配置版本。试算是针对路由的工具，放在页头和行菜单里。
 *
 * **路由图是这一页的全貌**：密钥 → 路由 → 策略组 → 上游。悬停表格的一行，图上经过它
 * 的路亮起来；悬停图上的节点，表格里对应的那一行也亮。
 */
export default function RoutingPage({
  ov,
  onChanged,
  onOpenConfigFile,
}: {
  ov: Overview;
  onChanged: () => void;
  onOpenConfigFile: (focus: string | null) => void;
}) {
  const t = useText(routingPageText);
  const rt = useText(routingText);
  const nav = useNav();
  const [tab, setTab] = useState<RoutingTab>("routes");
  const [dialog, setDialog] = useState<DialogState>(null);
  // 试算叠在路由对话框上面时，两个要同时开着 —— 单独一份状态
  const [dryRun, setDryRun] = useState<DryRunTarget | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const hover = useChainFocus();
  // 挂在页上，不挂在图上：切到「辅助请求」再切回来，在途的请求还在
  const flights = useFlights();
  // 命令面板和别的页送来的：打开这一页上的对话框，和点按钮、点那一行一样（见 nav.tsx）
  useNavParams("routing", (p) => {
    if (p.editRoute && ov.routes.some((r) => r.name === p.editRoute)) {
      setTab("routes");
      setDialog({ kind: "route", mode: { kind: "edit", name: p.editRoute } });
    } else if (p.editGroup && ov.groups.some((g) => g.name === p.editGroup)) {
      setTab("groups");
      setDialog({ kind: "group", mode: { kind: "edit", name: p.editGroup } });
    } else if (p.create) {
      setTab(p.create === "group" ? "groups" : "routes");
      setDialog({ kind: p.create, mode: { kind: "create" } });
    } else if (p.dryRun) {
      setTab("routes");
      setDryRun({ kind: "key" });
    }
  });

  // 模型建议（规则条件、改写参数、试算）。拿不到不影响任何功能，照常可以手写，所以
  // 失败时什么都不画。**跟着各上游的模型清单重读**，不只是配置版本：后台问完一个
  // 上游，建议里就该有它的模型
  const catalogKey = ov.providers.map((p) => `${p.name}:${p.model_source}:${p.model_count}`).join("|");
  const known = useResource("known-models", () => api.knownModels(), { deps: [ov.config_version, catalogKey] });
  const models = known.data ?? [];

  // 「优先使用」的乐观值：请求发出去就先画成新的，概览读回来一致了再撤掉
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  const [busyGroups, setBusyGroups] = useState<ReadonlySet<string>>(new Set());
  const view = useMemo<Overview>(() => {
    const names = Object.keys(picks);
    if (names.length === 0) return ov;
    return { ...ov, groups: ov.groups.map((g) => (g.name in picks ? { ...g, selected: picks[g.name] } : g)) };
  }, [ov, picks]);
  useEffect(() => {
    setPicks((p) => {
      const left = Object.entries(p).filter(([name, sel]) => ov.groups.find((g) => g.name === name)?.selected !== sel);
      return left.length === Object.keys(p).length ? p : Object.fromEntries(left);
    });
  }, [ov]);

  /**
   * 写配置用的版本号。**跟着写入的回执走**：撤销那一下要带的是刚写完的版本，而概览
   * 还没来得及读回来。
   */
  const version = useRef(ov.config_version);
  useEffect(() => {
    version.current = ov.config_version;
  }, [ov.config_version]);

  useEffect(() => {
    if (!flash) return;
    const h = setTimeout(() => setFlash(null), 1_000);
    return () => clearTimeout(h);
  }, [flash]);

  const done = (saved?: Flash) => {
    setDialog(null);
    onChanged();
    if (saved) setFlash(saved);
  };

  async function prefer(g: GroupView, provider: string) {
    const prev = g.selected ?? null;
    if (prev === provider) return;
    const mark = (on: boolean) =>
      setBusyGroups((s) => {
        const n = new Set(s);
        if (on) n.add(g.name);
        else n.delete(g.name);
        return n;
      });
    const pick = (sel: string | null) => setPicks((p) => ({ ...p, [g.name]: sel }));
    const unpick = () =>
      setPicks((p) => {
        const { [g.name]: _, ...rest } = p;
        return rest;
      });
    const write = async (selected: string | null) => {
      const res = await api.updateGroup(g.name, {
        group: { name: g.name, kind: g.kind, providers: g.providers, selected, session_affinity: g.session_affinity },
        base_version: version.current,
      });
      version.current = res.version;
    };
    mark(true);
    await undoable({
      message: t.preferred(targetLabel(g.name), provider),
      apply: () => {
        pick(provider);
        return unpick;
      },
      do: () => write(provider),
      undo: async () => {
        mark(true);
        pick(prev);
        try {
          await write(prev);
        } catch (e) {
          unpick();
          throw e;
        } finally {
          mark(false);
        }
      },
      after: onChanged,
    });
    mark(false);
  }

  function openNode(f: ChainFocus) {
    switch (f.kind) {
      case "key":
        nav.open("keys", { key: f.name });
        return;
      case "upstream":
        nav.open("upstreams", { upstream: f.name });
        return;
      case "route":
        setDialog({ kind: "route", mode: { kind: "edit", name: f.name } });
        return;
      case "group":
        setDialog({ kind: "group", mode: { kind: "edit", name: f.name } });
        return;
    }
  }

  if (ov.providers.length === 0) {
    return (
      <Page>
        <PageHeader title={t.title} />
        <EmptyState
          icon={<IconRoute />}
          title={t.noUpstreams}
          description={t.noUpstreamsDesc}
          action={
            <Button size="sm" onClick={() => nav.open("upstreams")}>
              {rt.showUpstreams}
            </Button>
          }
        />
      </Page>
    );
  }

  const ruleCount = view.routes.reduce((n, r) => n + r.rules.length, 0);
  const shadowed = view.routes.reduce((n, r) => n + r.rules.filter((x) => x.shadowed).length, 0);
  const noCatchAll = view.routes.filter((r) => !r.has_catch_all).length;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as RoutingTab)} className="gap-0">
      <Page>
        <PageHeader
          title={t.title}
          summary={
            <>
              <SummaryItem value={<AnimatedNumber value={view.routes.length} />} label={t.routesUnit(view.routes.length)} />
              <SummaryItem value={<AnimatedNumber value={ruleCount} />} label={t.rulesUnit(ruleCount)} />
              <SummaryItem value={<AnimatedNumber value={view.groups.length} />} label={t.groupsUnit(view.groups.length)} />
              {shadowed > 0 && (
                <SummaryItem lead={<StatusDot tone="warn" />} value={shadowed} label={t.shadowedUnit(shadowed)} />
              )}
              {noCatchAll > 0 && (
                <SummaryItem lead={<StatusDot tone="warn" />} value={noCatchAll} label={t.noCatchAllUnit(noCatchAll)} />
              )}
              {shadowed === 0 && noCatchAll === 0 && (
                <SummaryItem lead={<StatusDot tone="ok" />} label={t.allInEffect} />
              )}
            </>
          }
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setDryRun({ kind: "key" })}>
                <FlaskConicalIcon />
                {rt.dryRun}
              </Button>
              {tab === "routes" && (
                <Button size="sm" onClick={() => setDialog({ kind: "route", mode: { kind: "create" } })}>
                  <PlusIcon />
                  {rt.newRoute}
                </Button>
              )}
              {tab === "groups" && (
                <Button size="sm" onClick={() => setDialog({ kind: "group", mode: { kind: "create" } })}>
                  <PlusIcon />
                  {rt.newGroup}
                </Button>
              )}
            </>
          }
          tabs={
            <TabsList variant="line">
              <TabsTrigger value="routes">
                {t.routes}
                <Count n={view.routes.length} />
              </TabsTrigger>
              <TabsTrigger value="groups">
                {t.groups}
                <Count n={view.groups.length} />
              </TabsTrigger>
              {/* 请求先过这一层，剩下的才轮到规则 —— 所以它和规则同页 */}
              <TabsTrigger value="probes">{t.probes}</TabsTrigger>
            </TabsList>
          }
        />

        {/* 路由、策略组两个标签共用一张图：换标签时它不动，只换下面的表 */}
        {tab !== "probes" && (
          <ChainMap
            className="mt-4"
            ov={view}
            flights={flights}
            focus={hover.focus}
            onEnter={hover.enter}
            onLeave={hover.leave}
            onOpen={openNode}
          />
        )}

        <TabsContent value="routes" className="pt-4">
          <RouteTable
            ov={view}
            focus={hover.focus}
            onEnter={hover.enter}
            onLeave={hover.leave}
            flash={flash?.kind === "route" ? flash.name : null}
            actions={{
              edit: (name) => setDialog({ kind: "route", mode: { kind: "edit", name } }),
              dryRun: (name) => setDryRun({ kind: "route", name }),
              duplicate: (name) => setDialog({ kind: "route", mode: { kind: "duplicate", from: name } }),
              setDefault: (name) => setDialog({ kind: "set-default", name }),
              locate: (name) => onOpenConfigFile(name),
              remove: (name) => setDialog({ kind: "delete-route", name }),
            }}
          />
        </TabsContent>

        <TabsContent value="groups" className="pt-4">
          <GroupTable
            ov={view}
            focus={hover.focus}
            onEnter={hover.enter}
            onLeave={hover.leave}
            flash={flash?.kind === "group" ? flash.name : null}
            busy={busyGroups}
            actions={{
              create: () => setDialog({ kind: "group", mode: { kind: "create" } }),
              edit: (name) => setDialog({ kind: "group", mode: { kind: "edit", name } }),
              prefer: (g, p) => void prefer(g, p),
              duplicate: (name) => setDialog({ kind: "group", mode: { kind: "duplicate", from: name } }),
              locate: (name) => onOpenConfigFile(name),
              remove: (name) => setDialog({ kind: "delete-group", name }),
              showUpstreams: () => nav.open("upstreams"),
            }}
          />
        </TabsContent>

        <TabsContent value="probes" className="pt-4">
          <ProbesTab ov={view} />
        </TabsContent>
      </Page>

      {dialog?.kind === "route" && (
        <RouteDialog
          mode={dialog.mode}
          ov={view}
          models={models}
          configVersion={view.config_version}
          onChanged={onChanged}
          onClose={() => setDialog(null)}
          onSaved={(name) => done({ kind: "route", name })}
          onDryRun={(route: RouteInput, keys: string[]) => setDryRun({ kind: "draft", route, keys })}
        />
      )}
      {dialog?.kind === "set-default" && (
        <SetDefaultDialog
          ov={view}
          name={dialog.name}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.setDefaultRoute(dialog.name, view.config_version);
            done({ kind: "route", name: dialog.name });
          }}
        />
      )}
      {dialog?.kind === "delete-route" && (
        <DeleteRouteDialog
          ov={view}
          name={dialog.name}
          onClose={() => setDialog(null)}
          onConfirm={async (reassignTo) => {
            await api.deleteRoute(dialog.name, view.config_version, reassignTo);
            done();
          }}
        />
      )}
      {dialog?.kind === "group" && (
        <GroupDialog
          mode={dialog.mode}
          ov={view}
          configVersion={view.config_version}
          onClose={() => setDialog(null)}
          onSaved={(name) => done({ kind: "group", name })}
        />
      )}
      {dialog?.kind === "delete-group" && (
        <DeleteDialog
          what={t.group}
          name={dialog.name}
          referrers={groupRefs(view, dialog.name).map((r) => ({
            kind: "reference" as const,
            ref: { kind: "rule_target" as const, route: r.route, rule: r.rule },
          }))}
          consequence={t.deleteGroupConsequence}
          onDelete={async () => {
            await api.deleteGroup(dialog.name, view.config_version);
            done();
          }}
          onClose={() => setDialog(null)}
          onShow={(r) => {
            if (r.kind !== "reference" || r.ref.kind === "group") return;
            setTab("routes");
            setDialog({ kind: "route", mode: { kind: "edit", name: r.ref.route } });
          }}
        />
      )}
      {dryRun && <DryRunDialog target={dryRun} ov={view} models={models} onClose={() => setDryRun(null)} />}
    </Tabs>
  );
}
