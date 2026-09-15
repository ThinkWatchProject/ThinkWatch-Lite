import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/ui/resizable";

/**
 * 主从分栏,**只在真的要分栏时才存在**。
 *
 * 排查要来回对照:看详情的时候列表得还在,「这一条和上一条比慢在哪」
 * 恰恰要同时看见两边。所以详情不是盖在列表上,是占右边一栏。
 *
 * 而只有一栏的时候,这里返回的是一个普通的滚动容器 —— 不是「把分栏
 * 组件关掉」。上一版是套着它、用 `!block` 和 `!flex-none` 去抵消:
 * `Panel` 会给自己写内联的 `flexBasis`,`flex-none` 的 `flex-basis:auto`
 * 压过它,面板于是按内容宽收缩,表格右边空掉一大片。
 * **要用两个 important 去抵消一个组件的正常行为,那就是不该用它。**
 */
export function Split({
  split,
  layout,
  onLayout,
  detail,
  children,
}: {
  split: boolean;
  /** 上次拖到哪儿。panel id -> 占比 */
  layout?: Record<string, number>;
  onLayout: (l: Record<string, number>) => void;
  detail: ReactNode;
  children: ReactNode;
}) {
  if (!split) {
    return <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>;
  }
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      defaultLayout={layout}
      onLayoutChanged={onLayout}
      className="flex min-h-0 flex-1 overflow-hidden"
    >
      <ResizablePanel
        id="list"
        defaultSize={62}
        minSize={35}
        className="min-w-0 overflow-y-auto p-5"
      >
        {children}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel id="detail" defaultSize={38} minSize={25} className="min-w-0">
        {detail}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
