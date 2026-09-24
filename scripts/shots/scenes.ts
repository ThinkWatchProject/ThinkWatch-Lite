// 要拍的每一张图：开哪一页、连着本机还是远程、摆好之后要不要点开什么。
//
// 截图程序（capture.swift）先打开 `index.html?list` 读这张表，再按「场景 × 语言 ×
// 深浅」逐张打开 `index.html?scene=<id>&lang=<zh|en>` 来拍。**表只在这里写一份。**
//
// `setup` 在页面取完数之后跑，跑完再等一轮取数和动画才拍。它用的文案从界面自己的
// i18n 表里取，所以中英两种界面走的是同一段代码。
import { textOf } from "@/i18n";
import { connText } from "@/connection/connection.i18n";
import { routingText } from "@/routing/routing.i18n";
import { byText, choose, click, idle, type, waitFor } from "./drive";

export interface Scene {
  /** 输出的文件名：`docs/screenshots/<语言>/<id>-<深浅>.png` */
  id: string;
  /** 打开哪一页（`take_pending_view` 认的写法） */
  page: string;
  /** 连着远程 core（`homelab`），不是本机 */
  remote?: boolean;
  /** `homelab` 这条连接还没存：拍的就是添加它的那一刻 */
  adding?: boolean;
  /** 页面自己记在 localStorage 里的偏好（概览的时间范围……），挂载之前写进去 */
  storage?: Record<string, string>;
  /** 页面取完数之后要做的事：点开弹层、填表。做完之后才拍 */
  setup?: () => Promise<void>;
}

export const SCENES: Scene[] = [
  // 七天：一格两小时，看得出白天、夜里和周末
  { id: "overview", page: "dashboard", storage: { "tw-range": "7d" } },
  { id: "traffic", page: "requests" },
  { id: "clients", page: "clients" },
  { id: "keys", page: "keys" },
  { id: "upstreams", page: "upstreams" },
  { id: "routing", page: "routing" },
  { id: "security", page: "security" },
  { id: "mcp", page: "mcp" },
  { id: "settings", page: "settings" },
  {
    // 路由页的试算：Cursor 那把密钥用 OpenAI 的格式要 Sonnet，会走到哪儿、为什么、
    // 要不要转换格式。和 core/requests.json 里的那一条是同一个请求
    id: "dry-run",
    page: "routing",
    setup: async () => {
      click(await waitFor(() => byText(textOf(routingText).dryRun)));
      const dialog = await waitFor<HTMLElement>("[role=dialog]");
      choose(await waitFor<HTMLSelectElement>(() => dialog.querySelector<HTMLSelectElement>("select[id$='-key']")), "cursor");
      choose(await waitFor<HTMLSelectElement>(() => dialog.querySelector<HTMLSelectElement>("select[id$='-dialect']")), "openai-chat");
      const model = await waitFor<HTMLInputElement>(() => dialog.querySelector<HTMLInputElement>("input[id$='-model']"));
      type(model, "claude-sonnet-5");
      model.blur();
      await idle();
    },
  },
  {
    // 侧栏底部的连接切换器，连着远程 core 时点开
    id: "remote-switcher",
    page: "dashboard",
    remote: true,
    storage: { "tw-range": "7d" },
    setup: async () => {
      // 触发器外面包着悬停说明，`data-slot` 被它那一层盖掉了，按菜单按钮的角色找
      click(await waitFor("[data-slot=sidebar-footer] button[aria-haspopup=menu]"));
      await waitFor("[data-slot=dropdown-menu-content]");
    },
  },
  {
    // 设置 → 连接 → 添加远程连接：填好、测试通过
    id: "remote-add",
    page: "settings",
    adding: true,
    setup: async () => {
      const t = textOf(connText);
      click(await waitFor(() => byText(t.add)));
      type(await waitFor<HTMLInputElement>("#conn-name"), "homelab");
      type(await waitFor<HTMLInputElement>("#conn-host"), "192.168.1.40");
      type(await waitFor<HTMLInputElement>("#conn-port"), "24817");
      type(await waitFor<HTMLInputElement>("#conn-key"), "8c1f4e0a7d2b96f3a5e8c0d4b7f1a3e62d9c5b8f0e4a7d1c3b6f9e2a5d8c0b7f");
      (document.activeElement as HTMLElement | null)?.blur();
      const dialog = await waitFor<HTMLElement>("[role=dialog]");
      click(await waitFor(() => byText(t.test, "button", dialog)));
      await waitFor(() => dialog.querySelector(".text-success"));
    },
  },
  // 连着远程 core 时的客户端页：顶上那一条说明改的是这台 Mac 上的客户端
  { id: "remote-clients", page: "clients", remote: true },
];

export function sceneOf(id: string | null): Scene | undefined {
  return SCENES.find((s) => s.id === id);
}
