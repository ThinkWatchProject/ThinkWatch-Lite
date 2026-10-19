/**
 * 导入对话框里逐项的处理（规格 5.4）：新增的缺省导入、可取消勾选；冲突的**没有缺省值**，
 * 必须选覆盖 / 改名导入 / 跳过（全局设置只有覆盖 / 跳过）；相同的不处理；错误的不可导入。
 * 改名导入的名字缺省是 core 给的建议，可改，须唯一。
 *
 * 纯逻辑，不碰界面：对话框按它画、按它判断「导入」按不按得下去。
 */
import type { ImportAction, ImportDecision, ImportRow, ItemKind, ItemRef } from "@/types";
import { refKey } from "./items";

/** 一行此刻选的处理。`action` 为 null：冲突还没选 */
export interface Choice {
  action: ImportAction | null;
  /** 改名导入的新名字（选了改名导入才用） */
  name: string;
}

export type Choices = Record<string, Choice>;

/** 列在表里的行：相同的只计数，不列出 */
export function listed(rows: readonly ImportRow[]): ImportRow[] {
  return rows.filter((r) => r.status !== "same");
}

/** 改名导入的缺省名字：core 的建议，没有就是「原名 (2)」 */
export function suggested(r: ImportRow): string {
  return r.suggested_name ?? `${r.item.name} (2)`;
}

/** 刚预览完：新增的导入，冲突的待选，别的跳过 */
export function initialChoices(rows: readonly ImportRow[]): Choices {
  const out: Choices = {};
  for (const r of rows) {
    out[refKey(r.item)] = {
      action: r.status === "new" ? "import" : r.status === "conflict" ? null : "skip",
      name: suggested(r),
    };
  }
  return out;
}

/**
 * 重新预览之后：还在、状态没变的行留着原来选的（选过的冲突不必再选一遍），别的照刚预览完的
 */
export function carryOver(rows: readonly ImportRow[], fresh: Choices, before: Choices): Choices {
  const out = { ...fresh };
  for (const r of rows) {
    const k = refKey(r.item);
    const old = before[k];
    if (old?.action && actionsFor(r).includes(old.action)) out[k] = old;
  }
  return out;
}

/** 这一行能选哪几种处理。全局设置、路由顺序、通用偏好没有改名导入 */
export function actionsFor(r: ImportRow): ImportAction[] {
  if (r.status === "new") return ["import", "skip"];
  if (r.status !== "conflict") return [];
  return r.global || !renamable(r.item.kind) ? ["overwrite", "skip"] : ["overwrite", "rename", "skip"];
}

function renamable(kind: ItemKind): boolean {
  return !["global", "provider_order", "route_order", "plugin_order", "client_prefs"].includes(kind);
}

/** 「全部覆盖」「全部改名导入」「全部跳过」：只改冲突的行；不能改名的行在「全部改名导入」时不动 */
export function bulk(rows: readonly ImportRow[], choices: Choices, action: "overwrite" | "rename" | "skip"): Choices {
  const out = { ...choices };
  for (const r of rows) {
    if (!actionsFor(r).includes(action) || r.status !== "conflict") continue;
    const k = refKey(r.item);
    out[k] = { action, name: out[k]?.name ?? suggested(r) };
  }
  return out;
}

/**
 * 引用了不导入的项目、因而也导不进来的行（规格 5.4）：配置包里新增的项目跳过了或者本身不可
 * 导入，引用它的路由、别名、策略组随之不可导入 —— 本机没有同名的可以引用。改名导入的不算
 * （引用跟着改名），本机已有同名的（相同、冲突）也不算。一层层传下去。交回：行 → 缺的那一项
 */
export function blocked(rows: readonly ImportRow[], choices: Choices): Record<string, ItemRef> {
  const byKey = new Map(rows.map((r) => [refKey(r.item), r]));
  const out: Record<string, ItemRef> = {};
  const missing = (x: ItemRef) => {
    const k = refKey(x);
    const r = byKey.get(k);
    if (!r) return false;
    if (r.status === "error") return true;
    return r.status === "new" && (choices[k]?.action === "skip" || out[k] !== undefined);
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rows) {
      const k = refKey(r.item);
      if (out[k] || (r.status !== "new" && r.status !== "conflict") || choices[k]?.action === "skip") continue;
      const miss = r.refs.find(missing);
      if (miss) {
        out[k] = miss;
        changed = true;
      }
    }
  }
  return out;
}

/** 还没选处理方式的冲突有几项（因为引用而不可导入的不算：它没得选） */
export function unresolved(rows: readonly ImportRow[], choices: Choices): number {
  const stuck = blocked(rows, choices);
  return rows.filter((r) => {
    const k = refKey(r.item);
    return r.status === "conflict" && choices[k]?.action == null && !stuck[k];
  }).length;
}

/**
 * 改名导入的名字哪些不行：空的，或者和同类里已有的（本机的、配置包里别的、别的行改成的）
 * 重名。`taken`：本机每一类已有的名字
 */
export function nameProblems(
  rows: readonly ImportRow[],
  choices: Choices,
  taken: ReadonlyMap<ItemKind, ReadonlySet<string>>,
): Record<string, "empty" | "taken"> {
  const out: Record<string, "empty" | "taken"> = {};
  const stuck = blocked(rows, choices);
  const renames = rows.filter((r) => choices[refKey(r.item)]?.action === "rename" && !stuck[refKey(r.item)]);
  for (const r of renames) {
    const k = refKey(r.item);
    const name = (choices[k]?.name ?? "").trim();
    if (name === "") {
      out[k] = "empty";
      continue;
    }
    const sameKind = (x: ImportRow) => x.item.kind === r.item.kind && x !== r;
    const clash =
      taken.get(r.item.kind)?.has(name) ||
      rows.some((x) => sameKind(x) && x.item.name === name) ||
      renames.some((x) => sameKind(x) && (choices[refKey(x.item)]?.name ?? "").trim() === name);
    if (clash) out[k] = "taken";
  }
  return out;
}

/**
 * 交给 core 的逐项处理：新增与冲突的行各一条（跳过的也交，core 照它不动）。因为引用而不可
 * 导入的交「跳过」
 */
export function decisions(rows: readonly ImportRow[], choices: Choices): ImportDecision[] {
  const out: ImportDecision[] = [];
  const stuck = blocked(rows, choices);
  for (const r of rows) {
    if (r.status !== "new" && r.status !== "conflict") continue;
    const k = refKey(r.item);
    if (stuck[k]) {
      out.push({ item: r.item, action: "skip" });
      continue;
    }
    const c = choices[k];
    if (!c?.action) continue;
    out.push(
      c.action === "rename"
        ? { item: r.item, action: "rename", new_name: c.name.trim() }
        : { item: r.item, action: c.action },
    );
  }
  return out;
}

/** 真的会写进配置的有几项 */
export function writing(ds: readonly ImportDecision[]): number {
  return ds.filter((d) => d.action !== "skip").length;
}

/** 预览顶上那一行的几个数 */
export function tally(rows: readonly ImportRow[]): Record<ImportRow["status"], number> {
  const out = { new: 0, conflict: 0, same: 0, error: 0 };
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** 冲突行上按所选处理补的一句（`RowNote`） */
export type RowNote = "destination" | "renameKey" | "renamePass" | "renameLogin" | "renamePlugin";

/**
 * 冲突行上 core 的标记之外要说的几句，按所选处理：
 *
 * - 覆盖、core 标了 `missing_key`：这一项的目的地（地址、区域、代理……）和本机的不一样，不沿用
 *   本机的密钥；
 * - 改名导入：是另一个项目，不沿用本机的密钥和登录，带的标记由 core 给（`rename_flags`）。
 */
export function rowNotes(r: ImportRow, c: Choices[string] | undefined): RowNote[] {
  if (r.status !== "conflict") return [];
  if (c?.action === "overwrite") return r.flags.includes("missing_key") ? ["destination"] : [];
  if (c?.action !== "rename") return [];
  return r.rename_flags.map((f) =>
    f === "missing_key"
      ? r.item.kind === "proxy"
        ? "renamePass"
        : "renameKey"
      : f === "needs_login"
        ? "renameLogin"
        : "renamePlugin",
  );
}
