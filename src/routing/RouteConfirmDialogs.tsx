import { useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { Overview } from "@/types";
import { errorText } from "@/upstreams/labels";
import { FormItem, Note } from "@/upstreams/parts";
import { usersOf } from "./model";
import { routeConfirmText } from "./RouteConfirmDialogs.i18n";
import { routingText } from "./routing.i18n";

/** 一列密钥，右边可以附一句说明 */
function KeyList({ rows }: { rows: { name: string; note?: string }[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {rows.map((r) => (
        <div
          key={r.name}
          className="flex h-9 items-center gap-2 border-b border-border px-2.5 tw-body last:border-b-0"
        >
          <KeyRoundIcon className="size-3.5 text-muted-foreground" />
          <span className="font-mono">{r.name}</span>
          <span className="flex-1" />
          {r.note && <span className="tw-label text-muted-foreground">{r.note}</span>}
        </div>
      ))}
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = ov.routes.find((r) => r.default);
  const moving = ov.clients.filter((c) => !c.route).map((c) => c.name);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.setDefaultTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription>{moving.length > 0 ? t.keysWillMove : t.noKeysMove}</AlertDialogDescription>
        </AlertDialogHeader>
        {moving.length > 0 && (
          <KeyList rows={moving.map((k) => ({ name: k, note: `${current?.name ?? t.previousDefault} → ${name}` }))} />
        )}
        {current && <Note>{t.keepsRoute(current.name)}</Note>}
        {error && <Note tone="error">{error}</Note>}
        <AlertDialogFooter>
          <AlertDialogCancel>{ct.cancel}</AlertDialogCancel>
          <Button onClick={() => void run()} disabled={busy}>
            {busy && <Spinner />}
            {rt.setDefault}
          </Button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const route = ov.routes.find((r) => r.name === name);
  const users = route ? usersOf(route, ov.clients) : [];
  const fallback = ov.routes.find((r) => r.default);
  const others = ov.routes.filter((r) => r.name !== name && !r.default);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(target || null);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{t.deleteTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription>{users.length > 0 ? t.usersMove : t.unused}</AlertDialogDescription>
        </AlertDialogHeader>
        {users.length > 0 && (
          <>
            <KeyList rows={users.map((k) => ({ name: k }))} />
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
        {error && <Note tone="error">{error}</Note>}
        <AlertDialogFooter>
          <AlertDialogCancel>{ct.cancel}</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void run()} disabled={busy}>
            {busy && <Spinner />}
            {ct.delete}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
