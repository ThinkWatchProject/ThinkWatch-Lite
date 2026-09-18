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
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Progress } from "@/ui/progress";
import { Spinner } from "@/ui/spinner";
import { resetIn } from "@/format";
import type { ChatgptUsage, Overview, ProviderView, ResetCredits, ResetCreditView } from "@/types";
import { api } from "./api";
import { errorText, proxyKindLabel, quotaWindowLabel } from "./labels";
import { FormItem } from "./parts";
import type { UpstreamForm } from "./upstreamForm";

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
 * ChatGPT 账号上游的「账号」一节：叫什么、从哪出去、登录状态、还剩多少额度。
 *
 * 这一家没有可填的连接信息 —— 地址、协议、凭据都由登录决定，**把它们摆成
 * 输入框只会让人以为可以改**。
 *
 * **重置卡用掉就回不来**，所以只有用户明确点下去、并在确认之后才会用掉一张；
 * 网关自己从不使用。同一次操作重试时带同一个幂等键，上游据此不会重复扣卡。
 */
export function ChatgptAccountSection({
  form,
  set,
  editing,
  ov,
  onRelogin,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  editing: ProviderView;
  ov: Overview;
  onRelogin: () => void;
}) {
  const name = editing.name;
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

  // 额度只在 core 的内存里：冷启动之后第一次打开就去问一次
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
  const available = list.filter((c) => c.status === AVAILABLE);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-4">
        <FormItem label="名称" htmlFor="cg-name" desc="配置中这个上游的名称">
          <Input
            id="cg-name"
            className="font-mono"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FormItem>
        <FormItem label="出站方式" htmlFor="cg-proxy" desc="登录与后续请求都经此发出">
          <NativeSelect
            id="cg-proxy"
            value={form.proxy}
            onChange={(e) => set({ proxy: e.target.value })}
          >
            <NativeSelectOption value="direct">直连</NativeSelectOption>
            <NativeSelectOption value="system">系统代理</NativeSelectOption>
            {(ov.proxies ?? []).map((x) => (
              <NativeSelectOption key={x.name} value={x.name}>
                {x.name} · {proxyKindLabel(x.kind)} {x.addr}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormItem>
      </div>

      <LoginBox editing={editing} plan={usage?.plan ?? null} onRelogin={onRelogin} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="tw-head font-medium">订阅额度</h3>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCwIcon />}
            重新读取
          </Button>
        </div>
        {loading && !usage ? (
          <p className="tw-body text-muted-foreground">正在读取</p>
        ) : usage && usage.windows.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {usage.windows.map((w) => {
              const reset = resetIn(w.reset_in_secs);
              return (
                <div key={w.window} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between tw-body">
                    <span>{quotaWindowLabel(w.window)}窗口</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.round(w.used_percent)}%{reset && ` · ${reset}重置`}
                    </span>
                  </div>
                  <Progress value={Math.min(100, w.used_percent)} />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="tw-body text-muted-foreground">上游未报告额度。</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="tw-head font-medium">
            额度重置卡{credits && ` · 可用 ${available.length} 张`}
          </h3>
        </div>
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
                    {c.status === AVAILABLE && c.expires_at && ` · ${c.expires_at.slice(0, 10)} 到期`}
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
            <AlertDialogAction onClick={() => confirming && void use(confirming)} disabled={using}>
              使用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 登录状态：**凭据失效时这里是唯一的出路**，所以它自己就带着重新登录 */
function LoginBox({
  editing,
  plan,
  onRelogin,
}: {
  editing: ProviderView;
  plan: string | null;
  onRelogin: () => void;
}) {
  const oauth = editing.oauth;
  const broken = oauth?.needs_login === true;
  const expires = oauth?.expires_at ? Date.parse(oauth.expires_at) : NaN;
  const left = Number.isNaN(expires) ? null : resetIn((expires - Date.now()) / 1000);
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="tw-body font-medium">
            {broken ? "登录已失效" : "已登录"}
            {plan && !broken && ` · ${plan}`}
          </p>
          <p className="tw-label text-muted-foreground">
            {broken
              ? (oauth?.failure ?? "需要重新登录才能继续使用这个上游。")
              : `${left ? `凭据 ${left}过期，到期前自动续期 · ` : ""}请求计入订阅额度，不计算费用`}
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onRelogin}>
          重新登录
        </Button>
      </div>
    </div>
  );
}
