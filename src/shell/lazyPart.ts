import { useEffect, useReducer, type ComponentType } from "react";

/**
 * 按需载入的一块界面（主界面、一页、命令面板、一个大对话框）。
 *
 * **主窗口原来是一整块**：各页、图表、日历、配置编辑器全打在一个 1.8 MB 的包里，冷启动
 * 要整个解析完才画得出启动画面。现在每一块用到时才载入；交接之后空闲下来再把其余的预先
 * 载入（见 `Workspace`），换页时已经在了。
 */
export interface Part<P> {
  /** 开始载入。载入过、正在载入的不重来；载入完兑现 */
  preload: () => Promise<ComponentType<P>>;
  /** 载入好了的组件。还没好是 null */
  get: () => ComponentType<P> | null;
}

export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): Part<P> {
  let done: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  return {
    preload: () =>
      (loading ??= load().then(
        (c) => (done = c),
        (e: unknown) => {
          // 载入失败（多半是应用刚更新、旧的块不在了）：下次用到时再试，别把失败记住
          loading = null;
          throw e;
        },
      )),
    get: () => done,
  };
}

/**
 * 要画这一块：载入好了返回组件；还没好返回 null，开始载入，好了重画一次。`want` 为假时
 * 不载入（对话框关着的时候）。
 *
 * **不用 `React.lazy` + `Suspense`。**Suspense 的占位一旦画出来，里面的内容最快也要隔
 * 300 ms 才揭开（React 把揭开攒成一批，防闪）：主界面那一块套着落地页那一块，两层都挂起
 * 时，热启动的窗口要白白多藏三百毫秒才出现。这里没好就画调用方自己的占位，好了当场换上。
 */
export function usePart<P extends object>(part: Part<P>, want = true): ComponentType<P> | null {
  const [, loaded] = useReducer((n: number) => n + 1, 0);
  const C = part.get();
  useEffect(() => {
    if (!want || C) return;
    let alive = true;
    part.preload().then(
      () => alive && loaded(),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [part, want, C]);
  return want ? C : null;
}
