import { useEffect, useState } from "react";
import { EMPTY_FILTER, type Filter, type SortDir, type SortKey } from "@/requestTable";

/**
 * 流量页「怎么看」的那部分状态：筛选、排序、归组、展开了哪些组。
 *
 * **放在外壳里，不放在流量页里。**流量页换走就卸掉，而用户回来时应该看到他离开
 * 时的样子；别的页深链过来（「只看这把密钥」「只看无法计价」）也要改它。换了
 * 连接时外壳整个重挂，它跟着清掉 —— 另一个 core 的筛选条件没有意义。
 */
export interface TrafficView {
  filter: Filter;
  setFilter: React.Dispatch<React.SetStateAction<Filter>>;
  sortKey: SortKey;
  sortDir: SortDir;
  /** 点表头排序：同一列翻方向；换一列从降序开始（见 `toggleSort` 的注释） */
  toggleSort: (k: SortKey) => void;
  grouped: boolean;
  setGrouped: (v: boolean) => void;
  openGroups: Set<string>;
  setOpenGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useTrafficView(): TrafficView {
  // 默认按时间倒序 —— 那是「刚才发生了什么」，也是打开这一页最常见的意图
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState(EMPTY_FILTER);
  /*
    **按会话归组。**请求和会话是同一批记录的两个粒度。开关记下来：这是「习惯怎么
    看流量」，不是一次性的动作。
  */
  const [grouped, setGrouped] = useState(() => {
    try {
      return window.localStorage.getItem("tw-grouped") === "on";
    } catch {
      // 隐私模式之类。记不住而已
      return false;
    }
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      window.localStorage.setItem("tw-grouped", grouped ? "on" : "off");
    } catch {
      // 记不住而已，不值得为它中断
    }
  }, [grouped]);

  /**
   * 同一列再点一次翻方向；换一列时**从降序开始** —— 按耗时、费用、token 排序的
   * 人要找的是大的那几条，时间列是新的在前，状态列是失败的在前。
   */
  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return { filter, setFilter, sortKey, sortDir, toggleSort, grouped, setGrouped, openGroups, setOpenGroups };
}
