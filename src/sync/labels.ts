/**
 * 同步里给人看的几样写法：一个对象叫什么、改了哪几部分、多久之前。
 *
 * 在调用的那一刻按当前语言取（`textOf`），不存成模块级常量。
 */
import { textOf } from "@/i18n";
import { whenMinute } from "@/format";
import type { ItemRef } from "@/types";
import { syncLabelsText } from "./labels.i18n";

/** 「上游「公司中转」」「故障转移」「路由顺序」 */
export function itemLabel(r: ItemRef): string {
  const t = textOf(syncLabelsText);
  switch (r.kind) {
    case "global":
      return t.global[r.name] ?? t.named(t.kind.global, r.name);
    case "provider_order":
    case "route_order":
    case "plugin_order":
    case "client_prefs":
      return t.kind[r.kind];
    case "security_rule": {
      // `<分项>/<规则名>`：分项在安全页上是一个标签，这里只写规则名
      const slash = r.name.indexOf("/");
      return t.named(t.kind.security_rule, slash >= 0 ? r.name.slice(slash + 1) : r.name);
    }
    default:
      return t.named(t.kind[r.kind], r.name);
  }
}

/** 合并单位写成人话。认不得的（全局设置按字段，单位名是字段路径）原样 */
export function unitLabel(unit: string): string {
  return textOf(syncLabelsText).unit[unit] ?? unit;
}

/** 「上游「公司中转」· 连接」。整个对象一个单位（`all`）的不写后半 */
export function itemWithUnits(r: ItemRef, units: readonly string[]): string {
  const t = textOf(syncLabelsText);
  const named = units.filter((u) => u !== "all");
  const what = itemLabel(r);
  return named.length ? t.withUnits(what, named.map(unitLabel).join(t.unitSep)) : what;
}

/**
 * 多久之前：一分钟内「刚刚」，一小时内「N 分钟前」，今天之内（超过一小时）「今天 09:31」，
 * 更早的「10-16 11:02」（和别处写日期的样子一样）
 */
export function ago(atMs: number, now = Date.now()): string {
  const t = textOf(syncLabelsText);
  const d = Math.max(0, now - atMs);
  if (d < 60_000) return t.justNow;
  if (d < 3_600_000) return t.minutesAgo(Math.floor(d / 60_000));
  const at = new Date(atMs);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) return t.today(whenMinute(atMs, now));
  return whenMinute(atMs, now);
}
