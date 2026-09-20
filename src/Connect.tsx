import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { toast } from "sonner";
import { textOf, useText } from "@/i18n";
import { connectText } from "./Connect.i18n";
import { errorText } from "@/i18n/core.i18n";

/**
 * 沉默多久之后才开口。
 *
 * **大多数启动不该看到任何文字。**冷启动通常一秒出头，而一个只闪一下
 * 的进度条是噪音 —— 它从不停留，也就从不被读。超过这个时间还没连上，
 * 才说明这次不一样。
 */
const QUIET_MS = 1_500;

/** 把守护状态翻成「现在怎么了、能做什么」。 */
export interface Trouble {
  /** 一句话说清现在什么情况 */
  what: string;
  /** 接下来会自动发生什么，或者用户该做什么 */
  next: string;
  /** 这是个需要人介入的状态吗 —— 决定要不要上告警色 */
  bad: boolean;
  /** 能不能点一下重来 */
  retry: boolean;
}

/**
 * `core_state` 的字符串 → 界面要说的话。
 *
 * **不说 socket 层的错误。**「Connection refused (os error 61)」是给
 * 写代码的人看的；而这一层其实知道得多得多 —— 守护正在报「第 3 次
 * 重启，2 秒后」，那才是用户该看到的。
 */
export function trouble(raw: string, tries: number): Trouble | null {
  const t = textOf(connectText);
  if (raw.startsWith("missing:")) {
    return {
      what: t.missing,
      next: raw.slice("missing:".length),
      bad: true,
      retry: false,
    };
  }
  if (raw.startsWith("restarting:")) {
    const [, attempt = "1", inMs = "0"] = raw.split(":");
    const secs = Math.max(1, Math.round(Number(inMs) / 1000));
    return {
      what: t.restarting(attempt),
      next: t.retryIn(secs),
      bad: Number(attempt) >= 3,
      retry: false,
    };
  }
  if (raw === "safe_mode") {
    return {
      what: t.safeMode,
      next: t.safeModeNext,
      bad: true,
      retry: true,
    };
  }
  if (raw === "stopped") {
    return { what: t.stopped, next: t.stoppedNext, bad: true, retry: true };
  }
  if (raw === "starting") {
    return { what: t.starting, next: t.wait, bad: false, retry: false };
  }
  // running:pid —— 进程起来了，控制面还没答应。**这是一个真实的窗口
  // 期**：core 刚 exec 出来，socket 还没 bind 上。
  return {
    what: t.connecting,
    next: tries > 1 ? t.attempt(tries) : t.wait,
    bad: tries > 6,
    retry: tries > 6,
  };
}

/**
 * 还没连上控制面时，整窗显示的那一面。
 *
 * **只在这次会话从没连上过的时候出现。**断线重连是另一回事：那时候
 * 用户本来在看数据，把页面清空比留着旧值更糟。
 *
 * 和「不再有独立初始化页面」那条决定不冲突，边界是这个：那两道门挡的
 * 是**配置状态**（还没配上游），而门后面的东西是存在、可用的；这一道
 * 挡的是**连接状态**，控制面不答应的时候每一页的数据都没有来源。所以
 * 纪律是 —— **控制面一答应就立刻让开**，哪怕网关还没起来。
 *
 * 三层递进：先只画骨架不说话，超过一秒半才出现一行状态，需要人介入时
 * 才把出路摆出来。
 */
export default function Connect({ state, tries }: { state: string; tries: number }) {
  const text = useText(connectText);
  const [spoke, setSpoke] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setSpoke(true), QUIET_MS);
    return () => clearTimeout(h);
  }, []);
  const t = trouble(state, tries);
  // 需要人介入的状态不等那一秒半 —— 它不是「还没好」，是「不会好了」
  const show = spoke || t?.bad === true;

  return (
    <div className="flex h-full flex-col gap-6 p-5">
      {/* 骨架先占住版面。读完之后内容落在它原来的位置上 */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>

      {show && t && (
        <div className="space-y-2">
          <p className={"tw-head font-medium " + (t.bad ? "text-destructive" : "")}>
            {t.what}
          </p>
          <p className="max-w-prose tw-body whitespace-pre-wrap text-muted-foreground">
            {t.next}
          </p>
          {t.retry && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void invoke("restart_core")
                  .catch((e) => toast.error(errorText(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {text.restart}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
