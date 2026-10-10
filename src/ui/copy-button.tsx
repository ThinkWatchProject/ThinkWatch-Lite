import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { Button } from "./button";
import { IconCopied, IconCopy } from "./icons";
import { Tip } from "./tip";

/**
 * 只有图标的复制按钮。复制成功后换成一个勾，一秒半后换回来。**失败由调用方说**
 * （`onCopy` 抛出去就不打勾）。
 */
export function CopyIconButton({
  onCopy,
  label,
  className,
}: {
  onCopy: () => Promise<void>;
  label: string;
  className?: string;
}) {
  const common = useText(commonText);
  const [copied, flash] = useFlash();
  return (
    <Tip text={copied ? common.copied : label}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        className={cn("shrink-0 text-muted-foreground", className)}
        onClick={(e) => {
          e.stopPropagation();
          void onCopy().then(flash, () => {});
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {copied ? <IconCopied /> : <IconCopy />}
      </Button>
    </Tip>
  );
}

/**
 * 带字的复制按钮（对话框里用）。`label` 给了就用它（「创建并复制」），否则是「复制」。
 * 进行中转圈，复制完换成「已复制」一秒半。
 */
export function CopyButton({
  onCopy,
  label,
  disabled,
  flashAtStart = false,
}: {
  onCopy: () => Promise<void>;
  label?: string;
  disabled?: boolean;
  /** 一出现就是「已复制」：内容在它出现之前已经复制过了（「复制登录链接」开始的那次登录） */
  flashAtStart?: boolean;
}) {
  const common = useText(commonText);
  const [copied, flash] = useFlash();
  const [busy, setBusy] = useState(false);
  const firstFlash = useRef(flashAtStart);
  useEffect(() => {
    if (firstFlash.current) flash();
    // 只在出现时亮一下
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={disabled}
      pending={busy}
      onClick={() => {
        setBusy(true);
        onCopy()
          .then(flash, () => {})
          .finally(() => setBusy(false));
      }}
    >
      {!busy && (copied ? <IconCopied /> : <IconCopy />)}
      {copied ? common.copied : (label ?? common.copy)}
    </Button>
  );
}

/** 亮一下再灭：复制之后那个勾 */
function useFlash(ms = 1_500): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    on,
    () => {
      setOn(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), ms);
    },
  ];
}
