import { useEffect, useState } from "react";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { IconRoute } from "@/ui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import type { GroupView, KnownModel, Overview, RouteInput } from "@/types";
import { DeleteDialog } from "@/upstreams/DeleteDialog";
import { errorText } from "@/upstreams/labels";
import { api } from "./api";
import { DryRunDialog, type DryRunTarget } from "./DryRunDialog";
import { GroupDialog, type GroupDialogMode } from "./GroupDialog";
import { GroupTable, groupRefs } from "./GroupTable";
import { DeleteRouteDialog, SetDefaultDialog } from "./RouteConfirmDialogs";
import { RouteDialog, type RouteDialogMode } from "./RouteDialog";
import { RouteTable } from "./RouteTable";

export type RoutingTab = "routes" | "groups";

type DialogState =
  | null
  | { kind: "route"; mode: RouteDialogMode }
  | { kind: "set-default"; name: string }
  | { kind: "delete-route"; name: string }
  | { kind: "group"; mode: GroupDialogMode }
  | { kind: "delete-group"; name: string };

/**
 * 路由页：路由、策略组两个标签。
 *
 * **路由是配给密钥的**：一把密钥使用一条路由，没指定的使用默认路由。策略组
 * 只被路由规则引用，所以和路由放在同一页，引用关系在页内闭合 —— 和上游页里
 * 代理、价目表的做法一样。列表只读，新建与编辑都在对话框里完成，一次保存
 * 一个配置版本。试算是针对路由的工具，放在工具栏和行菜单里。
 */
export default function RoutingPage({
  ov,
  configVersion,
  onChanged,
  onOpenConfigFile,
  onNavigate,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
  onOpenConfigFile: (focus: string | null) => void;
  onNavigate: (tab: string) => void;
}) {
  const [tab, setTab] = useState<RoutingTab>("routes");
  const [dialog, setDialog] = useState<DialogState>(null);
  // 试算叠在路由对话框上面时，两个要同时开着 —— 单独一份状态
  const [dryRun, setDryRun] = useState<DryRunTarget | null>(null);
  const [models, setModels] = useState<KnownModel[]>([]);

  // 模型建议（规则条件、改写参数、试算）。拿不到不影响任何功能，照常可以手写
  useEffect(() => {
    api
      .knownModels()
      .then(setModels)
      .catch(() => {});
  }, [configVersion]);

  const done = () => {
    setDialog(null);
    onChanged();
  };

  async function prefer(g: GroupView, provider: string) {
    try {
      await api.updateGroup(g.name, {
        group: {
          name: g.name,
          kind: g.kind,
          providers: g.providers,
          selected: provider,
          session_affinity: g.session_affinity ?? true,
        },
        base_version: configVersion ?? undefined,
      });
      onChanged();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  if (ov.providers.length === 0) {
    return (
      <div className="p-5">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconRoute />
            </EmptyMedia>
            <EmptyTitle>尚无上游</EmptyTitle>
            <EmptyDescription>
              路由规则将请求转发至上游或策略组。新建上游后，默认路由将请求依次转发至全部上游。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => onNavigate("upstreams")}>
              前往上游页
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <Tabs value={tab} onValueChange={(v) => setTab(v as RoutingTab)}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="routes">
              路由 <Count n={ov.routes.length} />
            </TabsTrigger>
            <TabsTrigger value="groups">
              策略组 <Count n={ov.groups.length} />
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          {tab === "routes" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDryRun({ kind: "key" })}>
                <FlaskConicalIcon />
                试算
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "route", mode: { kind: "create" } })}>
                <PlusIcon />
                新建路由
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setDialog({ kind: "group", mode: { kind: "create" } })}>
              <PlusIcon />
              新建策略组
            </Button>
          )}
        </div>

        <TabsContent value="routes" className="mt-2">
          <RouteTable
            ov={ov}
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

        <TabsContent value="groups" className="mt-2">
          <GroupTable
            ov={ov}
            actions={{
              edit: (name) => setDialog({ kind: "group", mode: { kind: "edit", name } }),
              prefer: (g, p) => void prefer(g, p),
              duplicate: (name) => setDialog({ kind: "group", mode: { kind: "duplicate", from: name } }),
              locate: (name) => onOpenConfigFile(name),
              remove: (name) => setDialog({ kind: "delete-group", name }),
              showUpstreams: () => onNavigate("upstreams"),
            }}
          />
        </TabsContent>
      </Tabs>

      {dialog?.kind === "route" && (
        <RouteDialog
          mode={dialog.mode}
          ov={ov}
          models={models}
          configVersion={configVersion}
          onChanged={onChanged}
          onClose={() => setDialog(null)}
          onSaved={done}
          onDryRun={(route: RouteInput, keys: string[]) => setDryRun({ kind: "draft", route, keys })}
        />
      )}
      {dialog?.kind === "set-default" && (
        <SetDefaultDialog
          ov={ov}
          name={dialog.name}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.setDefaultRoute(dialog.name, configVersion);
            done();
          }}
        />
      )}
      {dialog?.kind === "delete-route" && (
        <DeleteRouteDialog
          ov={ov}
          name={dialog.name}
          onClose={() => setDialog(null)}
          onConfirm={async (reassignTo) => {
            await api.deleteRoute(dialog.name, configVersion, reassignTo);
            done();
          }}
        />
      )}
      {dialog?.kind === "group" && (
        <GroupDialog
          mode={dialog.mode}
          ov={ov}
          configVersion={configVersion}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      )}
      {dialog?.kind === "delete-group" && (
        <DeleteDialog
          what="策略组"
          name={dialog.name}
          referrers={groupRefs(ov, dialog.name).map((r) => ({
            kind: "reference" as const,
            ref: { kind: "rule_target" as const, route: r.route, rule: r.rule },
          }))}
          consequence="删除后，此策略组将从配置文件中移除，可在版本历史中恢复。"
          onDelete={async () => {
            await api.deleteGroup(dialog.name, configVersion);
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
      {dryRun && <DryRunDialog target={dryRun} ov={ov} models={models} onClose={() => setDryRun(null)} />}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tw-label tabular-nums text-muted-foreground">{n}</span>;
}
