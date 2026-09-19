import { useCallback, useEffect, useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";
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
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { CopyIcon } from "lucide-react";
import type { ClientView, CostGroup, DetectedClient, Overview } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { KeyDialog } from "./KeyDialog";
import { KeysTable } from "./KeysTable";
import { errorText } from "./labels";
import { RotateDialog } from "./RotateDialog";

const DAY_MS = 24 * 3_600_000;

type DialogState =
  | null
  | { kind: "edit"; name: string | null }
  | { kind: "rotate"; name: string }
  | { kind: "delete"; name: string }
  | { kind: "created"; name: string };

/**
 * 网关密钥。
 *
 * **这是访问控制的唯一入口**：端口决定谁能敲门，密钥决定谁能进来 ——
 * 没有密钥，即使从 127.0.0.1 也连不上。
 *
 * 页面只读，改任何东西都在对话框里完成；能不能删、改名要不要带着规则一起改、
 * 更换要同步给谁，都由 core 判断 —— 界面只负责把话说清楚。
 */
export default function KeysPage({
  ov,
  configVersion,
  onChanged,
  onOpenConfigFile,
  onNavigate,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
  onOpenConfigFile: (focus: string | null) => void;
  onNavigate: (tab: string) => void;
}) {
  const [keys, setKeys] = useState<ClientView[]>([]);
  const [clients, setClients] = useState<DetectedClient[]>([]);
  const [usage, setUsage] = useState<CostGroup[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [gateway, setGateway] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listKeys().then(setKeys).catch((e) => toast.error(errorText(e)));
    // 接管状态在客户端配置旁边的记录里，每次现扫；拿不到时行里少一句话，页面照常用
    invoke<{ clients: DetectedClient[] }>("list_clients")
      .then((r) => setClients(r.clients))
      .catch(() => setClients([]));
    api
      .keyUsage(Date.now() - DAY_MS)
      .then(setUsage)
      .catch(() => setUsage([]));
  }, []);

  useEffect(() => {
    load();
  }, [load, ov]);

  useEffect(() => {
    api.gatewayBase().then(setGateway).catch(() => setGateway(""));
  }, []);

  const changed = (name?: string) => {
    onChanged();
    load();
    if (name) setTimeout(() => document.querySelector(`[data-row="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" }), 0);
  };

  async function write(what: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await what();
      if (ok) toast.success(ok);
      changed();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const editing = dialog?.kind === "edit" && dialog.name ? keys.find((k) => k.name === dialog.name) : null;
  const target = (name: string) => keys.find((k) => k.name === name);
  const defaultRoute = ov.default_route ?? "默认";
  // 只有一把默认密钥时，这一页要回答的是「接下来做什么」
  const onlyDefault = keys.length === 1 && keys[0]?.default;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <p className="tw-body text-muted-foreground">
          客户端须使用密钥连接网关，本机连接也不例外。
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onNavigate("clients")}>
            接管客户端…
          </Button>
          <Button size="sm" onClick={() => setDialog({ kind: "edit", name: null })}>
            新建密钥
          </Button>
        </div>
      </div>

      <KeysTable
        keys={keys}
        clients={clients}
        usage={usage}
        defaultRoute={defaultRoute}
        actions={{
          edit: (name) => setDialog({ kind: "edit", name }),
          rotate: (name) => setDialog({ kind: "rotate", name }),
          remove: (name) => setDialog({ kind: "delete", name }),
          copy: (name) =>
            void api
              .copyKey(name)
              .then(() => toast.success(`已复制密钥「${name}」`))
              .catch((e) => toast.error(errorText(e))),
          toggle: (k) =>
            void write(() =>
              api.updateKey(k.name, {
                key: {
                  name: k.name,
                  route: k.route ?? null,
                  allow: k.allow ?? null,
                  max_concurrent: k.max_concurrent,
                  disabled: !k.disabled,
                },
                base_version: configVersion ?? undefined,
              }),
            ),
          makeDefault: (name) =>
            void write(() => api.setDefaultKey(name, configVersion), `「${name}」已设为默认密钥`),
          locate: (name) => onOpenConfigFile(name),
        }}
      />

      {onlyDefault && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>每个客户端一把密钥</EmptyTitle>
            <EmptyDescription>
              接管一个客户端时会为它单独生成密钥，流量、路由和并发上限才能分得清是谁的。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => onNavigate("clients")}>
              接管客户端…
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {dialog?.kind === "edit" && (
        <KeyDialog
          editing={editing ?? null}
          keys={keys}
          clients={clients}
          usage={usage}
          routes={ov.routes ?? []}
          defaultRoute={defaultRoute}
          configVersion={configVersion}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            const created = !dialog.name;
            setDialog(created ? { kind: "created", name } : null);
            changed(name);
          }}
          onRotate={(name) => setDialog({ kind: "rotate", name })}
        />
      )}

      {dialog?.kind === "rotate" && target(dialog.name) && (
        <RotateDialog
          target={target(dialog.name)!}
          clients={clients}
          configVersion={configVersion}
          onClose={() => setDialog(null)}
          onRotated={changed}
        />
      )}

      {dialog?.kind === "created" && (
        <CreatedDialog
          name={dialog.name}
          gateway={gateway}
          copied={copied}
          onCopy={(what, run) => {
            setCopied(null);
            run()
              .then(() => setCopied(what))
              .catch((e) => toast.error(errorText(e)));
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "delete" && (
        <AlertDialog open onOpenChange={(o) => !o && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除密钥「{dialog.name}」</AlertDialogTitle>
              <AlertDialogDescription>
                删除后，使用这把密钥的客户端将立即无法连接。可在版本历史中恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            {/* 这一步随手就做了，而代价要到下次接管才显出来 */}
            {target(dialog.name)?.client && (
              <Alert>
                <AlertTitle>
                  {clients.find((c) => c.id === target(dialog.name)?.client)?.name ??
                    target(dialog.name)?.client}{" "}
                  再次接管时会重新生成一把
                </AlertTitle>
                <AlertDescription>
                  这把密钥是接管时生成的。保留它，下次接管可以直接复用，不必重新配置。
                </AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  const name = dialog.name;
                  setDialog(null);
                  void write(() => api.deleteKey(name, configVersion));
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

/** 刚建好的一把密钥，下一步一定是拿去某个地方填上 —— 地址和密钥一起给 */
function CreatedDialog({
  name,
  gateway,
  copied,
  onCopy,
  onClose,
}: {
  name: string;
  gateway: string;
  copied: string | null;
  onCopy: (what: string, run: () => Promise<void>) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>密钥已创建</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{name}</span> 现在可以连接网关。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="tw-label text-muted-foreground">网关地址</p>
                <p className="truncate font-mono tw-body">{gateway || "读取中…"}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopy("base", api.copyGatewayBase)}
              >
                <CopyIcon />
                {copied === "base" ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-border pt-2.5">
              <div className="min-w-0">
                <p className="tw-label text-muted-foreground">密钥</p>
                <p className="truncate font-mono tw-body">点「复制」取得完整密钥</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onCopy("key", () => api.copyKey(name))}>
                <CopyIcon />
                {copied === "key" ? "已复制" : "复制"}
              </Button>
            </div>
          </div>
          <p className="tw-label text-muted-foreground">
            密钥在列表里只显示前后几位。忘了可以随时更换一把新的。
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
