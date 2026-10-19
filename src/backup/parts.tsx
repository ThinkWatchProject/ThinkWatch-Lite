import type { ReactNode } from "react";

/**
 * 设置「同步与备份」一节里的一部分（同步、备份）的小标题：左边名字，右边这一部分的操作。
 * 和一节的标题（`SettingsGroup`）差一级
 */
export function PartHeading({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-3">
      <h3 className="min-w-0 flex-1 truncate tw-body font-medium text-foreground">{title}</h3>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
