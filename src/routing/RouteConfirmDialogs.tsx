import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ClientView, Overview } from "@/types";
import { FormItem, Note } from "@/upstreams/parts";
import { usersOf } from "./model";
import { KeyIcon } from "./parts";
import { routeConfirmText } from "./RouteConfirmDialogs.i18n";
import { routingText } from "./routing.i18n";

/** 一列密钥，右边可以附一句说明 */
function KeyList({ rows }: { rows: { key: ClientView; note?: string }[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {rows.map((r) => (
        <div
          key={r.key.name}
          className="flex h-9 items-center gap-2 border-b border-border px-2.5 tw-body last:border-b-0"
        >
          <KeyIcon k={r.key} />
          <span className="font-mono">{r.key.name}</span>
          <span className="flex-1" />
          {r.note && <span className="tw-label text-muted-foreground">{r.note}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * 确认对话框的「确认」那一下：**请求回来之前不关**（结果要留在这张对话框里说），
 * 进行中转圈、失效，失败时在按钮上方说原因。
 */
function useConfirm(onConfirm: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/**
 * 设为默认路由。**没指定路由的密钥全都跟着换**，所以把它们列出来再确认。
 */
export function SetDefaultDialog({
  ov,
  name,
  onConfirm,
  onClose,
}: {
  ov: Overview;
  name: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(routeConfirmText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const { busy, error, run } = useConfirm(onConfirm);
  const current = ov.routes.find((r) => r.default);
  const moving = ov.clients.filter((c) => !c.route);

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.setDefaultTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription>{moving.length > 0 ? t.keysWillMove : t.noKeysMove}</AlertDialogDescription>
        </AlertDialogHeader>
        {moving.length > 0 && (
          <KeyList rows={moving.map((k) => ({ key: k, note: `${current?.name ?? t.previousDefault} → ${name}` }))} />
        )}
        {current && <Note>{t.keepsRoute(current.name)}</Note>}
        <Banner layout="inline" tone="error" show={error !== null}>
          {error !== null && errorText(error)}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{ct.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(e) => {
              // 结果要在这张对话框里给出来：请求回来之前不让它自己关掉
              e.preventDefault();
              void run();
            }}
          >
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {rt.setDefault}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 删除路由。使用它的密钥**由用户选**改用哪一条，默认选项是默认路由 ——
 * 一条限制用途的路由被删掉之后悄悄改走默认路由，限制也就随之没了。
 */
export function DeleteRouteDialog({
  ov,
  name,
  onConfirm,
  onClose,
}: {
  ov: Overview;
  name: string;
  /** `reassignTo` 为空：改用默认路由 */
  onConfirm: (reassignTo: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(routeConfirmText);
  const ct = useText(commonText);
  const [target, setTarget] = useState("");
  const { busy, error, run } = useConfirm(() => onConfirm(target || null));
  const route = ov.routes.find((r) => r.name === name);
  const users = route ? usersOf(route, ov.clients) : [];
  const fallback = ov.routes.find((r) => r.default);
  const others = ov.routes.filter((r) => r.name !== name && !r.default);

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.deleteTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription>{users.length > 0 ? t.usersMove : t.unused}</AlertDialogDescription>
        </AlertDialogHeader>
        {users.length > 0 && (
          <>
            <KeyList rows={ov.clients.filter((c) => users.includes(c.name)).map((k) => ({ key: k }))} />
            <FormItem label={t.reassignTo} htmlFor="reassign-to">
              <NativeSelect
                id="reassign-to"
                className="w-full"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <NativeSelectOption value="">
                  {fallback ? t.defaultOption(fallback.name) : t.defaultRoute}
                </NativeSelectOption>
                {others.map((r) => (
                  <NativeSelectOption key={r.name} value={r.name}>
                    {r.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormItem>
          </>
        )}
        <Banner layout="inline" tone="error" show={error !== null}>
          {error !== null && errorText(error)}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{ct.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {busy && <Spinner data-icon="inline-start" aria-hidden />}
            {ct.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
