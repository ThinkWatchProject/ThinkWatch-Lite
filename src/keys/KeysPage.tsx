import { useCallback, useEffect, useState } from "react";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
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
import { IconCopied, IconCopy } from "@/ui/icons";
import type { ClientView, CostGroup, DetectedClient, KnownModel, Overview } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { api } from "./api";
import { KeyDialog } from "./KeyDialog";
import { KeysTable } from "./KeysTable";
import { keysPageText } from "./KeysPage.i18n";
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
 * **客户端连网关必须带一把**，本机也不例外。每把的值原样显示、旁边一个复制
 * 按钮；接管客户端时生成的那几把单独标出来，写明是给谁的。
 *
 * **自己一页，挨着客户端。**它曾经和监听范围、并发合在「接入」里 —— 三样
 * 东西都跟「谁能连进来」有关，但用户来这一页只为一件事：拿一把密钥、看它
 * 给了谁。监听是配一次就不动的网关设置，已经挪去了设置页。
 *
 * 只读，改任何东西都在对话框里完成；能不能删、改名要不要带着规则一起改、
 * 更换要同步给谁，都由 core 判断 —— 界面只负责把话说清楚。
 */
export default function KeysPage({
  ov,
  onChanged,
  onOpenConfigFile,
  onNavigate,
}: {
  ov: Overview;
  onChanged: () => void;
  onOpenConfigFile: (focus: string | null) => void;
  onNavigate: (tab: string) => void;
}) {
  const t = useText(keysPageText);
  const configVersion = ov.config_version;
  const common = useText(commonText);
  const [keys, setKeys] = useState<ClientView[]>([]);
  const [clients, setClients] = useState<DetectedClient[]>([]);
  const [usage, setUsage] = useState<CostGroup[]>([]);
  const [catalog, setCatalog] = useState<KnownModel[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [gateway, setGateway] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.listKeys().then(setKeys).catch((e) => toast.error(errorText(e)));
    // 接管状态在客户端配置旁边的记录里，每次现扫；拿不到时少一个标记，页面照常用
    invoke<{ clients: DetectedClient[] }>("list_clients")
      .then((r) => setClients(r.clients))
      .catch(() => setClients([]));
    api
      .keyUsage(Date.now() - DAY_MS)
      .then(setUsage)
      .catch(() => setUsage([]));
    // 取不到就当作还没有清单：那一栏退回说规则条数，选择器只留手填
    api
      .knownModels()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    load();
  }, [load, ov]);

  // 换了监听端口，地址跟着变 —— 所以跟着概览重取，不是只取一次
  useEffect(() => {
    api.gatewayBase().then(setGateway).catch(() => setGateway(""));
  }, [ov]);

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

  async function copy(name: string, quiet?: boolean) {
    try {
      await api.copyKey(name);
      if (!quiet) toast.success(t.copied(name));
    } catch (e) {
      toast.error(errorText(e));
      throw e;
    }
  }

  const editing = dialog?.kind === "edit" && dialog.name ? keys.find((k) => k.name === dialog.name) : null;
  const target = (name: string) => keys.find((k) => k.name === name);
  const defaultRoute = ov.default_route;
  // 只有一把默认密钥时，这一页要回答的是「接下来做什么」
  const onlyDefault = keys.length === 1 && keys[0]?.default;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="tw-body text-muted-foreground">{t.intro}</p>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => onNavigate("clients")}>
          {t.connectClient}
        </Button>
        <Button size="sm" onClick={() => setDialog({ kind: "edit", name: null })}>
          <PlusIcon />
          {t.newKey}
        </Button>
      </div>

      <KeysTable
        keys={keys}
        clients={clients}
        usage={usage}
        defaultRoute={defaultRoute}
        catalog={catalog}
        actions={{
          edit: (name) => setDialog({ kind: "edit", name }),
          rotate: (name) => setDialog({ kind: "rotate", name }),
          remove: (name) => setDialog({ kind: "delete", name }),
          copy,
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
                base_version: configVersion,
              }),
            ),
          makeDefault: (name) =>
            void write(() => api.setDefaultKey(name, configVersion), t.madeDefault(name)),
          locate: (name) => onOpenConfigFile(name),
        }}
      />

      {onlyDefault && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>{t.emptyTitle}</EmptyTitle>
            <EmptyDescription>{t.emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => onNavigate("clients")}>
              {t.connectClient}
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
          routes={ov.routes}
          defaultRoute={defaultRoute}
          catalog={catalog}
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
          value={target(dialog.name)?.key ?? null}
          gateway={gateway}
          onCopyKey={() => copy(dialog.name, true)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "delete" && (
        <AlertDialog open onOpenChange={(o) => !o && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.deleteTitle(dialog.name)}</AlertDialogTitle>
              <AlertDialogDescription>{t.deleteDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            {/* 这一步随手就做了，而代价要到下次接管才显出来 */}
            {target(dialog.name)?.client && (
              <Alert>
                <AlertTitle>
                  {t.regenerated(
                    clients.find((c) => c.id === target(dialog.name)?.client)?.name ??
                      target(dialog.name)?.client ??
                      "",
                  )}
                </AlertTitle>
                <AlertDescription>{t.keepIt}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>{common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  const name = dialog.name;
                  setDialog(null);
                  void write(() => api.deleteKey(name, configVersion));
                }}
              >
                {common.delete}
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
  value,
  gateway,
  onCopyKey,
  onClose,
}: {
  name: string;
  /** 列表重取回来之前是 null */
  value: string | null;
  gateway: string;
  onCopyKey: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(keysPageText);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.createdTitle}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{name}</span> {t.canConnect}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border">
          <CopyRow label={t.gatewayAddress} value={gateway || null} onCopy={api.copyGatewayBase} />
          <div className="border-t border-border" />
          <CopyRow label={t.key} value={value} onCopy={onCopyKey} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string | null;
  onCopy: () => Promise<void>;
}) {
  const t = useText(keysPageText);
  const common = useText(commonText);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="tw-label text-muted-foreground">{label}</p>
        <p className="truncate font-mono tw-body select-text">{value ?? t.loading}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={value == null}
        onClick={() =>
          void onCopy()
            .then(() => setCopied(true))
            .catch((e) => toast.error(errorText(e)))
        }
      >
        {copied ? <IconCopied /> : <IconCopy />}
        {copied ? common.copied : common.copy}
      </Button>
    </div>
  );
}
