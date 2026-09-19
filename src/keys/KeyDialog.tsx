import { useState } from "react";
import { CopyIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { when } from "@/format";
import type { ClientView, CostGroup, DetectedClient, RouteView } from "@/types";
import { api } from "./api";
import { errorText, routeLabel, useLabel } from "./labels";

/** 可见模型的三态。第三态是「一个都不给」——「临时停掉」的正当用法 */
type Scope = "all" | "some" | "none";

function scopeOf(allow: string[] | null | undefined): Scope {
  if (allow == null) return "all";
  return allow.length === 0 ? "none" : "some";
}

/**
 * 新建与编辑一把密钥。
 *
 * 密钥的值不是一个可填的字段：它由 core 生成，要换走「更换」——
 * 那条路会把新值同步给正在用它的客户端。
 */
export function KeyDialog({
  editing,
  keys,
  clients,
  usage,
  routes,
  defaultRoute,
  configVersion,
  onClose,
  onSaved,
  onRotate,
}: {
  /** 编辑哪一把。不给就是新建 */
  editing: ClientView | null;
  keys: ClientView[];
  clients: DetectedClient[];
  usage: CostGroup[];
  routes: RouteView[];
  defaultRoute: string;
  configVersion: string | null;
  onClose: () => void;
  onSaved: (name: string) => void;
  onRotate: (name: string) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [route, setRoute] = useState(editing?.route ?? "");
  const [scope, setScope] = useState<Scope>(scopeOf(editing?.allow));
  const [globs, setGlobs] = useState((editing?.allow ?? []).join("\n"));
  const [limit, setLimit] = useState(
    editing?.max_concurrent != null ? String(editing.max_concurrent) : "",
  );
  const [enabled, setEnabled] = useState(!editing?.disabled);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = usage.find((u) => u.name === editing?.name);
  const taken = keys.some((k) => k.name === name.trim() && k.name !== editing?.name);
  const missing =
    name.trim().length === 0
      ? "请填写名称"
      : taken
        ? "这个名称已被占用"
        : scope === "some" && globs.trim().length === 0
          ? "请至少填写一条模型范围"
          : null;

  async function save() {
    setSaving(true);
    setError(null);
    const allow =
      scope === "all"
        ? null
        : scope === "none"
          ? []
          : globs
              .split("\n")
              .map((g) => g.trim())
              .filter(Boolean);
    const body = {
      key: {
        name: name.trim(),
        route: route || null,
        allow,
        max_concurrent: limit.trim() ? Number(limit.trim()) : null,
        disabled: !enabled,
      },
      base_version: configVersion ?? undefined,
    };
    try {
      if (editing) await api.updateKey(editing.name, body);
      else await api.createKey(body);
      onSaved(name.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑密钥" : "新建密钥"}</DialogTitle>
          <DialogDescription>
            {editing ? (
              <>
                <span className="font-mono text-foreground">{editing.name}</span> ·{" "}
                {useLabel(editing, clients)}
              </>
            ) : (
              "新密钥立即可用。客户端把它填进请求头即可连接网关。"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono tw-body">{editing.key}</p>
                <p className="tw-label text-muted-foreground">
                  {editing.last_seen_ms ? `最后使用 ${when(editing.last_seen_ms)}` : "从未使用"}
                  {used && used.requests > 0 && ` · 24 小时 ${used.requests.toLocaleString()} 次`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCopied(false);
                    api
                      .copyKey(editing.name)
                      .then(() => setCopied(true))
                      .catch((e) => setError(errorText(e)));
                  }}
                >
                  <CopyIcon />
                  {copied ? "已复制" : "复制"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => onRotate(editing.name)}>
                  <RotateCwIcon />
                  更换…
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-name">
                名称
              </label>
              <Input
                id="k-name"
                className="font-mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如 codex"
                aria-invalid={taken}
              />
              <p className="tw-label text-muted-foreground">流量与会话里按它区分客户端</p>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-route">
                路由
              </label>
              <NativeSelect id="k-route" value={route} onChange={(e) => setRoute(e.target.value)}>
                {/* 不绑就是走默认路由 —— 写出来，而不是留一个空白 */}
                <NativeSelectOption value="">{routeLabel(null, defaultRoute)}</NativeSelectOption>
                {routes
                  .filter((r) => r.name !== defaultRoute)
                  .map((r) => (
                    <NativeSelectOption key={r.name} value={r.name}>
                      {r.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <p className="tw-label text-muted-foreground">决定这把密钥的请求发往哪些上游</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-scope">
                可见模型
              </label>
              <NativeSelect
                id="k-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
              >
                <NativeSelectOption value="all">不限</NativeSelectOption>
                <NativeSelectOption value="some">指定范围</NativeSelectOption>
                <NativeSelectOption value="none">一个都不给</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-limit">
                并发上限
              </label>
              <Input
                id="k-limit"
                className="font-mono"
                value={limit}
                placeholder="不限"
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
          </div>

          {scope === "some" && (
            <div className="flex flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-globs">
                模型范围
              </label>
              <textarea
                id="k-globs"
                className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 font-mono tw-body outline-none focus-visible:border-ring"
                value={globs}
                onChange={(e) => setGlobs(e.target.value)}
                placeholder={"claude-*\ngpt-5*"}
              />
              <p className="tw-label text-muted-foreground">一行一条，支持 * 通配</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <div>
              <p className="tw-body font-medium">启用</p>
              <p className="tw-label text-muted-foreground">
                {editing?.default
                  ? "默认密钥不能停用：未接管的客户端均使用它"
                  : "停用后，使用这把密钥的请求一律拒绝"}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={editing?.default}
              onCheckedChange={(v) => setEnabled(v)}
            />
          </div>
        </div>

        {error && <p className="tw-body text-destructive">{error}</p>}

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving || missing != null}>
            {saving && <Spinner />}
            {editing ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
