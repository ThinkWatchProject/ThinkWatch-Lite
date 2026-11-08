import { useEffect, useMemo, useState } from "react";
import type { Col } from "./virtual";

export const ALL_COLUMNS: Col[] = ["status", "time", "client", "model", "upstream", "latency", "tokens", "cost"];
export interface Columns {
  order: Col[];
  hidden: Col[];
  /** 默认只有多把密钥时显示；手动选过之后遵从选择。 */
  autoClient: boolean;
}
export const DEFAULT_COLUMNS: Columns = { order: ALL_COLUMNS, hidden: [], autoClient: true };
export const COMPACT_COLUMNS: Columns = {
  order: ["status", "time", "model", "tokens", "cost", "client", "upstream", "latency"],
  hidden: ["client", "upstream", "latency"],
  autoClient: false,
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
  const hidden = Array.isArray(v.hidden) ? [...new Set(v.hidden.filter((c) => isCol(c) && c !== "status"))] : [];
  return { order, hidden, autoClient: v.autoClient !== false };
}

export function visibleColumns(settings: Columns, multipleClients: boolean): Col[] {
  return settings.order.filter((col) =>
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
  const at = settings.order.indexOf(col);
  const next = at + by;
  if (at <= 0 || next <= 0 || next >= settings.order.length) return settings;
  const order = [...settings.order];
  [order[at], order[next]] = [order[next]!, order[at]!];
  return { ...settings, order };
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
