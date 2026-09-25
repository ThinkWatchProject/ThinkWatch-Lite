import type { ReactNode } from "react";
import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BellIcon,
  CircleHelpIcon,
  DownloadIcon,
  FileCodeIcon,
  FlaskConicalIcon,
  HistoryIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  ZapIcon,
} from "lucide-react";
import { textOf, type Lang } from "@/i18n";
import { appText } from "@/App.i18n";
import { SURFACES, type Nav, type Surface } from "@/nav";
import type { ClientsResponse, Overview, RequestRow } from "@/types";
import {
  IconClient,
  IconDashboard,
  IconFlow,
  IconGateway,
  IconGuard,
  IconKey,
  IconLocal,
  IconMcp,
  IconRemote,
  IconRoute,
  IconServer,
  IconSettings,
  IconSidebar,
} from "@/ui/icons";
import { ClientLogo, UpstreamLogo } from "@/ui/logos";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { groupKindLabel, notSentText, probeLabel, targetLabel, ALL_UPSTREAMS } from "@/labels";
import { when } from "@/format";
import { notSent } from "@/requestRouting";
import { NotSentIcon } from "@/traffic/cells";
import type { ConnView } from "@/connection/api";
import { connText } from "@/connection/connection.i18n";
import { profileName } from "@/connection/describe";
import { COMBOS, pageCombo, type Combo } from "./keys";
import { paletteText } from "./palette.i18n";
import { SETTINGS_SECTIONS } from "./sections";

/** 结果分的组，也是空查询时的顺序 */
export type GroupId =
  | "recent"
  | "pages"
  | "actions"
  | "upstreams"
  | "keys"
  | "routes"
  | "groups"
  | "clients"
  | "connections"
  | "settings"
  | "requests";

/** 选中之后按回车会怎样。页脚上写这个词 */
export type Verb = "open" | "run" | "switch";

/** 面板里的一项 */
export interface Item {
  /** 稳定的标识：`page:keys`、`action:new-upstream`、`upstream:deepseek`。「最近使用」按它记 */
  id: string;
  group: Exclude<GroupId, "recent">;
  title: string;
  /** 同一行、名字后面的灰字 */
  detail?: string;
  /** 只用来搜、不显示：另一种语言的名字、别名、地址 */
  keywords?: string[];
  icon: ReactNode;
  /** 右端的键帽 */
  combo?: Combo;
  /** 右端的状态（点 + 字、时间） */
  meta?: ReactNode;
  verb: Verb;
  /** 只在搜的时候出现（上游、密钥这些实体，设置的各节）。空查询时不列 */
  searchOnly?: boolean;
  /** 选中之后面板不关，进下一级（切换连接） */
  enter?: "connections";
  /** 列出来但选不了：当前连着的那一条（切过去什么都不会发生）。方向键跳过它 */
  disabled?: boolean;
  run: () => void;
}

const PAGE_ICONS: Record<Surface, ReactNode> = {
  dashboard: <IconDashboard />,
  requests: <IconFlow />,
  clients: <IconClient />,
  keys: <IconKey />,
  upstreams: <IconServer />,
  routing: <IconRoute />,
  security: <IconGuard />,
  mcp: <IconMcp />,
  settings: <IconSettings />,
};

/** 两种语言的别名都参与搜索：中文界面里打 `dark` 也找得到外观 */
function both(pick: (t: (typeof paletteText)["zh"]) => string | undefined): string[] {
  return [pick(paletteText.zh), pick(paletteText.en)].filter((s): s is string => !!s);
}

/** 外壳交进来的：数据和几个只有外壳做得了的动作 */
export interface Sources {
  nav: Nav;
  lang: Lang;
  /** 连上 core 了。没连上时只有设置、连接和几个不碰 core 的动作 */
  linked: boolean;
  /** 连着的远程 core 断了：内容只读，写配置的动作不出现 */
  readOnly: boolean;
  /** 连着远程 core */
  remote: boolean;
  ov: Overview | null;
  railOpen: boolean;
  conn: ConnView | null;
  clients: ClientsResponse | undefined;
  switchTo: (id: string) => void;
  addConnection: () => void;
  shell: {
    toggleRail: () => void;
    refresh: () => void;
    configFile: () => void;
    history: () => void;
    notices: () => void;
    shortcuts: () => void;
    checkUpdates: () => void;
  };
}

/**
 * 面板里除了请求以外的全部条目。请求另算（`requestItems`）：五百行每次都铺成条目
 * 不划算，搜的时候才挑。
 */
export function buildItems(s: Sources): Item[] {
  const t = textOf(paletteText);
  const app = textOf(appText);
  const { nav, ov, linked } = s;
  const writable = linked && !s.readOnly;
  const hasUpstreams = (ov?.providers.length ?? 0) > 0;
  const items: Item[] = [];

  // ── 页面：源列表的顺序，⌘1…⌘9
  SURFACES.forEach((surface, i) => {
    if (!linked && surface !== "settings") return;
    items.push({
      id: `page:${surface}`,
      group: "pages",
      title: app.surfaces[surface],
      keywords: [appText.zh.surfaces[surface], appText.en.surfaces[surface], ...both((x) => x.pageAliases[surface])],
      icon: PAGE_ICONS[surface],
      combo: pageCombo(i),
      verb: "open",
      run: () => nav.open(surface),
    });
  });

  // ── 操作
  const action = (
    id: string,
    title: string,
    icon: ReactNode,
    run: () => void,
    more: Partial<Item> & { alias?: string } = {},
  ) => {
    const { alias, keywords = [], ...rest } = more;
    items.push({
      id: `action:${id}`,
      group: "actions",
      title,
      icon,
      verb: "run",
      run,
      ...rest,
      // 两种语言的名字，加两种语言的别名
      keywords: [...keywords, ...both((x) => x.actionAliases[alias ?? id])],
    });
  };
  const other = (pick: (x: (typeof paletteText)["zh"]) => string) => [pick(paletteText.zh), pick(paletteText.en)];

  if (writable) {
    action("new-upstream", t.newUpstream, <PlusIcon />, () => nav.open("upstreams", { create: "upstream" }), {
      keywords: other((x) => x.newUpstream),
    });
    action("new-key", t.newKey, <PlusIcon />, () => nav.open("keys", { create: true }), {
      keywords: other((x) => x.newKey),
    });
    if (hasUpstreams) {
      action("new-route", t.newRoute, <PlusIcon />, () => nav.open("routing", { create: "route" }), {
        keywords: other((x) => x.newRoute),
      });
    }
  }
  if (linked && hasUpstreams && !s.readOnly) {
    action("speed-test", t.speedTest, <ZapIcon />, () => nav.open("upstreams", { test: "speed" }), {
      keywords: other((x) => x.speedTest),
      alias: "speedTest",
    });
    action("link-test", t.linkTest, <ActivityIcon />, () => nav.open("upstreams", { test: "link" }), {
      keywords: other((x) => x.linkTest),
      alias: "linkTest",
    });
    action("dry-run", t.dryRun, <FlaskConicalIcon />, () => nav.open("routing", { dryRun: true }), {
      keywords: other((x) => x.dryRun),
      alias: "dryRun",
    });
  }
  if (linked) {
    action("search-traffic", t.searchTraffic, <SearchIcon />, () => nav.open("requests", { search: true }), {
      keywords: other((x) => x.searchTraffic),
      combo: COMBOS.search,
      alias: "searchTraffic",
    });
  }
  const profiles = s.conn?.profiles ?? [];
  if (profiles.length > 1) {
    action("switch-connection", t.switchConnection, <ArrowLeftRightIcon />, () => {}, {
      keywords: other((x) => x.switchConnection),
      alias: "switchConnection",
      enter: "connections",
    });
  }
  action("refresh", t.refresh, <RotateCwIcon />, s.shell.refresh, {
    keywords: other((x) => x.refresh),
    combo: COMBOS.refresh,
  });
  action("rail", s.railOpen ? app.collapseRail : app.expandRail, <IconSidebar />, s.shell.toggleRail, {
    keywords: [appText.zh.collapseRail, appText.zh.expandRail, appText.en.collapseRail, appText.en.expandRail],
    combo: COMBOS.rail,
  });
  if (linked) {
    action("config-file", app.configFile, <FileCodeIcon />, s.shell.configFile, {
      keywords: [appText.zh.configFile, appText.en.configFile],
      alias: "configFile",
    });
    action("version-history", app.versionHistory, <HistoryIcon />, s.shell.history, {
      keywords: [appText.zh.versionHistory, appText.en.versionHistory],
      alias: "versionHistory",
    });
  }
  action("check-updates", t.checkUpdates, <DownloadIcon />, s.shell.checkUpdates, {
    keywords: other((x) => x.checkUpdates),
    alias: "checkUpdates",
  });
  action("notices", t.notices, <BellIcon />, s.shell.notices, { keywords: other((x) => x.notices) });
  action("shortcuts", t.shortcuts, <CircleHelpIcon />, s.shell.shortcuts, {
    keywords: other((x) => x.shortcuts),
    combo: COMBOS.shortcuts,
  });

  // 只在搜的时候出现的几个动作：常用的已经在上面，这几个列出来只会把列表拉长
  if (writable) {
    if (hasUpstreams) {
      action("new-group", t.newGroup, <PlusIcon />, () => nav.open("routing", { create: "group" }), {
        keywords: other((x) => x.newGroup),
        searchOnly: true,
      });
    }
    action("new-proxy", t.newProxy, <PlusIcon />, () => nav.open("upstreams", { create: "proxy" }), {
      keywords: other((x) => x.newProxy),
      searchOnly: true,
    });
    action("new-sheet", t.newSheet, <PlusIcon />, () => nav.open("upstreams", { create: "sheet" }), {
      keywords: other((x) => x.newSheet),
      searchOnly: true,
    });
  }
  action("add-connection", t.addConnection, <PlusIcon />, s.addConnection, {
    keywords: other((x) => x.addConnection),
    alias: "addConnection",
    searchOnly: true,
  });

  // ── 实体：只在搜的时候出现
  if (ov && linked) {
    for (const p of ov.providers) {
      const status: [StatusTone, string] | null = p.disabled
        ? ["idle", t.disabled]
        : p.oauth?.needs_login
          ? ["error", t.needsLogin]
          : p.auth_rejected != null
            ? ["error", t.authRejected]
            : p.health === "open"
              ? ["error", t.circuitOpen]
              : null;
      // 账号上游的地址人人一样：和上游列表一样，写登的是哪个账号
      const email = p.oauth?.account?.email;
      items.push({
        id: `upstream:${p.name}`,
        group: "upstreams",
        title: p.name,
        detail: email ?? hostOf(p.base_url),
        // 地址也能搜（`11434`、`api.deepseek`），账号的邮箱也能；协议不算 —— 打 `openai`
        // 会把一半上游都带出来
        keywords: email ? [p.base_url, email] : [p.base_url],
        icon: <UpstreamLogo name={p.name} baseUrl={p.base_url} protocol={p.protocol} />,
        meta: status && <Status tone={status[0]} text={status[1]} />,
        verb: "open",
        searchOnly: true,
        run: () => nav.open("upstreams", { edit: p.name }),
      });
    }
    for (const k of ov.clients) {
      const tags = [k.default && t.defaultMark, k.disabled && t.disabled].filter(Boolean).join(" · ");
      items.push({
        id: `key:${k.name}`,
        group: "keys",
        title: k.name,
        detail: k.route ? t.route(k.route) : t.defaultRoute,
        // 绑定的客户端：密钥名和应用名不一样时，按应用也找得到
        keywords: [k.client ?? ""],
        icon: k.client ? <ClientLogo id={k.client} /> : <IconKey />,
        meta: tags ? <Status tone={k.disabled ? "idle" : undefined} text={tags} /> : undefined,
        verb: "open",
        searchOnly: true,
        run: () => nav.open("keys", { edit: k.name }),
      });
    }
    // 没有上游时路由页只有一句「先添加上游」，路由和策略组打不开
    for (const r of hasUpstreams ? ov.routes : []) {
      items.push({
        id: `route:${r.name}`,
        group: "routes",
        title: r.name,
        detail: t.rules(r.rules.length),
        icon: <IconRoute />,
        meta: r.default ? <Status text={t.defaultMark} /> : undefined,
        verb: "open",
        searchOnly: true,
        run: () => nav.open("routing", { editRoute: r.name }),
      });
    }
    for (const g of hasUpstreams ? ov.groups : []) {
      // 内置的「全部上游」不能编辑，在表里双击它也是去上游页
      if (g.builtin || g.name === ALL_UPSTREAMS) continue;
      items.push({
        id: `group:${g.name}`,
        group: "groups",
        title: targetLabel(g.name),
        detail: `${groupKindLabel(g.kind)} · ${t.upstreamCount(g.providers.length)}`,
        // 显示的是译名（内置组），原名也能搜。里面的上游不算：打 `deep` 要的是 deepseek
        // 这个上游，不是每个含有它的组
        keywords: [g.name],
        icon: <IconRoute />,
        verb: "open",
        searchOnly: true,
        run: () => nav.open("routing", { editGroup: g.name }),
      });
    }
  }

  if (s.clients && linked) {
    for (const c of s.clients.clients) {
      const adopted = c.adopted_at_ms != null;
      items.push({
        id: `client:${c.id}`,
        group: "clients",
        title: c.name,
        keywords: [c.id],
        icon: <ClientLogo id={c.id} name={c.name} />,
        meta: !c.installed ? (
          <Status text={t.notInstalled} />
        ) : adopted ? (
          <Status tone="ok" text={t.adopted} />
        ) : undefined,
        verb: "open",
        searchOnly: true,
        // 和点那一行一样：没安装的打开手动配置
        run: () => nav.open("clients", c.installed ? { detail: c.id } : { setup: c.id }),
      });
    }
    for (const m of s.clients.manual) {
      items.push({
        id: `client:${m.id}`,
        group: "clients",
        title: m.name,
        keywords: [m.id],
        icon: <ClientLogo id={m.id} name={m.name} />,
        meta: <Status text={t.manualSetup} />,
        verb: "open",
        searchOnly: true,
        run: () => nav.open("clients", { setup: m.id }),
      });
    }
  }

  if (s.conn) {
    for (const p of s.conn.profiles) {
      const current = p.id === s.conn.current;
      items.push({
        id: `connection:${p.id}`,
        group: "connections",
        title: profileName(p),
        detail: p.local ? undefined : (p.addr ?? undefined),
        keywords: p.local ? [connText.zh.local, connText.en.local] : [p.name, p.host ?? ""],
        icon: p.local ? <IconLocal /> : <IconRemote />,
        meta: current ? <Status tone="ok" text={t.current} /> : undefined,
        disabled: current,
        verb: "switch",
        searchOnly: true,
        run: () => s.switchTo(p.id),
      });
    }
  }

  // ── 设置的各节
  for (const sec of SETTINGS_SECTIONS) {
    if (sec.core && !linked) continue;
    if (sec.local && s.remote) continue;
    items.push({
      id: `settings:${sec.id}`,
      group: "settings",
      title: sec.title[s.lang],
      detail: app.surfaces.settings,
      keywords: [sec.title.zh, sec.title.en, ...both((x) => x.sectionAliases[sec.id])],
      icon: <IconSettings />,
      verb: "open",
      searchOnly: true,
      run: () => nav.open("settings", { section: sec.id }),
    });
  }

  return items;
}

/**
 * 请求。**只在搜的时候挑**，按编号、模型比对；最多挑 `limit` 条，分数一样新的在前
 * （`rows` 本来就是新的在前）。
 *
 * · 按模型搜：**每个模型只列最近的那一条**。打 `claude` 要看到的是 sonnet、haiku、
 *   opus 各自最近的一条，不是六条一模一样的 sonnet —— 同一个模型的更多请求是流量页
 *   筛选的事。
 * · 上游、密钥不参与：打 `codex` 找的是那把密钥和那个客户端，不是它发过的几百条请求。
 */
export function requestItems(
  rows: readonly RequestRow[],
  ov: Overview | null,
  nav: Nav,
  scoreOf: (title: string, keywords: string[]) => number,
  idQuery: string | null,
  limit: number,
): { item: Item; score: number }[] {
  const t = textOf(paletteText);
  const baseOf = new Map(ov?.providers.map((p) => [p.name, p]) ?? []);
  const out: { item: Item; score: number; row: RequestRow }[] = [];
  /** 按模型搜时已经列过的模型（`rows` 新的在前，先碰到的就是最近的那一条） */
  const seen = new Set<string>();
  for (const r of rows) {
    // 本地应答的没有模型，路径是辅助请求的类别（`titling`）：标题写类别的名字，原词留着搜
    const title = r.model || (r.local ? probeLabel(r.path) : r.path);
    const keywords = r.local && !r.model ? [r.path] : [];
    let sc: number;
    if (idQuery !== null) {
      const id = String(r.id);
      sc = id === idQuery ? 1 : id.startsWith(idQuery) ? 0.85 : 0;
    } else {
      if (seen.has(title)) continue;
      sc = scoreOf(title, keywords);
      if (sc >= 0.5) seen.add(title);
    }
    if (sc < 0.5) continue;
    const p = baseOf.get(r.provider);
    const tone: StatusTone | null =
      r.state === "in_flight" ? "pending" : r.state === "failed" ? "error" : null;
    // 没有发往任何上游的（被规则拒绝、选中的上游一个都接不了）上游是空的：图形和那一行说是
    // 哪一种，不画一个「?」方块。本地应答的「上游」一格是那一句说明，不是上游的名字
    const sent = notSent(r);
    out.push({
      row: r,
      score: sc,
      item: {
        id: `request:${r.id}`,
        group: "requests",
        title,
        detail: [t.requestNo(r.id), sent ? notSentText(sent) : r.provider, r.client].filter(Boolean).join(" · "),
        icon: sent ? (
          <NotSentIcon kind={sent} plain />
        ) : r.local ? (
          <IconGateway />
        ) : (
          <UpstreamLogo name={r.provider} baseUrl={p?.base_url} protocol={p?.protocol} />
        ),
        meta: (
          <>
            {tone && <StatusDot tone={tone} label={tone === "pending" ? t.inFlight : t.failed} />}
            <span className="tw-num">{when(r.atMs)}</span>
          </>
        ),
        verb: "open",
        searchOnly: true,
        run: () => nav.open("requests", { request: r.id }),
      },
    });
  }
  // 编号对得上、但不在手上这几百行里（更早的）：照样能打开，详情是按编号去取的。排在
  // 手上前缀对上的那几条后面 —— 编号多半还没打完
  if (idQuery !== null && !out.some((x) => String(x.row.id) === idQuery)) {
    const id = Number(idQuery);
    out.push({
      row: { id } as RequestRow,
      score: 0.8,
      item: {
        id: `request:${id}`,
        group: "requests",
        title: t.openRequest(id),
        icon: <IconFlow />,
        verb: "open",
        searchOnly: true,
        run: () => nav.open("requests", { request: id }),
      },
    });
  }
  // 稳定排序：分数一样时保留原来的顺序（新的在前）
  return out
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}

/** 右端的状态：可选的点，加几个字 */
function Status({ tone, text }: { tone?: StatusTone; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {tone && <StatusDot tone={tone} />}
      {text}
    </span>
  );
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}
