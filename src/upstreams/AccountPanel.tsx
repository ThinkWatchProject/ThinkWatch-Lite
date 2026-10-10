import { useEffect, useState, type ReactNode } from "react";
import { CircleCheckIcon, CopyIcon, ExternalLinkIcon, LoaderCircleIcon, SmartphoneIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { CopyButton } from "@/ui/copy-button";
import { Field, FieldLabel } from "@/ui/field";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { resetAt } from "@/format";
import { useNow } from "@/useNow";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import type { QuotaWindow, ZaiFamily } from "@/types";
import { api } from "./api";
import type { AccountLogin, LoginAccount, LoginKind, LoginParams } from "./accountLogin";
import { accountPanelText } from "./AccountPanel.i18n";
import { quotaWindowLabel } from "./labels";
import { DialogError, SummaryRow, VendorTile } from "./parts";
import { QuotaBar } from "./QuotaBar";

/** 站点的名字，中英一样 */
const SITES: Record<ZaiFamily, string> = { zai: "Z.ai", bigmodel: "BigModel" };

/**
 * 登录账号那一块：说明与确认、两种登录方式、等授权或输码。新建上游的「账号」一步和重新登录
 * 的对话框都用它；名称和出站代理在它上面，由用它的地方画。标志在对话框标题旁，这里不再画。
 *
 * **怎么登录按实际能走的路给**：
 *
 * · ChatGPT 在这台电脑上：两张并排的卡片 —— 在浏览器中登录（打开授权页，或复制链接到常用的
 *   浏览器里打开），和用设备码登录。
 * · ChatGPT 连着远程 core：**只有设备码** —— 浏览器登录的回调只能回到 core 那台机器的
 *   本机端口，而浏览器开在这台电脑上。
 * · Z.ai / BigModel：浏览器（或复制链接）。授权回的是对方的服务端、core 自己轮询，所以
 *   连着远程 core 也一样能用；它没有设备码。
 *
 * 「已阅读上述说明」挡着每一种开始方式，开始之后就不能再取消勾选。登录链接、验证网址、
 * 设备码**只拿来显示**，复制和打开都按登录 ID 交给 Rust 侧。
 */
export function AccountPanel({
  login,
  params,
  blocked,
  relogin = false,
  notices = !relogin,
}: {
  login: AccountLogin;
  /** 发起登录时交给 core 的名称、出站代理、站点 */
  params: LoginParams;
  /** 名称不能用（空的、被占用）：先不能开始 */
  blocked: boolean;
  /** 给已有的账号换一次凭据：完成时说的是换了凭据 */
  relogin?: boolean;
  /**
   * 要不要先看说明、勾确认。新建要；ChatGPT 重新登录不要（此前看过并同意了）；Z.ai 的上游
   * 登录换密钥要（那个上游的密钥可能是手填的，没看过会建一把密钥的那几条）
   */
  notices?: boolean;
}) {
  // 放在这一层：换一种方式重新开始（设备码 ↔ 浏览器）时那一块会换掉，勾过的不该跟着丢
  const [understood, setUnderstood] = useState(!notices);
  const phase = login.phase;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3.5">
        {phase.at === "device" ? (
          <DeviceCode login={login} params={params} />
        ) : phase.at === "done" ? (
          <Done login={login} relogin={relogin} />
        ) : (
          <Methods
            login={login}
            params={params}
            blocked={blocked}
            notices={notices}
            understood={understood}
            onUnderstood={setUnderstood}
          />
        )}
      </div>
      <DialogError error={login.error} />
    </div>
  );
}

/**
 * 开始之前和等浏览器授权的时候：这是什么、要知道的几点、确认，下面是登录方式。等着的时候
 * 说明和确认留在原处，浏览器那一张卡换成等待和「重新打开」「复制链接」，设备码那一张淡下去，
 * 给「改用设备码」
 */
function Methods({
  login,
  params,
  blocked,
  notices,
  understood,
  onUnderstood,
}: {
  login: AccountLogin;
  params: LoginParams;
  blocked: boolean;
  notices: boolean;
  understood: boolean;
  onUnderstood: (v: boolean) => void;
}) {
  const t = useText(accountPanelText);
  const rt = useText(remoteText);
  const remote = useRemote();
  const phase = login.phase;
  const waiting = phase.at === "browser" ? phase : null;
  const chatgpt = login.kind === "chatgpt";
  const where = remote ? t.server(remote.name) : t.here;
  const site = SITES[params.family];
  const other = SITES[params.family === "zai" ? "bigmodel" : "zai"];
  const canStart = !blocked && understood && login.starting === null;
  /** ChatGPT 连着远程 core 只能用设备码 */
  const deviceOnly = chatgpt && remote != null;
  const start = (how: "browser" | "link" | "device") => void login.start(how, params);

  /** 「复制链接」：还没开始时它就是一种开始方式 —— 开始一次登录、不开浏览器、把链接复制下来 */
  const copyLink = waiting ? (
    <CopyButton
      variant="ghost"
      label={t.copyLink}
      copiedLabel={t.linkCopied}
      // 用复制开始的那一次，一出现就是「已复制链接」
      flashAtStart={!waiting.opened}
      onCopy={() => login.copy("url")}
    />
  ) : (
    <Tip text={t.linkHint}>
      <Button variant="ghost" size="sm" onClick={() => start("link")} pending={login.starting === "link"} disabled={!canStart}>
        {login.starting !== "link" && <CopyIcon />}
        {t.copyLink}
      </Button>
    </Tip>
  );
  /** 授权页：没开始时打开它就是开始；等着的时候再打开一次（用复制开始的那次，这是第一次打开） */
  const openPage = (size: "sm" | "default") =>
    waiting ? (
      <Button variant="outline" size={size} onClick={login.reopen}>
        {waiting.opened ? t.reopen : t.openPage}
      </Button>
    ) : null;

  return (
    <>
      <Head title={chatgpt ? t.chatgptTitle : t.zaiTitle(site)} desc={chatgpt ? t.chatgptDesc : t.zaiDesc(site, other)} />
      {notices && (
        <>
          <ul className="flex list-disc flex-col gap-0.5 pl-4.5 tw-label text-muted-foreground">
            {chatgpt ? (
              <>
                <li>{t.noticeOfficial}</li>
                <li>{t.noticeCredential(where)}</li>
              </>
            ) : (
              <>
                <li>{t.noticeTheirPage}</li>
                <li>{t.noticeKey}</li>
              </>
            )}
          </ul>
          {/* 勾选框和文字**分开挂**：套在一个 label 里点一下会切换两次，等于点不动 */}
          <Field orientation="horizontal">
            <Checkbox
              id="login-understood"
              checked={understood}
              disabled={login.waiting}
              onCheckedChange={(v) => onUnderstood(v === true)}
            />
            <FieldLabel htmlFor="login-understood" className="font-normal">
              {t.understood}
            </FieldLabel>
          </Field>
        </>
      )}

      {chatgpt ? (
        <div className={cn("grid gap-2.5", deviceOnly ? "grid-cols-1" : "grid-cols-2")}>
          {!deviceOnly && (
            <Way
              icon={<ExternalLinkIcon />}
              title={t.signInBrowser}
              active={waiting != null}
              desc={waiting ? <Waiting key={waiting.expiresAt} expiresAt={waiting.expiresAt} text={t.waiting} /> : t.browserDesc}
            >
              {waiting ? (
                openPage("sm")
              ) : (
                <Button size="sm" onClick={() => start("browser")} pending={login.starting === "browser"} disabled={!canStart}>
                  {t.openPage}
                </Button>
              )}
              {copyLink}
            </Way>
          )}
          <Way
            icon={<SmartphoneIcon />}
            title={t.signInDevice}
            faded={waiting != null}
            desc={deviceOnly ? rt.deviceOnly(remote.name) : waiting ? t.deviceInstead : t.deviceDesc}
          >
            <Button
              variant={deviceOnly ? "default" : "outline"}
              size="sm"
              onClick={() => start("device")}
              pending={login.starting === "device"}
              disabled={!canStart}
            >
              {waiting ? t.useDevice : t.getCode}
            </Button>
          </Way>
        </div>
      ) : waiting ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Waiting key={waiting.expiresAt} expiresAt={waiting.expiresAt} text={t.waiting} />
            <span className="flex-1" />
            {openPage("sm")}
            {copyLink}
          </div>
          <p className="tw-label text-muted-foreground">{t.zaiAfter}</p>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={() => start("browser")} pending={login.starting === "browser"} disabled={!canStart}>
            {login.starting !== "browser" && <ExternalLinkIcon />}
            {t.signInBrowser}
          </Button>
          {copyLink}
        </div>
      )}
    </>
  );
}

/** 一种登录方式的卡片：标题、一句说明或状态、按钮 */
function Way({
  icon,
  title,
  desc,
  active = false,
  faded = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: ReactNode;
  /** 正在用这一种：描边深一档 */
  active?: boolean;
  /** 正在用另一种：淡下去，按钮照样能点 */
  faded?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background px-3.5 py-3 transition-opacity duration-(--motion-fast)",
        active ? "border-foreground/25" : "border-border",
        faded && "opacity-60 hover:opacity-100 focus-within:opacity-100",
      )}
    >
      <p className="flex items-center gap-1.5 tw-body font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0">
        {icon}
        {title}
      </p>
      <div className="tw-label text-muted-foreground">{desc}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * 设备码登录：验证网址和设备码并排（网址能复制、能打开，码大字、能复制），下面是有效期、
 * 重新获取和那一句提醒。在这台电脑上时还能改回浏览器登录
 */
function DeviceCode({ login, params }: { login: AccountLogin; params: LoginParams }) {
  const t = useText(accountPanelText);
  const remote = useRemote();
  const phase = login.phase;
  if (phase.at !== "device") return null;
  return (
    <>
      <Head title={t.deviceTitle} desc={remote ? t.deviceDescRemote(remote.name) : t.deviceDescLocal} />
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
        <CodeBox label={t.verifyUrl}>
          <span className="min-w-0 flex-1 truncate font-mono tw-body select-text" title={phase.url}>
            {phase.url}
          </span>
          <CopyButton onCopy={() => login.copy("url")} />
          <Button variant="outline" size="sm" onClick={login.reopen}>
            <ExternalLinkIcon />
            {t.open}
          </Button>
        </CodeBox>
        <CodeBox label={t.code}>
          {/* 码要能一眼读准也能选中：字距拉开，等宽字体 */}
          <span className="min-w-0 flex-1 truncate font-mono text-xl leading-7 font-medium tracking-[0.2em] tw-num select-text">
            {phase.code}
          </span>
          <CopyButton onCopy={() => login.copy("code")} />
        </CodeBox>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 tw-body text-muted-foreground">
        <Waiting key={phase.expiresAt} expiresAt={phase.expiresAt} text={t.deviceWaiting} />
        <span aria-hidden>·</span>
        <LinkButton onClick={() => void login.start("device", params)} pending={login.starting === "device"}>
          {t.newCode}
        </LinkButton>
        {!remote && (
          <>
            <span aria-hidden>·</span>
            <LinkButton onClick={() => void login.start("browser", params)} pending={login.starting === "browser"}>
              {t.useBrowser}
            </LinkButton>
          </>
        )}
        {/* 拿着别人给的码去输，等于把自己的账号授权给对方 */}
        <span className="ml-auto tw-label">{t.deviceWarning}</span>
      </div>
    </>
  );
}

function CodeBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2">
      <span className="tw-label text-muted-foreground">{label}</span>
      <div className="flex min-h-7 min-w-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * 重新登录完成：换了哪个上游的凭据、登的是哪个账号，ChatGPT 再带上额度。新建上游时登录完成
 * 直接进「模型」一步，账号写在那一步顶上（`AccountSummary`），不经过这里
 */
function Done({ login, relogin }: { login: AccountLogin; relogin: boolean }) {
  const t = useText(accountPanelText);
  const phase = login.phase;
  const windows = useAccountWindows(login.kind, phase.at === "done" ? phase.provider : null);
  const now = useNow();
  if (phase.at !== "done") return null;
  const a = phase.account;
  const name = <span className="font-mono text-foreground">{phase.provider}</span>;
  return (
    <>
      <div className="flex items-center gap-2">
        <CircleCheckIcon className="size-4 shrink-0 text-success" aria-hidden />
        <p className="tw-body font-semibold">{t.doneTitle}</p>
      </div>
      {relogin && <p className="tw-body text-muted-foreground">{t.reloginDone(name)}</p>}
      {a && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3">
          <Avatar account={a} large />
          <div className="flex min-w-0 flex-1 flex-col">
            {a.who && <span className="truncate tw-body font-medium">{a.who}</span>}
            {a.plan && <span className="truncate tw-label text-muted-foreground">ChatGPT {a.plan}</span>}
          </div>
          {windows.length > 0 && (
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {windows.map((w) => {
                const label = t.quotaUsed(quotaWindowLabel(w.window), Math.round(w.used_percent));
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

/**
 * 登上的 ChatGPT 账号此刻的额度窗口（过了重置时刻的不算）。只有 ChatGPT 账号能当场问到；
 * 问不到就是空的，不耽误往下走
 */
function useAccountWindows(kind: LoginKind, provider: string | null): QuotaWindow[] {
  const now = useNow();
  const [windows, setWindows] = useState<QuotaWindow[]>([]);
  useEffect(() => {
    if (kind !== "chatgpt" || !provider) return;
    let alive = true;
    api
      .chatgptUsage(provider)
      .then((u) => alive && setWindows(u.windows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [provider, kind]);
  return windows.filter((w) => w.resets_at_ms == null || w.resets_at_ms > now);
}

/**
 * 登录的账号，一行：头像（名字的第一个字）、邮箱、套餐和「已登录」，右边是最紧张的那个额度
 * 窗口。新建上游登录完成后「模型」一步顶上是它。
 *
 * 额度只有 ChatGPT 账号能当场问到（Z.ai 的额度要等请求带回来）；问不到就不写
 */
export function AccountSummary({
  kind,
  provider,
  account,
  family,
}: {
  kind: LoginKind;
  provider: string;
  account: LoginAccount | null;
  /** Z.ai / BigModel 登的是哪一边。ChatGPT 是 null */
  family: ZaiFamily | null;
}) {
  const t = useText(accountPanelText);
  const now = useNow();
  // 最紧张的那个窗口：先到的那条线决定什么时候用完
  const tight = useAccountWindows(kind, provider).reduce<QuotaWindow | null>(
    (a, w) => (!a || w.used_percent > a.used_percent ? w : a),
    null,
  );
  const label = tight ? t.quotaUsed(quotaWindowLabel(tight.window), Math.round(tight.used_percent)) : null;
  const reset = tight ? resetAt(tight.resets_at_ms, now) : null;
  return (
    <SummaryRow>
      <Avatar account={account} />
      <span className="min-w-0 truncate tw-body font-medium">{account?.who ?? provider}</span>
      <span className="shrink-0 tw-body text-muted-foreground">{planLine(t, kind, account, family)}</span>
      {tight && label && (
        <span className="ml-auto flex min-w-0 items-center gap-2 pl-3">
          <QuotaBar percent={tight.used_percent} label={label} className="w-24 shrink-0" />
          <span className="truncate tw-body tw-num text-muted-foreground">
            {label}
            {reset && ` · ${t.resets(reset)}`}
          </span>
        </span>
      )}
    </SummaryRow>
  );
}

/**
 * 新建上游登录之后再回到「账号」一步：登录那一块换成一行已登录的账号和「重新登录」（交给
 * 重新登录的对话框，和编辑时一样）
 */
export function AccountLine({
  kind,
  account,
  family,
  onRelogin,
}: {
  kind: LoginKind;
  account: LoginAccount | null;
  family: ZaiFamily | null;
  onRelogin: () => void;
}) {
  const t = useText(accountPanelText);
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface py-2 pr-2 pl-3">
      <Avatar account={account} />
      <span className="min-w-0 truncate tw-body font-medium">{account?.who ?? t.signedIn}</span>
      <span className="shrink-0 tw-body text-muted-foreground">{planLine(t, kind, account, family)}</span>
      <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={onRelogin}>
        {t.relogin}
      </Button>
    </div>
  );
}

/** 「ChatGPT Plus · 已登录」「BigModel 账号 · 已登录」 */
function planLine(
  t: (typeof accountPanelText)["zh"],
  kind: LoginKind,
  account: LoginAccount | null,
  family: ZaiFamily | null,
): string {
  const plan = kind === "chatgpt" ? (account?.plan ? `ChatGPT ${account.plan}` : null) : t.siteAccount(SITES[family ?? "zai"]);
  return plan ? `${plan} · ${t.signedIn}` : t.signedIn;
}

function Avatar({ account, large = false }: { account: LoginAccount | null; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
        large ? "size-8 tw-body" : "size-6 tw-label",
      )}
    >
      {(account?.who ?? account?.plan ?? "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * 编辑 Z.ai / BigModel 的上游、认证方式是账号登录时，密钥那一栏的位置上是这一行。
 *
 * 密钥是登录换来的：写已登录哪一边的账号，给「重新登录」。从 API 密钥换成账号登录、还没登录
 * 过的：给「登录账号」。两者都打开重新登录的对话框（说明、确认、登录都在那里），登录成功后
 * core 只换这个上游的密钥，别的设置不动
 */
export function AccountKeyPanel({
  family,
  signedIn,
  onSignIn,
}: {
  family: ZaiFamily;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const t = useText(accountPanelText);
  const site = SITES[family];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface py-2.5 pr-2.5 pl-3">
      {signedIn ? (
        <CircleCheckIcon className="size-5 shrink-0 text-success" strokeWidth={1.8} aria-hidden />
      ) : (
        <VendorTile name={family} baseUrl={family === "zai" ? "https://api.z.ai" : "https://open.bigmodel.cn"} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="tw-body font-medium">{signedIn ? t.signedInTitle(site) : t.replaceTitle(site)}</span>
        <span className="tw-label text-muted-foreground">{signedIn ? t.signedInDesc : t.replaceDesc}</span>
      </div>
      <Button variant={signedIn ? "outline" : "default"} size="sm" className="shrink-0" onClick={onSignIn}>
        {signedIn ? t.relogin : t.signIn}
      </Button>
    </div>
  );
}

/** 那一块的标题和一句说明 */
function Head({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="tw-body font-semibold">{title}</p>
      <p className="tw-body text-muted-foreground">{desc}</p>
    </div>
  );
}

/**
 * 转圈的一句：还在等，多久之内有效。分钟按剩下的往上取整。换了一次登录（重新获取）时
 * 由外面按到期时刻换一个 key 重新挂上：手上的「现在」不能比新的那次登录还早
 */
function Waiting({ expiresAt, text }: { expiresAt: number; text: (min: number) => string }) {
  const now = useNow(15_000);
  const min = Math.max(1, Math.ceil((expiresAt - now) / 60_000));
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground" role="status">
      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" aria-hidden />
      {text(min)}
    </span>
  );
}

/** 一行字的次要操作（重新获取、改用另一种方式），下划线链接的样子 */
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
