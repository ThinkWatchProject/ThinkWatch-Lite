import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { IconCopied, IconCopy } from "@/ui/icons";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Spinner } from "@/ui/spinner";
import { Table, TableBody, TableCell, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import type { ClientView, ManualSetup, Msg } from "@/types";
import { api } from "./api";
import { clientsText } from "./clients.i18n";

/** 手动配置的是谁：接管不了的（Cursor…），或者没检测到的（配置文件不在默认位置） */
export interface ManualTarget {
  id: string;
  name: string;
  setup: ManualSetup;
  /** 配完还漏什么。只有接管不了的那几个有 */
  caveat?: Msg | null;
  /** 为它生成的那把密钥 */
  key?: string | null;
}

/** 选单里「新建一把」那一项的值。**密钥名首尾不能有空白**，所以没有哪把密钥叫这个 */
const NEW = " new";

/**
 * 手动配置一个客户端：几步说明、要写的字段，以及网关地址和密钥各一个复制按钮。
 *
 * **密钥默认是为它新建的那把专用密钥** —— 手动配进去的客户端也要分得清流量是
 * 谁的。点「创建并复制」那一刻才真的建（打开这个对话框不该有副作用）；已经有
 * 为它留着的，就直接是那一把。想用别的密钥（比如默认那把），在选单里换。
 */
export function ManualDialog({
  target,
  keys,
  onClose,
  onKeyReady,
}: {
  target: ManualTarget;
  keys: ClientView[];
  onClose: () => void;
  /** 新建了密钥：列表要跟着重读 */
  onKeyReady: () => void;
}) {
  const t = useText(clientsText);
  /** 为它留着的那把。刚建好的在列表重读回来之前也要能选到 */
  const [own, setOwn] = useState(target.key ?? null);
  const [choice, setChoice] = useState(target.key ?? NEW);
  const [copied, setCopied] = useState<"endpoint" | "key" | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (what: "endpoint" | "key") => {
    setCopied(what);
    setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
  };

  async function copyKey() {
    setBusy(true);
    try {
      let name = choice;
      if (choice === NEW) {
        name = await api.prepareKey(target.id);
        setOwn(name);
        setChoice(name);
        onKeyReady();
      }
      await api.copyKey(name);
      flash("key");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const { steps, fields, endpoint } = target.setup;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
        // 点一行就打开：焦点落在对话框本身，不落到第一个按钮上 —— WebKit 里
        // 脚本给的焦点会在按钮上画一圈框，而用户根本没按过 Tab。和请求详情
        // 抽屉同一个做法：焦点仍在对话框里，读屏和 Esc 照常
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.manualDialogTitle(target.name)}</DialogTitle>
        </DialogHeader>

        <ol className="flex list-decimal flex-col gap-1.5 pl-5 tw-body">
          {steps.map((s, i) => (
            <li key={i}>{coreText(s)}</li>
          ))}
        </ol>

        {fields.length > 0 && (
          <div className="rounded-md border border-border">
            <Table>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.path}>
                    <TableCell className="font-mono tw-label">{f.path}</TableCell>
                    <TableCell className="whitespace-normal break-all">
                      {f.secret ? (
                        <span className="text-muted-foreground">{t.keyGoesBelow}</span>
                      ) : (
                        <span className="font-mono tw-label">{f.value}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="tw-label text-muted-foreground">{t.endpointLabel}</p>
              <p className="truncate font-mono tw-body select-text">{endpoint}</p>
            </div>
            <CopyButton
              copied={copied === "endpoint"}
              onClick={() =>
                void api
                  .copyEndpoint(target.id)
                  .then(() => flash("endpoint"))
                  .catch((e) => toast.error(errorText(e)))
              }
            />
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="tw-label text-muted-foreground">{t.keyLabel}</p>
              <NativeSelect
                size="sm"
                aria-label={t.keyLabel}
                className="w-72"
                value={choice}
                disabled={busy}
                onChange={(e) => setChoice(e.target.value)}
              >
                {own == null && <NativeSelectOption value={NEW}>{t.newKeyFor(target.name)}</NativeSelectOption>}
                {own != null && !keys.some((k) => k.name === own) && (
                  <NativeSelectOption value={own}>{own}</NativeSelectOption>
                )}
                {keys.map((k) => (
                  <NativeSelectOption key={k.name} value={k.name}>
                    {k.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <CopyButton
              copied={copied === "key"}
              busy={busy}
              label={choice === NEW ? t.createAndCopy : undefined}
              onClick={() => void copyKey()}
            />
          </div>
        </div>

        {target.caveat && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>{coreText(target.caveat)}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button onClick={onClose}>{t.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({
  copied,
  busy,
  label,
  onClick,
}: {
  copied: boolean;
  busy?: boolean;
  label?: string;
  onClick: () => void;
}) {
  const common = useText(commonText);
  return (
    <Button variant="outline" size="sm" className="shrink-0" disabled={busy} onClick={onClick}>
      {busy ? <Spinner /> : copied ? <IconCopied /> : <IconCopy />}
      {copied ? common.copied : (label ?? common.copy)}
    </Button>
  );
}
