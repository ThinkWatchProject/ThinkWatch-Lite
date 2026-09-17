import { useEffect, useRef, useState } from "react";
import { CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
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
import type { ChatgptLoginStatus, CoreEvent, Overview } from "@/types";
import { api } from "./api";
import { errorText, proxyKindLabel } from "./labels";
import { FormItem } from "./parts";
import { freeName } from "./upstreamForm";

/** 登录还没结果时，多久问一次 core。事件是主路，这是它的兜底 */
const POLL_MS = 2_000;

type Phase =
  | { at: "form" }
  | { at: "waiting"; id: string }
  | { at: "done"; provider: string; plan: string | null };

/**
 * 用 ChatGPT 账号新建上游。
 *
 * 授权在浏览器里完成，core 在本机等回调、把凭据写进配置；这个对话框负责登录之前
 * 的说明与选择，以及等待期间的状态。**登录只能有一次在进行**，所以离开时要收尾。
 */
export function ChatgptLoginDialog({
  ov,
  onClose,
  onSaved,
}: {
  ov: Overview;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const proxies = ov.proxies ?? [];
  const taken = ov.providers.map((p) => p.name);
  const [name, setName] = useState(() => freeName("chatgpt", taken));
  const [proxy, setProxy] = useState("direct");
  const [understood, setUnderstood] = useState(false);
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const waiting = phase.at === "waiting" ? phase.id : null;

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

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const login = await api.startChatgptLogin(name.trim(), proxy);
      if (alive.current) setPhase({ at: "waiting", id: login.id });
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

  const nameTaken = taken.includes(name.trim()) && phase.at === "form";
  const canStart = name.trim().length > 0 && !nameTaken && understood && !busy;

  return (
    <Dialog open onOpenChange={(o) => !o && void cancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>使用 ChatGPT 账号</DialogTitle>
          <DialogDescription>
            登录 OpenAI 账号，把 ChatGPT 订阅额度作为一个上游使用。授权在浏览器中完成。
          </DialogDescription>
        </DialogHeader>

        {phase.at === "form" && (
          <div className="flex flex-col gap-4">
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

            <div className="grid grid-cols-2 gap-4">
              <FormItem label="名称" htmlFor="cg-name" desc="配置中这个上游的名称">
                <Input
                  id="cg-name"
                  className="font-mono"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
          </div>
        )}

        {phase.at === "waiting" && (
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
                <Button onClick={() => void start()} disabled={!canStart}>
                  {busy ? <Spinner /> : <ExternalLinkIcon />}
                  在浏览器中登录
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
