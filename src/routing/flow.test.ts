import { describe, expect, it } from "vitest";
import { FLOW_COLORS, FLOW_LAYERS, FLOW_MS, FLOW_PERIOD_PX, flowColor, flowCycles, flowDelay, flowShift, flowStrength } from "./flow";

/** 一层光点的前头在 `t` 时刻落在线上哪儿（按周期，0–1）：偏移从 1 匀速走到 0，`delay` 是它的起点 */
function frontAt(t: number, dash: number, delay: number): number {
  const local = (((t - delay) % FLOW_MS) + FLOW_MS) % FLOW_MS;
  const offset = 1 - local / FLOW_MS;
  return (((dash - offset) % 1) + 1) % 1;
}

describe("在途请求的光点", () => {
  it("每条线排整数个间距，至少一个；长一倍的线排两倍", () => {
    expect(flowCycles(0)).toBe(1);
    expect(flowCycles(FLOW_PERIOD_PX * 0.4)).toBe(1);
    expect(flowCycles(FLOW_PERIOD_PX * 1.4)).toBe(1);
    expect(flowCycles(FLOW_PERIOD_PX * 1.6)).toBe(2);
    expect(flowCycles(FLOW_PERIOD_PX * 3)).toBe(3);
    expect(Number.isInteger(flowCycles(123.4))).toBe(true);
  });

  it("请求多一点亮一点，封顶；没有请求时不画", () => {
    expect(flowStrength(0)).toBe(0);
    const s = [1, 2, 3, 4, 8].map(flowStrength);
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThanOrEqual(s[i - 1]!);
    expect(s[0]!).toBeGreaterThan(0.5);
    expect(s[s.length - 1]!).toBe(1);
  });

  it("不管什么时候挂上，同一刻每一层的前头都在同一处：先亮的线和后亮的线接得上", () => {
    for (const mount of [0, 17, 640.5, 1299, 98_765.25]) {
      for (const l of FLOW_LAYERS) {
        const d = flowDelay(mount, l.dash);
        expect(d).toBeLessThanOrEqual(0);
        expect(d).toBeGreaterThan(-FLOW_MS);
        // 动画从挂上那一刻算起，起点往前拨了 -d
        for (const t of [mount, mount + 333, mount + 5000]) {
          const front = frontAt(t - mount, l.dash, d);
          const ref = frontAt(t, FLOW_LAYERS[0]!.dash, flowDelay(0, FLOW_LAYERS[0]!.dash));
          expect(Math.min(Math.abs(front - ref), 1 - Math.abs(front - ref))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("每个请求一种颜色，先后到的轮着取；同一个请求每一段的错开量一样，所以接得上", () => {
    const colors = new Set(Array.from({ length: FLOW_COLORS }, (_, i) => flowColor(100 + i)));
    expect(colors.size).toBe(FLOW_COLORS);
    expect(flowColor(7)).toBe(flowColor(7 + FLOW_COLORS));
    expect(flowShift(0)).toBe(0);
    for (const id of [1, 2, 9]) {
      expect(flowShift(id)).toBeGreaterThanOrEqual(0);
      expect(flowShift(id)).toBeLessThan(1);
      // 错开量只是把每一层一起往后挪：不管哪一刻挂上，这个请求的几段前头都在同一处
      for (const mount of [0, 640.5, 98_765.25]) {
        const l = FLOW_LAYERS[0]!;
        const front = frontAt(1000 - mount, l.dash, flowDelay(mount, l.dash, flowShift(id)));
        const ref = frontAt(1000, l.dash, flowDelay(0, l.dash, flowShift(id)));
        expect(Math.min(Math.abs(front - ref), 1 - Math.abs(front - ref))).toBeLessThan(1e-9);
      }
    }
  });

  it("几层都比一个间距短，最亮的那层最短", () => {
    for (const l of FLOW_LAYERS) {
      expect(l.dash).toBeGreaterThan(0);
      expect(l.dash).toBeLessThan(1);
    }
    const top = FLOW_LAYERS.reduce((a, b) => (b.opacity > a.opacity ? b : a));
    expect(Math.min(...FLOW_LAYERS.map((l) => l.dash))).toBe(top.dash);
  });
});
