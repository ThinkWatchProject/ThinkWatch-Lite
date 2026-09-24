import { useEffect, useRef, useState } from "react";
import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { connApi, type Adopted, type ConnectError, type Profile, type ServerInfo, type SwitchError } from "./api";
import { connText } from "./connection.i18n";
import { TestResult } from "./ProfileDialog";

type Stage =
  | { kind: "testing" }
  | { kind: "failed"; error: ConnectError | null; text: string | null }
  | { kind: "confirm"; info: ServerInfo; adopted: Adopted | null };

/**
 * 切到一条远程连接（设计稿 ④）。
 *
 * **先试连，通过了才出现确认。**选中另一项不会立即切换：试连没通过就说原因，留在
 * 原来的连接上。确认里说清切换的代价：还指着本机网关的客户端会失败、本机 core
 * 要停、之后各页改的是服务器上的配置。
 *
 * 从远程切回本机不走这里，直接切：本机 core 拉起来，指着服务器的客户端不受影响。
 */
export function SwitchDialog({
  target,
  tested,
  onClose,
  onEdit,
}: {
  target: Profile;
  /** 刚在编辑对话框里试连过：不再试一遍，直接到确认 */
  tested: ServerInfo | null;
  onClose: () => void;
  onEdit: (p: Profile) => void;
}) {
  const t = useText(connText);
  const common = useText(commonText);
  const [stage, setStage] = useState<Stage>(
    tested ? { kind: "confirm", info: tested, adopted: null } : { kind: "testing" },
  );
  const [retarget, setRetarget] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 试连，同时数一数还指着本机的客户端
  useEffect(() => {
    void (async () => {
      const adopted = connApi.preflight().catch(() => null);
      if (!tested) {
        try {
          const r = await connApi.test({
            id: target.id,
            name: target.name,
            host: target.host ?? "",
            port: target.port ?? 0,
            key: null,
          });
          if (!alive.current) return;
          if (r.result === "failed") {
            setStage({ kind: "failed", error: r.error, text: null });
            return;
          }
          setStage({ kind: "confirm", info: r.info, adopted: await adopted });
        } catch (e) {
          if (alive.current) setStage({ kind: "failed", error: null, text: errorText(e) });
        }
        return;
      }
      const a = await adopted;
      if (alive.current) setStage((s) => (s.kind === "confirm" ? { ...s, adopted: a } : s));
    })();
  }, [target, tested]);

  async function commit() {
    setBusy(true);
    try {
      await connApi.switchTo(target.id, retarget);
      onClose();
    } catch (e) {
      const err = e as SwitchError;
      if (err && typeof err === "object" && "kind" in err) {
        setStage({
          kind: "failed",
          error: err.kind === "connect" ? err.error : null,
          text: err.kind === "key_unreadable" ? t.keyUnreadable : err.kind === "unknown" ? t.gone : null,
        });
      } else {
        setStage({ kind: "failed", error: null, text: errorText(e) });
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const title =
    stage.kind === "testing"
      ? t.testingTitle(target.name)
      : stage.kind === "failed"
        ? t.failedTitle(target.name)
        : t.confirmTitle(target.name);
  const adopted = stage.kind === "confirm" ? stage.adopted : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
        </DialogHeader>

        {stage.kind === "testing" && <TestResult result={null} testing />}

        {stage.kind === "failed" &&
          (stage.error ? (
            <TestResult result={{ ok: false, error: stage.error }} testing={false} />
          ) : (
            <p className="tw-body text-destructive">{stage.text}</p>
          ))}

        {stage.kind === "confirm" && (
          <ul className="flex flex-col gap-3 tw-body">
            {adopted && adopted.count > 0 && (
              <li className="flex gap-2.5">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="flex flex-col gap-2">
                  <p>
                    <span className="font-medium">
                      {t.adoptedWarn(adopted.count, adopted.local_addr ?? "127.0.0.1:8788")}
                    </span>
                    {t.adoptedWarnNext(target.name)}
                  </p>
                  <label className="flex items-center gap-2">
                    <Checkbox checked={retarget} onCheckedChange={(v) => setRetarget(v === true)} />
                    {t.retarget(target.name)}
                  </label>
                </div>
              </li>
            )}
            <li className="flex gap-2.5 text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <p>
                <span className="font-medium text-foreground">{t.localStops}</span>
                {t.localKept}
              </p>
            </li>
            <li className="flex gap-2.5 text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <p>{t.remoteConfig(target.name)}</p>
            </li>
          </ul>
        )}

        <DialogFooter>
          {stage.kind === "failed" && (
            <Button variant="outline" className="sm:mr-auto" onClick={() => onEdit(target)}>
              {t.editConnection}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {stage.kind === "failed" ? common.close : common.cancel}
          </Button>
          {stage.kind === "confirm" && (
            <Button disabled={busy} onClick={() => void commit()}>
              {busy && <Spinner />}
              {t.switchAction}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
