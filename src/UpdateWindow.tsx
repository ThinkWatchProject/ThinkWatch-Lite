import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "../src-tauri/icons/128x128.png";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { StatusDot } from "@/ui/status-dot";
import { IconCopied, IconCopy } from "@/ui/icons";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { canInstall, describeStep, type Offer, type Step } from "./updateFlow";
import { updateText } from "./Update.i18n";
import { errorText } from "@/i18n/core.i18n";

/** 「已复制」留多久 */
const COPIED_MS = 2_000;

/**
 * 更新窗口。
 *
 * 由 Rust 建出来：用户点了「检查更新」并查到新版本、设置里点了「更新到 x…」，或者
 * 点了自动检查发出的那条通知、菜单里的「安装新版本」。窗口建出来时是隐藏的 —— 这里
 * 画好、量出高度之后再亮出来。
 *
 * 上面是应用图标、哪一版可用、现在是哪一版；下面画哪一种取决于这一份是怎么装上来的：
 *
 * · 从网页下载的：「下载并安装」，按一次之后不再问任何问题 —— 下载、
 *   等网关手上的请求结束、替换、重启，全部自动。
 * · Homebrew 装的：给出那条命令和复制按钮。更新交给 brew。
 * · 开发构建：只说明不自动更新。
 *
 * **没有任何按钮默认获得焦点。**这个窗口是在用户做别的事时冒出来的；
 * 他在终端里按下的回车，不该变成一次「下载并安装」。
 *
 * **不做展开、收起的动画**（换一步只淡入）：窗口的高度跟着内容走（`update_fit`），
 * 内容一边展开、窗口一边一格格地改尺寸，比直接换过去难看。
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

  // 内容高度变了就跟着改窗口高度：出现进度条、出现错误。第一次量完才亮出窗口，不让人看见跳一下的那一帧。
  //
  // **窗口的尺寸由 Rust 那边设**，理由见 `update_fit`：窗口接口说的是整扇
  // 窗户，标题栏算在里面，照着内容的高度设下去，网页会少一条标题栏。宽度
  // 也一并在那边。
  useEffect(() => {
    const el = body.current;
    if (!offer || !el) return;
    const w = getCurrentWindow();
    const fit = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      void invoke("update_fit", { height }).then(async () => {
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
      setFailed(errorText(e));
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

  let content: ReactNode;
  let actions: ReactNode;
  if (canInstall(offer.install)) {
    content = busy && step ? (
      <Progressing step={step} done={progress[0]} total={progress[1]} />
    ) : (
      <>
        <p className="tw-body text-muted-foreground">{t.standalone}</p>
        {failed && (
          <Banner layout="inline" tone="error" title={t.failed}>
            <span className="select-text">{failed}</span>
          </Banner>
        )}
      </>
    );
    actions = busy ? (
      // 等请求结束可能要几分钟：窗口可以先关掉，更新照常进行（上面那句说了）
      step?.step === "waiting" && (
        <Button variant="outline" onClick={close}>
          {common.close}
        </Button>
      )
    ) : (
      <>
        <Button variant="outline" onClick={close}>
          {t.later}
        </Button>
        <Button onClick={() => void install()}>{failed ? common.retry : t.install}</Button>
      </>
    );
  } else if (offer.install === "homebrew" && offer.command) {
    content = (
      <>
        <p className="tw-body text-muted-foreground">{t.homebrew}</p>
        {/*
          命令占满整行，复制放进底下那排按钮里当主操作 —— 和另一档的
          「稍后 / 下载并安装」同一个位置、同一个分量。按钮塞在输入框
          里面的话，命令就只剩一截能显示。
        */}
        <div className="flex flex-col gap-1.5">
          <Input
            ref={command}
            readOnly
            value={offer.command}
            aria-label={t.command}
            className="bg-surface font-mono dark:bg-surface"
            onFocus={(e) => e.currentTarget.select()}
          />
          {copyFailed && <p className="tw-label text-destructive">{t.copyFailed}</p>}
        </div>
      </>
    );
    actions = (
      <>
        <Button variant="outline" onClick={close}>
          {common.close}
        </Button>
        <Button onClick={() => void copy()}>
          {copied ? <IconCopied /> : <IconCopy />}
          {copied ? common.copied : t.copyCommand}
        </Button>
      </>
    );
  } else {
    content = <p className="tw-body text-muted-foreground">{t.dev}</p>;
    actions = (
      <Button variant="outline" onClick={close}>
        {common.close}
      </Button>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div ref={body} className="flex flex-col gap-4 p-5">
        <header className="flex items-center gap-3.5">
          {/* 应用图标本身（和程序坞里同一张） */}
          <img src={appIcon} alt="" width={48} height={48} draggable={false} className="size-12 shrink-0 select-none" />
          <div className="min-w-0">
            <h1 className="tw-title">{t.available(offer.version)}</h1>
            <p className="tw-num tw-body text-muted-foreground">{t.current(offer.current)}</p>
          </div>
        </header>
        {content}
        {actions && <div className="flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * 按下安装之后走到哪一步了。**知道总长才画进度条** —— 一根假装知道还剩多少的进度条
 * 比没有更糟；等请求结束那一步是一个在跳的点（此刻在等），下面说明窗口可以关。
 */
function Progressing({ step, done, total }: { step: Step; done: number; total: number | null }) {
  const t = useText(updateText);
  const text = describeStep(step, done, total);
  if (step.step === "downloading" && total) {
    const pct = Math.min(100, (done / total) * 100);
    return (
      <div className="flex flex-col gap-2">
        <div
          role="progressbar"
          aria-label={text}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        >
          <div className="h-full rounded-full bg-foreground motion-bar" style={{ width: `${pct}%` }} />
        </div>
        <p className="tw-num tw-body text-muted-foreground">{text}</p>
      </div>
    );
  }
  return (
    <div key={step.step} className="flex flex-col gap-1 motion-fade">
      <p role="status" className="flex items-center gap-2 tw-body text-foreground">
        {step.step === "waiting" ? (
          <StatusDot tone="pending" />
        ) : (
          <Spinner className="size-3.5 text-muted-foreground" aria-hidden />
        )}
        <span className="tw-num">{text}</span>
      </p>
      {/* 这一步可能要几分钟，而且长短取决于用户自己的请求 */}
      {step.step === "waiting" && <p className="tw-label text-muted-foreground">{t.closeWhileWaiting}</p>}
    </div>
  );
}
