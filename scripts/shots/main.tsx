// 截图用的入口：真的应用（src/main.tsx → App）跑在假的 IPC 上。怎么用见 CONTRIBUTING.md
// 的「Product screenshots」一节。
//
// **不进应用的包。**应用的构建只认根目录的 index.html，这里是另一个入口，由
// `scripts/shots/vite.config.ts` 单独构建。
import { NOW } from "./boot"; // 必须是第一个：注入的全局量和定住的时钟
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { P } from "./mock/params";
import { SCENES } from "./scenes";
import { animationsDone, freezeLoops, idle, sleep, track } from "./drive";

window.__shot = { state: "loading" };

async function main() {
  const q = new URLSearchParams(location.search);
  if (q.has("list")) {
    window.__shotList = SCENES.map((s) => s.id);
    // 菜单栏那几张图（src-tauri/examples/menubar_shots.rs）上的「今天」：和概览同一个口径
    const { summary } = await import("./mock/traffic");
    const midnight = new Date(NOW);
    midnight.setHours(0, 0, 0, 0);
    const t = summary(midnight.getTime());
    window.__shotToday = {
      tokens: t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens,
      cost_micros: t.cost_micros_exact + t.cost_micros_estimated,
      requests: t.requests,
      failed: t.failed,
    };
    window.__shot = { state: "ready" };
    return;
  }
  const scene = P.scene;
  if (!scene) throw new Error(`没有这个场景：${q.get("scene")}`);

  for (const [k, v] of Object.entries(scene.storage ?? {})) localStorage.setItem(k, v);
  const { command } = await import("./mock/commands");
  mockWindows("main");
  mockIPC((cmd, args) => track(command(cmd, (args ?? {}) as Record<string, unknown>)), {
    shouldMockEvents: true,
  });
  // mock 的 unlisten 读 `args.id`，而 @tauri-apps/api 传的是 `eventId`：不改的话，卸载了的
  // 监听一直挂着，之后每发一个事件都报一句「Couldn't find callback id」
  {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (c: string, a?: Record<string, unknown>, o?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const inner = internals.invoke;
    internals.invoke = (cmd, args, opts) =>
      inner(cmd, cmd === "plugin:event|unlisten" && args ? { ...args, id: args.eventId } : args, opts);
  }

  await import("../../src/main");
  // 首屏取完数、字体到齐，再摆场景
  await idle();
  await document.fonts.ready;
  if (scene.setup) {
    await scene.setup();
    await idle();
  }
  // 进场动画、数字滚动走完
  await animationsDone();
  await sleep(700);
  await idle();
  await animationsDone();
  await freezeLoops();
  window.__shot = { state: "ready" };
}

main().catch((e: unknown) => {
  // WebKit 的 `stack` 里没有那句话本身，两样都要
  window.__shot = { state: "error", message: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e) };
});
