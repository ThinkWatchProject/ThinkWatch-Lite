import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";

/**
 * 启动画面上的「重新启动」。**单独一块，用到时才载入**（见 `LaunchScreen`）：按钮那一套
 * （样式合并、变体、Radix 的 Slot）有四十来 kB，而这个按钮只在出了事的时候出现。
 */
export default function RestartButton({
  busy,
  onClick,
  label,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={onClick}>
      {busy && <Spinner />}
      {label}
    </Button>
  );
}
