import { useEffect, useMemo, useState } from "react";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { IconClient } from "@/ui/icons";
import { AnimatedNumber, Reveal } from "@/ui/motion";
import { notify, undoable } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, Loadable } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { useNav, useNavParams } from "@/nav";
import { usd, type ClientView, type KeyInput, type Overview } from "@/types";
import { useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { useClients } from "@/clients/data";
import { api } from "./api";
import { CreatedDialog } from "./CreatedDialog";
import { useConfigVersion, useGatewayBase, useKeys, useKeyUsage, useKnownModels, type KeyUse } from "./data";
import { DeleteDialog } from "./DeleteDialog";
import { KeyDialog } from "./KeyDialog";
import { KeysTable } from "./KeysTable";
import { keysPageText } from "./KeysPage.i18n";
import { takeoverOf } from "./labels";
import { RowsSkeleton } from "./parts";
import { RotateDialog } from "./RotateDialog";

type DialogState =
  | null
  | { kind: "edit"; name: string | null }
  | { kind: "rotate"; name: string }
  /**
   * 删的那一把**连同它的样子一起记下**：删成功之后它就从列表里拿掉了，对话框还要
   * 放完自己的收起动画
   */
  | { kind: "delete"; target: ClientView }
  | { kind: "created"; name: string };

/**
 * 网关密钥。
 *
 * **客户端连网关必须带一把**，本机也不例外。每把的值原样显示、旁边一个复制
 * 按钮；接管客户端时生成的那几把单独标出来，写明是给谁的。
 *
 * **自己一页，挨着客户端。**用户来这一页只为一件事：拿一把密钥、看它给了谁、
 * 还有没有在用。页头一行是总数和 24 小时的用量，每一行右边是那把的小柱图。
 *
 * 只读，改任何东西都在对话框里完成；能不能删、改名要不要带着规则一起改、
 * 更换要同步给谁，都由 core 判断 —— 界面只负责把话说清楚。停用、启用、设为
 * 默认可以撤销，不弹确认；删除要确认。
 */
export default function KeysPage({
  ov,
  busy,
  onChanged,
  onOpenConfigFile,
}: {
  ov: Overview;
  /** 此刻有请求在跑的密钥 */
  busy: ReadonlySet<string>;
  onChanged: () => void;
  onOpenConfigFile: (focus: string | null) => void;
}) {
  const t = useText(keysPageText);
  const title = useText(appText).surfaces.keys;
  const nav = useNav();
  const version = useConfigVersion(ov.config_version);
  const keys = useKeys(ov.config_version);
  const usage = useKeyUsage();
  const clients = useClients();
  const catalog = useKnownModels();
  const gateway = useGatewayBase();
  const [dialog, setDialog] = useState<DialogState>(null);

  const list = keys.data;
  const detected = clients.data?.clients ?? [];
  const manual = clients.data?.manual ?? [];

  /*
    从别的页点过来的那一把（客户端页的密钥名）：那一行出现了就滚过去、底色亮一下。
    参数一次送达只回调一次，行还没到的话先记着
  */
  const [focus, setFocus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  useNavParams("keys", (p) => {
    setFocus(p.key ?? null);
    // 命令面板送来的：打开这一页上的对话框，和点「新建密钥」、点那一行一样（见 nav.tsx）
    if (p.edit) setDialog({ kind: "edit", name: p.edit });
    else if (p.create) setDialog({ kind: "edit", name: null });
  });
  useEffect(() => {
    if (!focus || !list?.some((k) => k.name === focus)) return;
    document.querySelector(`[data-row="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" });
    setHighlight(focus);
    setFocus(null);
  }, [focus, list]);
  useEffect(() => {
    if (!highlight) return;
    const h = setTimeout(() => setHighlight(null), 1600);
    return () => clearTimeout(h);
  }, [highlight]);

  /** 写完一次：记下新版本，重读列表，告诉外壳（概览跟着重读） */
  function wrote(v: string) {
    version.set(v);
    void keys.reload();
    onChanged();
  }

  async function copy(name: string, quiet?: boolean) {
    try {
      await api.copyKey(name);
      if (!quiet) notify.success(t.copied(name));
    } catch (e) {
      notify.error(e);
      throw e;
    }
  }

  /** 停用、启用。**可以撤销**：先改界面，再写；toast 上给撤销 */
  function toggle(k: ClientView) {
    const next = !k.disabled;
    const write = async (disabled: boolean) => {
      const w = await api.updateKey(k.name, { key: inputOf(k, { disabled }), base_version: version.get() });
      wrote(w.version);
    };
    void undoable({
      message: next ? t.disabledToast(k.name) : t.enabledToast(k.name),
      apply: () => keys.mutate((ks) => (ks ?? []).map((x) => (x.name === k.name ? { ...x, disabled: next } : x))),
      do: () => write(next),
      undo: () => write(!next),
    });
  }

  /** 设为默认。**可以撤销**：撤销就是把原来那一把设回去 */
  function makeDefault(name: string) {
    const before = list?.find((k) => k.default)?.name;
    const write = async (to: string) => {
      const w = await api.setDefaultKey(to, version.get());
      wrote(w.version);
    };
    const mark = (to: string) => (ks: ClientView[] | undefined) => (ks ?? []).map((k) => ({ ...k, default: k.name === to }));
    if (!before) {
      void write(name).catch((e) => notify.error(e));
      return;
    }
    void undoable({
      message: t.madeDefault(name),
      apply: () => keys.mutate(mark(name)),
      do: () => write(name),
      undo: () => write(before),
    });
  }

  const byName = (name: string) => list?.find((k) => k.name === name);
  const editing = dialog?.kind === "edit" && dialog.name ? byName(dialog.name) : null;
  const rotating = dialog?.kind === "rotate" ? byName(dialog.name) : undefined;
  const deleting = dialog?.kind === "delete" ? dialog.target : undefined;
  // 只有一把默认密钥时，这一页要回答的是「接下来做什么」
  const onlyDefault = list?.length === 1 && list[0]?.default === true;

  return (
    <Page className="@container/page">
      <PageHeader
        title={title}
        summary={<Summary keys={list} loading={keys.loading} usage={usage.byKey} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => nav.open("clients")}>
              {t.connectClient}
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: "edit", name: null })}>
              <PlusIcon />
              {t.newKey}
            </Button>
          </>
        }
      />

      <Loadable
        r={keys}
        loading={<RowsSkeleton rows={4} cols={5} />}
        errorTitle={t.loadFailed}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={<KeyRoundIcon />}
            title={t.noKeys}
            description={t.noKeysHint}
            action={
              <Button size="sm" onClick={() => setDialog({ kind: "edit", name: null })}>
                <PlusIcon />
                {t.newKey}
              </Button>
            }
          />
        }
      >
        {(data) => (
          <>
            <KeysTable
              keys={data}
              clients={detected}
              manual={manual}
              highlight={highlight}
              usage={usage.byKey}
              busy={busy}
              defaultRoute={ov.default_route}
              catalog={catalog.data ?? []}
              actions={{
                edit: (name) => setDialog({ kind: "edit", name }),
                rotate: (name) => setDialog({ kind: "rotate", name }),
                remove: (name) => {
                  const target = byName(name);
                  if (target) setDialog({ kind: "delete", target });
                },
                copy,
                toggle,
                makeDefault,
                locate: (name) => onOpenConfigFile(name),
              }}
            />
            <Reveal show={onlyDefault}>
              <EmptyState
                variant="outlined"
                className="mt-6"
                icon={<IconClient />}
                title={t.emptyTitle}
                description={t.emptyDescription}
                action={
                  <Button size="sm" onClick={() => nav.open("clients")}>
                    {t.connectClient}
                  </Button>
                }
              />
            </Reveal>
          </>
        )}
      </Loadable>

      {/* 编辑要等那把密钥读到了再开：先开的话对话框按「新建」起了表单，读到之后也不会换 */}
      {dialog?.kind === "edit" && (dialog.name === null || editing) && (
        <KeyDialog
          editing={editing ?? null}
          keys={list ?? []}
          clients={detected}
          manual={manual}
          usage={editing ? usage.byKey?.get(editing.name) : undefined}
          usageLoaded={usage.byKey !== undefined}
          routes={ov.routes}
          defaultRoute={ov.default_route}
          catalog={catalog.data ?? []}
          version={version}
          onClose={() => setDialog(null)}
          onSaved={(name, v) => {
            wrote(v);
            setDialog(dialog.name ? null : { kind: "created", name });
          }}
          onRotate={(name) => setDialog({ kind: "rotate", name })}
        />
      )}

      {rotating && (
        <RotateDialog
          target={rotating}
          clients={detected}
          version={version}
          onClose={() => setDialog(null)}
          onRotated={wrote}
        />
      )}

      {dialog?.kind === "created" && (
        <CreatedDialog
          name={dialog.name}
          value={byName(dialog.name)?.key ?? null}
          gateway={gateway.data ?? null}
          onCopyKey={() => copy(dialog.name, true)}
          onClose={() => setDialog(null)}
        />
      )}

      {deleting && (
        <DeleteDialog
          target={deleting}
          owner={takeoverOf(deleting, detected, manual)}
          onDelete={async () => {
            const w = await api.deleteKey(deleting.name, version.get());
            // 先从列表里拿掉（那一行淡出），再去取真值
            keys.mutate((ks) => (ks ?? []).filter((k) => k.name !== deleting.name));
            wrote(w.version);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </Page>
  );
}

/**
 * 页头那一行：几把密钥、几把在用、停用的有几把，24 小时的请求数和费用。
 *
 * **用量没取到就不写用量**（不写成 0）；24 小时里一个请求都没有时写一句「24 小时内
 * 无请求」，而不是一排零。
 */
function Summary({
  keys,
  loading,
  usage,
}: {
  keys: ClientView[] | undefined;
  /** 列表还在取。**取失败了不画骨架**：下面是一个报错，页头不该还像在等 */
  loading: boolean;
  usage: Map<string, KeyUse> | undefined;
}) {
  const t = useText(keysPageText);
  const totals = useMemo(() => {
    if (!keys || !usage) return null;
    let requests = 0;
    let cost = 0;
    let active = 0;
    for (const k of keys) {
      const u = usage.get(k.name);
      if (!u || u.requests === 0) continue;
      active += 1;
      requests += u.requests;
      cost += u.cost;
    }
    return { requests, cost, active };
  }, [keys, usage]);
  if (!keys) return loading ? <Skeleton className="my-1 h-3 w-64 rounded-sm" /> : null;
  const disabled = keys.filter((k) => k.disabled).length;
  return (
    <>
      <SummaryItem value={<AnimatedNumber value={keys.length} />} label={t.keysUnit(keys.length)} />
      {totals && totals.active > 0 && (
        <SummaryItem
          lead={<StatusDot tone="ok" />}
          value={<AnimatedNumber value={totals.active} />}
          label={t.active}
        />
      )}
      {disabled > 0 && <SummaryItem lead={<StatusDot tone="idle" />} value={disabled} label={t.disabled} />}
      {totals &&
        (totals.requests > 0 ? (
          <>
            <span className="motion-fade whitespace-nowrap">
              {t.requests24h(<AnimatedNumber value={totals.requests} className="font-medium text-foreground" />)}
            </span>
            <span className="motion-fade inline-flex items-center gap-1.5 whitespace-nowrap">
              {t.cost}
              <AnimatedNumber
                value={totals.cost}
                format={(v) => usd(Math.round(v))}
                className="font-medium text-foreground"
              />
            </span>
          </>
        ) : (
          <span className="motion-fade whitespace-nowrap">{t.noRequests24h}</span>
        ))}
    </>
  );
}

/** 一把密钥写回去时的样子：照原样，改其中几项 */
function inputOf(k: ClientView, patch: Partial<KeyInput>): KeyInput {
  return {
    name: k.name,
    route: k.route ?? null,
    allow: k.allow ?? null,
    max_concurrent: k.max_concurrent,
    disabled: k.disabled ?? false,
    ...patch,
  };
}
