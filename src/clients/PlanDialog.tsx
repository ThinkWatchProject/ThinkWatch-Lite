import { useId, useMemo, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Reveal } from "@/ui/motion";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useNav } from "@/nav";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { BedrockDraft, DesktopRule, DetectedClient, FieldChange, ModelChoice, PinnedModel, PlanView } from "@/types";
import { ClientMark, DISCLOSURE, Tile, useDialogFocus } from "@/keys/parts";
import { clientsText } from "./clients.i18n";

/**
 * 接管、还原之前的确认。**这一步不能省** —— 要改的是用户其他软件的配置。
 *
 * 顺序是用户要做决定的顺序：改哪个文件、改哪几项（密钥写成「新密钥 xxx」或
 * 「密钥 xxx」，新建和沿用对用户是两件事）、有什么要知道的；完整的改动默认
 * 收起 —— 需要逐行核对的人点开，其余的人不必读一段配置文件。
 *
 * 按下确认之后对话框留着、按钮转圈，写完才关；失败时对话框还在，可以再试。
 * 确认之后不再弹第二个对话框：行上的状态会变成「等待首个请求」。
 *
 * Claude Desktop 在网关没有它认的模型时（`plan.desktop_rule.pick`），先选它用哪个上游模型，
 * 再在「网关配置」里写明加在它密钥上的那条规则；还原时写明删掉它。
 */
export function PlanDialog({
  plan,
  client,
  restore,
  stale = null,
  pending,
  bedrockUpstreams = [],
  onCancel,
  onConfirm,
}: {
  plan: PlanView;
  client: DetectedClient;
  restore: boolean;
  /**
   * 刚才确认时什么都没写，这一份是重算的：`files` 是文件已经被改过，`gateway` 是网关
   * 可用的模型变了
   */
  stale?: "files" | "gateway" | null;
  pending: boolean;
  /** 网关里已有的 Bedrock 上游（名字）。客户端原来直连 Bedrock 时要说有没有 */
  bedrockUpstreams?: string[];
  onCancel: () => void;
  /** `model`：给 Claude Desktop 选的模型（要选时） */
  onConfirm: (model?: string) => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  const dialogFocus = useDialogFocus();
  const [diffOpen, setDiffOpen] = useState(false);
  // 同一次改动里的另外几份文件（DeepSeek Harness 的凭据文件、Claude Desktop 的
  // 另外三个）：字段接在后面，完整改动按文件分开画。已经是目标状态的不列
  const also = (plan.also ?? []).filter((a) => !a.noop);
  const fields = [...plan.fields, ...also.flatMap((a) => a.fields)];
  const path = <code className="font-mono text-foreground">{plan.path}</code>;
  const rule = plan.desktop_rule ?? null;
  const pick = restore ? null : (rule?.pick ?? null);
  const choices = pick?.choices ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  // 重算过的一份里没有刚才选的那个：回到默认的那个
  const choice = choices.find((c) => c.model === picked) ?? defaultChoice(rule, choices);
  const to = choice ? pinnedOf(choice) : null;
  // 网关上要不要改：还原删、要选时和已有的不一样才写、不用选时删已有的
  const ruleChanges = restore ? rule != null : pick ? to != null && !samePinned(to, rule?.current) : rule?.current != null;
  const noop = plan.noop && !ruleChanges;
  const modelId = useId();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        {...dialogFocus}
        // 要选模型时焦点落在对话框本身：落进下拉框的话，它带一圈焦点框，方向键也会悄悄换掉模型
        onOpenAutoFocus={(e) => {
          if (!pick) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader className="flex-row items-center gap-3">
          <Tile className="size-9 rounded-lg [&_svg]:size-[18px]">
            <ClientMark id={client.id} name={client.name} size={18} />
          </Tile>
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle>{restore ? t.restoreTitle(client.name) : t.adoptTitle(client.name)}</DialogTitle>
            <DialogDescription>
              {plan.before == null ? t.creates(path) : t.modifies(path)}
              {also.map((a) => {
                const p = <code className="font-mono text-foreground">{a.path}</code>;
                return (
                  <span key={a.path} className="block">
                    {a.deletes ? t.alsoDeletes(p) : a.before == null ? t.alsoCreates(p) : t.alsoModifies(p)}
                  </span>
                );
              })}
            </DialogDescription>
          </div>
        </DialogHeader>

        <Banner layout="inline" tone="warning" show={stale != null}>
          {stale === "gateway" ? t.staleGateway : t.stale}
        </Banner>

        {noop ? (
          <p className="tw-body">{t.noop}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {pick && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3.5 py-3">
                <label className="tw-head" htmlFor={modelId}>
                  {t.desktopModel}
                </label>
                <p className="tw-label text-muted-foreground">
                  {choices.length > 0 ? t.desktopModelHint : t.desktopNoModels}
                </p>
                {choices.length > 0 && (
                  <NativeSelect
                    id={modelId}
                    className="w-[360px] max-w-full"
                    value={choice?.model ?? ""}
                    disabled={pending}
                    onChange={(e) => setPicked(e.target.value)}
                  >
                    {choices.map((c) => (
                      <NativeSelectOption key={c.model} value={c.model}>
                        {t.desktopChoice(c.model, c.providers)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </div>
            )}

            {fields.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t.field}</TableHead>
                      <TableHead>{restore ? t.change : t.written}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* 同名的字段可能在两个文件里各有一项（Claude Desktop 的 deploymentMode） */}
                    {fields.map((f, i) => (
                      <TableRow key={`${i} ${f.op} ${f.path}`} className="hover:bg-transparent">
                        <TableCell className="font-mono tw-label">{f.path}</TableCell>
                        <TableCell className="whitespace-normal break-all">
                          <FieldValue f={f} plan={plan} restore={restore} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {rule && (ruleChanges || (pick && to)) && (
              <GatewayRule rule={rule} to={pick ? to : null} restore={restore} />
            )}

            {!restore && plan.bedrock && (
              <BedrockOffer
                draft={plan.bedrock}
                client={client.name}
                existing={bedrockUpstreams}
                disabled={pending}
              />
            )}

            {(plan.notes.length > 0 || (restore && plan.key)) && (
              <div className="flex flex-col gap-1">
                <p className="tw-head">{t.notes}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 tw-body text-muted-foreground">
                  {plan.notes.map((n, i) => (
                    <li key={i}>{coreText(n)}</li>
                  ))}
                  {restore && plan.key && <li>{t.keepsKey(plan.key)}</li>}
                </ul>
              </div>
            )}

            <div>
              <Button
                variant="ghost"
                size="xs"
                className={cn("-ml-1.5 gap-1 px-1.5 text-muted-foreground aria-expanded:text-muted-foreground", DISCLOSURE)}
                aria-expanded={diffOpen}
                onClick={() => setDiffOpen((o) => !o)}
              >
                <ChevronRightIcon className={cn("motion-bar", diffOpen && "rotate-90")} />
                {t.diff}
              </Button>
              <Reveal show={diffOpen}>
                {also.length > 0 && <p className="mt-2 font-mono tw-label text-muted-foreground">{plan.path}</p>}
                <Diff before={plan.before} after={plan.after} />
                {also.map((a) => (
                  <div key={a.path}>
                    <p className="mt-3 font-mono tw-label text-muted-foreground">{a.path}</p>
                    <Diff before={a.before} after={a.deletes ? "" : a.after} />
                  </div>
                ))}
                {plan.carries_secret && <p className="mt-1.5 tw-label text-muted-foreground">{t.secretMasked}</p>}
              </Reveal>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {common.cancel}
          </Button>
          {!noop && (
            <Button
              variant={restore ? "destructive" : "default"}
              pending={pending}
              onClick={() => onConfirm(pick && choice ? choice.model : undefined)}
            >
              {restore ? t.confirmRestore : t.confirmAdopt}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 默认选哪个：已有的规则指定的那个还在就是它，否则是网关列出的第一个 */
function defaultChoice(rule: DesktopRule | null, choices: ModelChoice[]): ModelChoice | null {
  const now = rule?.current?.[0]?.model;
  return choices.find((c) => c.model === now) ?? choices[0] ?? null;
}

/** 选了这个模型时规则的去向：提供它的每一家，按顺序备用（和 Rust 侧 `desktop_rule::pinned` 一样） */
function pinnedOf(c: ModelChoice): PinnedModel[] {
  return c.providers.map((provider) => ({ provider, model: c.model }));
}

function samePinned(a: PinnedModel[], b: PinnedModel[] | null | undefined): boolean {
  return b != null && a.length === b.length && a.every((p, i) => p.provider === b[i]?.provider && p.model === b[i]?.model);
}

/**
 * 「网关配置」：Claude Desktop 的密钥上那条规则在哪、写的什么。`to` 是接管时要指定的模型；
 * 为空是删掉已有的那条（还原，或者网关已经有它认的模型了）
 */
function GatewayRule({ rule, to, restore }: { rule: DesktopRule; to: PinnedModel[] | null; restore: boolean }) {
  const t = useText(clientsText);
  const shown = to ?? rule.current ?? [];
  const key = <code className="font-mono">{rule.key}</code>;
  // 一个「上游 · 模型」不从中间折开，折在几个之间
  const models = shown.map((p, i) => (
    <span key={`${p.provider} ${p.model}`}>
      {i > 0 && t.pinnedJoin}
      <span className="whitespace-nowrap">
        {p.provider} · <code className="font-mono">{p.model}</code>
      </span>
    </span>
  ));
  const foot = restore
    ? null
    : to == null
      ? t.ruleUnneeded
      : rule.current != null && !samePinned(to, rule.current)
        ? t.ruleChanged
        : t.ruleAdded;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="tw-head">{t.gatewayChange}</p>
      <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-3 rounded-lg border border-border px-3 py-2 tw-body">
        <span className="text-muted-foreground">{t.rulePlace(rule.route, rule.position)}</span>
        <span className="break-words">
          {to == null ? t.ruleDelete(rule.name, key, models) : t.ruleText(rule.name, key, models)}
        </span>
      </div>
      {foot && <p className="tw-label text-muted-foreground">{foot}</p>}
    </div>
  );
}

/**
 * 客户端原来直连 Bedrock：网关里有没有 Bedrock 上游，和按它原来的设置新建一个的入口。
 *
 * 新建走上游页自己的那个对话框（深链带上 `draft` 预填），**不在这里另开一个**：对话框只有
 * 一份，在上游页里。凭据只有 `${变量名}` 和 profile 的名字，这里照原样显示。
 */
function BedrockOffer({
  draft,
  client,
  existing,
  disabled,
}: {
  draft: BedrockDraft;
  client: string;
  existing: string[];
  disabled: boolean;
}) {
  const t = useText(clientsText);
  const nav = useNav();
  const a = draft.auth;
  const parts = [
    t.bedrockRegion(draft.region),
    ...(draft.base_url ? [t.bedrockAddress(draft.base_url)] : []),
    a.kind === "key"
      ? t.bedrockKey(a.key)
      : a.kind === "keys"
        ? t.bedrockKeys(a.access_key_id)
        : a.kind === "profile"
          ? t.bedrockProfile(a.profile)
          : t.bedrockNoCredential,
  ];
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-1 tw-body">
        <p>{existing.length > 0 ? t.bedrockSome(existing) : t.bedrockNone(client)}</p>
        <p className="break-words text-muted-foreground">{t.bedrockDraft(client, parts)}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={disabled}
        onClick={() => nav.open("upstreams", { create: "upstream", draft })}
      >
        {t.bedrockCreate}
      </Button>
    </div>
  );
}

/** 一项改动写成什么：密钥写名字，删除写「删除」，其余写值 */
function FieldValue({ f, plan, restore }: { f: FieldChange; plan: PlanView; restore: boolean }) {
  const t = useText(clientsText);
  if (f.op === "remove") return <span className="text-muted-foreground">{t.remove}</span>;
  if (f.secret) {
    const name = plan.key ?? "";
    return <span>{plan.key_created && !restore ? t.newKey(name) : t.keyNamed(name)}</span>;
  }
  if (restore) return <span className="font-mono tw-label">{t.restoreTo(literal(f.value ?? ""))}</span>;
  return <span className="font-mono tw-label">{literal(f.value ?? "")}</span>;
}

/**
 * 写进去的值怎么显示。**空串写成 `""`**：Claude Code 的云服务商开关接管时写成空串，
 * 照原样画出来是一格空白，看不出写了什么
 */
function literal(v: string): string {
  return v === "" ? '""' : v;
}

/**
 * 逐行 diff。
 *
 * **删掉的行必须留在它原来的位置上。**第一版把所有删除行提到最前面，
 * 于是「给 MY_OWN 那行末尾加了个逗号」被画成「你的 MY_OWN 被删了，
 * 另外新增了一行」—— 用户看到自己的字段带着删除线出现在最上面，正是
 * 这个对话框本来要消除的那种恐慌。
 *
 * 所以用最长公共子序列：没动的行原地不动，改动的行紧挨着显示。
 */
export function Diff({ before, after }: { before: string | null; after: string }) {
  const rows = useMemo(() => diffRows(before ?? "", after), [before, after]);
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-surface p-2 font-mono tw-label leading-relaxed">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.kind === "add"
              ? "bg-success/10 text-success-foreground"
              : r.kind === "del"
                ? "bg-destructive/8 text-destructive-foreground line-through"
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

export type DiffRow = { text: string; kind: "add" | "del" | "same" };

/**
 * [`Diff`] 画的那几行。
 *
 * **两头相同的行先摘掉，只拿中间那段做 LCS。**两头相同的行本来就一定在最长公共子序列
 * 里，摘掉不改结果；而 MCP 页拿来比的是整份 `~/.claude.json`，几千行里只动了一段 ——
 * 整份做 O(n·m) 的表，两千行是 16 MB、一两百毫秒，八千行是 256 MB、两秒多，窗口就卡在那儿。
 */
export function diffRows(before: string, after: string): DiffRow[] {
  const all = before.split("\n");
  const bll = after.split("\n");
  let head = 0;
  while (head < all.length && head < bll.length && all[head] === bll[head]) head++;
  let tail = 0;
  while (
    tail < all.length - head &&
    tail < bll.length - head &&
    all[all.length - 1 - tail] === bll[bll.length - 1 - tail]
  )
    tail++;
  const a = all.slice(head, all.length - tail);
  const b = bll.slice(head, bll.length - tail);

  // LCS 表，只为中间那段。摊平成一维的 Uint32Array —— 二维数组每次下标访问在
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
  const rows: DiffRow[] = all.slice(0, head).map((text) => ({ text, kind: "same" }));
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
  for (const text of all.slice(all.length - tail)) rows.push({ text, kind: "same" });
  return rows;
}
