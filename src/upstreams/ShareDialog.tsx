import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useResource } from "@/lib/resource";
import { FormRow, FormRows } from "@/settings/form";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { CopyButton } from "@/ui/copy-button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Skeleton } from "@/ui/skeleton";
import { Switch } from "@/ui/switch";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { call } from "@/control";
import type { ImportProposal, ProviderView, ShareLink } from "@/types";
import { api } from "./api";
import { modelsKey } from "./data";
import { carried, dropParam, shareProposal, type Carried, type Left } from "./share";
import { shareDialogText } from "./ShareDialog.i18n";

/** 一次分享最多去掉几项写不进链接的（再多就是别处出了错，不再试） */
const MAX_DROPS = 8;

/** 写成的链接，和为了写进去去掉的那几项（Rust 说的参数名） */
interface Built {
  link: ShareLink;
  dropped: string[];
}

/** 交给 Rust 写成链接；写不进的那一项去掉再写（`dropParam`） */
async function build(start: ImportProposal): Promise<Built> {
  let proposal = start;
  const dropped: string[] = [];
  for (let i = 0; i <= MAX_DROPS; i++) {
    const link = await invoke<ShareLink>("share_import_link", { proposal });
    if (link.kind !== "invalid" || !link.param) return { link, dropped };
    const next = dropParam(proposal, link.param);
    if (!next) return { link, dropped };
    dropped.push(link.param);
    proposal = next;
  }
  return { link: { kind: "invalid", param: null }, dropped };
}

/**
 * 分享上游（规格 8.3）：生成导入链接（`thinkwatch://import?…` 与官网的网页形式），接收方点开后
 * 打开预填好的新建上游对话框。「包含密钥」缺省开，开着时写明持有链接即可使用该密钥。底下一句说
 * 包含什么、不包含什么。链接写不下（价目、规格太多）就只给配置包。
 *
 * 「导出为配置包…」打开导出对话框，预先勾上这个上游（`onExportPack`）。
 */
export function ShareDialog({
  provider: p,
  onClose,
  onExportPack,
}: {
  provider: ProviderView;
  onClose: () => void;
  onExportPack: () => void;
}) {
  const t = useText(shareDialogText);
  const [secrets, setSecrets] = useState(true);
  /** 这个上游有没有能写进链接的密钥一类（账号登录的上游没有）：没有的话「包含密钥」不起作用，置灰 */
  const holdsSecrets = useMemo(() => {
    const q = shareProposal(p, { models: null, sheet: null }, true).proposal;
    return q.key != null || q.oauth != null || q.aws != null || q.headers.length > 0;
  }, [p]);
  const models = useResource(modelsKey(p.name), () => api.providerModels(p.name));
  const sheet = useResource(p.pricing ? `price-sheet:${p.pricing}` : null, () => call("PriceSheet", null, p.pricing!));
  /** 规格和价目表读完了（读不到就不带，链接照样生成） */
  const settled =
    (models.data !== undefined || models.error !== undefined) &&
    (!p.pricing || sheet.data !== undefined || sheet.error !== undefined);
  const [built, setBuilt] = useState<{ shared: ReturnType<typeof shareProposal>; out: Built } | null>(null);
  const [error, setError] = useState<unknown>(undefined);

  useEffect(() => {
    if (!settled) return;
    let alive = true;
    const shared = shareProposal(p, { models: models.data?.models ?? null, sheet: sheet.data ?? null }, secrets);
    setError(undefined);
    build(shared.proposal).then(
      (out) => alive && setBuilt({ shared, out }),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [p, secrets, settled, models.data, sheet.data]);

  const ready = built?.out.link.kind === "ready" ? built.out.link : null;
  const keyCarried = ready ? ready.proposal.key != null || ready.proposal.aws != null || ready.proposal.oauth != null : false;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.title(p.name)}</DialogTitle>
        </DialogHeader>

        <FormRows>
          <FormRow
            label={t.secrets}
            hint={secrets && keyCarried ? <span className="text-warning-foreground">{t.secretsNote}</span> : undefined}
          >
            <label className="flex items-center gap-2.5 pt-0.5 tw-body">
              <Switch checked={secrets && holdsSecrets} disabled={!holdsSecrets} onCheckedChange={setSecrets} />
              {t.secretsWhat}
            </label>
          </FormRow>
          <FormRow label={t.link} hint={ready ? t.webHint : undefined}>
            {error !== undefined ? (
              <Banner layout="inline" tone="error" title={t.failed} className="w-full">
                {errorText(error)}
              </Banner>
            ) : !built ? (
              <Skeleton className="h-16 w-full rounded-md" />
            ) : ready ? (
              <>
                <p className="max-h-28 w-full overflow-y-auto rounded-md border border-border bg-surface px-2.5 py-2 font-mono tw-label break-all text-foreground select-text">
                  {ready.web}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <CopyButton label={t.copyWeb} onCopy={() => navigator.clipboard.writeText(ready.web)} />
                  <CopyButton variant="ghost" label={t.copyApp} onCopy={() => navigator.clipboard.writeText(ready.app)} />
                </div>
              </>
            ) : (
              <Banner layout="inline" tone="info" className="w-full">
                {built.out.link.kind === "too_long" ? t.tooLong(built.out.link.length) : t.invalid}
              </Banner>
            )}
          </FormRow>
        </FormRows>

        <DialogFooter className="items-center">
          {built && ready && (
            <span className="mr-auto min-w-0 tw-label text-muted-foreground">
              <Summary carried={carried(ready.proposal)} left={built.shared.left} dropped={built.out.dropped} />
            </span>
          )}
          <Button variant="outline" onClick={onExportPack}>
            {t.exportPack}
          </Button>
          <Button onClick={onClose}>{t.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 底下那一句：「包含：地址、协议、密钥、2 个模型。不包含：出站代理、路由。」 */
function Summary({ carried: items, left, dropped }: { carried: Carried[]; left: Left[]; dropped: string[] }) {
  const t = useText(shareDialogText);
  const c = t.carried;
  const say = (x: Carried): string => {
    switch (x.kind) {
      case "headers":
        return c.headers(x.n);
      case "models":
        return c.models(x.n);
      case "specs":
        return c.specs(x.n);
      case "prices":
        return c.prices(x.n);
      case "limits":
        return c.limits(x.n);
      default:
        return c[x.kind];
    }
  };
  const params = t.params as Record<string, string | undefined>;
  const droppedNames = [
    ...new Set(
      dropped.map((d) =>
        d.startsWith("oauth_") ? params.oauth : d.startsWith("aws_") ? params.aws : (params[d] ?? params.other),
      ),
    ),
  ];
  const out = [
    ...left.map((l) => t.left[l]),
    ...(droppedNames.length > 0 ? [t.left.rejected(droppedNames.join(t.sep))] : []),
  ];
  return (
    <>
      {items.length > 0 && t.includes(items.map(say).join(t.sep))}
      {items.length > 0 && out.length > 0 && " "}
      {out.length > 0 && t.excludes(out.join(t.sep))}
    </>
  );
}
