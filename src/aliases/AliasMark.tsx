import type { ComponentProps } from "react";
import { useText } from "@/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { aliasesText } from "./aliases.i18n";

/**
 * 「别名」小标记。名称是别名、或者请求经别名发出的地方都用这一个，长得一样：密钥的可见
 * 模型、模型输入框和它的建议、上游模型弹窗、规则条件、流量表上游那一格（同一处的「指定」
 * 也用它，两者说的都是发出的模型名为什么不是客户端写的那个）。
 *
 * 不给 `children` 时写「别名」。`className` 只管位置（间距、收缩、截断），不改长相。其余
 * 属性原样交给 `Badge`：外面包 `Tip` 时，触发器的属性和 ref 要传得进来。
 */
export function AliasMark({ children, className, ...rest }: Omit<ComponentProps<typeof Badge>, "variant" | "asChild">) {
  const t = useText(aliasesText);
  return (
    <Badge
      {...rest}
      variant="secondary"
      // 字号是 Badge 自带的 text-xs（tw-label），和旁边的灰字同一档
      className={cn("h-4 shrink-0 rounded-[4px] px-1 font-sans font-normal", className)}
    >
      {children ?? t.alias}
    </Badge>
  );
}
