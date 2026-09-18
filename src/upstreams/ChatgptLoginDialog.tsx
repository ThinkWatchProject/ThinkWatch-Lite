import { useEffect, useRef, useState } from "react";
import { CircleAlertIcon, CopyIcon, ExternalLinkIcon, SmartphoneIcon } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
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
import { Spinner } from "@/ui/spinner";
import type { ChatgptLoginMode, ChatgptLoginStatus, CoreEvent, Overview } from "@/types";
import { api } from "./api";
import { errorText, proxyKindLabel, shortUrl } from "./labels";
import { FormItem } from "./parts";
import { freeName } from "./upstreamForm";

/** 登录还没结果时，多久问一次 core。事件是主路，这是它的兜底 */
const POLL_MS = 2_000;

type Phase =
  | { at: "form" }
  /** 授权页已经在这台机器的浏览器里打开 */
  | { at: "browser"; id: string }
  /** 码已经拿到，等用户在另一台设备上输 */
  | { at: "device"; id: string; code: string; url: string }
  | { at: "done"; provider: string; plan: string | null };

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
  const proxies = ov.proxies ?? [];
  const taken = ov.providers.map((p) => p.name);
  const [name, setName] = useState(() => relogin?.name ?? freeName("chatgpt", taken));
  const [proxy, setProxy] = useState(relogin?.proxy ?? "direct");
  // 重新登录的人此前已经看过并同意了这些，不再拦一次
  const [understood, setUnderstood] = useState(relogin != null);
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [busy, setBusy] = useState(false);
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
    setError(
      s.error ??
        (s.status === "expired" ? "授权未在有效期内完成" : "登录已取消"),
    );
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
    setBusy(true);
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
      setBusy(false);
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

  return (
    <Dialog open onOpenChange={(o) => !o && void cancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{relogin ? "重新登录 ChatGPT 账号" : "使用 ChatGPT 账号"}</DialogTitle>
          <DialogDescription>
            {relogin ? (
              <>
                为上游 <span className="font-mono">{relogin.name}</span> 换一次登录凭据。
                模型范围、计费方式等设置保持不变。
              </>
            ) : (
              "登录 OpenAI 账号，把 ChatGPT 订阅额度作为一个上游使用。"
            )}
          </DialogDescription>
        </DialogHeader>

        {phase.at === "form" && (
          <div className="flex flex-col gap-4">
            {!relogin && (
            <Alert variant="warning">
              <CircleAlertIcon />
              <AlertTitle>登录之前请确认以下几点</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 [&>li]:mt-1">
                  <li>
                    ChatGPT 订阅的用途是在 OpenAI 的官方客户端中对话。把订阅额度用于其他客户端不受
                    OpenAI 支持，账号可能因此受限。
                  </li>
                  <li>
                    请求会如实说明来自 ThinkWatch，不伪装成其他客户端。
                  </li>
                  <li>登录得到的凭据保存在本机的配置文件中，与其他上游一同管理。</li>
                  <li>删除该上游时，登录凭据会一并吊销。</li>
                </ul>
              </AlertDescription>
            </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormItem label="名称" htmlFor="cg-name" desc="配置中这个上游的名称">
                <Input
                  id="cg-name"
                  className="font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={relogin != null}
                  aria-invalid={nameTaken}
                />
                {nameTaken && <p className="tw-label text-destructive">这个名称已被占用</p>}
              </FormItem>
              <FormItem label="出站代理" htmlFor="cg-proxy" desc="登录与后续请求都经此发出">
                <NativeSelect
                  id="cg-proxy"
                  className="w-full"
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                >
                  <NativeSelectOption value="direct">直连</NativeSelectOption>
                  <NativeSelectOption value="system">系统代理</NativeSelectOption>
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
                id="cg-understood"
                checked={understood}
                onCheckedChange={(v) => setUnderstood(v === true)}
              />
              <FieldLabel htmlFor="cg-understood" className="font-normal">
                已阅读上述说明，继续登录
              </FieldLabel>
            </Field>
            )}
          </div>
        )}

        {phase.at === "browser" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 tw-body">
              <Spinner />
              授权页已在浏览器中打开，完成授权后此处会自动继续。
            </div>
            <p className="tw-label text-muted-foreground">
              授权有效期 15 分钟。浏览器未打开时可再打开一次。
            </p>
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  api.reopenChatgptLogin(phase.id).catch((e) => setError(errorText(e)));
                }}
              >
                <ExternalLinkIcon />
                重新打开授权页
              </Button>
            </div>
          </div>
        )}

        {phase.at === "device" && (
          <div className="flex flex-col gap-3">
            <p className="tw-body">
              在另一台已登录 ChatGPT 的设备上打开{" "}
              <span className="font-mono text-foreground">{shortUrl(phase.url)}</span>
              ，输入下面的登录码。
            </p>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3">
              {/* 码要能一眼读准也能选中：字距拉开，等宽字体 */}
              <span className="select-text font-mono text-2xl tracking-[0.2em] tabular-nums">
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
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="flex items-center gap-2 tw-body">
              <Spinner />
              输入完成后此处会自动继续。
            </div>
            {/* Codex 也有这一句：拿着别人给的码去输，等于把自己的账号授权给对方 */}
            <p className="tw-label text-muted-foreground">
              登录码有效期 15 分钟。只输入这里显示的这一个；由他人提供的登录码请勿输入。
            </p>
          </div>
        )}

        {phase.at === "done" && (
          <div className="flex flex-col gap-2 tw-body">
            <p>
              已登录，上游 <span className="font-mono">{phase.provider}</span> 已写入配置。
              {phase.plan && ` 订阅类型 ${phase.plan}。`}
            </p>
            <p className="tw-label text-muted-foreground">
              模型范围、计费方式等可在该上游的编辑对话框中调整。
            </p>
          </div>
        )}

        {error && <p className="tw-body text-destructive">{error}</p>}

        <DialogFooter>
          {phase.at === "done" ? (
            <Button onClick={onClose}>完成</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void cancel()}>
                取消
              </Button>
              {phase.at === "form" && (
                <>
                  {/* 次要的那条路先摆：主按钮留在最右边 */}
                  <Button
                    variant="outline"
                    onClick={() => void start("device")}
                    disabled={!canStart}
                  >
                    <SmartphoneIcon />
                    在其他设备上登录
                  </Button>
                  <Button onClick={() => void start("browser")} disabled={!canStart}>
                    {busy ? <Spinner /> : <ExternalLinkIcon />}
                    在这台电脑上登录
                  </Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
