import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { PlusIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { IconPlugin } from "@/ui/icons";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { undoable } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { RowMenu, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ListSkeleton, Loadable } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tip } from "@/ui/tip";
import { useResource } from "@/lib/resource";
import { writeQueue } from "@/lib/writeQueue";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { useNav, useNavParams } from "@/nav";
import { useConfigVersion } from "@/keys/data";
import type { Overview } from "@/types";
import { PLUGIN_FAILED, pluginCall, type PluginView, type PluginWrite } from "./api.provisional";
import { ChangedDialog } from "./ChangedDialog";
import { DeleteDialog, ReorderDialog } from "./ListDialogs";
import { LogsDialog } from "./LogsDialog";
import { PermissionChips, PluginText, ScopeSummary, StatsCell, StatusOf } from "./parts";
import { pluginsPageText } from "./PluginsPage.i18n";
import { SettingsDialog } from "./SettingsDialog";
import { SourceDialog, type NativeWrite } from "./SourceDialog";
import { TrialDialog } from "./TrialDialog";

type DialogState =
  | null
  | { kind: "add" }
  | { kind: "settings"; id: string }
  | { kind: "replace"; id: string }
  | { kind: "review"; id: string }
  | { kind: "trial"; id: string }
  | { kind: "logs"; id: string }
  | { kind: "reorder" }
  /** 删的那一个连同它的样子一起记下：删成功之后它从列表里拿掉了，对话框还要放完收起动画 */
  | { kind: "delete"; target: PluginView };

/** 插件写回去时的样子：照原样，改其中几项 */
export function updateOf(p: PluginView) {
  return { enabled: p.enabled, on_error: p.on_error, scope: p.scope, settings: p.settings };
}

/**
 * 插件页。
 *
 * 插件是一段 JavaScript：请求发往上游之前改写请求，回答交给客户端之前改写回答。它只在
 * core 的沙箱里运行，**从不在这个界面里运行**。这一页列出装着的插件（按运行的顺序）、各自
 * 的状态和权限，以及进入其余一切的入口：安装、设置、试运行、日志、确认文件变更、删除。
 *
 * 几条纪律：
 *
 * - **插件写的字一律按纯文本画**（名字、说明、设置项的标签、日志、报错），见 `PluginText`。
 * - **安装、更换代码、确认文件变更要在系统原生对话框里点头**：这三步的端点不在网页的
 *   白名单里，只能请 Rust 去做（`plugin_install` 等）。网页里的「安装」只是发起。
 * - 配置的改动都进对话框；启用、停用可以撤销，一按就写；删除要确认。
 * - **不在运行、又会拒绝请求的插件挂一条横幅**：文件变了或者加载不了的插件不运行，出错时
 *   选了「拒绝」的，适用范围内的请求全部被拒 —— 这件事要一直看得见，直到处理掉。
 */
export default function PluginsPage({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const t = useText(pluginsPageText);
  const nav = useNav();
  const version = useConfigVersion(ov.config_version);
  /** 这一页上的写入排成一队：连着拨两个开关，第二次带第一次写完的版本（见 writeQueue） */
  const queue = useMemo(() => writeQueue(version), [version]);
  /*
    **统计跟着请求走。**运行次数、改写次数在请求落地时变，所以请求事件也让它重读（节流
    2.5 秒）；core 那边是内存里的数，读一次很便宜。
  */
  const plugins = useResource("plugins", () => pluginCall("Plugins", null), {
    events: ["config_reloaded", "request_finished", "request_failed", PLUGIN_FAILED],
    deps: [ov.config_version],
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState<Record<string, number>>({});
  const list = plugins.data;
  const byId = (id: string) => list?.find((p) => p.id === id);

  /** 写完一次：记下新版本，重读列表，告诉外壳（概览跟着重读） */
  const wrote = useCallback(
    (v: string) => {
      version.set(v);
      void plugins.reload();
      onChanged();
    },
    [version, plugins, onChanged],
  );

  /**
   * 要原生确认的写入：照样排进队里。用户在系统对话框里取消的，版本号不变、什么都没写
   */
  const native: NativeWrite = useCallback(
    async (run: (base: string) => Promise<PluginWrite>) => {
      let cancelled = false;
      const w = await queue(async (base) => {
        const r = await run(base);
        if (r.kind === "cancelled") {
          cancelled = true;
          return { version: base };
        }
        return { version: r.version };
      });
      if (cancelled) return "cancelled";
      wrote(w.version);
      return "done";
    },
    [queue, wrote],
  );

  // 从别处来的：定位一个插件、添加、审核文件变更（命令面板、通知）
  const [focus, setFocus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  useNavParams("plugins", (p) => {
    setFocus(p.plugin ?? null);
    if (p.add) setDialog({ kind: "add" });
    else if (p.review) setDialog({ kind: "review", id: p.review });
  });
  useEffect(() => {
    if (!focus || !list?.some((p) => p.id === focus)) return;
    document.querySelector(`[data-plugin="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" });
    setHighlight(focus);
    setFocus(null);
  }, [focus, list]);
  useEffect(() => {
    if (!highlight) return;
    const h = setTimeout(() => setHighlight(null), 1600);
    return () => clearTimeout(h);
  }, [highlight]);

  async function tracked<T>(id: string, run: () => Promise<T>): Promise<T> {
    setPending((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
    try {
      return await run();
    } finally {
      setPending((p) => ({ ...p, [id]: Math.max(0, (p[id] ?? 0) - 1) }));
    }
  }

  /** 启用、停用。**可以撤销**：先拨过去，写完给「撤销」 */
  function toggle(p: PluginView, enabled: boolean) {
    const send = (on: boolean) =>
      tracked(p.id, async () => {
        const w = await queue((base) =>
          pluginCall("UpdatePlugin", { ...updateOf(p), enabled: on, base_version: base }, p.id),
        );
        wrote(w.version);
      });
    const name = <PluginText text={p.name} />;
    void undoable({
      message: enabled ? t.turnedOn(name) : t.turnedOff(name),
      apply: () => plugins.mutate((ps) => (ps ?? []).map((x) => (x.id === p.id ? { ...x, enabled } : x))),
      do: () => send(enabled),
      undo: () => send(!enabled),
    });
  }

  const taken = (list ?? []).map((p) => p.id);
  const at = (d: { id: string }) => byId(d.id);

  return (
    <Page>
      <PageHeader
        summary={<Summary list={list} loading={plugins.loading} />}
        actions={
          <>
            {list && list.length > 1 && (
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "reorder" })}>
                {t.reorder}
              </Button>
            )}
            <Button size="sm" onClick={() => setDialog({ kind: "add" })}>
              <PlusIcon />
              {t.add}
            </Button>
          </>
        }
      />

      <Loadable
        r={plugins}
        loading={<ListSkeleton rows={3} />}
        errorTitle={t.loadFailed}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={<IconPlugin />}
            title={t.emptyTitle}
            description={t.emptyDescription}
            action={
              <Button size="sm" onClick={() => setDialog({ kind: "add" })}>
                <PlusIcon />
                {t.add}
              </Button>
            }
          />
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <Stopped list={data} onReview={(id) => setDialog({ kind: "review", id })} onReplace={(id) => setDialog({ kind: "replace", id })} />
            <PluginList
              list={data}
              highlight={highlight}
              pending={(id) => (pending[id] ?? 0) > 0}
              onToggle={toggle}
              onOpen={(kind, p) => setDialog(kind === "delete" ? { kind, target: p } : { kind, id: p.id })}
            />
          </div>
        )}
      </Loadable>

      {dialog?.kind === "add" && (
        <SourceDialog
          mode={{ kind: "add" }}
          taken={taken}
          native={native}
          onClose={() => setDialog(null)}
          onDone={(id) => {
            setDialog(null);
            setFocus(id);
          }}
        />
      )}
      {dialog?.kind === "replace" && at(dialog) && (
        <SourceDialog
          mode={{ kind: "replace", plugin: at(dialog)! }}
          taken={taken}
          native={native}
          onClose={() => setDialog(null)}
          onDone={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "settings" && at(dialog) && (
        <SettingsDialog
          plugin={at(dialog)!}
          version={version}
          onClose={() => setDialog(null)}
          onSaved={(v) => {
            wrote(v);
            setDialog(null);
          }}
          onReplace={() => setDialog({ kind: "replace", id: dialog.id })}
        />
      )}
      {dialog?.kind === "review" && at(dialog) && (
        <ChangedDialog
          plugin={at(dialog)!}
          native={native}
          onClose={() => setDialog(null)}
          onApproved={() => setDialog(null)}
          onReplace={() => setDialog({ kind: "replace", id: dialog.id })}
        />
      )}
      {dialog?.kind === "trial" && at(dialog) && <TrialDialog plugin={at(dialog)!} onClose={() => setDialog(null)} />}
      {dialog?.kind === "logs" && at(dialog) && (
        <LogsDialog
          plugin={at(dialog)!}
          onClose={() => setDialog(null)}
          onOpenRequest={(id) => {
            setDialog(null);
            nav.open("requests", { request: id });
          }}
        />
      )}
      {dialog?.kind === "reorder" && list && (
        <ReorderDialog
          list={list}
          onClose={() => setDialog(null)}
          onSave={async (ids) => {
            const w = await queue((base) => pluginCall("ReorderPlugins", { ids, base_version: base }));
            plugins.mutate((ps) => ids.map((id) => (ps ?? []).find((p) => p.id === id)!).filter(Boolean));
            wrote(w.version);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          target={dialog.target}
          onClose={() => setDialog(null)}
          onDelete={async () => {
            const w = await queue((base) => pluginCall("DeletePlugin", { base_version: base }, dialog.target.id));
            // 先从列表里拿掉（那一行淡出），再去取真值
            plugins.mutate((ps) => (ps ?? []).filter((p) => p.id !== dialog.target.id));
            wrote(w.version);
          }}
        />
      )}
    </Page>
  );
}

/**
 * 页头一行：几个插件，几个生效中、停用、文件已更改、加载失败（和行上的状态点同色）。
 */
function Summary({ list, loading }: { list: PluginView[] | undefined; loading: boolean }) {
  const t = useText(pluginsPageText);
  if (!list) return loading ? <Skeleton className="my-1 h-3 w-48 rounded-sm" /> : null;
  const count = (kind: PluginView["status"]["kind"]) => list.filter((p) => p.status.kind === kind).length;
  const items: [number, "ok" | "idle" | "warn" | "error", string][] = [
    [count("ok"), "ok", t.active],
    [count("disabled"), "idle", t.disabled],
    [count("changed"), "warn", t.changed],
    [count("error"), "error", t.failed],
  ];
  return (
    <>
      <SummaryItem value={<AnimatedNumber value={list.length} />} label={t.pluginsUnit(list.length)} />
      {items
        .filter(([n]) => n > 0)
        .map(([n, tone, label]) => (
          <SummaryItem key={label} lead={<StatusDot tone={tone} />} value={n} label={label} />
        ))}
    </>
  );
}

/**
 * 启用着、却没在运行的插件：文件变了，或者加载不了。**选了「拒绝这次请求」的，适用范围内的
 * 请求此刻全被拒绝** —— 一条一直在的横幅，按钮直接通到处理它的那个对话框。选了「跳过」的
 * 不拒请求，只是没在运行，用灰色的那一档。
 */
function Stopped({
  list,
  onReview,
  onReplace,
}: {
  list: PluginView[];
  onReview: (id: string) => void;
  onReplace: (id: string) => void;
}) {
  const t = useText(pluginsPageText);
  const stopped = list.filter((p) => p.enabled && (p.status.kind === "changed" || p.status.kind === "error"));
  if (stopped.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {stopped.map((p) => {
        const reject = p.on_error === "reject";
        const name = <PluginText text={p.name} />;
        if (p.status.kind === "changed") {
          return (
            <Banner
              key={p.id}
              layout="inline"
              tone={reject ? "warning" : "info"}
              title={t.changedTitle(name)}
              actions={
                <Button size="sm" variant="outline" onClick={() => onReview(p.id)}>
                  {t.review}
                </Button>
              }
            >
              {reject ? t.changedRejecting : t.changedSkipping}
            </Banner>
          );
        }
        return (
          <Banner
            key={p.id}
            layout="inline"
            tone={reject ? "error" : "info"}
            title={t.failedTitle(name)}
            actions={
              <Button size="sm" variant="outline" onClick={() => onReplace(p.id)}>
                {t.replace}
              </Button>
            }
          >
            {p.status.kind === "error" && (
              <p className="break-words select-text">
                <PluginText text={p.status.message} />
              </p>
            )}
            <p>{reject ? t.failedRejecting : t.failedSkipping}</p>
          </Banner>
        );
      })}
    </div>
  );
}

type RowAction = "settings" | "trial" | "logs" | "review" | "replace" | "delete";

/**
 * 插件列表，**按运行的顺序**：前一个改过的内容交给后一个，所以行首写着它是第几个。
 *
 * 每一行三行字：名字和状态；说明（加载失败的是原因）；权限、适用范围、运行统计。右边是
 * 启用的开关，和**写成字的几个操作**（设置、试运行、日志、删除）—— 不用图标：这一页上
 * 每个操作都要一眼认得出，`…` 里藏着的东西用户想不到去找。文件变了的、加载不了的，
 * 处理它的那个操作排在最前面。点一行（或回车）打开设置；右键是同一份操作。
 */
function PluginList({
  list,
  highlight,
  pending,
  onToggle,
  onOpen,
}: {
  list: PluginView[];
  highlight: string | null;
  pending: (id: string) => boolean;
  onToggle: (p: PluginView, enabled: boolean) => void;
  onOpen: (kind: RowAction, p: PluginView) => void;
}) {
  const t = useText(pluginsPageText);
  const rows = usePresentList(list, (p) => p.id);
  const menu = (p: PluginView): MenuItems => [
    ...(p.status.kind === "changed" ? [{ kind: "item" as const, label: t.menu.review, onSelect: () => onOpen("review", p) }] : []),
    { kind: "item", label: t.menu.settings, onSelect: () => onOpen("settings", p) },
    { kind: "item", label: t.menu.trial, onSelect: () => onOpen("trial", p), disabled: p.status.kind === "error" },
    { kind: "item", label: t.menu.logs, onSelect: () => onOpen("logs", p) },
    { kind: "item", label: t.menu.replace, onSelect: () => onOpen("replace", p) },
    { kind: "sep" },
    { kind: "item", label: t.menu.remove, onSelect: () => onOpen("delete", p), danger: true },
  ];
  return (
    <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
      {rows.map(({ item: p, key, presence }, i) => (
        <RowMenu key={key} items={menu(p)}>
          <li
            data-plugin={p.id}
            className={cn(
              "flex cursor-default gap-3 border-b border-border px-4 py-3 outline-none last:border-b-0",
              "transition-colors duration-(--motion-fast) hover:bg-muted/30",
              "focus-visible:bg-muted/60 focus-visible:shadow-[inset_2px_0_0_0_var(--ring)]",
              highlight === p.id && "bg-muted/60",
              rowMotion(presence),
            )}
            {...openable(() => onOpen("settings", p))}
          >
            <Tip text={t.order(i + 1)}>
              <span className="mt-px w-4 shrink-0 text-right tw-num tw-body text-muted-foreground">{i + 1}</span>
            </Tip>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5">
                <PluginText
                  text={p.name}
                  className={cn("min-w-0 truncate tw-head", p.enabled ? "text-foreground" : "text-muted-foreground")}
                />
                <StatusOf status={p.status} />
              </div>
              {p.status.kind === "error" ? (
                <p className="mt-0.5 truncate tw-body text-destructive">
                  <PluginText text={p.status.message} />
                </p>
              ) : (
                p.description && (
                  <p className="mt-0.5 truncate tw-body text-muted-foreground">
                    <PluginText text={p.description} />
                  </p>
                )
              )}
              {/*
                权限、适用范围、统计在左，写成字的操作在右。**窗口窄时操作整组折到下一行**（靠右），
                不去挤名字和状态
              */}
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 tw-label">
                <PermissionChips permissions={p.permissions} />
                <span className="flex min-w-0 max-w-[260px] items-center gap-1">
                  <span className="shrink-0 text-muted-foreground/80">{t.appliesTo}</span>
                  <ScopeSummary scope={p.scope} permissions={p.permissions} />
                </span>
                <StatsCell stats={p.stats} />
                <span className="-my-1 -mr-2 ml-auto flex shrink-0 items-center" {...keepInRow}>
                  {p.status.kind === "changed" && (
                    <Button size="xs" variant="outline" className="mr-1" onClick={() => onOpen("review", p)}>
                      {t.review}
                    </Button>
                  )}
                  {p.status.kind === "error" && (
                    <Button size="xs" variant="outline" className="mr-1" onClick={() => onOpen("replace", p)}>
                      {t.replace}
                    </Button>
                  )}
                  <RowWord onClick={() => onOpen("settings", p)}>{t.settings}</RowWord>
                  <RowWord onClick={() => onOpen("trial", p)} disabled={p.status.kind === "error"}>
                    {t.trial}
                  </RowWord>
                  <RowWord onClick={() => onOpen("logs", p)}>{t.logs}</RowWord>
                  <RowWord onClick={() => onOpen("delete", p)} danger>
                    {t.remove}
                  </RowWord>
                </span>
              </div>
            </div>
            <div className="shrink-0 pt-0.5" {...keepInRow}>
              <Switch
                size="sm"
                checked={p.enabled}
                pending={pending(p.id)}
                aria-label={t.toggleFor(p.name)}
                onCheckedChange={(v) => onToggle(p, v)}
              />
            </div>
          </li>
        </RowMenu>
      ))}
    </ul>
  );
}

/** 行上写成字的一个操作。灰字，悬停变实；删除悬停是红的 */
function RowWord({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: string;
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={cn("font-normal text-muted-foreground hover:text-foreground", danger && "hover:text-destructive")}
    >
      {children}
    </Button>
  );
}

/** 可以点开的一行：单击、回车、空格打开。**选中文字不算点击**；行里的按钮不冒泡上来 */
function openable(open: () => void) {
  return {
    tabIndex: 0,
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  };
}

/** 行里自己能点的那一块（开关、操作）：点击和按键不再冒泡成「打开这一行」 */
const keepInRow = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
};
