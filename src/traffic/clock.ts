/**
 * core 的时钟，由本机的时钟推出来。
 *
 * **在跑的请求跑了多久，要拿 core 的「现在」减开始事件的 `at_ms`** —— 两个都是 core
 * 那台机器的钟。连的是另一台机器上的 core 时，两边的钟可能差着几秒甚至几分钟：拿本机
 * 的 `Date.now()` 去减，差多少「已跑」就错多少，core 的钟快了还是负的。
 *
 * 所以记下「core 的钟比本机快多少」，本机的钟加上它就是 core 此刻的钟：
 *
 * · `/in-flight` 的快照带着 core 拍它那一刻的钟（`now_ms`）。那一刻在问出去和收回来
 *   之间，按一去一回的中点算，差不过往返的一半。每拿到一份快照重定一次：开窗、core
 *   回到在跑、事件流丢过事件，都会问（见 `useRequests`）。
 * · 两份快照之间，事件流上每来一条开始事件：它的 `at_ms` 是 core 发出它的那一刻，收到
 *   时 core 的钟只会更晚。比现在的估计还晚，就把估计抬到它 —— 只抬不降，core 的钟在
 *   两份快照之间往前拨了也跟得上。
 *
 * 换了连接从头来（`resetCoreClock`）：另一台机器是另一个钟。
 */

/** core 的钟比本机快多少毫秒。`null`：还没对过 */
let skew: number | null = null;
/** 显示已跑时长的地方：秒针走一格、钟重新对过，都重画一次 */
const listeners = new Set<() => void>();

function changed(): void {
  for (const f of listeners) f();
}

/** 换了连接：之前那个 core 的钟作废 */
export function resetCoreClock(): void {
  skew = null;
  changed();
}

/** 一份快照：core 在 `nowMs` 那一刻拍的，本机 `sentAt` 问出去、`gotAt` 收到 */
export function syncCoreClock(nowMs: number, sentAt: number, gotAt: number): void {
  skew = nowMs - (sentAt + gotAt) / 2;
  changed();
}

/** 本机 `gotAt` 收到一条开始事件：core 的钟至少走到了它的 `atMs` */
export function noteCoreTime(atMs: number, gotAt: number): void {
  const least = atMs - gotAt;
  if (skew !== null && least <= skew) return;
  skew = least;
  changed();
}

/** core 此刻的钟。还没对过是 `null` */
export function coreNow(local = Date.now()): number | null {
  return skew === null ? null : local + skew;
}

/** 秒针。有地方在显示已跑时长才走，全都摘掉就停 */
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 挂一个每秒重画一次的回调（钟重新对过时也叫它），返回摘掉它的函数。所有地方共用
 * 一根秒针，同时跳。
 */
export function onTick(f: () => void): () => void {
  listeners.add(f);
  timer ??= setInterval(changed, 1_000);
  return () => {
    listeners.delete(f);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** 已跑时长：`0:07`、`12:05`、`1:03:20`。和菜单栏「进行中」那一栏同一个写法 */
export function stopwatch(ms: number): string {
  const all = Math.floor(ms / 1000);
  const h = Math.floor(all / 3600);
  const m = Math.floor((all % 3600) / 60);
  const s = String(all % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
