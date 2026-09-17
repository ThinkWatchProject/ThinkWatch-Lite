/**
 * 模型名的通配匹配，和 core 的 `tw_engine::rule::glob_match` 是同一套规则：
 * 只认 `*`，不区分大小写。
 *
 * 界面要在用户勾选、编辑启用范围的时候实时说出哪些模型在范围里，保存之前
 * 没有机会去问 core。规则只有这一条，两边照着同一份写。
 */
export function globMatch(pattern: string, s: string): boolean {
  const p = pattern.toLowerCase();
  const t = s.toLowerCase();
  const parts = p.split("*");
  if (parts.length === 1) return p === t;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  // **头尾各自锚定，再在中间找其余几段。**只从左往右找的话，最后一段会停在
  // 它第一次出现的地方：`*-mini` 对 `gpt-4o-mini-2024-mini` 就判成不匹配。
  // 头尾不能重叠：`ab*ba` 不匹配 `aba`
  if (t.length < first.length + last.length || !t.startsWith(first) || !t.endsWith(last)) {
    return false;
  }
  let rest = t.slice(first.length, t.length - last.length);
  for (const part of parts.slice(1, -1)) {
    const i = rest.indexOf(part);
    if (i < 0) return false;
    rest = rest.slice(i + part.length);
  }
  return true;
}
