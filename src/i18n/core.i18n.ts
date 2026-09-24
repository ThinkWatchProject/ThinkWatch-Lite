import type { Msg } from "@/types";
import { getLang } from "./index";
import CORE_ZH from "./core.zh.json";
import { render, type Args, type Tables } from "./template";

/**
 * core 发来的那些码，中文怎么说。
 *
 * **只有中文一份，没有英文那一份。**core 给的 `text` 已经是英文了 ——
 * 再在这里抄一份英文，core 一改措辞两边就对不上，而那份抄本没有任何
 * 东西在守着它。所以英文界面直接用 `text`，这张表只回答一个问题：
 * 「这句话中文怎么说」。
 *
 * **表在 `core.zh.json`，不在这里。**系统通知的正文是 Rust 写的（`notices::rules`），
 * 也要按码说中文；表写成数据，两边读同一份（Rust 那边 `include_str!`），不会一边
 * 改了一边没改。句子的写法见 `template.ts`：参数、查词表、可有可无的一段。
 *
 * **码不在表里就显示 `text`。**两种情况会走到这条退路，而且都该走：
 * 这句还没进词表，或者这条消息只是把更深一层的原话原样带出来（`{detail}`
 * 那一类，翻它没有意义）。
 *
 * 码的写法和 core 一致：点分小写，第一段是发出它的那一层（`l1` 是链路
 * 测速，`gw` 是网关的数据面，`control` 是控制面）。表里以 `//` 开头的键是分节的
 * 标题，不是码。
 */
export const CORE_TABLES: Tables = CORE_ZH.tables;
const MESSAGES: Record<string, string> = CORE_ZH.messages;

/**
 * 原因外面套的那一层场合：哪个上游的凭据、哪个代理的密码、Z.ai 登录卡在哪一步。
 *
 * **码是原因的码**（core 的 `Msg::in_context`）：场合只多一个参数，英文
 * 前面多一句「`{lead}: `」。所以这边按原因的码翻，再把场合接回前面。
 *
 * **认场合要看英文开头，不能只看参数在不在** —— `upstream` 这类参数原因
 * 自己也可能带着（`gw.oauth.not_configured` 就带），只看参数会把一句
 * 「上游某某的凭据」凭空加到前面。场合可以套好几层，由外往里一层层剥。
 */
const CONTEXTS: { arg: string; en: string; zh: string }[] = CORE_ZH.contexts;

/** 藏起来的那几类字符为什么值得看一眼。查不到就用 core 的原话 */
export function hiddenWhy(kind: string, text: string): string {
  if (getLang() === "en") return text;
  return CORE_TABLES.hidden_why?.[kind] ?? text;
}

/**
 * 内置扫描规则命中之后那一句「为什么」。
 *
 * **它不是 `Msg`，是一个规则 id 加一句话** —— 工具调用防火墙的事件里带
 * 的就是这两样。内置规则查表说中文；用户自己加的规则查不到，那句话本来
 * 就是他自己写的，原样显示。
 */
export function ruleWhy(rule: string, text: string): string {
  if (getLang() === "en") return text;
  return CORE_TABLES.rule_why?.[rule] ?? text;
}

/**
 * 一句没有码的话，包成 [`Msg`]。
 *
 * **给的是退路，不是常规写法。**界面自己造的失败（invoke 抛了别的东西、
 * 连不上 socket）没有码，但它们要能和 core 发来的那些放在同一个字段里。
 */
export function plain(text: string): Msg {
  return { code: "", text };
}

/**
 * 一条 core 消息在界面上怎么说。
 *
 * 传字符串进来也行：控制面之外的错误（连不上 socket 之类）本来就是
 * 一句现成的话。
 */
export function coreText(m: Msg | string | null | undefined): string {
  if (m == null) return "";
  if (typeof m === "string") return m;
  if (getLang() === "en") return m.text;
  return zhOf(m) ?? m.text;
}

/**
 * 按码说中文，连同外面套的场合。**说不出来是 `undefined`**：码不在表里，或者
 * 缺参数、词表里查不到。少一个参数时不能写出半句中文或一个「undefined」——
 * core 改了参数名而这张表还没跟上时，一句完整的英文比一句缺了主语的中文好。
 */
export function zhOf(m: Msg): string | undefined {
  const say = MESSAGES[m.code];
  if (!say || m.code.startsWith("//")) return undefined;
  const args: Args = m.args ?? {};
  const leads: string[] = [];
  for (let rest = m.text; ; ) {
    let hit: { zh: string; en: string } | undefined;
    for (const c of CONTEXTS) {
      if (args[c.arg] === undefined) continue;
      const en = render(c.en, args, CORE_TABLES);
      if (en === undefined || !rest.startsWith(`${en}: `)) continue;
      const zh = render(c.zh, args, CORE_TABLES);
      if (zh === undefined) return undefined;
      hit = { zh, en };
      break;
    }
    if (!hit) break;
    leads.push(`${hit.zh}：`);
    rest = rest.slice(hit.en.length + 2);
  }
  const zh = render(say, args, CORE_TABLES);
  return zh === undefined ? undefined : leads.join("") + zh;
}

/**
 * invoke 抛出来的东西变成一句话。
 *
 * **命令失败时交出来的是一条 `Msg` 形状的对象**（src-tauri 的 `CmdError`）：
 * 控制面的失败带着 core 的码，按码翻；桌面端自己的失败码是空串，照 `text`
 * 显示。Tauri 自己拒掉的调用（命令不存在、没有权限）仍然是一句字符串。
 */
export function errorText(e: unknown): string {
  if (isMsg(e)) return coreText(e);
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

function isMsg(e: unknown): e is Msg {
  if (typeof e !== "object" || e === null) return false;
  const m = e as Partial<Msg>;
  return typeof m.code === "string" && typeof m.text === "string";
}
