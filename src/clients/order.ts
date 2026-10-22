/**
 * 客户端页上客户端的顺序（`ClientsResponse.order`，存在 `app.json` 里）。
 *
 * 存的是用户排过的客户端 id。**在里面的按它排在前，没在里面的（新装的、从未排过的）按
 * 注册表顺序跟在后面**，不认识的 id 不管。这台电脑上和各个 WSL 发行版里共用这一份：在
 * 一处把 Codex 挪到 Claude Code 前面，另一处也跟着变。
 */

/** 按存下的顺序排 `items`。没在 `order` 里的保持原来的先后，跟在后面 */
export function sortByOrder<T>(items: readonly T[], order: readonly string[], idOf: (item: T) => string): T[] {
  const rank = new Map<string, number>();
  for (const [i, id] of order.entries()) if (!rank.has(id)) rank.set(id, i);
  return items
    .map((item, i) => ({ item, i, r: rank.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
      if (a.r !== undefined) return -1;
      if (b.r !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * 一张表排过之后，要存下的那一份顺序。
 *
 * `order`：存着的；`known`：页上所有的客户端 id，按注册表顺序；`table`：这张表里的客户端
 * 排过之后的顺序。这张表里的那几个**占着它们原来在整份顺序里的位置**，换成新的先后；
 * 别的客户端的相对顺序不动。存下的是原来排过的加上这张表里的，其余照旧按注册表跟在后面。
 * 不认识的 id 丢掉。
 */
export function mergeOrder(order: readonly string[], known: readonly string[], table: readonly string[]): string[] {
  const all = new Set([...known, ...table]);
  const listed = [...new Set(order)].filter((id) => all.has(id));
  const listedSet = new Set(listed);
  const full = [...listed, ...[...all].filter((id) => !listedSet.has(id))];
  const inTable = new Set(table);
  let next = 0;
  const merged = full.map((id) => (inTable.has(id) ? table[next++]! : id));
  const keep = new Set([...listed, ...table]);
  return merged.filter((id) => keep.has(id));
}

/** 把第 `from` 个挪到第 `to` 个的位置（拿走之后的下标），别的顺次让开 */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

/** 两份顺序一样 */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
