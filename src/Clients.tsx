import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import type {
  AdoptResponse,
  ClientsResponse,
  DetectedClient,
  FindingView,
  PlanView,
} from "./types";
import { Button } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { toast } from "sonner";
import { useCoreEvent } from "./useCoreEvent";
import { fieldsOnlyText, takesEffectText } from "./labels";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { clientsText } from "./Clients.i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";

/**
 * 客户端接管页。
 *
 * 这是整个应用里唯一会去改**用户其他软件**配置的地方，所以这一页的
 * 每一处交互都是按「让他敢按下去、也退得回来」设计的：
 *
 * - 接管前必须看到 diff。**没有一键接管按钮** —— 那种按钮顺手到
 *   没有人会记得先看看要改什么。
 * - 接管的代价（Remote Control 被禁用之类）在确认框里就列出来，
 *   不等用户自己撞上（那些不是我们的 bug，但他会算到我们头上）。
 * - 接管完成后**不宣布成功**，只说「已接管，等第一个请求」。
 *   我们改了一个文件，但那个文件有没有被读到，只有请求能证明。
 */
export default function Clients() {
  const t = useText(clientsText);
  const common = useText(commonText);
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ p: PlanView; c: DetectedClient; restore: boolean } | null>(
    null,
  );
  const [done, setDone] = useState<AdoptResponse | null>(null);
  const [why, setWhy] = useState<{ id: string; found: FindingView[] } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 「不限还原」按了一次，等第二次确认。**不弹浏览器的 confirm** ——
   * 这个项目里所有破坏性操作都走自己的确认界面（接管走 diff 弹窗） */
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await invoke<ClientsResponse>("list_clients"));
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(typeof e === "string" ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    这一页有两件事会变，而它们各自都有事件：

    · **磁盘上那几个配置文件被改了** —— 用户在编辑器里把地址改回去，
      接管状态就该跟着变。core 盯着那几个目录，改动会报 `clients_changed`。
    · **第一个真实请求到了** —— 「已验证」这个标记等的就是它，而它可能
      几分钟后才来。

    原来两件事都靠每 5 秒重扫一遍磁盘来发现。空闲的机器上那是每分钟
    十二次白扫，而用户多半根本没打开这一页。
  */
  useCoreEvent(
    ["clients_changed", "request_finished", "request_failed", "request_cancelled"],
    () => void load(),
    3_000,
  );

  async function ask(c: DetectedClient, restore: boolean) {
    setBusy(true);
    setError(null);
    try {
      const p = await invoke<PlanView>(restore ? "plan_restore" : "plan_adopt", {
        client: c.id,
      });
      setPlan({ p, c, restore });
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    try {
      /*
        **密钥由 core 备好**：每个被接管的客户端有它自己的一把。

        以前这一步在界面里做 —— 先生成一个值、再拼两行 YAML 写进配置、
        再接管。三次调用之间任何一次失败，留下的都是「客户端配了一把
        config.yaml 里没有的钥匙」。现在 core 在落盘那一步一并处理：
        为这个客户端留着的那把（包括取消接管后留下的）直接复用，
        一把也没有才新建。
      */
      const r = await invoke<AdoptResponse>(plan.restore ? "restore_client" : "adopt_client", {
        client: plan.c.id,
      });
      setPlan(null);
      setDone(r);
      await load();
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }

  async function diagnose(id: string) {
    setBusy(true);
    try {
      setWhy({ id, found: await invoke<FindingView[]>("diagnose_client", { client: id }) });
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <div className="p-5 tw-head text-muted-foreground">{error ?? t.scanning}</div>;
  }

  const here = data.clients.filter((c) => c.installed);
  const gone = data.clients.filter((c) => !c.installed);

  return (
    <div className="space-y-5 p-5">
      

      <div className="flex items-start justify-between gap-4">
        <div className="tw-body text-muted-foreground">
          {t.intro(<code>{data.gateway_base}</code>)}
        </div>
        {/*
          **退路要一直看得见**。用户敢按下「接管」的前提，就是
          看得见怎么退回去 —— 藏在二级菜单里的退路等于没有退路，他会在
          心里给接管打上「不可逆」的标签，然后犹豫。
        */}
        {data.clients.some((c) => c.adopted_at_ms !== null) &&
          (confirmAll ? (
            <div className="flex shrink-0 items-center gap-2 tw-body">
              <span className="text-amber-700 dark:text-amber-400">
                {t.restoreAllWarning(data.clients.filter((c) => c.adopted_at_ms !== null).length)}
              </span>
              <Button
                variant="default"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setConfirmAll(false);
                  setBusy(true);
                  try {
                    const rs = await invoke<{ client: string; ok: boolean; detail: string }[]>(
                      "restore_all",
                    );
                    const bad = rs.filter((r) => !r.ok);
                    // **一个失败不影响其余的**，所以逐条报，不能只说「失败了」
                    if (bad.length === 0) {
                      toast.success(t.restoredAll(rs.length));
                    } else {
                      toast.error(t.restoreFailed(bad));
                    }
                    await load();
                  } catch (e) {
                    toast.error(typeof e === "string" ? e : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t.confirmRestoreAll}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAll(false)}
              >
                {common.cancel}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={busy}
              onClick={() => setConfirmAll(true)}
            >
              {t.restoreAll}
            </Button>
          ))}
      </div>

      {/*
        一个都没装的时候，「这里空空如也」是句废话。**空状态
        永远在回答「接下来该做什么」** —— 而这一页的答案是「装一个，
        或者手动把端点指过来」。
      */}
      {here.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t.noneTitle}</EmptyTitle>
            <EmptyDescription>
              {t.runOnce((s) => (
                <Tip text={t.runOnceTip}>
                  <span className="underline decoration-dotted underline-offset-2">{s}</span>
                </Tip>
              ))}
              <br />
              {t.manualEndpoint(
                <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                  {data.gateway_base}
                </code>,
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {here.map((c) => (
        <Card key={c.id} c={c} busy={busy} onAsk={ask} onWhy={diagnose} />
      ))}

      {gone.length > 0 && (
        <details className="tw-body text-muted-foreground">
          <summary className="cursor-pointer">{t.notDetected(gone.length)}</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {gone.map((c) => (
              <li key={c.id}>
                {t.notFound(c.name, <code>{c.path}</code>)}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* **不假装能接管。**显示成「已接管」会让用户以为所有流量都在我们这儿 */}
      <div className="rounded border border-border p-3">
        <div className="mb-2 tw-body font-medium">{t.manual}</div>
        <ul className="space-y-2 tw-body text-muted-foreground">
          {data.manual.map((m) => (
            <li key={m.name}>
              <span className="font-medium text-foreground">{m.name}</span>
              <div>{m.how}</div>
              <div className="text-muted-foreground">{m.caveat}</div>
            </li>
          ))}
        </ul>
      </div>

      {plan && <PlanDialog {...plan} busy={busy} onCancel={() => setPlan(null)} onConfirm={confirm} />}
      {done && <DoneDialog r={done} onClose={() => setDone(null)} />}
      {why && <WhyDialog found={why.found} onClose={() => setWhy(null)} />}
    </div>
  );
}

function Card({
  c,
  busy,
  onAsk,
  onWhy,
}: {
  c: DetectedClient;
  busy: boolean;
  onAsk: (c: DetectedClient, restore: boolean) => void;
  onWhy: (id: string) => void;
}) {
  const t = useText(clientsText);
  const adopted = c.adopted_at_ms != null;
  // **「已接管」和「已生效」是两回事。**只有请求能证明后者
  const verified = adopted && c.last_seen_ms != null && c.last_seen_ms > (c.adopted_at_ms ?? 0);
  const silentFor = adopted && !verified ? Date.now() - (c.adopted_at_ms ?? 0) : 0;
  // 需要重开终端的客户端不催 —— 用户可能一整天都没重开过，
  // 那时弹「是不是没生效」是狼来了
  const nagging = c.warns_when_silent && silentFor > 5 * 60 * 1000;

  return (
    <div className="rounded border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="tw-head font-medium">{c.name}</span>
        {verified ? (
          <Badge variant="success">{t.verified}</Badge>
        ) : adopted ? (
          <Badge variant="warning">{t.waiting}</Badge>
        ) : (
          <Badge variant="secondary">{t.notConnected}</Badge>
        )}
        <div className="ml-auto flex gap-1">
          {adopted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onWhy(c.id)}
              disabled={busy}
            >
              {/* 已经收到过它的请求了还问「为什么没生效」，读起来像是我们
                  自己都不信刚才那个「已验证」 */}
              {verified ? t.checkChain : t.diagnose}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAsk(c, adopted)}
            disabled={busy}
          >
            {adopted ? t.restore : t.connectMenu}
          </Button>
        </div>
      </div>

      <div className="mt-1 space-y-0.5 tw-body text-muted-foreground">
        <div>
          <code>{c.real}</code>
          {/* 用户以为在改 ~/.claude/settings.json，实际写的可能是他
              dotfiles 仓库里的那份 —— 而那是个会被 git 提交的地方 */}
          {c.real !== c.path && <span className="ml-1">{t.symlink(c.path)}</span>}
        </div>
        {c.endpoint && <div>{t.pointsTo(c.endpoint)}</div>}
        {c.takes_effect === "on_restart" && <div>{takesEffectText(c.takes_effect)}</div>}
        {/* 「只查证过字段名」说的是这些字段还没在本机跑过。**接管之后
            收到了请求，就是在本机跑通了** —— 这时再说「尚未验证」，
            和上面那个「已验证」自相矛盾 */}
        {c.verified === "fields_only" && !verified && <div>ⓘ {fieldsOnlyText()}</div>}
        {c.shadows.map((s) => (
          <div key={s} className="text-amber-600 dark:text-amber-400">
            ⚠ {t.shadowed(s)}
          </div>
        ))}
        {nagging && (
          <div className="text-amber-600 dark:text-amber-400">
            {t.silent}
          </div>
        )}
      </div>
    </div>
  );
}


/**
 * 这几屏共用的对话框外壳。
 *
 * **原来是手写的 `fixed inset-0` 浮层。**它缺的东西和另外三处一模一样:
 * Esc 关不掉、Tab 会跑到背景里去、打开时焦点不进来、关上之后焦点不回到
 * 触发它的那个按钮、读屏软件不知道这是个对话框。每一件都能自己补,而四
 * 份手写的实现里一定有几份是错的。
 *
 * `title` 是新收的参数:shadcn 的 `DialogContent` 要求必须有
 * `DialogTitle`,那正是读屏软件念出来的那一句。
 */
function Shell({
  title,
  children,
  onClose,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** 接管前的确认。**这一步不能省** —— 我们要改的是他别的软件的配置。 */
function PlanDialog({
  p,
  c,
  restore,
  busy,
  onCancel,
  onConfirm,
}: {
  p: PlanView;
  c: DetectedClient;
  restore: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  return (
    <Shell onClose={onCancel} title={t.planTitle(restore, c.name)}>
      <div className="mt-1 tw-body text-muted-foreground">
        {t.modifies(<code>{p.path}</code>)}
      </div>

      {p.noop ? (
        <div className="mt-3 tw-body">{t.noop}</div>
      ) : (
        <>
          {p.fields.length > 0 && (
            <ul className="mt-3 space-y-0.5 tw-body">
              {p.fields.map((f) => (
                <li key={`${f.op} ${f.path}`}>
                  {f.op === "remove" ? t.removeField : t.setField}
                  <code>{f.path}</code>
                  {/* 没有值的是网关密钥或一整段结构，摘要里不展开 */}
                  {f.value != null && (
                    <>
                      {" = "}
                      <code>{f.value}</code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* 接管的代价要在这里列出来，不能等用户自己发现 */}
          {p.notes.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-4 tw-body text-muted-foreground">
              {p.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          <Diff before={p.before} after={p.after} />

          <div className="mt-3 tw-body text-muted-foreground">
            {t.backup}
            {p.carries_secret && t.secretMasked}
          </div>
        </>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {common.cancel}
        </Button>
        {!p.noop && (
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {restore ? t.restore : t.confirmConnect}
          </Button>
        )}
      </div>
    </Shell>
  );
}

/**
 * 逐行 diff。
 *
 * **删掉的行必须留在它原来的位置上。**第一版把所有删除行提到最前面，
 * 于是「给 MY_OWN 那行末尾加了个逗号」被画成「你的 MY_OWN 被删了，
 * 另外新增了一行」——用户看到自己的字段带着删除线出现在最上面，正是
 * 这个对话框本来要消除的那种恐慌。
 *
 * 所以用最长公共子序列：没动的行原地不动，改动的行紧挨着显示。
 */
function Diff({ before, after }: { before: string | null; after: string }) {
  const a = (before ?? "").split("\n");
  const b = after.split("\n");

  // LCS 表。配置文件都是几十行，O(n·m) 完全够用。
  // 摊平成一维的 Uint32Array —— 二维数组每次下标访问在
  // noUncheckedIndexedAccess 下都是 `number | undefined`
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  const line = (xs: string[], k: number) => xs[k] ?? "";
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        line(a, i) === line(b, j)
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const rows: { text: string; kind: "add" | "del" | "same" }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (line(a, i) === line(b, j)) {
      rows.push({ text: line(a, i), kind: "same" });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      rows.push({ text: line(a, i), kind: "del" });
      i++;
    } else {
      rows.push({ text: line(b, j), kind: "add" });
      j++;
    }
  }
  while (i < n) rows.push({ text: line(a, i++), kind: "del" });
  while (j < m) rows.push({ text: line(b, j++), kind: "add" });

  return (
    <pre className="mt-3 max-h-72 overflow-auto rounded bg-neutral-50 p-2 tw-label leading-relaxed dark:bg-neutral-950">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.kind === "add"
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
              : r.kind === "del"
                ? "bg-red-50 text-red-900 line-through dark:bg-red-950/50 dark:text-red-300"
                : "text-muted-foreground"
          }
        >
          {r.kind === "add" ? "+ " : r.kind === "del" ? "- " : "  "}
          {r.text}
        </div>
      ))}
    </pre>
  );
}

/** 接管完成。**不说「成功」** —— 只有请求能证明它真的生效了。 */
function DoneDialog({ r, onClose }: { r: AdoptResponse; onClose: () => void }) {
  const t = useText(clientsText);
  const common = useText(commonText);
  return (
    <Shell onClose={onClose} title={t.doneTitle}>
      <div className="mt-2 space-y-1 tw-body text-muted-foreground">
        <div>{takesEffectText(r.takes_effect)}</div>
        <div>
          {t.modified(<code>{r.real}</code>)}
        </div>
        <div>
          {t.backedUp(<code>{r.backup}</code>)}
        </div>
        {r.warnings.map((w) => (
          <div key={w} className="text-amber-600 dark:text-amber-400">
            ⚠ {w}
          </div>
        ))}
        <div className="pt-1">
          {t.provenByRequest}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {common.close}
        </Button>
      </div>
    </Shell>
  );
}

/** 优先级链的诊断结果。**查干净的也要说出来**，而不是让那一项消失。 */
function WhyDialog({ found, onClose }: { found: FindingView[]; onClose: () => void }) {
  const t = useText(clientsText);
  const common = useText(commonText);
  return (
    <Shell onClose={onClose} title={t.whyTitle}>
      <ul className="mt-3 space-y-2 tw-body">
        {found.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={
                f.level === "blocking"
                  ? "text-red-600 dark:text-red-400"
                  : f.level === "suspect"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
              }
            >
              {f.level === "blocking" ? "✗" : f.level === "suspect" ? "?" : "✓"}
            </span>
            <div>
              <div className="font-medium">{f.title}</div>
              <div className="text-muted-foreground">{f.detail}</div>
              {/* 命令给出来，执行与否是他的事 */}
              {f.fix && (
                <code className="mt-1 block rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
                  {f.fix}
                </code>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {common.close}
        </Button>
      </div>
    </Shell>
  );
}
