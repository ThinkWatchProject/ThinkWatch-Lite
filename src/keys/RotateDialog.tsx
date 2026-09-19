import { useState } from "react";
import { CircleAlertIcon, CopyIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
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
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import type { ClientView, DetectedClient, KeyRotated } from "@/types";
import { api } from "./api";
import { errorText } from "./labels";

/**
 * 更换一把密钥。
 *
 * **先说代价，再做事。**原密钥立即失效；如果这把钥匙是某个被接管的客户端
 * 在用的，core 会把新值一并写进它的配置，而那个客户端多半要重新启动才会
 * 读到 —— 这句话必须在用户按下去之前说，不是之后。
 */
export function RotateDialog({
  target,
  clients,
  configVersion,
  onClose,
  onRotated,
}: {
  target: ClientView;
  clients: DetectedClient[];
  configVersion: string | null;
  onClose: () => void;
  onRotated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<KeyRotated | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owner = clients.find((c) => c.id === target.client);
  const adopted = !!owner?.adopted_at_ms;
  const needsRestart = owner?.takes_effect === "on_restart";

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.rotateKey(target.name, configVersion);
      setDone(r);
      onRotated();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>密钥已更换</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-foreground">{target.name}</span>
              {done.synced.length > 0
                ? ` 的新密钥已写入 ${done.synced.map((s) => s.name).join("、")} 的配置文件。`
                : " 的新密钥如下。"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="tw-label text-muted-foreground">新密钥</p>
                <p className="truncate font-mono tw-body">{done.key}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCopied(false);
                  api
                    .copyKey(target.name)
                    .then(() => setCopied(true))
                    .catch((e) => setError(errorText(e)));
                }}
              >
                <CopyIcon />
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            {/* 做完之后再说一遍该做什么：前一屏是决定要不要做 */}
            {done.synced
              .filter((s) => s.takes_effect === "on_restart")
              .map((s) => (
                <Alert key={s.client} variant="warning">
                  <CircleAlertIcon />
                  <AlertTitle>请重新启动 {s.name}</AlertTitle>
                  <AlertDescription>正在运行的窗口仍在使用原密钥，重启后恢复。</AlertDescription>
                </Alert>
              ))}
            {done.failed.map((f) => (
              <Alert key={f.client} variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>未能写入 {f.name} 的配置</AlertTitle>
                <AlertDescription>
                  {f.error}。密钥已经更换，请手动把新密钥填进 {f.name}。
                </AlertDescription>
              </Alert>
            ))}
            {done.synced.length === 0 && done.failed.length === 0 && (
              <p className="tw-label text-muted-foreground">
                使用原密钥的地方需要改成新密钥，否则将无法连接。
              </p>
            )}
            {error && <p className="tw-body text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={onClose}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>更换密钥「{target.name}」</AlertDialogTitle>
          <AlertDialogDescription>
            原密钥立即失效。
            {adopted && owner
              ? `新密钥会同时写入 ${owner.name} 的配置文件。`
              : "使用原密钥的地方需要改成新密钥。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {adopted && owner && needsRestart && (
          <Alert variant="warning">
            <CircleAlertIcon />
            <AlertTitle>{owner.name} 需要重新启动</AlertTitle>
            <AlertDescription>
              {owner.name} 在启动时读取配置，更换后正在运行的窗口会无法连接，需要重新启动它。
            </AlertDescription>
          </Alert>
        )}
        {target.default && (
          <Alert variant="warning">
            <CircleAlertIcon />
            <AlertTitle>这是默认密钥</AlertTitle>
            <AlertDescription>
              手动配置了这把密钥的客户端都会无法连接，需要逐个改成新密钥。
            </AlertDescription>
          </Alert>
        )}
        {error && <p className="tw-body text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // 结果要留在这张对话框里给出来，所以不让它自己关掉
              e.preventDefault();
              void rotate();
            }}
            disabled={busy}
          >
            {adopted ? "更换并同步" : "更换"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
