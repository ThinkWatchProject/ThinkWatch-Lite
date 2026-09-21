/** 标签上那个数。**灰的、等宽的** —— 它是标签的注脚，不是第二个标题 */
export function Count({ n }: { n: number }) {
  return (
    <span className="tw-label tabular-nums text-muted-foreground">{n}</span>
  );
}
