import { useEffect, useMemo, useState } from "react";
import type { Col } from "./virtual";

export const ALL_COLUMNS: Col[] = ["status", "time", "client", "model", "upstream", "latency", "tokens", "cost"];
export interface Columns {
  order: Col[];
  hidden: Col[];
  /** 默认只有多把密钥时显示；手动选过之后遵从选择。 */
  autoClient: boolean;
  pinned: Partial<Record<Col, Pin>>;
}
export type Pin = "left" | "right";
export const DEFAULT_COLUMNS: Columns = {
  order: ALL_COLUMNS, hidden: [], autoClient: true, pinned: { tokens: "right", cost: "right" },
};
export const COMPACT_COLUMNS: Columns = {
  order: ["status", "time", "model", "tokens", "cost", "client", "upstream", "latency"],
  hidden: ["client", "upstream", "latency"],
  autoClient: false,
  pinned: { tokens: "right", cost: "right" },
};
const STORAGE_KEY = "tw-traffic-columns";
const isCol = (v: unknown): v is Col => ALL_COLUMNS.includes(v as Col);

/** 旧偏好或损坏的数据不能让表头与行丢列。状态固定在首列，保留会话展开入口。 */
export function normalizeColumns(value: unknown): Columns {
  if (!value || typeof value !== "object") return DEFAULT_COLUMNS;
  const v = value as Partial<Columns>;
  const order = [...new Set<Col>([
    "status", ...(Array.isArray(v.order) ? v.order.filter(isCol) : []), ...ALL_COLUMNS,
  ])];
  const hidden: Col[] = Array.isArray(v.hidden) ? [...new Set(v.hidden.filter((c) => isCol(c) && c !== "status"))] : [];
  const pinned: Columns["pinned"] = {};
  // 旧版本自动保存过默认布局：指标原本就在可见末尾时，可直接固定而不改顺序。
  const end = order.filter((col) => !hidden.includes(col)).slice(-2);
  if (!("pinned" in v) && end.includes("tokens") && end.includes("cost")) {
    pinned.tokens = "right";
    pinned.cost = "right";
  }
  if (v.pinned && typeof v.pinned === "object") {
    for (const col of ALL_COLUMNS) {
      const side = v.pinned[col];
      if ((side === "left" || side === "right") && (col !== "status" || side === "left")) pinned[col] = side;
    }
  }
  if (Object.values(pinned).includes("left")) pinned.status = "left";
  // 自定义布局中位于中间的指标不自动移动；显式取消过固定也不会被重新启用。
  return { order, hidden, autoClient: v.autoClient !== false, pinned };
}

/** 固定列分居两侧，每组内部遵循用户顺序。状态始终在第一列，保留会话的入口。 */
export function orderedColumns(settings: Columns): Col[] {
  const rest = settings.order.filter((col) => col !== "status");
  return ["status", ...rest.filter((c) => settings.pinned[c] === "left"),
    ...rest.filter((c) => !settings.pinned[c]), ...rest.filter((c) => settings.pinned[c] === "right")];
}

export function visibleColumns(settings: Columns, multipleClients: boolean): Col[] {
  return orderedColumns(settings).filter((col) =>
    !settings.hidden.includes(col) && (col !== "client" || !settings.autoClient || multipleClients),
  );
}

export function toggleColumn(settings: Columns, col: Col, shown: boolean): Columns {
  if (col === "status") return settings;
  return {
    ...settings,
    hidden: shown ? settings.hidden.filter((c) => c !== col) : [...new Set([...settings.hidden, col])],
    autoClient: col === "client" ? false : settings.autoClient,
  };
}

export function moveColumn(settings: Columns, col: Col, by: -1 | 1): Columns {
  const shown = orderedColumns(settings);
  const at = shown.indexOf(col);
  const neighbor = shown[at + by];
  if (col === "status" || !neighbor || neighbor === "status" || settings.pinned[col] !== settings.pinned[neighbor]) return settings;
  const order = [...settings.order];
  const a = order.indexOf(col), b = order.indexOf(neighbor);
  [order[a], order[b]] = [order[b]!, order[a]!];
  return { ...settings, order };
}

export function pinColumn(settings: Columns, col: Col, side: Pin | null): Columns {
  if (col === "status" && side === "right") return settings;
  if (col === "status" && !side && Object.entries(settings.pinned).some(([c, p]) => c !== "status" && p === "left")) return settings;
  const pinned = { ...settings.pinned };
  if (side) pinned[col] = side;
  else delete pinned[col];
  if (side === "left") pinned.status = "left";
  return { ...settings, pinned };
}

export const numericColumn = (col: Col) => col === "latency" || col === "tokens" || col === "cost";

export function useTrafficColumns(multipleClients: boolean) {
  const [settings, setSettings] = useState<Columns>(() => {
    try {
      return normalizeColumns(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
    } catch {
      return DEFAULT_COLUMNS;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 无法存储时，本次窗口仍可调整。
    }
  }, [settings]);
  const columns = useMemo(() => visibleColumns(settings, multipleClients), [settings, multipleClients]);
  return { settings, setSettings, columns };
}
