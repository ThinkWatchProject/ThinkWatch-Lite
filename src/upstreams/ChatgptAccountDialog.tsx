import { useCallback, useEffect, useState } from "react";
import { CircleAlertIcon, RefreshCwIcon } from "lucide-react";
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
import { Progress } from "@/ui/progress";
import { Spinner } from "@/ui/spinner";
import { when } from "@/format";
import type { ChatgptUsage, ResetCredits, ResetCreditView } from "@/types";
import { api } from "./api";
import { errorText, quotaWindowLabel } from "./labels";

/** 卡的状态词表由上游给，只有这一个能用 */
const AVAILABLE = "available";

/** 上游的状态词。认不出来的原样显示 —— 编不出来的说法比一个陌生的词更糟 */
const STATUS: Record<string, string> = {
  available: "可用",
  redeemed: "已使用",
  expired: "已过期",
  revoked: "已作废",
};

/** 用一张卡的结果 */
const CODES: Record<string, string> = {
  reset: "额度已重置",
  nothing_to_reset: "额度尚未用完，未使用重置卡",
  no_credit: "没有可用的重置卡",
  already_redeemed: "这次操作此前已经完成，额度已在那一次重置",
};

/**
 * ChatGPT 账号的额度与额度重置卡。
 *
 * **重置卡用掉就回不来**，所以只有用户明确点下去、并在确认之后才会用掉一张；
 * 网关自己从不使用。同一次操作重试时带同一个幂等键，上游据此不会重复扣卡。
 */
export function ChatgptAccountDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [usage, setUsage] = useState<ChatgptUsage | null>(null);
  const [credits, setCredits] = useState<ResetCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ResetCreditView | null>(null);
  const [using, setUsing] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, c] = await Promise.all([api.chatgptUsage(name), api.chatgptResets(name)]);
      setUsage(u);
      setCredits(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => {
    void load();
  }, [load]);

  async function use(credit: ResetCreditView) {
    setUsing(true);
    setError(null);
    try {
      // 幂等键按这一次操作生成：重试时不会再扣一张
      const key = `${name}:${credit.id}:${Date.now()}`;
      const r = await api.useChatgptReset(name, credit.id, key);
      setOutcome(CODES[r.code] ?? r.code);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUsing(false);
      setConfirming(null);
    }
  }

  const list = credits?.credits ?? [];

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>额度与重置卡</DialogTitle>
            <DialogDescription>
              上游 <span className="font-mono">{name}</span>
              {usage?.plan && ` · 订阅类型 ${usage.plan}`}
            </DialogDescription>
          </DialogHeader>

          {loading && !usage ? (
            <div className="flex items-center gap-2 tw-body text-muted-foreground">
              <Spinner />
              正在读取
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-2">
                <h3 className="tw-body font-medium">订阅额度</h3>
                {usage && usage.windows.length > 0 ? (
                  usage.windows.map((w) => (
                    <div key={w.window} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between tw-body">
                        <span>{quotaWindowLabel(w.window)}</span>
                        <span className="tabular-nums">{Math.round(w.used_percent)}%</span>
                      </div>
                      <Progress value={Math.min(100, w.used_percent)} />
                      {w.reset_in_secs != null && (
                        <p className="tw-label text-muted-foreground">
                          {when(Date.now() + w.reset_in_secs * 1000)} 重置
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="tw-body text-muted-foreground">上游未报告额度。</p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="tw-body font-medium">
                  额度重置卡{credits && ` · 可用 ${credits.available_count} 张`}
                </h3>
                <p className="tw-label text-muted-foreground">
                  一张重置卡把已用完的额度窗口重置一次。使用之后无法撤回，网关不会自动使用。
                </p>
                {list.length === 0 ? (
                  <p className="tw-body text-muted-foreground">账号上没有重置卡。</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {list.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="tw-body">{c.title ?? "额度重置卡"}</p>
                          <p className="tw-label text-muted-foreground">
                            {STATUS[c.status] ?? c.status}
                            {/* 到期日只对还能用的卡有意义 */}
                            {c.status === AVAILABLE &&
                              c.expires_at &&
                              ` · ${c.expires_at.slice(0, 10)} 到期`}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={c.status !== AVAILABLE || using}
                          onClick={() => setConfirming(c)}
                        >
                          使用…
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {outcome && <p className="tw-body">{outcome}</p>}
              {error && <p className="tw-body text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCwIcon />}
              重新读取
            </Button>
            <Button onClick={onClose}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming != null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>使用一张额度重置卡</AlertDialogTitle>
            <AlertDialogDescription>
              这张卡将被立即使用，用于重置已经用完的额度窗口。使用之后无法撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Alert variant="warning">
            <CircleAlertIcon />
            <AlertTitle>额度尚未用完时不会消耗</AlertTitle>
            <AlertDescription>
              上游在没有需要重置的窗口时直接返回，不扣除这张卡。
            </AlertDescription>
          </Alert>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirming && void use(confirming)}
              disabled={using}
            >
              使用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
