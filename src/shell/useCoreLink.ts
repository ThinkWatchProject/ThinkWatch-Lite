import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribe } from "@/lib/tauriEvent";
import { call } from "@/control";
import { invalidateAll } from "@/lib/resource";
import { controlUp, isRunning, parseCoreState } from "@/coreState";
import { useStableState } from "@/useStable";
import { useRequests } from "@/useRequests";
import { warm } from "@/launch/warm";
import type { LinkState } from "@/connection/api";
import type { CoreStatus, Overview } from "@/types";

/**
 * 连控制面最多退避重试几次。
 *
 * **到了上限就停手**，不再往下试 —— 再试下去就成了轮询。守护状态一变
 * （启动中 → 运行中、进了重启、进了安全模式）那个 effect 会重跑，那才
 * 是它该被叫醒的时机。
 */
const MAX_TRIES = 8;

/** 概览的几个重读理由挨着到时，等这么久再读：一串只读一次 */
const COALESCE_MS = 100;

/**
 * 启动画面最多等多久。**过了就照常打开窗口**，内容区显示「未连接」那一页、后台接着
 * 重连 —— 而不是一直转圈。界面外壳不该依赖 core 连没连上：连接管理在设置里，那一页
 * 这时必须能用
 */
const LAUNCH_CAP_MS = 8_000;

/** 连上之后首屏迟迟取不齐：等这么久就不再等，交给那一页自己的骨架 */
const FIRST_SCREEN_MS = 2_500;

/**
 * 外壳和 core 之间的那一层：守护状态、连没连上控制面、状态和配置概览、实时请求列表，
 * 以及启动画面什么时候交接。
 *
 * **它不画任何东西**，和启动画面一起在主窗口最先加载的那一小块里（见 `App`）：冷启动
 * 时启动画面靠它说话，主界面那一大块还在加载的时候这里已经在连了。
 *
 * `viewReady`：主界面落地的那一页取好了首屏的数据（概览页的第一份数据到了，或者落地的
 * 不是概览页）。启动画面等它再交接，交接时数字已经是对的。
 */
export function useCoreLink({
  first,
  link,
  viewReady,
}: {
  /** 这次开窗第一次挂上（换了连接重挂的不算）。启动画面只在这一次、冷启动时出现 */
  first: boolean;
  /** 连接的现状（`ConnView.link`）。还没读到是 null */
  link: LinkState | null;
  viewReady: boolean;
}) {
  /**
   * 守护状态。**先当它在起**：第一次读到之前画「已停止」的话，启动画面会先
   * 闪一下「core 未运行」
   */
  const [core, setCore] = useState("starting");
  /**
   * 这次开窗连上过控制面吗。
   *
   * **取数的都等它。**连上之前去取，拿回来的只有一句「连不上」。它也决定断线时的
   * 样子：连上过就保留页面、顶上挂一条横幅 —— 清空比留着旧值加一句说明更糟。
   */
  const [linked, setLinked] = useState(false);
  /** `linked` 的同一个值，给只在变化时才该重跑的 effect 读 */
  const linkedRef = useRef(false);
  /** 连了第几次了。只用来在界面上说清楚，不参与重试逻辑 */
  const [tries, setTries] = useState(0);
  /**
   * 最近一次读状态失败的原因，原样留着。启动画面上连着失败时说出来，**用到时才翻成一句话**：
   * 翻译要 core 的译文表，启动画面不该为了一个多半用不上的错误先等它载入
   */
  const [linkError, setLinkError] = useState<unknown>(null);
  const feed = useRequests(linked);
  const { reloads, health, models, listening, upstreamState } = feed;

  const [status, setStatus] = useStableState<CoreStatus | null>(null);
  /**
   * 启动画面还在。**只在冷启动、这次开窗第一次交接之前**，见 `LaunchScreen`。
   * 热启动没有这一面，窗口藏到交接那一刻才出现（见 `warm`）
   */
  const [launching, setLaunching] = useState(!warm && first);
  /** 启动画面等够了：不再等，交出主界面 */
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setGaveUp(true), LAUNCH_CAP_MS);
    return () => clearTimeout(h);
  }, []);
  /** 连远程时密钥不对、版本对不上：等多久也不会好，不必等够再交接 */
  const lasting =
    link?.kind === "down" && (link.error.kind === "wrong_key" || link.error.kind === "version_mismatch");
  /** 连上之后首屏迟迟取不齐：不再等，交给那一页自己的骨架 */
  const [waited, setWaited] = useState(false);

  // ⌘R 和配置改动之后立刻重读一次。等下一次事件的话，刚点完「保存」还看着旧值
  const [nudge, setNudge] = useState(0);
  /** ⌘R、命令面板的「刷新数据」：状态和概览重读，眼前这一页的数据也重取 */
  const refresh = useCallback(() => {
    setNudge((n) => n + 1);
    invalidateAll();
  }, []);
  /** 改完配置：状态和概览重读 */
  const changed = useCallback(() => setNudge((n) => n + 1), []);
  const [ov, setOv] = useStableState<Overview | null>(null);
  /** 概览最近一次读失败的原因。还没读到过概览时，配置那几页拿它画「读取失败」 */
  const [ovError, setOvError] = useState<unknown>(null);

  /**
   * 守护状态。**推过来的，不是问出来的。**先挂监听再读一次当前值，顺序不能反：
   * 事件只报变化，两者之间发生的那一次转换会丢。
   */
  useEffect(() => {
    let alive = true;
    const un = subscribe<string>("core-state", (e) => {
      if (!alive) return;
      setCore(e.payload);
      // 又起来了：之前读状态失败的次数和原因作废，这一回重新数
      if (isRunning(parseCoreState(e.payload))) {
        setTries(0);
        setLinkError(null);
      }
    });
    void un.ready
      .then(() => invoke<string>("core_state"))
      .then((c) => {
        if (alive) setCore(c);
      })
      .catch(() => {
        /* core 还没起来。它起来的那一刻会推一条过来 */
      });
    return () => {
      alive = false;
      un();
    };
  }, []);

  /**
   * 状态与配置概览。**只在真的有理由重读的时候重读**：配置换了一份（`reloads`）、
   * 上游熔断或恢复（`health`）、模型清单开始或结束获取（`models`）、监听地址换了
   * （`listening`）、守护状态变了、上游的现状变了（`upstreamState`）、用户刚改完东西
   * （`nudge`）。**一串触发只读一次**（`COALESCE_MS`）。
   */
  useEffect(() => {
    /*
      头一次连上之前，控制面没答应就不去读：读回来的只有一句「连不上」。**安全模式的控制面
      也算**（`safe_mode:<pid>`）：一启动就进了安全模式的那次，界面要连上它，才说得出哪儿错了
    */
    if (!linkedRef.current && !controlUp(parseCoreState(core))) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let n = 0;
    const read = async () => {
      try {
        const s = await invoke<CoreStatus>("core_status");
        if (!alive) return;
        setStatus(s);
        setLinked(true);
        linkedRef.current = true;
        setTries(0);
        setLinkError(null);
      } catch (e) {
        /*
          **读不到不弹提示。**启动画面（还没连上时）和顶上那条横幅（连上过之后）已经
          在说 core 怎么了。次数和原因记下来交给它们；到上限就停手 —— 再试下去就是
          轮询了，守护状态一变这个 effect 会重跑。
        */
        if (!alive) return;
        n += 1;
        setTries(n);
        setLinkError(e);
        if (n <= MAX_TRIES) {
          timer = setTimeout(() => void read(), Math.min(1600, 200 * 2 ** Math.min(n - 1, 3)));
        }
        return;
      }
      try {
        const o = await call("Overview", null);
        if (alive) {
          setOv(o);
          setOvError(null);
        }
      } catch (e) {
        /*
          概览拿不到不影响状态那一半 —— 连上了就是连上了。**原因要留着**：还没读到过概览
          时，配置那几页只能画骨架，读失败了要换成「读取失败」和重试，而不是一直转着
        */
        if (alive) setOvError(e);
      }
    };
    // 头一次连上之前不攒：启动画面（热启动时是还藏着的窗口）正等着这一读
    const kick = setTimeout(() => void read(), linkedRef.current ? COALESCE_MS : 0);
    return () => {
      alive = false;
      clearTimeout(kick);
      if (timer) clearTimeout(timer);
    };
  }, [reloads, nudge, health, models, listening, upstreamState, core, setStatus, setOv]);

  useEffect(() => {
    if (!linked) return;
    const h = setTimeout(() => setWaited(true), FIRST_SCREEN_MS);
    return () => clearTimeout(h);
  }, [linked]);
  /*
    **首屏的数据取好了再交接。**启动画面下面主界面已经挂上了，交接时概览（和落地页
    那一页的数据）已经在了，数字不会在眼前从零跳成实际值。取不齐就不等了（`waited`）。
  */
  const handover = (linked && ((ov !== null && viewReady) || waited)) || gaveUp || lasting;

  // 热启动：交接的那一刻就是窗口出现的那一刻。Rust 那边也有保底，这里只管早到
  useEffect(() => {
    if (warm && handover) void invoke("reveal_main_window").catch(() => {});
  }, [handover]);

  /** 启动画面淡出完了 */
  const endLaunch = useCallback(() => setLaunching(false), []);

  return useMemo(
    () => ({
      core,
      linked,
      tries,
      linkError,
      status,
      ov,
      ovError,
      nudge,
      refresh,
      changed,
      feed,
      launching,
      endLaunch,
      handover,
    }),
    [core, linked, tries, linkError, status, ov, ovError, nudge, refresh, changed, feed, launching, endLaunch, handover],
  );
}

export type CoreLink = ReturnType<typeof useCoreLink>;
