// 场景里的动作：等页面取完数、点开弹层、往输入框里填字，最后告诉截图程序「可以拍了」。
//
// **点击照真的鼠标那样发一串事件**（pointerdown → mousedown → pointerup → mouseup →
// click）。Radix 的下拉菜单在 pointerdown 上打开，对话框里的按钮认 click —— 只发其中一个，
// 有的弹层打不开，而且打不开时不报错，拍出来的是一张少了弹层的图。

/** 还没答复的 IPC 调用有几个。页面「取完数了」就是它归零之后又静了一会儿 */
let pending = 0;
let lastChange = performance.now();

/** 把一次 IPC 调用记进 `pending`。mock 的每一个回答都经过这里 */
export function track<T>(p: Promise<T>): Promise<T> {
  pending += 1;
  lastChange = performance.now();
  return p.finally(() => {
    pending -= 1;
    lastChange = performance.now();
  });
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等到没有在途的 IPC 调用，而且静了 `quietMs` */
export async function idle(quietMs = 500, timeoutMs = 20_000): Promise<void> {
  const t0 = performance.now();
  while (pending > 0 || performance.now() - lastChange < quietMs) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`等了 ${timeoutMs} ms，还有 ${pending} 个调用没答复`);
    await sleep(50);
  }
}

/** 进场动画（对话框淡入、弹层展开）走完。一直转的（加载圈）不算 */
export async function animationsDone(timeoutMs = 5_000): Promise<void> {
  const t0 = performance.now();
  const busy = () =>
    document.getAnimations().some((a) => {
      if (a.playState !== "running") return false;
      const end = a.effect?.getComputedTiming().endTime;
      return typeof end === "number" && Number.isFinite(end);
    });
  while (busy()) {
    if (performance.now() - t0 > timeoutMs) return;
    await sleep(50);
  }
}

/**
 * 一直在转的（加载圈、「进行中」的脉冲点）停在第一帧。不停的话，每次拍到的相位不一样，
 * 同一张图拍两次对不上
 */
export async function freezeLoops(): Promise<void> {
  for (const a of document.getAnimations()) {
    if (a.effect?.getComputedTiming().endTime === Infinity) {
      a.pause();
      a.currentTime = 0;
    }
  }
  // 等两帧，让停下来的那一帧画出来
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

/** 等一个元素出现。`what` 是选择器，或者一个返回元素的函数 */
export async function waitFor<T extends Element>(
  what: string | (() => T | null | undefined),
  timeoutMs = 10_000,
): Promise<T> {
  const t0 = performance.now();
  for (;;) {
    const el = typeof what === "string" ? document.querySelector<T & Element>(what) : what();
    if (el) return el as T;
    if (performance.now() - t0 > timeoutMs) throw new Error(`等不到 ${typeof what === "string" ? what : "元素"}`);
    await sleep(50);
  }
}

/** 文字恰好是 `text` 的那个元素（按钮、菜单项）。找最里层的，外面包着的容器不算 */
export function byText(text: string, selector = "button, [role=menuitem], a", scope: ParentNode = document): HTMLElement | null {
  const all = [...scope.querySelectorAll<HTMLElement>(selector)];
  return all.find((el) => el.textContent?.trim() === text) ?? null;
}

/** 像鼠标那样点一下 */
export function click(el: Element): void {
  const r = el.getBoundingClientRect();
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
  const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", pointer));
  el.dispatchEvent(new MouseEvent("mouseup", at));
  el.dispatchEvent(new MouseEvent("click", at));
}

/**
 * 往受控的输入框里填字。
 *
 * **不能直接赋 `value`**：React 记着上一次的值，直接赋了它认为什么都没变，`onChange`
 * 不会来。要走原型上的 setter，再发一个 input 事件。
 */
export function type(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 选中下拉框里的一项。和输入框一样走原型上的 setter；React 听的是 change 事件 */
export function choose(el: HTMLSelectElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** 截图程序读的状态：`ready` 之后拍，`error` 就停下来报出原因 */
export type ShotState = { state: "loading" } | { state: "ready" } | { state: "error"; message: string };

declare global {
  interface Window {
    __shot: ShotState;
    /** `index.html?list`：有哪些场景 */
    __shotList?: string[];
    /** `index.html?list`：定住的「现在」和今天的用量，菜单栏那几张图用 */
    __shotToday?: { now: number; tokens: number; cost_micros: number; requests: number; failed: number };
  }
}
