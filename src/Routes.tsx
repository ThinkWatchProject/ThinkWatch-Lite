import { useId, useState } from "react";
import { Tip } from "@/ui/tip";
import { Checkbox } from "@/ui/checkbox";
import { Field, FieldLabel } from "@/ui/field";
import type { Overview, PatchOp, RouteView } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { toast } from "sonner";
import { patchConfig } from "./patch";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";

/**
 * 路由。
 *
 * **一条路由是一组按顺序求值的规则,一把密钥绑一条。**默认路由是
 * 「没绑定时走的那条」,不是「所有人都要过的那条」—— 这个区别是整个
 * 模型的支点:前者意味着求值永远只看一张规则表。
 *
 * 在此之前这一页只能看不能建:`to` 能通过策略组的下拉改,而 `when` 的
 * 十三个条件、`set`、`deny`、`guard` 不限只读,新建一条规则更无从谈起。
 * **一个只能查看的路由页,等于没有路由这个功能。**
 */
export default function Routes({
  ov,
  configVersion,
  onChanged,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<RouteView | null>(null);
  const [addRuleTo, setAddRuleTo] = useState<string | null>(null);

  const routes = ov.routes ?? [];
  const defaultRoute = ov.default_route ?? "默认";
  const targets = [
    ...ov.groups.map((g) => [g.name, `${g.name}（组）`] as const),
    ...ov.providers.map((p) => [p.name, p.name] as const),
  ];

  async function patch(ops: PatchOp[], tag: string) {
    if (!configVersion) {
      toast.error("还没读到配置版本，稍等一下再试");
      return false;
    }
    setBusy(tag);
    try {
      await patchConfig(ops, configVersion);
      onChanged();
      return true;
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-5">
      {/*
        默认路由单独一块,因为它在模型里就是单独的一个字段
        （顶层的 `default_route`）—— 不是某条路由身上的标志。
      */}
      {/* 标题 + 一个操作 + 一句说明 —— Card 的形状 */}
      <Card className="py-3">
        <CardHeader className="gap-1 px-3">
          <CardTitle className="tw-head font-normal">默认路由</CardTitle>
          <CardAction>
          <NativeSelect
            size="sm"
            value={defaultRoute}
            disabled={busy === "default"}
            onChange={(e) =>
              void patch(
                [{ op: "replace", path: "/default_route", value: e.target.value }],
                "default",
              )
            }
          >
            {routes.map((r) => (
              <NativeSelectOption key={r.name} value={r.name}>
                {r.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          </CardAction>
          <CardDescription>
            没绑路由的密钥走这条。<b>不是所有人都要过的那条。</b>
          </CardDescription>
        </CardHeader>
      </Card>

      <section>
        <div className="flex items-baseline gap-3">
          <p className="tw-body text-muted-foreground">
            一条路由里，从上往下匹配，第一条命中的决定去向。
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setAdding(true)}
          >
            新建路由
          </Button>
        </div>

        {adding && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-input p-2">
            <Input
              className="flex-1"
              autoFocus
              value={newName}
              placeholder="路由名，比如 长上下文"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <Button
              size="sm"
              disabled={busy === "new" || !newName.trim()}
              onClick={async () => {
                const n = newName.trim();
                if (routes.some((r) => r.name === n)) {
                  toast.error(`已经有一条叫「${n}」的路由了`);
                  return;
                }
                // **新路由带一条兜底规则。**空路由是个合法但没用的状态：
                // 绑上它的密钥会一条规则都匹配不到，请求不限失败，而
                // 配置看起来是好的。
                const first = targets[0]?.[0];
                if (!first) {
                  toast.error("还没有任何上游 —— 先去「网关」加一个。");
                  return;
                }
                const ok = await patch(
                  [
                    {
                      op: "append",
                      path: "/routes",
                      item: `name: ${n}\nrules:\n  - name: 兜底\n    to: ${first}`,
                    },
                  ],
                  "new",
                );
                if (ok) {
                  setAdding(false);
                  setNewName("");
                }
              }}
            >
              建
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              取消
            </Button>
          </div>
        )}

        <div className="mt-3 space-y-3">
          {routes.map((r) => (
            <div
              key={r.name}
              className="rounded-lg border border-border"
            >
              <div className="flex items-baseline gap-2 border-b border-border px-3 py-2">
                <span className="tw-head">{r.name}</span>
                {r.default && (
                  <span className="rounded bg-neutral-200 px-1.5 tw-label dark:bg-neutral-800">
                    默认
                  </span>
                )}
                <span className="tw-label text-muted-foreground">
                  {/*
                    绑了这条的密钥。默认路由这里通常是空的 —— 走它的人是
                    「没绑」,不是「绑了它」。把这件事说出来,否则空白读起来
                    像是「未被引用」。
                  */}
                  {r.clients.length > 0
                    ? `${r.clients.join("、")} 绑了它`
                    : r.default
                      ? "没绑路由的密钥走它"
                      : "还没有密钥绑它"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setAddRuleTo(r.name)}
                >
                  加规则
                </Button>
                <Tip
                  text={
                    r.default
                      ? "默认路由不可删除，请先将默认路由指向其他路由。"
                      : r.clients.length > 0
                        ? `还有 ${r.clients.length} 把密钥绑着它，删了它们会退回默认路由。`
                        : "删掉这条路由。"
                  }
                >
                  <Button
                    variant="destructive"
                    size="xs"
                    disabled={r.default}
                    onClick={() => setConfirmDelete(r)}
                  >
                    删除
                  </Button>
                </Tip>
              </div>

              {addRuleTo === r.name && (
                <NewRule
                  route={r.name}
                  targets={targets}
                  busy={busy === `rule-${r.name}`}
                  onCancel={() => setAddRuleTo(null)}
                  onCreate={async (item) => {
                    const ok = await patch(
                      [{ op: "append", path: `/routes/${r.name}/rules`, item }],
                      `rule-${r.name}`,
                    );
                    if (ok) setAddRuleTo(null);
                  }}
                />
              )}

              <ol className="divide-y divide-neutral-100 dark:divide-neutral-900">
                {r.rules.map((rule, i) => (
                  <li
                    key={rule.name}
                    className="flex items-baseline gap-3 px-3 py-1.5 tw-body"
                  >
                    <span className="w-4 shrink-0 text-neutral-400">{i + 1}</span>
                    <span className="font-medium">{rule.name}</span>
                    <span className="text-muted-foreground">
                      {rule.conditions.length === 0 ? (
                        // 兜底规则要标出来。少了它，用户会以为「没有兜底」
                        // 而反复调试一条其实一直在生效的规则。
                        <span className="rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-800">
                          兜底
                        </span>
                      ) : (
                        rule.conditions.join(" 且 ")
                      )}
                    </span>
                    <span className="ml-auto font-mono text-muted-foreground">
                      → {rule.to}
                    </span>
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={busy === `rule-${r.name}`}
                      onClick={() =>
                        void patch(
                          [{ op: "remove", path: `/routes/${r.name}/rules/${rule.name}` }],
                          `rule-${r.name}`,
                        )
                      }
                    >
                      删
                    </Button>
                  </li>
                ))}
                {r.rules.length === 0 && (
                  <li className="px-3 py-2 tw-body text-amber-700 dark:text-amber-400">
                    这条路由一条规则都没有。绑上它的密钥会匹配不到任何规则，请求不限失败。
                  </li>
                )}
              </ol>
            </div>
          ))}
        </div>

              </section>

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>删掉路由「{confirmDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && confirmDelete.clients.length > 0
                ? `${confirmDelete.clients.join("、")} 绑着它，删掉之后它们会退回默认路由。`
                : "这条路由没有密钥绑着，删掉不影响任何请求。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive"
              onClick={() => {
                const r = confirmDelete;
                setConfirmDelete(null);
                if (!r) return;
                // 先解绑，再删路由 —— **一次写入**。反过来的话，中间那一刻
                // 配置里有一把绑着不存在路由的密钥，而那是加载不了的。
                const ops: PatchOp[] = [
                  ...r.clients.map(
                    (c): PatchOp => ({
                      op: "replace",
                      path: `/clients/${c}/route`,
                      value: null,
                    }),
                  ),
                  { op: "remove", path: `/routes/${r.name}` },
                ];
                void patch(ops, r.name);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 加一条规则。
 *
 * **只放最常用的三个条件**（模型、是否带工具、输入长度）。`when` 一共
 * 十三个维度，全铺开是一张没人读得完的表 —— 而剩下那些在文本模式里写
 * 一行就完事。这里要解决的是「新建一条规则」这件事本身不可能，不是
 * 「每个条件都得有个控件」。
 */
function NewRule({
  route,
  targets,
  busy,
  onCancel,
  onCreate,
}: {
  route: string;
  targets: readonly (readonly [string, string])[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (item: string) => void;
}) {
  const uid = useId();
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [tools, setTools] = useState(false);
  const [tokens, setTokens] = useState("");
  const [to, setTo] = useState(targets[0]?.[0] ?? "");

  function build(): string {
    const when: string[] = [];
    if (model.trim()) when.push(`model: "${model.trim()}"`);
    if (tools) when.push("tools: true");
    if (tokens.trim()) when.push(`input_tokens: "${tokens.trim()}"`);
    const lines = [`name: ${name.trim()}`];
    if (when.length > 0) lines.push(`when: { ${when.join(", ")} }`);
    lines.push(`to: ${to}`);
    return lines.join("\n");
  }

  return (
    <div className="space-y-2 border-b border-border bg-neutral-50 p-3 dark:bg-neutral-900/40">
      <div className="flex flex-wrap items-center gap-2 tw-body">
        <Input
          className="min-w-52 flex-1"
          autoFocus
          value={name}
          placeholder="规则名，比如 超长上下文降级"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="text-muted-foreground">去向</span>
        <NativeSelect size="sm" value={to} onChange={(e) => setTo(e.target.value)}>
          {targets.map(([v, label]) => (
            <NativeSelectOption key={v} value={v}>
              {label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-wrap items-center gap-2 tw-body">
        <span className="text-muted-foreground">当</span>
        <Input
          className="w-52 font-mono"
          value={model}
          placeholder="模型 glob，比如 claude-opus-*"
          onChange={(e) => setModel(e.target.value)}
        />
        <Input
          value={tokens}
          placeholder="输入长度，比如 >200k"
          onChange={(e) => setTokens(e.target.value)}
          className="w-40 font-mono"
        />
        <Field orientation="horizontal" className="w-auto">
          <Checkbox
            id={`${uid}-tools`}
            checked={tools}
            onCheckedChange={(c) => setTools(c === true)}
          />
          <FieldLabel htmlFor={`${uid}-tools`}>带工具调用</FieldLabel>
        </Field>
        <Tip text="三个条件都留空就是一条兜底规则 —— 它会命中这条路由里所有还没被上面的规则拦下的请求。每条路由都该有一条。">
          <span className="tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
            都留空 = 兜底
          </span>
        </Tip>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-neutral-200/60 px-2 py-1 font-mono tw-label text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {route} ／ {build().replace(/\n/g, "  ")}
        </code>
        <Button
          size="sm"
          disabled={busy || !name.trim() || !to}
          onClick={() => onCreate(build())}
        >
          加上
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
        >
          取消
        </Button>
      </div>
    </div>
  );
}
