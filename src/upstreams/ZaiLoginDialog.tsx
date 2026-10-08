import { useState } from "react";
import { useSystemProxyLabel } from "@/connection/Remote";
import { ExternalLinkIcon } from "lucide-react";
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
import type { Overview, ZaiFamily, ZaiLoginStatus } from "@/types";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { api } from "./api";
import { zaiLoginText } from "./ZaiLoginDialog.i18n";
import { coreText, errorText, proxyKindLabel, shortUrl } from "./labels";
import { DialogError, FormItem } from "./parts";
import { useLoginWait } from "./loginWait";
import { ZAI_ENDPOINTS } from "./presets";
import { freeName } from "./upstreamForm";

type Phase =
  | { at: "form" }
  /** 授权页已经在这台机器的浏览器里打开 */
  | { at: "waiting"; id: string }
  | { at: "done"; provider: string; account: string | null };

/**
 * 用 Z.ai 或 BigModel 账号新建上游，或给同名的已有上游换一把密钥。
 *
 * **只有一条路：这台机器上的浏览器。**授权回的是对方自己的服务端，所以既没有
 * 「在另一台设备上输码」那条路（那要对方支持），也没有「返回 ThinkWatch」那一步 ——
 * 登录成没成由 core 轮询出来，再通过事件告诉这里。
 */
export function ZaiLoginDialog({
  ov,
  onClose,
  onSaved,
}: {
  ov: Overview;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(zaiLoginText);
  const systemProxy = useSystemProxyLabel(t.systemProxy);
  const common = useText(commonText);
  const proxies = ov.proxies;
  const taken = ov.providers.map((p) => p.name);
  const [family, setFamily] = useState<ZaiFamily>("zai");
  const [name, setName] = useState(() => freeName("zai", taken));
  const [proxy, setProxy] = useState("direct");
  const [understood, setUnderstood] = useState(false);
  const [phase, setPhase] = useState<Phase>({ at: "form" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waiting = phase.at === "waiting" ? phase.id : null;
  // 结果由 core 发事件，轮询兜底；对话框关掉就不再等（见 `useLoginWait`）
  useLoginWait(waiting, api.zaiLoginStatus, (s: ZaiLoginStatus) => {
    if (s.status === "done" && s.provider) {
      setPhase({ at: "done", provider: s.provider, account: s.account ?? null });
      onSaved(s.provider);
      return;
    }
    setPhase({ at: "form" });
    const text = textOf(zaiLoginText);
    setError(s.error ? coreText(s.error) : s.status === "expired" ? text.expired : text.cancelled);
  });

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const login = await api.startZaiLogin(family, name.trim(), proxy);
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

  // 同名的上游已经是这一家的话，登录换的是它的密钥 —— 那不是冲突，要说清是替换。
  // **末尾的 `/` 不算**，和 core 认这件事时一样：差一个斜杠就判成「名字被占用」的话，
  // 按钮点不了，而 core 其实会接受
  const existing = ov.providers.find((p) => p.name === name.trim());
  const replaces =
    existing != null && existing.base_url.replace(/\/+$/, "") === ZAI_ENDPOINTS[family].replace(/\/+$/, "");
  const nameTaken = !replaces && existing != null && phase.at === "form";
  const canStart = name.trim().length > 0 && !nameTaken && understood && !busy;

  return (
    <Dialog open onOpenChange={(o) => !o && void cancel()}>
      {/* 点到外面不关：登录进行中时关掉就是放弃这一次登录。Esc、×、取消照常 */}
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        {phase.at === "form" && (
          <div className="flex flex-col gap-4">
            <Banner layout="inline" tone="warning" title={t.noticeTitle}>
              <ul className="list-disc pl-4 [&>li]:mt-1">
                <li>{t.noticeTheirPage}</li>
                <li>{t.noticeKey}</li>
                <li>{t.noticeHonest}</li>
                <li>{t.noticeStorage}</li>
              </ul>
            </Banner>

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
