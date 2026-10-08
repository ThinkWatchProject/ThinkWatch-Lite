import { useState, type ReactNode } from "react";
import { ArrowRightIcon } from "lucide-react";
import { useClients } from "@/clients/data";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { useResource } from "@/lib/resource";
import { useNav } from "@/nav";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogConfirm,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { IconClient, IconFlow, IconKey, IconRoute } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { focusSelf } from "@/ui/dialog-focus";
import { errorText } from "@/upstreams/labels";
import { DialogError } from "@/upstreams/parts";
import { api } from "./api";
import type { AliasRuleRef, AliasView } from "@/types";
import { aliasesText } from "./aliases.i18n";
import { clientsListing } from "./logic";

/** 在用这个名称的一处：一句话、图标，和能跳过去看的话跳到哪儿 */
interface Use {
  key: string;
  icon: ReactNode;
  text: string;
  show?: () => void;
}

/**
 * 删除别名。**先列出在用这个名称的地方**（core 的 `GET /aliases/{name}/usage`：24 小时的
 * 请求、密钥的可见模型、规则；加上这台电脑上模型列表里写着它的已接管客户端），每一处都能
 * 跳过去看。和上游不同，别名被引用时照样能删 —— 删了之后那些地方写着的是一个没有上游
 * 提供的名称，这句话在对话框里说清。
 *
 * 删除失败时对话框留着，原因写在里面，可以直接再点一次。
 */
export function DeleteAliasDialog({
  alias,
  configVersion,
  onClose,
  onDeleted,
}: {
  alias: AliasView;
  configVersion: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useText(aliasesText);
  const c = useText(commonText);
  const nav = useNav();
  const name = alias.name;
  const usage = useResource(`alias-usage:${name}`, () => api.aliasUsage(name));
  const clients = useClients();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (f: () => void) => () => {
    onClose();
    f();
  };
  const uses: Use[] = [];
  const u = usage.data;
  if (u && u.requests_24h > 0)
    uses.push({
      key: "requests",
      icon: <IconFlow />,
      text: t.usedByRequests(u.requests_24h),
      show: go(() => nav.open("requests", { filter: { model: name } })),
    });
  for (const k of u?.keys ?? [])
    uses.push({ key: `key:${k}`, icon: <IconKey />, text: t.usedByKey(k), show: go(() => nav.open("keys", { edit: k })) });
  for (const r of u?.rules ?? [])
    uses.push({
      key: `rule:${r.route}/${r.rule}/${r.field}`,
      icon: <IconRoute />,
      text: ruleText(r),
      show: go(() => nav.open("routing", { editRoute: r.route })),
    });
  const listing = clientsListing(clients.data?.clients, name);
  if (listing.length > 0)
    uses.push({
      key: "clients",
      icon: <IconClient />,
      text: t.usedByClients(listing.map((x) => x.name)),
      show: go(() => nav.open("clients", listing.length === 1 ? { detail: listing[0]!.id } : undefined)),
    });

  function ruleText(r: AliasRuleRef): string {
    if (r.field === "when.model") return t.usedByCondition(r.route, r.rule);
    if (r.field === "set.model") return t.usedByRewrite(r.route, r.rule);
    return t.usedByRule(r.route, r.rule);
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.deleteAlias(name, configVersion);
      onDeleted();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const loading = u === undefined && usage.error === undefined;
  const models = [...new Set(alias.models.map((m) => m.model))];
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="sm:max-w-md" onOpenAutoFocus={focusSelf}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.deleteTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription>{loading || uses.length > 0 ? t.inUse : t.unused}</AlertDialogDescription>
        </AlertDialogHeader>
        {loading ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5" role="status" aria-busy="true">
            <Skeleton className="h-3 w-2/3 rounded-sm" />
            <Skeleton className="h-3 w-1/2 rounded-sm" />
          </div>
        ) : (
          uses.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-border">
              {uses.map((x) => (
                <div
                  key={x.key}
                  className="flex min-h-9 items-center gap-2 border-b border-border px-2.5 py-1 tw-body last:border-b-0"
                >
                  <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">{x.icon}</span>
                  <span className="min-w-0 flex-1">{x.text}</span>
                  {x.show && (
                    <Button variant="ghost" size="xs" onClick={x.show}>
                      {t.show}
                      <ArrowRightIcon />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
        {usage.error !== undefined && u === undefined && (
          <p className="tw-label text-warning">{t.usageFailed(errorText(usage.error))}</p>
        )}
        {models.length > 0 && <p className="tw-label text-muted-foreground">{t.kept(models)}</p>}
        <DialogError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{c.cancel}</AlertDialogCancel>
          <AlertDialogConfirm variant="destructive" pending={busy} onConfirm={() => void run()}>
            {c.delete}
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
