/**
 * 恢复预览里勾选与 core 的计划（规格 7.2）。
 *
 * **勾选的是人选的，会动什么由 core 说**：只恢复几项时，core 会把它们引用的、本机已经没有的
 * 一起恢复，把留下的项目还引用着的保留（`kept: referenced`）。所以每改一次勾选，就用所选的
 * 几项重新要一次预览（`RestorePreviewRequest.items`），表上的变化以它交回的为准。
 *
 * 纯逻辑，导出给测试。
 */
import type { ItemRef, RestoreRow } from "@/types";
import { refKey } from "./items";

/** 能勾的：core 说要保留的（客户端在用的密钥、还被引用着的）不给勾 */
export const selectable = (r: RestoreRow) => r.kept === null;

/** 交给 core 的项目：全勾着是 null（整个版本），否则是勾着的那几项 */
export function selection(base: readonly RestoreRow[], unchecked: ReadonlySet<string>): ItemRef[] | null {
  const rows = base.filter(selectable);
  if (rows.every((r) => !unchecked.has(refKey(r.item)))) return null;
  return rows.filter((r) => !unchecked.has(refKey(r.item))).map((r) => r.item);
}

/** 表上的一行怎么写 */
export type RowNote =
  /** 勾着、照所选恢复 */
  | "chosen"
  /** 没勾，但所选的项目引用它、本机又没有：一并恢复 */
  | "along"
  /** 没勾：保持当前内容 */
  | "untouched"
  /** core 保留（`kept` 写明原因） */
  | "kept";

export interface PlanRow {
  row: RestoreRow;
  /** 有勾选框吗 */
  box: boolean;
  checked: boolean;
  note: RowNote;
}

/**
 * 整个版本的差异（`base`，第一次预览）为表的骨架，叠上此刻所选的计划（`plan`）：勾选框跟着人，
 * 变化、保留跟着 core。计划里有、骨架里没有的行（一并恢复的）接在后面
 */
export function planRows(
  base: readonly RestoreRow[],
  plan: readonly RestoreRow[],
  unchecked: ReadonlySet<string>,
): PlanRow[] {
  const inPlan = new Map(plan.map((r) => [refKey(r.item), r]));
  const out: PlanRow[] = base.map((b) => {
    const k = refKey(b.item);
    const p = inPlan.get(k);
    if (!selectable(b)) return { row: p ?? b, box: false, checked: false, note: "kept" };
    const checked = !unchecked.has(k);
    if (p?.kept) return { row: p, box: true, checked, note: "kept" };
    if (checked) return { row: p ?? b, box: true, checked, note: "chosen" };
    return p ? { row: p, box: true, checked, note: "along" } : { row: b, box: true, checked, note: "untouched" };
  });
  const known = new Set(base.map((r) => refKey(r.item)));
  for (const p of plan) {
    if (known.has(refKey(p.item))) continue;
    out.push({ row: p, box: false, checked: false, note: p.kept ? "kept" : "along" });
  }
  return out;
}

/** 恢复之后实际动了几项、保留了几项（`RestoreWritten.rows`） */
export function tallyWritten(rows: readonly RestoreRow[]): { restored: number; kept: number } {
  const kept = rows.filter((r) => r.kept !== null).length;
  return { restored: rows.length - kept, kept };
}
