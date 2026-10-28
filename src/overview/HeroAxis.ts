import { monthDay } from "@/format";
import type { Grid } from "./series";

/**
 * 用量大图的坐标轴：纵轴的刻度、横轴标在哪几格、哪一格还在进行。
 *
 * 和 `Hero.tsx` 分开，是为了能测：刻度整不整齐、标签落在哪一格、夏令时那天对不对得上，
 * 写在 JSX 里没有东西会回答。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 大图的绘图区多高（骨架照它留地方） */
export const CHART_H = 184;

/** 纵轴分几格：四格五条线 */
export const Y_STEPS = 4;

/**
 * 纵轴的顶：四格，每格是 1 / 2 / 2.5 / 5 乘 10 的幂（乘 `unit`），顶上留出一点空，最高的
 * 那根柱子不顶着最上面那条线。
 *
 * · `integer`：数的是个数（请求、token、字节），每格必须是整数 —— 没有「2.5 次请求」。
 *   一格是 2.5 的那一档跳过，不到 1 的按 1 算：只有一两次请求的图，纵轴是 0–4。
 * · `unit`：先换算到这个单位再取整齐的数。字节按 1024 进位，取整要在 KB、MB 里取，
 *   不然刻度是「97.7 KB」。
 * · 全是零（或者没有数）时给最小的那一档：个数是 0–4，别的是 0–1 个单位。
 */
export function niceTop(max: number, { integer = false, unit = 1 }: { integer?: boolean; unit?: number } = {}): number {
  const m = max / unit;
  if (!(m > 0) || !Number.isFinite(m)) return (integer ? Y_STEPS : 1) * unit;
  const raw = (m * 1.04) / Y_STEPS;
  let e = 10 ** Math.floor(Math.log10(raw));
  for (;;) {
    for (const f of [1, 2, 2.5, 5]) {
      // 1e-9：10 的负几次幂乘出来差一点点，不能因此跳到下一档
      const step = Number((f * e).toPrecision(12));
      if (step < raw * (1 - 1e-9)) continue;
      if (integer && (step < 1 || !Number.isInteger(step))) continue;
      return step * Y_STEPS * unit;
    }
    e *= 10;
  }
}

/** 纵轴上那五个数：0 到顶，四等分。浮点误差抹掉（「0.30000000000000004」） */
export function yTicks(top: number): number[] {
  return Array.from({ length: Y_STEPS + 1 }, (_, k) => Number(((top * k) / Y_STEPS).toPrecision(12)));
}

/**
 * 字节的纵轴按哪个单位取整：让峰值落在 1–1024 之间的那一级（B、KB、MB…）。返回那一级的
 * 字节数和第几级。
 */
export function byteUnit(max: number): { unit: number; level: number } {
  let level = 0;
  while (level < 4 && max >= 1024 ** (level + 1)) level += 1;
  return { unit: 1024 ** level, level };
}

/** 横轴上的一个标签：落在第几格的起点（`f` 是 0–1 的位置），写什么 */
export interface XTick {
  f: number;
  label: string;
}

/**
 * 这一格是过去的、正在进行的（包着此刻、还没过完），还是将来的（「某一天」选的是今天：
 * 图画到今晚零点，后面那几格还没到）。实时档的格子是一个个时刻，没有「进行中」。
 */
export function slotPhase(g: Grid, i: number, now: number): "past" | "ongoing" | "future" {
  const at = g.at[i];
  if (at === undefined || g.kind === "instant") return "past";
  if (at > now) return "future";
  return now < at + g.step ? "ongoing" : "past";
}

const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * 横轴标在哪几格、写什么。标签写在那一格的起点上，往右排开；**最多 `max` 个**（按图的宽度
 * 算，挤不下就隔得更开）。
 *
 * · 实时档：整分钟的时刻（每 1 / 2 / 5 分钟一个），写「14:32」。格子跟着时间走，标签也跟着
 *   往左走，位置按时刻算，不按第几格。
 * · 几小时一格：本地的整点（每 1 / 2 / 3 / 6 / 12 小时一个，是格宽的整数倍）。**零点写日期**
 *   （今天写「今天」）：24 小时的图跨过半夜，那一刻要看得出换了一天；「某一天」的第一格
 *   就是那一天的日期。整点排不下时退到按天标。
 * · 一天以上一格：每隔几格标一个日期。**从最右边那一格往回数**：最近的那一天一定标着。
 */
export function xTicks(g: Grid, max: number, { today, now }: { today: string; now: number }): XTick[] {
  const n = g.at.length;
  const first = g.at[0];
  if (first === undefined || max < 1) return [];
  const nowDate = new Date(now);
  const dateOf = (at: number) => (sameDay(new Date(at), nowDate) ? today : monthDay(at));

  if (g.kind === "instant") {
    const last = g.at[n - 1] ?? first;
    for (const every of [1, 2, 5, 10].map((m) => m * MINUTE)) {
      const out: XTick[] = [];
      for (let t = Math.ceil(first / every) * every; t <= last; t += every) {
        const d = new Date(t);
        // 点画在每一格的正中（见大图），时刻 t 落在两点之间按比例插
        out.push({ f: ((t - first) / g.step + 0.5) / n, label: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
      }
      if (out.length <= max) return out;
    }
    return [];
  }

  const at = (i: number) => g.at[i] ?? first;
  const tick = (i: number, label: string): XTick => ({ f: i / n, label });

  if (g.step < DAY) {
    const stepH = Math.max(1, Math.round(g.step / HOUR));
    for (const every of [1, 2, 3, 6, 12, 24]) {
      if (every < stepH || every % stepH !== 0) continue;
      const out: XTick[] = [];
      for (let i = 0; i < n; i++) {
        const d = new Date(at(i));
        if (d.getMinutes() !== 0 || d.getHours() % every !== 0) continue;
        out.push(tick(i, d.getHours() === 0 ? dateOf(at(i)) : `${pad(d.getHours())}:00`));
      }
      if (out.length <= max) return out;
    }
    // 整点排不下：只标零点，再隔几天一个
    const midnights: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(at(i));
      if (d.getHours() === 0 && d.getMinutes() === 0) midnights.push(i);
    }
    return everyFew(midnights, max).map((i) => tick(i, dateOf(at(i))));
  }

  // 一天以上一格。按天的格子从本地零点数固定毫秒，过了夏令时切换会落在前一天 23 点：
  // 写离起点最近的那一天
  const all = Array.from({ length: n }, (_, i) => i);
  return everyFew(all, max).map((i) => tick(i, dateOf(at(i) + 12 * HOUR)));
}

/**
 * 从一排格子里每隔几个挑一个，挑出来的不超过 `max` 个。**从最后一个往回数**，最后一个
 * 总在里面。隔几个按 1 / 2 / 3 / 5 / 7 / 14 / 28 … 挑，读起来是整齐的间距。
 */
function everyFew(idx: readonly number[], max: number): number[] {
  if (idx.length === 0 || max < 1) return [];
  const strides = [1, 2, 3, 5, 7, 14, 28];
  let stride = strides.find((s) => Math.ceil(idx.length / s) <= max);
  if (stride === undefined) stride = Math.ceil(idx.length / max);
  const out: number[] = [];
  for (let k = idx.length - 1; k >= 0; k -= stride) out.push(idx[k]!);
  return out.reverse();
}
