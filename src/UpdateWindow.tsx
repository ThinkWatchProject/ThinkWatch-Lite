import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Progress } from "@/ui/progress";
import { Spinner } from "@/ui/spinner";
import { IconCopied, IconCopy } from "@/ui/icons";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { canInstall, describeStep, type Offer, type Step } from "./updateFlow";
import { updateText } from "./Update.i18n";

/**
 * 窗口宽度。**高度跟着内容走** —— 发布说明有长有短，固定高度要么留白要么
 * 截断。
 *
 * 宽度是被 Homebrew 那条命令定下来的：它要在一行里完整显示出来。一条要
 * 粘进终端去执行的命令，显示成「…upgrade --cask thinkwatc」是不行的 ——
 * 用户看不全自己要执行的是什么。Rust 建窗口时用的是同一个数。
 */
const WIDTH = 480;

/** 「已复制」留多久 */
const COPIED_MS = 2_000;

/**
 * 更新窗口。
 *
 * 查到新版本时由 Rust 建出来：自动检查查到了，或者用户在设置里点了
 * 「立即检查」。窗口建出来时是隐藏的 —— 这里画好、量出高度之后再亮出来。
 *
 * 画哪一种取决于这一份是怎么装上来的：
 *
 * · 从网页下载的：「下载并安装」，按一次之后不再问任何问题 —— 下载、
 *   等网关手上的请求结束、替换、重启，全部自动。
 * · Homebrew 装的：给出那条命令和复制按钮。更新交给 brew。
 * · 开发构建：只说明不自动更新。
 *
 * **没有任何按钮默认获得焦点。**这个窗口是在用户做别的事时冒出来的；
 * 他在终端里按下的回车，不该变成一次「下载并安装」。
 */
export default function UpdateWindow() {
  const t = useText(updateText);
  const common = useText(commonText);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [progress, setProgress] = useState<[number, number | null]>([0, null]);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const command = useRef<HTMLInputElement>(null);
  const shown = useRef(false);

  const load = useCallback(() => {
    void invoke<Offer | null>("update_pending").then(setOffer);
  }, []);

  useEffect(load, [load]);

  // 窗口开着的时候又查到了更新的一版 —— 换成新的那一版
  useEffect(() => {
    const un = listen("update-found", load);
    return () => {
      void un.then((f) => f());
    };
  }, [load]);

  useEffect(() => {
    const a = listen<Step>("update-step", (e) => setStep(e.payload));
    // 事件报的是**这一块多大**，不是已下载总量，要自己累加
    const b = listen<[number, number | null]>("update-progress", (e) => {
      const [chunk, total] = e.payload;
      setProgress(([done, t]) => [done + chunk, total ?? t]);
    });
    return () => {
      void a.then((f) => f());
      void b.then((f) => f());
    };
  }, []);

  // 内容高度变了就跟着改窗口高度：出现进度条、出现错误、换了一版带着
  // 更长的说明。第一次量完才亮出窗口，不让人看见跳一下的那一帧。
  useEffect(() => {
    const el = body.current;
    if (!offer || !el) return;
    const w = getCurrentWindow();
    const fit = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      void w.setSize(new LogicalSize(WIDTH, h)).then(async () => {
        if (shown.current) return;
        shown.current = true;
        await w.show();
        await w.setFocus();
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [offer]);

  const close = useCallback(() => void getCurrentWindow().close(), []);

  // Esc 等于「稍后」。安装已经开始的话关掉的只是窗口，更新照常进行
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!offer) return null;
  const busy = step !== null && failed === null;

  const install = async () => {
    setFailed(null);
    setProgress([0, null]);
    setStep({ step: "downloading" });
    try {
      await invoke("update_install");
    } catch (e) {
      setStep(null);
      setFailed(typeof e === "string" ? e : String(e));
    }
  };

  const copy = async () => {
    setCopyFailed(false);
    try {
      await invoke("update_copy_command");
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // 系统剪贴板没写进去。**把命令选中**，让 ⌘C 立刻能用，并且说出来
      command.current?.focus();
      command.current?.select();
      setCopyFailed(true);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div ref={body} className="flex flex-col gap-4 p-5">
        <div className="space-y-0.5">
          <h1 className="tw-title font-semibold">{t.available(offer.version)}</h1>
          <p className="tw-body text-muted-foreground">{t.current(offer.current)}</p>
        </div>

        {offer.notes && (
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-pretty tw-body">
            {offer.notes}
          </p>
        )}

        {canInstall(offer.install) ? (
          <>
            {busy ? (
              <div className="space-y-1.5">
                {/* 知道总长才画进度条 —— 一根假装知道还剩多少的进度条比没有更糟 */}
                {step?.step === "downloading" && progress[1] ? (
                  <Progress value={(progress[0] / progress[1]) * 100} />
                ) : null}
                <p className="flex items-center gap-2 tw-body text-muted-foreground">
                  {!(step?.step === "downloading" && progress[1]) && <Spinner />}
                  {step && describeStep(step, progress[0], progress[1])}
                </p>
                {/* 这一步可能要几分钟，而且长短取决于用户自己的请求 */}
                {step?.step === "waiting" && (
                  <p className="tw-label text-muted-foreground">
                    {t.closeWhileWaiting}
                  </p>
                )}
              </div>
            ) : (
              <p className="tw-body text-muted-foreground">
                {t.standalone}
              </p>
            )}
            {failed && <p className="tw-body text-destructive">{failed}</p>}
            {!busy && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={close}>
                  {t.later}
                </Button>
                <Button size="sm" onClick={() => void install()}>
                  {failed ? common.retry : t.install}
                </Button>
              </div>
            )}
          </>
        ) : offer.install === "homebrew" && offer.command ? (
          <>
            <p className="tw-body text-muted-foreground">
              {t.homebrew}
            </p>
            {/*
              命令占满整行，复制放进底下那排按钮里当主操作 —— 和另一档的
              「稍后 / 下载并安装」同一个位置、同一个分量。按钮塞在输入框
              里面的话，命令就只剩一截能显示。
            */}
            <Input
              ref={command}
              readOnly
              value={offer.command}
              aria-label={t.command}
              className="font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            {copyFailed && (
              <p className="tw-label text-destructive">{t.copyFailed}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={close}>
                {common.close}
              </Button>
              <Button size="sm" onClick={() => void copy()}>
                {copied ? <IconCopied /> : <IconCopy />}
                {copied ? common.copied : t.copyCommand}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="tw-body text-muted-foreground">{t.dev}</p>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={close}>
                {common.close}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
