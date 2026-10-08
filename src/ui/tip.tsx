import { useState, type ReactNode } from "react";
import { Slot } from "radix-ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/ui/tooltip";

/**
 * 悬浮说明。
 *
 * **这不是自绘,是组合。**长相和行为全是 shadcn 的 `Tooltip`;这里只是
 * 把「触发器 + 内容」两层收成一个属性,因为全 app 有 46 处在用,每处展
 * 开成四行会把它们各自所在的那段 JSX 淹掉。skill 里写的是「组合,不要
 * 重新发明」,这条正是。
 *
 * 替掉的是 22 处原生 `title=`。原生 `title` 在 macOS 上有三个毛病:
 * **要等一秒才出来**(那一秒足够用户放弃)、样式完全不受控(是操作系统
 * 画的,和应用长得不像)、而且不能换行排版 —— 而这个项目里好几处
 * `title` 装的是两句话。
 *
 * `lazy`：鼠标第一次移上来才挂上 Tooltip，之前子元素原样画出来。**给一屏几百个
 * 的地方用**（流量表每一格里的字）：每个 Tooltip 自带一套状态、定位和事件，一行五
 * 六个、几十行一起挂，切页和滚动都要多花一截。挂上的那一下子元素会重新挂一次，
 * 所以只给不能交互的子元素用 —— 按钮在按下的半途被换掉，这一下点击就丢了。
 */
export function Tip({
  text,
  children,
  side = "top",
  lazy = false,
}: {
  text: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  lazy?: boolean;
}) {
  const [armed, setArmed] = useState(!lazy);
  // 挂上之后要再动一下鼠标才开始计时（Tooltip 按 pointermove 起算），移进来时鼠标本来就在动
  if (!armed) return <Slot.Root onPointerEnter={() => setArmed(true)}>{children}</Slot.Root>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} collisionPadding={8}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * 挂在应用根上。
 *
 * **延迟 400ms 是选出来的**,不是默认值:比系统的一秒短,但不至于鼠标
 * 扫过去就弹一片。shadcn 的默认是 0 —— 那会让整个界面在鼠标移动时不停
 * 闪气泡。`skipDelay` 让连着看第二个时不用再等。
 */
export function TooltipRoot({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      {children}
    </TooltipProvider>
  );
}
