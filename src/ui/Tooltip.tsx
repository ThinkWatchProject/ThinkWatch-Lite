import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";

/**
 * 悬浮说明。
 *
 * 替掉 22 处 `title=`。原生 `title` 在 macOS 上有三个毛病：**要等一秒
 * 才出来**（那一秒足够用户放弃)、样式完全不受控(是操作系统画的,和
 * 应用长得不像)、而且**触发之后不能换行排版** —— 而这个项目里好几处
 * `title` 装的是两句话。
 *
 * 一眼就能看出是网页的地方，这是其中之一。
 *
 * 延迟 400ms：比系统的一秒短，但不至于扫过去就弹一片。
 */
export function TooltipRoot({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </T.Provider>
  );
}

export function Tip({
  text,
  children,
  side = "top",
}: {
  text: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={5}
          collisionPadding={8}
          className="z-50 max-w-[260px] rounded-md border border-neutral-300 bg-neutral-50 px-2 py-1.5 tw-label leading-relaxed text-neutral-700 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
        >
          {text}
          <T.Arrow className="fill-neutral-50 dark:fill-neutral-800" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
