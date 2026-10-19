/**
 * 配置里的「项目」：导出时选的、导入预览逐项列的、恢复预览逐项勾的，都是它（core 的
 * `ItemRef`：类别 + 名字）。这里是它们在界面上的叫法、排法，和导出时「随附」的算法。
 */
import { textOf } from "@/i18n";
import type { ConfigOrigin, Guard, ItemKind, ItemNode, ItemRef, PackOrigin } from "@/types";
import { backupText } from "./backup.i18n";

/** 列表里各类的先后：和导出对话框里的分组一样 */
export const KIND_ORDER: readonly ItemKind[] = [
  "provider",
  "proxy",
  "key",
  "alias",
  "group",
  "route",
  "price_sheet",
  "security_rule",
  "plugin",
  "global",
  "provider_order",
  "route_order",
  "plugin_order",
  "client_prefs",
];

/** 不按名字、整份一项的几类：几样东西的先后、Lite 的通用偏好 */
const WHOLE: readonly ItemKind[] = ["provider_order", "route_order", "plugin_order", "client_prefs"];

/** 列表里当一类显示的：几样东西的先后、Lite 通用偏好并进「全局设置」那一组 */
export function groupOf(kind: ItemKind): ItemKind {
  return WHOLE.includes(kind) ? "global" : kind;
}

/** 一个项目的键：类别里没有 `:`，所以第一个 `:` 之后都是名字 */
export function refKey(r: ItemRef): string {
  return `${r.kind}:${r.name}`;
}

export function refOf(key: string): ItemRef {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as ItemKind, name: key.slice(i + 1) };
}

export function kindLabel(kind: ItemKind): string {
  return textOf(backupText).kinds[kind];
}

const GUARDS: readonly Guard[] = ["redact", "inspect_tools", "content"];

/**
 * 一个项目在列表里写成什么。全局设置写节的名字，安全规则写「分项 · 规则名」，路由顺序、
 * Lite 通用偏好写类别。**认不出的节名、分项照原样写**：core 以后多一节，界面照样列得出来
 */
export function itemLabel(r: ItemRef): string {
  const t = textOf(backupText);
  switch (r.kind) {
    case "global":
      return (t.globals as Record<string, string | undefined>)[r.name] ?? r.name;
    case "provider_order":
    case "route_order":
    case "plugin_order":
    case "client_prefs":
      return t.kinds[r.kind];
    case "security_rule": {
      const i = r.name.indexOf("/");
      if (i < 0) return r.name;
      const guard = r.name.slice(0, i);
      const rule = r.name.slice(i + 1);
      const g = GUARDS.includes(guard as Guard) ? t.guards[guard as Guard] : guard;
      return `${g} · ${rule}`;
    }
    default:
      return r.name;
  }
}

/** 名字是配置里的标识（上游名、路由名……）：等宽字体写。全局设置、安全规则写的是界面上的叫法 */
export function namedById(r: ItemRef): boolean {
  return r.kind !== "global" && r.kind !== "security_rule" && !WHOLE.includes(r.kind);
}

/** 一版备份是谁写的：同步来的写上是哪台设备 */
export function originLabel(origin: PackOrigin | ConfigOrigin, device: string | null): string {
  const t = textOf(backupText).origins;
  if (origin === "sync") return device ? t.syncFrom(device) : t.sync;
  return t[origin];
}

/** 冲突时哪几处不同：「连接、模型不同」。认不出的单位（全局设置的字段路径）照原样写 */
export function differsLabel(units: readonly string[]): string | null {
  if (units.length === 0) return null;
  const t = textOf(backupText);
  const names = units.map((u) => (t.units as Record<string, string | undefined>)[u] ?? u);
  return t.differ(names.join(t.sep), names.length);
}

/** 按类分组，组内保持原来的先后。只给有东西的组 */
export function groupBy<T>(items: readonly T[], ref: (t: T) => ItemRef): { kind: ItemKind; items: T[] }[] {
  const by = new Map<ItemKind, T[]>();
  for (const it of items) {
    const k = groupOf(ref(it).kind);
    const list = by.get(k);
    if (list) list.push(it);
    else by.set(k, [it]);
  }
  return KIND_ORDER.filter((k) => by.has(k)).map((kind) => ({ kind, items: by.get(kind)! }));
}

/**
 * 选了这几项，实际导出的是哪些：所选的，加上它们（一层层）引用到的 —— 路由引用的上游、
 * 上游引用的出站代理。`along` 是因为被引用才进来的那几项（列表上标「随附」、勾着不能取消）。
 * core 导出时同样会补齐，这里算出来是为了让人在导出之前看见
 */
export function closure(
  picked: ReadonlySet<string>,
  nodes: readonly ItemNode[],
): { included: Set<string>; along: Set<string> } {
  const refs = new Map(nodes.map((n) => [refKey(n.item), n.refs.map(refKey)]));
  const included = new Set<string>();
  const queue = [...picked];
  while (queue.length > 0) {
    const k = queue.pop()!;
    if (included.has(k)) continue;
    included.add(k);
    for (const r of refs.get(k) ?? []) if (!included.has(r)) queue.push(r);
  }
  const along = new Set([...included].filter((k) => !picked.has(k)));
  return { included, along };
}

/** 有几项是这一类的 */
export function countOf(nodes: readonly ItemNode[], kind: ItemKind): number {
  return nodes.filter((n) => n.item.kind === kind).length;
}
