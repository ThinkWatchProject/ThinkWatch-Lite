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
import type { Overview } from "@/types";
import { errorText } from "@/upstreams/labels";
import { FormItem, Note } from "@/upstreams/parts";
import { usersOf } from "./model";

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
          <AlertDialogTitle>将「{name}」设为默认路由</AlertDialogTitle>
          <AlertDialogDescription>
            {moving.length > 0 ? "未指定路由的密钥将改用此路由。" : "当前所有密钥均已指定路由，更换默认路由不影响现有密钥。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {moving.length > 0 && (
          <KeyList rows={moving.map((k) => ({ name: k, note: `${current?.name ?? "默认"} → ${name}` }))} />
        )}
        {current && <Note>「{current.name}」保留为普通路由，可继续指定给密钥。</Note>}
        {error && <Note tone="error">{error}</Note>}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button onClick={() => void run()} disabled={busy}>
            {busy && <Spinner />}
            设为默认路由
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
          <AlertDialogTitle>删除路由「{name}」</AlertDialogTitle>
          <AlertDialogDescription>
            {users.length > 0
              ? "以下密钥使用此路由，删除后改用所选路由。可在版本历史中恢复。"
              : "此路由未被密钥使用。删除后可在版本历史中恢复。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {users.length > 0 && (
          <>
            <KeyList rows={users.map((k) => ({ name: k }))} />
            <FormItem label="改用路由" htmlFor="reassign-to">
              <NativeSelect
                id="reassign-to"
                className="w-full"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <NativeSelectOption value="">
                  {fallback ? `${fallback.name}（默认路由）` : "默认路由"}
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
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="destructive" onClick={() => void run()} disabled={busy}>
            {busy && <Spinner />}
            删除
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
