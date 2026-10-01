import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "@/control";
import { textOf, useLang } from "@/i18n";
import { codesMatching } from "@/i18n/core.i18n";
import { filterRows, hasAnyFilter, matches, type Filter } from "@/requestTable";
import type { ContentHit, HistoryCursor, HistorySearchQuery, RequestRow, SearchStop } from "@/types";
import { rowFromHistory } from "@/useRequests";
import { requestsText } from "@/useRequests.i18n";

/**
 * 流量页的搜索伸到整份请求记录里（`POST /history/search`）。
 *
 * **读进来的只有最近两千条，记录却留着三个月。**筛选框原来只筛读进来的那些，再往前
 * 的永远看不见；请求和回答的内容不在行上，读进来的那些也搜不到。所以分两步：读进来的
 * 当场筛（照旧），库里的交给 core，找到的并进同一张表。
 *
 * 两种找法（`SearchMode`）：
 *
 * - `older`：只按记录找，**从读进来的最老那一条往前**。比它新的读进来的都已经筛过了，
 *   再问一遍只会拿回一页已经在表里的行，「继续搜索」点几次都不见新东西。列表没装满
 *   时读进来的就是全部，不去问。
 * - `content`：也按内容找，**从最新的往前**：内容只有 core 读得到，读进来的那些也要它
 *   去看。按内容找要读盘，core 每次只读一定的量就交回来（`SearchStop` 的 `budget`），
 *   要再往前就再问一次。
 */
export type SearchMode = "off" | "older" | "content";

/** 一页几条。按记录找是一句走索引的 SQL，一页给多一点，少点几次「继续搜索」 */
const PAGE_RECORDS = 200;
/** 按内容找时一页几条。多半凑够之前，读盘的量（core 的 `Budget`）就先用完了 */
const PAGE_CONTENT = 100;
/** 停手多久之后才去库里找。读进来的那些当场就筛了，这一步不必跟着每个键走 */
export const DEBOUNCE_MS = 300;

/** 这组条件要不要去库里找、怎么找。`capped`：列表装满了，更早的还在库里 */
export function searchMode(f: Filter, capped: boolean): SearchMode {
  if (!hasAnyFilter(f)) return "off";
  if (f.content && f.q.trim() !== "") return "content";
  return capped ? "older" : "off";
}

/** 读进来的行里最老的那一条：`older` 从它往前找。没有行时是 `null` */
export function oldestCursor(rows: readonly RequestRow[]): HistoryCursor | null {
  let at: RequestRow | undefined;
  for (const r of rows) if (!at || r.atMs < at.atMs || (r.atMs === at.atMs && r.id < at.id)) at = r;
  return at ? { at_ms: at.atMs, id: at.id } : null;
}

/**
 * 交给 core 的那一份条件，和界面的筛选一一对应。
 *
 * 失败原因在界面上是按码翻出来的（中文界面），库里只有英文原句：译文里可能含着搜索
 * 词的码一起交过去（`codesMatching`）。本地应答的那几行「上游」一格写的是界面自己的
 * 一句说明，那句话里含着搜索词时交 `local_matches`。
 */
export function searchQuery(f: Filter, mode: "older" | "content", before: HistoryCursor | null): HistorySearchQuery {
  const q = f.q.trim().toLowerCase();
  return {
    q,
    failed: f.failedOnly,
    unpriced: f.unpricedOnly,
    client: f.client || null,
    provider: f.provider || null,
    model: f.model || null,
    error_codes: codesMatching(q),
    local_matches: q !== "" && textOf(requestsText).answeredLocally.toLowerCase().includes(q),
    content: mode === "content",
    before,
    limit: mode === "content" ? PAGE_CONTENT : PAGE_RECORDS,
  };
}

/** 一次搜索（一组条件）到目前为止的结果 */
export interface Found {
  /** 哪一组条件的结果。和此刻的条件对不上就是作废了的，不画（见 `useHistorySearch`） */
  key: string;
  mode: "older" | "content";
  /**
   * 搜索开始那一刻，读进来的行里对上的那些。**之后被挤出列表的靠它留在表里**：
   * 列表只装两千条，新请求一来，最老的就被挤掉 —— 而 `older` 是从当时最老的那一条
   * 往前找的，挤掉的那几条两边都不再有。
   */
  kept: RequestRow[];
  /** 库里找到的，按 core 给的顺序（新的在前） */
  rows: RequestRow[];
  /** 按内容对上的那些各自对上了哪一段 */
  hits: ReadonlyMap<number, ContentHit>;
  /** 正在要、或者最后一次要的那一页从哪儿找起。失败了「重试」从这里再要一次 */
  at: HistoryCursor | null;
  /** 下一页从哪儿接着找。`null`：找完了，或者第一页还没回来（看 `stopped`） */
  next: HistoryCursor | null;
  /** 最后一页为什么停在那儿。第一页还没回来时是 `null` */
  stopped: SearchStop | null;
  /** 按内容找时：报文最早留到哪一刻。盘上一份都没有时是 `null` */
  bodiesSinceMs: number | null;
  /** 正在要一页 */
  busy: boolean;
  /** 最后一次要页失败的原因。成了就清掉 */
  error: unknown;
}

/**
 * 表里该有的行：读进来的行里对上的，加上库里找到的。
 *
 * **同一条请求两边都有时用读进来的那个**：实时的那一行更全（脱敏、可疑的工具调用只在
 * 事件里有），而且它还在变。读进来的那一行按记录对不上、库里却交回来了的，只有按内容
 * 对上的才要 —— 别的是那边宽、这边严（失败原因的码是宽着给的，见 `searchQuery`），
 * 以屏幕上看得见的为准。
 */
export function mergeFound(loaded: readonly RequestRow[], f: Filter, found: Found | null): RequestRow[] {
  const matched = filterRows(loaded as RequestRow[], f);
  if (!found) return matched;
  const live = new Map(loaded.map((r) => [r.id, r]));
  const out = new Map(matched.map((r) => [r.id, r]));
  for (const r of found.kept) if (!live.has(r.id) && !out.has(r.id)) out.set(r.id, r);
  for (const r of found.rows) {
    if (out.has(r.id)) continue;
    const l = live.get(r.id);
    if (!l) out.set(r.id, r);
    else if (found.hits.has(r.id)) out.set(r.id, l);
  }
  return [...out.values()];
}

/** 要一页，换成表格的行。按记录交回来的照屏幕上的说法再筛一遍（见 `mergeFound`） */
async function fetchPage(f: Filter, mode: "older" | "content", before: HistoryCursor | null) {
  const page = await call("HistorySearch", searchQuery(f, mode, before));
  const hits = new Map(page.hits.map((h) => [h.id, h]));
  const q = f.q.trim().toLowerCase();
  return {
    rows: page.rows.map(rowFromHistory).filter((r) => hits.has(r.id) || matches(r, f, q)),
    hits,
    next: page.next,
    stopped: page.stopped,
    bodiesSinceMs: page.bodies_since_ms,
  };
}

export interface HistorySearch {
  mode: SearchMode;
  /** 这组条件的结果。`mode` 是 `off` 时是 `null` */
  found: Found | null;
  /** 往前接着找一页；上一次失败了就是重试那一页 */
  more: () => void;
}

/**
 * 跟着筛选条件在库里找。条件一变就是一次新的搜索（停手 `DEBOUNCE_MS` 之后才问），
 * 之前那次还没回来的结果作废。
 *
 * `ready`：历史读成了。之前「列表装没装满」「最老的是哪一条」都还不知道；读失败时
 * 读进来的只是之后的事件流，那两样也不成立。
 */
export function useHistorySearch(
  filter: Filter,
  loaded: readonly RequestRow[],
  capped: boolean,
  ready: boolean,
): HistorySearch {
  // 换了语言要重找：失败原因按哪种语言对、本地应答那句话怎么写，都跟着语言
  const lang = useLang();
  const mode = ready ? searchMode(filter, capped) : "off";
  const key =
    mode === "off"
      ? ""
      : JSON.stringify([
          mode,
          lang,
          filter.q.trim().toLowerCase(),
          filter.failedOnly,
          filter.unpricedOnly,
          filter.client,
          filter.provider,
          filter.model,
        ]);
  const [found, setFound] = useState<Found | null>(null);
  /*
    **读进来的行和条件放在 ref 里。**开始一次搜索时要用它们（从哪一条往前、当时对上了
    哪些），但新请求一到就重找是不对的：读进来的那些在页面上当场就筛了。
  */
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const foundRef = useRef(found);
  foundRef.current = found;
  /** 第几次搜索。回来的一页对不上这个数就是作废了的那次 */
  const seq = useRef(0);

  const load = useCallback((my: number, m: "older" | "content", before: HistoryCursor | null) => {
    setFound((prev) => prev && { ...prev, at: before, busy: true, error: undefined });
    fetchPage(filterRef.current, m, before).then(
      (p) => {
        if (seq.current !== my) return;
        setFound(
          (prev) =>
            prev && {
              ...prev,
              rows: [...prev.rows, ...p.rows],
              hits: p.hits.size === 0 ? prev.hits : new Map([...prev.hits, ...p.hits]),
              next: p.next,
              stopped: p.stopped,
              bodiesSinceMs: p.bodiesSinceMs,
              busy: false,
            },
        );
      },
      (e: unknown) => {
        if (seq.current !== my) return;
        setFound((prev) => prev && { ...prev, busy: false, error: e });
      },
    );
  }, []);

  useEffect(() => {
    const my = ++seq.current;
    if (mode === "off") {
      setFound(null);
      return;
    }
    const rows = loadedRef.current;
    const from = mode === "older" ? oldestCursor(rows) : null;
    setFound({
      key,
      mode,
      kept: filterRows(rows as RequestRow[], filterRef.current),
      rows: [],
      hits: new Map(),
      at: from,
      next: null,
      stopped: null,
      bodiesSinceMs: null,
      busy: true,
      error: undefined,
    });
    const timer = setTimeout(() => load(my, mode, from), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `key` 已经包含了 `mode` 和条件里要紧的每一样
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);

  const more = useCallback(() => {
    const f = foundRef.current;
    if (!f || f.busy) return;
    if (f.error !== undefined) load(seq.current, f.mode, f.at);
    else if (f.next) load(seq.current, f.mode, f.next);
  }, [load]);

  /*
    条件变了的那一帧，新的一次搜索还没开始（effect 在画完之后才跑），手上的还是上一组
    条件的结果 —— 它们不一定对得上新的条件，不画
  */
  return { mode, found: found?.key === key ? found : null, more };
}
