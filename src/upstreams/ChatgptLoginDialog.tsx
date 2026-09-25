import { useEffect, useRef, useState } from "react";
import { CopyIcon, ExternalLinkIcon, SmartphoneIcon } from "lucide-react";
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
import { StatusLabel } from "@/ui/status-dot";
import type { ChatgptLoginMode, ChatgptLoginStatus, ChatgptPlan, CoreEvent, Overview } from "@/types";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { api } from "./api";
import { chatgptLoginText } from "./ChatgptLoginDialog.i18n";
import { coreText, errorText, planLabel, proxyKindLabel, shortUrl } from "./labels";
import { DialogError, FormItem } from "./parts";
import { freeName } from "./upstreamForm";
import { useSystemProxyLabel } from "@/connection/Remote";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";

/** 登录还没结果时，多久问一次 core。事件是主路，这是它的兜底 */
const POLL_MS = 2_000;

type Phase =
  | { at: "form" }
  /** 授权页已经在这台机器的浏览器里打开 */
  | { at: "browser"; id: string }
  /** 码已经拿到，等用户在另一台设备上输 */
  | { at: "device"; id: string; code: string; url: string }
  | { at: "done"; provider: string; plan: ChatgptPlan | null };

/**
 * 用 ChatGPT 账号新建上游，或给已有的账号换一次凭据。
 *
 * **在哪台设备上授权由用户选**：这台机器的浏览器，或者把一个码输到另一台已经登录
 * 的设备上 —— 后者是这台机器上没有浏览器、或者浏览器登不进去时唯一的路。两条路
 * 的凭据都由 core 写进配置。**登录只能有一次在进行**，所以离开时要收尾。
 */
export function ChatgptLoginDialog({
  ov,
  relogin,
  onClose,
  onSaved,
}: {
  ov: Overview;
  /** 给这个已有的账号换一次凭据：名称固定，出站方式沿用它的 */
  relogin?: { name: string; proxy: string };
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(chatgptLoginText);
  const systemProxy = useSystemProxyLabel(t.systemProxy);
  /**
   * 连着远程 core 时**只给设备码**：浏览器登录的回调只能回到 core 那台机器的
   * 1455 / 1457 端口，而浏览器开在这台机器上
   */
  const remote = useRemote();
  const rt = useText(remoteText);
  const common = useText(commonText);
  const proxies = ov.proxies;
  const taken = ov.providers.map((p) => p.name);
  const [name, setName] = useState(() => relogin?.name ?? freeName("chatgpt", taken));
  const [proxy, setProxy] = useState(relogin?.proxy ?? "direct");
  // 重新登录的人此前已经看过并同意了这些，不再拦一次
  const [understood, setUnderstood] = useState(relogin != null);
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  /** 正在发起哪一种登录。两条路各有一个按钮，转圈的是被点的那个 */
  const [starting, setStarting] = useState<ChatgptLoginMode | null>(null);
  const busy = starting !== null;
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 卸载之后不要再写状态：等待期间用户可能直接关掉对话框。
  // **挂载时要置回来** —— 开发模式下 effect 会先跑一遍再清理再跑一遍，
  // 只在清理里置 false 的话，第二次挂载起就一直是「已卸载」
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const waiting = phase.at === "browser" || phase.at === "device" ? phase.id : null;

  function settle(s: ChatgptLoginStatus) {
    if (!alive.current || s.status === "pending") return;
    if (s.status === "done" && s.provider) {
      setPhase({ at: "done", provider: s.provider, plan: s.plan ?? null });
      onSaved(s.provider);
      return;
    }
    setPhase({ at: "form" });
    const text = textOf(chatgptLoginText);
    setError(s.error ? coreText(s.error) : s.status === "expired" ? text.expired : text.cancelled);
  }

  // 结果由 core 发事件，不必一直问；问一遍是为了事件漏掉时也能收尾
  useEffect(() => {
    if (!waiting) return;
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind !== "login_finished" || ev.login !== waiting) return;
      settle({
        id: ev.login,
        status: ev.status,
        provider: ev.provider ?? null,
        error: ev.error ?? null,
      });
    });
    const t = setInterval(() => {
      api
        .chatgptLoginStatus(waiting)
        .then(settle)
        .catch(() => {
          // 控制面一时不通：下一轮再问
        });
    }, POLL_MS);
    return () => {
      void un.then((f) => f());
      clearInterval(t);
    };
    // settle 每次渲染都是新的，但订阅只该跟着这次登录重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  async function start(mode: ChatgptLoginMode) {
    setStarting(mode);
    setError(null);
    try {
      const login = await api.startChatgptLogin(name.trim(), proxy, mode);
      if (!alive.current) return;
      setPhase(
        login.user_code && login.verification_url
          ? {
              at: "device",
              id: login.id,
              code: login.user_code,
              url: login.verification_url,
            }
          : { at: "browser", id: login.id },
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(null);
    }
  }

  async function cancel() {
    if (waiting) {
      try {
        await api.cancelChatgptLogin(waiting);
      } catch {
        // 取消失败也要关掉：它最多在 15 分钟后自己过期
      }
    }
    onClose();
  }

  const nameTaken = !relogin && taken.includes(name.trim()) && phase.at === "form";
  const canStart = name.trim().length > 0 && !nameTaken && understood && !busy;
  const planName = phase.at === "done" ? planLabel(phase.plan) : null;

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
                  <li>{t.noticeOfficial}</li>
                  <li>{t.noticeHonest}</li>
                  <li>{t.noticeStorage}</li>
                  <li>{t.noticeRevoke}</li>
                </ul>
              </Banner>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormItem label={t.name} htmlFor="cg-name" desc={t.nameDesc}>
                <Input
                  id="cg-name"
                  className="font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={relogin != null}
                  aria-invalid={nameTaken}
                />
                {nameTaken && <p className="tw-label text-destructive">{t.nameTaken}</p>}
              </FormItem>
              <FormItem label={t.proxy} htmlFor="cg-proxy" desc={t.proxyDesc}>
                <NativeSelect
                  id="cg-proxy"
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

            {remote && <p className="tw-label text-muted-foreground">{rt.deviceOnly(remote.name)}</p>}

            {/* 勾选框和文字**分开挂**：套在一个 label 里点一下会切换两次，等于点不动 */}
            {!relogin && (
            <Field orientation="horizontal" className="w-auto">
              <Checkbox
                id="cg-understood"
                checked={understood}
                onCheckedChange={(v) => setUnderstood(v === true)}
              />
              <FieldLabel htmlFor="cg-understood" className="font-normal">
                {t.understood}
              </FieldLabel>
            </Field>
            )}
          </div>
        )}

        {phase.at === "browser" && (
          <div className="flex flex-col gap-3">
            <StatusLabel tone="pending">{t.browserWaiting}</StatusLabel>
            <p className="tw-label text-muted-foreground">{t.browserHint}</p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  api.reopenChatgptLogin(phase.id).catch((e) => setError(errorText(e)));
                }}
              >
                <ExternalLinkIcon />
                {t.reopen}
              </Button>
            </div>
          </div>
        )}

        {phase.at === "device" && (
          <div className="flex flex-col gap-3">
            <p className="tw-body">
              {t.deviceStep(<span className="font-mono text-foreground">{shortUrl(phase.url)}</span>)}
            </p>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
              {/* 码要能一眼读准也能选中：字距拉开，等宽字体 */}
              <span className="select-text font-mono text-2xl tracking-[0.2em] tw-num">
                {phase.code}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCopied(false);
                  api
                    .copyChatgptCode(phase.id)
                    .then(() => setCopied(true))
                    .catch((e) => setError(errorText(e)));
                }}
              >
                <CopyIcon />
                {copied ? common.copied : common.copy}
              </Button>
            </div>
            <StatusLabel tone="pending">{t.deviceWaiting}</StatusLabel>
            {/* Codex 也有这一句：拿着别人给的码去输，等于把自己的账号授权给对方 */}
            <p className="tw-label text-muted-foreground">{t.deviceWarning}</p>
          </div>
        )}

        {phase.at === "done" && (
          <div className="flex flex-col gap-2 tw-body">
            <p>
              {t.done(<span className="font-mono">{phase.provider}</span>)}
              {planName && ` ${t.plan(planName)}`}
            </p>
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
                <>
                  {remote ? (
                    <Button onClick={() => void start("device")} pending={busy} disabled={!canStart}>
                      {!busy && <SmartphoneIcon />}
                      {rt.signInWithCode}
                    </Button>
                  ) : (
                    <>
                      {/* 次要的那条路先摆：主按钮留在最右边 */}
                      <Button
                        variant="outline"
                        onClick={() => void start("device")}
                        pending={starting === "device"}
                        disabled={!canStart}
                      >
                        {starting !== "device" && <SmartphoneIcon />}
                        {t.otherDevice}
                      </Button>
                      <Button onClick={() => void start("browser")} pending={starting === "browser"} disabled={!canStart}>
                        {starting !== "browser" && <ExternalLinkIcon />}
                        {t.thisComputer}
                      </Button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
