import { useEffect, useState, type ReactNode } from "react";
import { CircleCheckIcon, CopyIcon, ExternalLinkIcon, LoaderCircleIcon, SmartphoneIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { CopyButton } from "@/ui/copy-button";
import { Field, FieldLabel } from "@/ui/field";
import { useText } from "@/i18n";
import { resetAt } from "@/format";
import { useNow } from "@/useNow";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import type { QuotaWindow } from "@/types";
import { api } from "./api";
import type { AccountLogin, LoginParams } from "./accountLogin";
import { accountPanelText } from "./AccountPanel.i18n";
import { quotaWindowLabel } from "./labels";
import { DialogError, VendorTile } from "./parts";
import { QuotaBar } from "./QuotaBar";

/**
 * 登录账号那一块：说明与确认、发起登录、等授权或输码、登上了谁。新建上游的「账号」一步
 * 和 ChatGPT 的重新登录都用它；名称和出站代理在它上面，由用它的地方画。
 *
 * **怎么登录按实际能走的路给**：
 *
 * · ChatGPT 在这台电脑上：默认浏览器、复制登录链接到别的浏览器、设备码，三条都有。
 * · ChatGPT 连着远程 core：**只有设备码** —— 浏览器登录的回调只能回到 core 那台机器的
 *   本机端口，而浏览器开在这台电脑上。
 * · Z.ai / BigModel：浏览器（或复制链接）。授权回的是对方的服务端、core 自己轮询，所以
 *   连着远程 core 也一样能用；它没有设备码。
 *
 * 登录链接、验证网址、设备码**只拿来显示**，复制和打开都按登录 ID 交给 Rust 侧。
 */
export function AccountPanel({
  login,
  params,
  blocked,
  relogin = false,
}: {
  login: AccountLogin;
  /** 发起登录时交给 core 的名称、出站代理、站点 */
  params: LoginParams;
  /** 名称不能用（空的、被占用）：先不能开始 */
  blocked: boolean;
  /** 给已有的账号换一次凭据：此前已经看过并同意了说明，不再拦一次 */
  relogin?: boolean;
}) {
  const t = useText(accountPanelText);
  const remote = useRemote();
  const phase = login.phase;
  const tile = (
    <VendorTile
      name={login.kind === "chatgpt" ? "openai" : params.family}
      baseUrl={login.kind === "chatgpt" ? "https://chatgpt.com" : params.family === "zai" ? "https://api.z.ai" : "https://open.bigmodel.cn"}
      size="lg"
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-7 py-6 text-center">
        {phase.at === "idle" && <Intro login={login} params={params} blocked={blocked} relogin={relogin} tile={tile} />}
        {phase.at === "browser" && (
          <>
            {tile}
            <Title>{t.waitTitle}</Title>
            <Desc>{phase.opened ? t.waitOpened : t.waitCopied}</Desc>
            <Waiting key={phase.expiresAt} expiresAt={phase.expiresAt} text={t.waiting} />
            <UrlRow label={t.link} url={phase.url} onCopy={() => login.copy("url")} copiedAtStart={!phase.opened} />
            <div className="flex flex-wrap items-center justify-center gap-4">
              <LinkButton onClick={login.reopen}>{phase.opened ? t.reopen : t.openPage}</LinkButton>
              {login.kind === "chatgpt" && (
                <LinkButton onClick={() => void login.start("device", params)} pending={login.starting === "device"}>
                  {t.useDevice}
                </LinkButton>
              )}
            </div>
            {login.kind === "zai" && <Desc small>{t.zaiAfter}</Desc>}
          </>
        )}
        {phase.at === "device" && (
          <>
            {tile}
            <Title>{t.deviceTitle}</Title>
            <Desc>{remote ? t.deviceDescRemote(remote.name) : t.deviceDesc}</Desc>
            <div className="mt-1 flex w-full max-w-xl flex-col">
              <Row label={t.verifyUrl}>
                <span className="min-w-0 flex-1 truncate font-mono tw-body select-text" title={phase.url}>
                  {phase.url}
                </span>
                <CopyButton onCopy={() => login.copy("url")} />
                <Button variant="outline" size="sm" onClick={login.reopen}>
                  <ExternalLinkIcon />
                  {t.open}
                </Button>
              </Row>
              <Row label={t.code} last>
                {/* 码要能一眼读准也能选中：字距拉开，等宽字体 */}
                <span className="min-w-0 flex-1 truncate font-mono text-2xl font-medium tracking-[0.2em] tw-num select-text">
                  {phase.code}
                </span>
                <CopyButton onCopy={() => login.copy("code")} />
              </Row>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 tw-body text-muted-foreground">
              <Waiting key={phase.expiresAt} expiresAt={phase.expiresAt} text={t.deviceWaiting} bare />
              <span aria-hidden>·</span>
              <LinkButton onClick={() => void login.start("device", params)} pending={login.starting === "device"}>
                {t.newCode}
              </LinkButton>
            </div>
            {/* Codex 也有这一句：拿着别人给的码去输，等于把自己的账号授权给对方 */}
            <Desc small>{t.deviceWarning}</Desc>
            {!remote && (
              <LinkButton onClick={() => void login.start("browser", params)} pending={login.starting === "browser"}>
                {t.useBrowser}
              </LinkButton>
            )}
          </>
        )}
        {phase.at === "done" && <Done login={login} relogin={relogin} />}
      </div>
      <DialogError error={login.error} />
    </div>
  );
}

/** 开始之前：这是什么、要知道的几点、确认、怎么登录 */
function Intro({
  login,
  params,
  blocked,
  relogin,
  tile,
}: {
  login: AccountLogin;
  params: LoginParams;
  blocked: boolean;
  relogin: boolean;
  tile: ReactNode;
}) {
  const t = useText(accountPanelText);
  const rt = useText(remoteText);
  const remote = useRemote();
  // 重新登录的人此前已经看过并同意了这些
  const [understood, setUnderstood] = useState(relogin);
  const chatgpt = login.kind === "chatgpt";
  const where = remote ? t.server(remote.name) : t.here;
  const site = params.family === "zai" ? "Z.ai" : "BigModel";
  const canStart = !blocked && understood && login.starting === null;
  /** ChatGPT 连着远程 core 只能用设备码 */
  const deviceOnly = chatgpt && remote != null;

  return (
    <>
      {tile}
      <Title>{chatgpt ? t.chatgptTitle : t.zaiTitle(site)}</Title>
      <Desc>{chatgpt ? t.chatgptDesc : t.zaiDesc}</Desc>
      {!relogin && (
        <>
          <ul className="mt-1 flex w-full max-w-xl list-disc flex-col gap-1 border-t border-border pt-3 pl-5 text-left tw-body text-muted-foreground">
            {chatgpt ? (
              <>
                <li>{t.noticeOfficial}</li>
                <li>{t.noticeCredential(where)}</li>
              </>
            ) : (
              <>
                <li>{t.noticeTheirPage}</li>
                <li>{t.noticeKey}</li>
                <li>{t.noticeKeyStorage(where)}</li>
              </>
            )}
          </ul>
          {/* 勾选框和文字**分开挂**：套在一个 label 里点一下会切换两次，等于点不动 */}
          <Field orientation="horizontal" className="w-full max-w-xl">
            <Checkbox id="login-understood" checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} />
            <FieldLabel htmlFor="login-understood" className="font-normal">
              {t.understood}
            </FieldLabel>
          </Field>
        </>
      )}
      {deviceOnly && <Desc small>{rt.deviceOnly(remote.name)}</Desc>}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        {!deviceOnly && (
          <Button size="lg" className="px-4" onClick={() => void login.start("browser", params)} pending={login.starting === "browser"} disabled={!canStart}>
            {login.starting !== "browser" && <ExternalLinkIcon />}
            {t.signInBrowser}
          </Button>
        )}
        {chatgpt && (
          <Button
            size="lg"
            className="px-4"
            variant={deviceOnly ? "default" : "outline"}
            onClick={() => void login.start("device", params)}
            pending={login.starting === "device"}
            disabled={!canStart}
          >
            {login.starting !== "device" && <SmartphoneIcon />}
            {t.signInDevice}
          </Button>
        )}
      </div>
      {/* 登录链接要先开始一次登录才有（里面带着这一次的凭证），所以复制它就是开始登录、不开默认浏览器 */}
      {!deviceOnly && (
        <div className="flex flex-col items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void login.start("link", params)}
            pending={login.starting === "link"}
            disabled={!canStart}
          >
            {login.starting !== "link" && <CopyIcon />}
            {t.copyLink}
          </Button>
          <Desc small>{t.linkHint}</Desc>
        </div>
      )}
    </>
  );
}

/** 登上了：哪个上游、哪个账号，ChatGPT 再带上额度 */
function Done({ login, relogin }: { login: AccountLogin; relogin: boolean }) {
  const t = useText(accountPanelText);
  const phase = login.phase;
  const [windows, setWindows] = useState<QuotaWindow[] | null>(null);
  const provider = phase.at === "done" ? phase.provider : null;
  // 额度只有 ChatGPT 账号能当场问到；问不到就不写，不耽误往下走
  useEffect(() => {
    if (!provider || login.kind !== "chatgpt") return;
    let alive = true;
    api
      .chatgptUsage(provider)
      .then((u) => alive && setWindows(u.windows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [provider, login.kind]);
  const now = useNow();
  if (phase.at !== "done") return null;
  const a = phase.account;
  const name = <span className="font-mono text-foreground">{phase.provider}</span>;
  return (
    <>
      <CircleCheckIcon className="size-10 text-success" strokeWidth={1.6} aria-hidden />
      <Title>{t.doneTitle}</Title>
      <Desc>{relogin ? t.reloginDone(name) : t.done(name)}</Desc>
      {a && (
        <div className="mt-1 flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3 text-left">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted tw-body font-semibold text-muted-foreground"
          >
            {(a.who ?? a.plan ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            {a.who && <span className="truncate tw-body font-medium">{a.who}</span>}
            {a.plan && <span className="truncate tw-label text-muted-foreground">ChatGPT {a.plan}</span>}
          </div>
          {windows && windows.length > 0 && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {windows.map((w) => {
                const pct = Math.round(w.used_percent);
                const label = t.quotaUsed(quotaWindowLabel(w.window), pct);
                const reset = resetAt(w.resets_at_ms, now);
                return (
                  <div key={w.window} className="flex flex-col items-end gap-1">
                    <QuotaBar percent={w.used_percent} label={label} className="w-28" />
                    <span className="tw-label tw-num text-muted-foreground">
                      {label}
                      {reset && ` · ${t.resets(reset)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <p className="tw-title font-semibold">{children}</p>;
}

function Desc({ children, small = false }: { children: ReactNode; small?: boolean }) {
  return <p className={cn("max-w-xl text-muted-foreground", small ? "tw-label" : "tw-body")}>{children}</p>;
}

/**
 * 转圈的一行：还在等，多久之内有效。分钟按剩下的往上取整。换了一次登录（重新获取）时
 * 由外面按到期时刻换一个 key 重新挂上：手上的「现在」不能比新的那次登录还早
 */
function Waiting({
  expiresAt,
  text,
  bare = false,
}: {
  expiresAt: number;
  text: (min: number) => string;
  bare?: boolean;
}) {
  const now = useNow(15_000);
  const min = Math.max(1, Math.ceil((expiresAt - now) / 60_000));
  return (
    <span className={cn("inline-flex items-center gap-2 tw-body text-muted-foreground", !bare && "mt-0.5")} role="status">
      <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
      {text(min)}
    </span>
  );
}

/** 登录链接一行：链接本身（截断、能选中）和复制。用复制开始的那一次，按钮一开始就是「已复制」 */
function UrlRow({
  label,
  url,
  onCopy,
  copiedAtStart,
}: {
  label: string;
  url: string;
  onCopy: () => Promise<void>;
  copiedAtStart: boolean;
}) {
  return (
    <div className="mt-1 flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-background pr-1 pl-3">
      <span className="shrink-0 tw-label text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-left font-mono tw-label select-text" title={url}>
        {url}
      </span>
      <CopyButton onCopy={onCopy} flashAtStart={copiedAtStart} />
    </div>
  );
}

/** 设备码那两行：左边一个固定宽的名字，中间是值，右边是按钮 */
function Row({ label, last = false, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2.5 py-2.5 text-left", !last && "border-b border-border")}>
      <span className="w-28 shrink-0 tw-label text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** 一行字的次要操作（重新打开、改用另一种方式），下划线链接的样子 */
function LinkButton({
  onClick,
  pending = false,
  children,
}: {
  onClick: () => void;
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-sm tw-body text-foreground/85 underline decoration-foreground/30 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {pending && <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
