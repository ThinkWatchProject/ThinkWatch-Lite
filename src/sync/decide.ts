/**
 * 两处要逐项选的：加入同步时的合并（和导入同一套规则，方案 5.3、5.4），和同步冲突
 * （6.7）。只是记哪一项选了什么、写成交给 core 的样子、还差几项没选。纯函数，导出给测试。
 */
import type {
  ImportDecision,
  ImportRow,
  ItemRef,
  SyncConflict,
  SyncConflictDecision,
  SyncJoinAuto,
  SyncTake,
} from "@/types";

export const refKey = (r: ItemRef) => `${r.kind}\u0000${r.name}`;

/**
 * core 替人定了、不用选的那一项（`SyncJoinPreview.auto`：两边的默认网关密钥同名、值不同时
 * 采用同步数据的值）。照常列出，但不给选择、不算没选的冲突、不交处理
 */
export function autoOf(auto: readonly SyncJoinAuto[], row: ImportRow): SyncJoinAuto | undefined {
  const k = refKey(row.item);
  return auto.find((a) => refKey(a.item) === k);
}

// ───────────────────────────────────────────── 合并（加入同步的第 3 步）

/** 冲突的一项怎么处理。**没有缺省值**：没选就是 null */
export type MergeChoice = "overwrite" | "rename" | "skip";

export interface MergePick {
  choice: MergeChoice | null;
  /** 改名导入时的新名字。缺省是 core 给的建议（「公司中转 (2)」） */
  name: string;
}

export type MergePicks = Record<string, MergePick>;

/** 全局设置的一节只能覆盖或跳过 */
export function choicesOf(row: ImportRow): MergeChoice[] {
  return row.global ? ["overwrite", "skip"] : ["overwrite", "rename", "skip"];
}

export function initialPicks(rows: readonly ImportRow[], auto: readonly SyncJoinAuto[] = []): MergePicks {
  const out: MergePicks = {};
  for (const r of rows)
    if (r.status === "conflict" && !autoOf(auto, r)) out[refKey(r.item)] = { choice: null, name: r.suggested_name ?? `${r.item.name} (2)` };
  return out;
}

/** 列表上方的「全部覆盖 / 全部改名导入 / 全部跳过」：全局设置那几节不能改名，跳过它们 */
export function pickAll(
  rows: readonly ImportRow[],
  picks: MergePicks,
  choice: MergeChoice,
  auto: readonly SyncJoinAuto[] = [],
): MergePicks {
  const out = { ...picks };
  for (const r of rows) {
    if (r.status !== "conflict" || autoOf(auto, r) || !choicesOf(r).includes(choice)) continue;
    const k = refKey(r.item);
    out[k] = { ...(out[k] ?? { name: r.suggested_name ?? r.item.name }), choice };
  }
  return out;
}

/** 改名导入的名字哪儿不对：空的、和原名一样、和另一项改成的名字撞了 */
export function renameProblem(
  rows: readonly ImportRow[],
  picks: MergePicks,
  row: ImportRow,
): "empty" | "same" | "taken" | null {
  const p = picks[refKey(row.item)];
  if (!p || p.choice !== "rename") return null;
  const name = p.name.trim();
  if (!name) return "empty";
  if (name === row.item.name) return "same";
  const clash = rows.some((r) => {
    if (r === row || r.item.kind !== row.item.kind) return false;
    // 同类里已经有这个名字（配置包里另一项，或者另一项改成了它）
    if (r.item.name === name) return true;
    const q = picks[refKey(r.item)];
    return q?.choice === "rename" && q.name.trim() === name;
  });
  return clash ? "taken" : null;
}

/** 还没选的冲突有几项；改名改得不对的也算没选好 */
export function unresolved(rows: readonly ImportRow[], picks: MergePicks, auto: readonly SyncJoinAuto[] = []): number {
  return rows.filter((r) => {
    if (r.status !== "conflict" || autoOf(auto, r)) return false;
    const p = picks[refKey(r.item)];
    return !p?.choice || renameProblem(rows, picks, r) !== null;
  }).length;
}

/**
 * 交给 core 的逐项处理：新增的导入，冲突的照选的，相同的和错误的不交（core 不处理它们）
 */
export function mergeDecisions(
  rows: readonly ImportRow[],
  picks: MergePicks,
  auto: readonly SyncJoinAuto[] = [],
): ImportDecision[] {
  const out: ImportDecision[] = [];
  for (const r of rows) {
    // core 定了的不交（交了它也不看）
    if (autoOf(auto, r)) continue;
    if (r.status === "new") out.push({ item: r.item, action: "import" });
    else if (r.status === "conflict") {
      const p = picks[refKey(r.item)];
      if (!p?.choice) continue;
      out.push(
        p.choice === "rename"
          ? { item: r.item, action: "rename", new_name: p.name.trim() }
          : { item: r.item, action: p.choice },
      );
    }
  }
  return out;
}

export interface MergeCounts {
  new: number;
  conflict: number;
  same: number;
  error: number;
}

/** 统计。core 定了的那几项不算冲突（不用选），也不另计 */
export function countRows(rows: readonly ImportRow[], auto: readonly SyncJoinAuto[] = []): MergeCounts {
  const c: MergeCounts = { new: 0, conflict: 0, same: 0, error: 0 };
  for (const r of rows) if (!(r.status === "conflict" && autoOf(auto, r))) c[r.status] += 1;
  return c;
}

// ───────────────────────────────────────────── 同步冲突

export interface ConflictPick {
  take: SyncTake | null;
  /** 两者都保留时另一方用的名字。缺省「名称 (MacBook Air)」 */
  name: string;
}

export type ConflictPicks = Record<string, ConflictPick>;

export function initialConflictPicks(list: readonly SyncConflict[]): ConflictPicks {
  const out: ConflictPicks = {};
  for (const c of list) out[c.id] = { take: null, name: `${c.item.name} (${c.remote.device})` };
  return out;
}

/** 两者都保留的名字哪儿不对：空的、和原名一样 */
export function keepBothProblem(c: SyncConflict, p: ConflictPick | undefined): "empty" | "same" | null {
  if (p?.take !== "both") return null;
  const name = p.name.trim();
  if (!name) return "empty";
  return name === c.item.name ? "same" : null;
}

/** 交给 core 的：**只交选了的**，没选的留到下次（「稍后处理」） */
export function resolveDecisions(list: readonly SyncConflict[], picks: ConflictPicks): SyncConflictDecision[] {
  const out: SyncConflictDecision[] = [];
  for (const c of list) {
    const p = picks[c.id];
    // core 给的选项里没有的不交（冲突刷新之后能选的变了）
    if (!p?.take || !c.options.includes(p.take) || keepBothProblem(c, p)) continue;
    out.push(p.take === "both" ? { id: c.id, take: "both", new_name: p.name.trim() } : { id: c.id, take: p.take });
  }
  return out;
}

/** 冲突那一方的设备：都是同一台时表头写它的名字，否则写「其他设备」 */
export function remoteDevice(list: readonly SyncConflict[]): string | null {
  const names = new Set(list.map((c) => c.remote.device));
  return names.size === 1 ? [...names][0]! : null;
}
