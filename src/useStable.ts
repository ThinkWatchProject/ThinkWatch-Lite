import { useCallback, useRef, useState } from "react";

/**
 * 只在内容真的变了的时候 setState。
 *
 * **轮询每 2 秒把 `status` 和 `overview` 整个重设一遍，哪怕一个字节都
 * 没变。**React 比的是引用，而每次 `invoke` 回来都是一个新对象，所以
 * 每 2 秒整棵树重渲染一次。表现是表格会闪、悬浮说明会被掐掉、正在编辑
 * 的下拉会被合上 —— 而这些都发生在「什么都没发生」的时候。
 *
 * 判据用 JSON 序列化。**对这两个对象够用**：它们是控制面回来的纯数据
 * （没有函数、没有 undefined、没有 Map/Set），几百字节，2 秒一次。
 * 真正的深比较在这里是过度设计，而 `useMemo` 解决不了这个问题 ——
 * 它依赖的仍然是那个每次都新的引用。
 *
 * 返回的 setter 是稳定的，可以安全地进 effect 的依赖数组。
 */
export function useStableState<T>(
  initial: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  // 存上一次的序列化结果，而不是每次都序列化两个对象
  const lastJson = useRef<string>(JSON.stringify(initial));

  const set = useCallback((next: T) => {
    const json = JSON.stringify(next);
    if (json === lastJson.current) return;
    lastJson.current = json;
    setValue(next);
  }, []);

  return [value, set];
}
