import { useEffect, useRef, useState } from "react";
import { useSystemProxyLabel } from "@/connection/Remote";
import { ExternalLinkIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Field, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import type { CoreEvent, Overview, ZaiFamily, ZaiLoginStatus } from "@/types";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { api } from "./api";
import { zaiLoginText } from "./ZaiLoginDialog.i18n";
import { coreText, errorText, proxyKindLabel, shortUrl } from "./labels";
import { DialogError, FormItem } from "./parts";
import { ZAI_ENDPOINTS } from "./presets";
import { freeName } from "./upstreamForm";

/** 登录还没结果时，多久问一次 core。事件是主路，这是它的兜底 */
const POLL_MS = 2_000;

type Phase =
  | { at: "form" }
  /** 授权页已经在这台机器的浏览器里打开 */
  | { at: "waiting"; id: string }
  | { at: "done"; provider: string; account: string | null };

/**
 * 用 Z.ai 或 BigModel 账号新建上游，或给已有的换一把密钥。
 *
 * **只有一条路：这台机器上的浏览器。**授权回的是对方自己的服务端，所以既没有
 * 「在另一台设备上输码」那条路（那要对方支持），也没有「返回 ThinkWatch」那一步 ——
 * 登录成没成由 core 轮询出来，再通过事件告诉这里。
 */
export function ZaiLoginDialog({
  ov,
  relogin,
  onClose,
  onSaved,
}: {
  ov: Overview;
  /** 给这个已有的上游换一把密钥：名称固定，账号归属和出站方式沿用它的 */
  relogin?: { name: string; proxy: string; family: ZaiFamily };
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(zaiLoginText);
  const systemProxy = useSystemProxyLabel(t.systemProxy);
  const common = useText(commonText);
  const proxies = ov.proxies;
  const taken = ov.providers.map((p) => p.name);
  const [family, setFamily] = useState<ZaiFamily>(relogin?.family ?? "zai");
  const [name, setName] = useState(() => relogin?.name ?? freeName("zai", taken));
  const [proxy, setProxy] = useState(relogin?.proxy ?? "direct");
  // 重新登录的人此前已经看过并同意了这些，不再拦一次
  const [understood, setUnderstood] = useState(relogin != null);
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 卸载之后不要再写状态：等待期间用户可能直接关掉对话框。
  // **挂载时要置回来** —— 开发模式下 effect 会先跑一遍再清理再跑一遍
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const waiting = phase.at === "waiting" ? phase.id : null;
  /** 已经收过尾的那次登录。事件和轮询都会报结果，只收一次 */
  const settled = useRef<string | null>(null);

  function settle(s: ZaiLoginStatus) {
    if (!alive.current || s.status === "pending" || settled.current === s.id) return;
    settled.current = s.id;
    if (s.status === "done" && s.provider) {
      setPhase({ at: "done", provider: s.provider, account: s.account ?? null });
      onSaved(s.provider);
      return;
    }
    setPhase({ at: "form" });
    const text = textOf(zaiLoginText);
    setError(s.error ? coreText(s.error) : s.status === "expired" ? text.expired : text.cancelled);
  }

  // 结果由 core 发事件，不必一直问；问一遍是为了事件漏掉时也能收尾
  useEffect(() => {
    if (!waiting) return;
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind !== "login_finished" || ev.login !== waiting) return;
      // 事件只报结果，不带登上的是哪个账号：那一项只在这次登录的状态里。立刻问一次，
      // 问不到就按事件收尾
      api.zaiLoginStatus(ev.login).then(settle, () =>
        settle({
          id: ev.login,
          status: ev.status,
          provider: ev.provider ?? null,
          error: ev.error ?? null,
        }),
      );
    });
    const timer = setInterval(() => {
      api
        .zaiLoginStatus(waiting)
        .then(settle)
        .catch(() => {
          // 控制面一时不通：下一轮再问
        });
    }, POLL_MS);
    return () => {
      void un.then((f) => f());
      clearInterval(timer);
    };
    // settle 每次渲染都是新的，但订阅只该跟着这次登录重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const login = await api.startZaiLogin(family, name.trim(), proxy);
      if (!alive.current) return;
      setPhase({ at: "waiting", id: login.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (waiting) {
      try {
        await api.cancelZaiLogin(waiting);
      } catch {
        // 取消失败也要关掉：它最多在 15 分钟后自己过期
      }
    }
    onClose();
  }

  // 同名的上游已经是这一家的话，登录换的是它的密钥 —— 那不是冲突，要说清是替换
  const existing = ov.providers.find((p) => p.name === name.trim());
  const replaces =
    existing != null && existing.base_url === ZAI_ENDPOINTS[family] && !relogin;
  const nameTaken = !relogin && !replaces && existing != null && phase.at === "form";
  const canStart = name.trim().length > 0 && !nameTaken && understood && !busy;

  return (
    <Dialog open onOpenChange={(o) => !o && void cancel()}>
      {/* 点到外面不关：登录进行中时关掉就是放弃这一次登录。Esc、×、取消照常 */}
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{relogin ? t.reloginTitle : t.title}</DialogTitle>
          <DialogDescription>
            {relogin ? t.reloginDesc(<span className="font-mono">{relogin.name}</span>) : t.desc}
          </DialogDescription>
        </DialogHeader>

        {phase.at === "form" && (
          <div className="flex flex-col gap-4">
            {!relogin && (
              <Banner layout="inline" tone="warning" title={t.noticeTitle}>
                <ul className="list-disc pl-4 [&>li]:mt-1">
                  <li>{t.noticeTheirPage}</li>
                  <li>{t.noticeKey}</li>
                  <li>{t.noticeHonest}</li>
                  <li>{t.noticeStorage}</li>
                </ul>
              </Banner>
            )}

            <FormItem
              label={t.service}
              desc={t.serviceDesc(
                <span className="font-mono">{shortUrl(ZAI_ENDPOINTS[family])}</span>,
              )}
            >
              <div className="flex h-8 items-center">
                <Segmented
                  value={family}
                  options={[
                    { id: "zai" as ZaiFamily, label: "Z.ai" },
                    { id: "bigmodel" as ZaiFamily, label: "BigModel" },
                  ]}
                  onChange={setFamily}
                  disabled={relogin != null}
                  label={t.service}
                />
              </div>
            </FormItem>

            <div className="grid grid-cols-2 gap-4">
              <FormItem label={t.name} htmlFor="zai-name" desc={t.nameDesc}>
                <Input
                  id="zai-name"
                  className="font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={relogin != null}
                  aria-invalid={nameTaken}
                />
                {nameTaken && <p className="tw-label text-destructive">{t.nameTaken}</p>}
                {replaces && <p className="tw-label text-muted-foreground">{t.nameReplaces}</p>}
              </FormItem>
              <FormItem label={t.proxy} htmlFor="zai-proxy" desc={t.proxyDesc}>
                <NativeSelect
                  id="zai-proxy"
                  className="w-full"
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                >
                  <NativeSelectOption value="direct">{t.direct}</NativeSelectOption>
                  <NativeSelectOption value="system">{systemProxy}</NativeSelectOption>
                  {proxies.map((x) => (
                    <NativeSelectOption key={x.name} value={x.name}>
                      {x.name} · {proxyKindLabel(x.kind)} {x.addr}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormItem>
            </div>

            {/* 勾选框和文字**分开挂**：套在一个 label 里点一下会切换两次，等于点不动 */}
            {!relogin && (
              <Field orientation="horizontal" className="w-auto">
                <Checkbox
                  id="zai-understood"
                  checked={understood}
                  onCheckedChange={(v) => setUnderstood(v === true)}
                />
                <FieldLabel htmlFor="zai-understood" className="font-normal">
                  {t.understood}
                </FieldLabel>
              </Field>
            )}
          </div>
        )}

        {phase.at === "waiting" && (
          <div className="flex flex-col gap-3">
            <StatusLabel tone="pending">{t.waiting}</StatusLabel>
            <p className="tw-label text-muted-foreground">{t.hint}</p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  api.reopenZaiLogin(phase.id).catch((e) => setError(errorText(e)));
                }}
              >
                <ExternalLinkIcon />
                {t.reopen}
              </Button>
            </div>
          </div>
        )}

        {phase.at === "done" && (
          <div className="flex flex-col gap-2 tw-body">
            {/* 登上的账号单独一行，和 ChatGPT 账号登录完成时一样 */}
            <div>
              <p>{t.done(<span className="font-mono">{phase.provider}</span>)}</p>
              {phase.account && <p>{t.account(phase.account)}</p>}
            </div>
            <p className="tw-label text-muted-foreground">{t.doneHint}</p>
          </div>
        )}

        <DialogError error={error} />

        <DialogFooter>
          {phase.at === "done" ? (
            <Button onClick={onClose}>{t.finish}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void cancel()}>
                {common.cancel}
              </Button>
              {phase.at === "form" && (
                <Button onClick={() => void start()} pending={busy} disabled={!canStart}>
                  {!busy && <ExternalLinkIcon />}
                  {t.signIn}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
