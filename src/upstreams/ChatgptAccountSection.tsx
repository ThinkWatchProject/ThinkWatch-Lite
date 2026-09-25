import { useCallback, useEffect, useState } from "react";
import { useSystemProxyLabel } from "@/connection/Remote";
import { RefreshCwIcon } from "lucide-react";
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
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { notify } from "@/ui/notify";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { resetAt, resetIn } from "@/format";
import { useNow } from "@/useNow";
import type { ChatgptUsage, Overview, ProviderView, ResetCredits, ResetCreditView } from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { api } from "./api";
import { chatgptAccountText } from "./ChatgptAccountSection.i18n";
import { coreText, errorText, planLabel, proxyKindLabel, quotaWindowLabel } from "./labels";
import { DialogError, FormItem } from "./parts";
import { QuotaBar } from "./QuotaBar";
import type { UpstreamForm } from "./upstreamForm";

/** 卡的状态词表由上游给，只有这一个能用 */
const AVAILABLE = "available";

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
  const t = useText(chatgptAccountText);
  const systemProxy = useSystemProxyLabel(t.systemProxy);
  const common = useText(commonText);
  const now = useNow();
  /** 上游的状态词。认不出来的原样显示 —— 编不出来的说法比一个陌生的词更糟 */
  const status: Record<string, string> = t.status;
  /** 用一张卡的结果 */
  const codes: Record<string, string> = t.codes;
  const name = editing.name;
  const [usage, setUsage] = useState<ChatgptUsage | null>(null);
  const [credits, setCredits] = useState<ResetCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ResetCreditView | null>(null);
  const [using, setUsing] = useState(false);

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
      // 结果是一句话：重置了（额度条随之变回去），或者没有用卡的原因
      const said = codes[r.code] ?? r.code;
      if (r.code === "reset") notify.success(said);
      else notify.info(said);
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
        <FormItem label={t.name} htmlFor="cg-name" desc={t.nameDesc}>
          <Input
            id="cg-name"
            className="font-mono"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </FormItem>
        <FormItem label={t.egress} htmlFor="cg-proxy" desc={t.egressDesc}>
          <NativeSelect
            id="cg-proxy"
            value={form.proxy}
            onChange={(e) => set({ proxy: e.target.value })}
          >
            <NativeSelectOption value="direct">{t.direct}</NativeSelectOption>
            <NativeSelectOption value="system">{systemProxy}</NativeSelectOption>
            {ov.proxies.map((x) => (
              <NativeSelectOption key={x.name} value={x.name}>
                {x.name} · {proxyKindLabel(x.kind)} {x.addr}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormItem>
      </div>

      <LoginBox editing={editing} onRelogin={onRelogin} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="tw-head font-medium">{t.quota}</h3>
          <Button variant="ghost" size="sm" onClick={() => void load()} pending={loading}>
            {!loading && <RefreshCwIcon />}
            {t.reload}
          </Button>
        </div>
        {loading && !usage ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-3.5">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-24 rounded-sm" />
                  <Skeleton className="h-3 w-32 rounded-sm" />
                </div>
                <Skeleton className="h-1 w-full rounded-full" />
              </div>
            ))}
          </div>
        ) : usage && usage.windows.length > 0 ? (
          <div className="flex flex-col gap-2.5 motion-fade">
            {usage.windows.map((w) => {
              const reset = resetAt(w.resets_at_ms, now);
              return (
                <div key={w.window} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between tw-body">
                    <span>{t.window(quotaWindowLabel(w.window))}</span>
                    <span className="tw-num text-muted-foreground">
                      {t.used(Math.round(w.used_percent))}
                      {reset && ` · ${t.resets(reset)}`}
                    </span>
                  </div>
                  <QuotaBar percent={w.used_percent} label={t.window(quotaWindowLabel(w.window))} />
                </div>
              );
            })}
          </div>
        ) : usage ? (
          <p className="tw-body text-muted-foreground">{t.noQuota}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="tw-head font-medium">
            {t.credits}
            {credits && ` · ${t.available(available.length)}`}
          </h3>
        </div>
        <p className="tw-label text-muted-foreground">{t.creditsNote}</p>
        {!credits ? null : list.length === 0 ? (
          <p className="tw-body text-muted-foreground">{t.noCredits}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="tw-body">{c.title ?? t.credit}</p>
                  <p className="tw-label text-muted-foreground">
                    {status[c.status] ?? c.status}
                    {/* 到期日只对还能用的卡有意义 */}
                    {c.status === AVAILABLE && c.expires_at && ` · ${t.expires(c.expires_at.slice(0, 10))}`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={c.status !== AVAILABLE || using}
                  onClick={() => setConfirming(c)}
                >
                  {t.useEllipsis}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DialogError error={error} />

      <AlertDialog open={confirming != null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.confirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <Banner layout="inline" tone="warning" title={t.notConsumedTitle}>
            {t.notConsumedDesc}
          </Banner>
          <AlertDialogFooter>
            <AlertDialogCancel>{common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={using}
              aria-busy={using || undefined}
              onClick={(e) => {
                // 用完再关：结果和原因要等上游答复
                e.preventDefault();
                if (confirming) void use(confirming);
              }}
            >
              {using && <Spinner data-icon="inline-start" aria-hidden />}
              {t.use}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * 登录状态。
 *
 * 先说**登的是哪个账号** —— 上游的名字是用户自己取的，说明不了这一条。
 * **凭据失效时这里是唯一的出路**，所以它自己就带着重新登录。
 */
function LoginBox({ editing, onRelogin }: { editing: ProviderView; onRelogin: () => void }) {
  const t = useText(chatgptAccountText);
  const oauth = editing.oauth;
  // 账号和套餐是 core 从凭据的令牌里读的：凭据失效之后仍是最后登着的那个
  const email = oauth?.account?.email ?? null;
  const plan = oauth?.account?.plan;
  const broken = oauth?.needs_login === true;
  const expires = oauth?.expires_at ? Date.parse(oauth.expires_at) : NaN;
  const left = Number.isNaN(expires) ? null : resetIn((expires - Date.now()) / 1000);
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate tw-body font-medium" title={email ?? undefined}>
            {broken ? t.loginInvalid : (email ?? t.signedIn)}
            {planLabel(plan) && !broken && ` · ${planLabel(plan)}`}
          </p>
          {broken ? (
            <p className="tw-label text-muted-foreground">{oauth?.failure ? coreText(oauth.failure) : t.needsLogin}</p>
          ) : (
            left && <p className="tw-label text-muted-foreground">{t.credentialExpires(left)}</p>
          )}
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onRelogin}>
          {t.relogin}
        </Button>
      </div>
    </div>
  );
}
