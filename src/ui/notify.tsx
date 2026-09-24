import { useCallback, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { textOf } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { uiText } from "./ui.i18n";

/**
 * 操作结果的反馈。**所有 toast 都从这里出**，不直接调 sonner：
 *
 * · `notify.success(msg)`：一个动作成功了，而界面上看不出来（保存、复制、已发送）。
 *   界面上本来就看得出来的（行出现了、开关拨过去了）不再弹。
 * · `notify.error(e, title?)`：动作失败。`e` 直接传 catch 到的东西，翻成一句话。
 * · `notify.info(msg)`：告知，不是结果。
 * · `undoable({...})`：可撤销的动作（停用、启用、移除一项）。先改界面、再发请求，
 *   toast 上给「撤销」。见 src/ui/README.md 的「Feedback」。
 *
 * 状态（「配置没通过」「断线了」）不是 toast，是 `Banner`：toast 会飘走。
 */
export const notify = {
  success(message: ReactNode, description?: ReactNode) {
    return toast.success(message, { description });
  },
  error(error: unknown, title?: ReactNode) {
    const text = errorText(error);
    return title ? toast.error(title, { description: text }) : toast.error(text);
  },
  info(message: ReactNode, description?: ReactNode) {
    return toast(message, { description });
  },
};

/**
 * 可撤销的动作。
 *
 * 1. `apply()`（可选）先把界面改成做完之后的样子 —— 乐观更新，返回撤回用的函数。
 *    和 `useResource` 的 `mutate` 正好接上：`mutate` 返回的就是撤回函数。
 * 2. 发出 `do()`。失败：撤回界面、报错。
 * 3. 成功：toast 写 `message`，带「撤销」。点了就跑 `undo()`（同样先撤回界面），
 *    失败再报错。
 *
 *   await undoable({
 *     message: t.keyDisabled(name),
 *     apply: () => keys.mutate((ks) => ks.map((k) => (k.name === name ? { ...k, disabled: true } : k))),
 *     do: () => setDisabled(name, true),
 *     undo: () => setDisabled(name, false),
 *     after: () => keys.reload(),
 *   });
 *
 * 返回 `do()` 成没成功。
 */
export async function undoable({
  message,
  apply,
  do: run,
  undo,
  after,
  undoLabel,
}: {
  message: ReactNode;
  apply?: () => () => void;
  do: () => Promise<unknown>;
  undo: () => Promise<unknown>;
  /** 做完或撤销之后（无论成败）调一次，通常是 `reload` */
  after?: () => unknown;
  undoLabel?: string;
}): Promise<boolean> {
  const t = textOf(uiText);
  const rollback = apply?.();
  try {
    await run();
  } catch (e) {
    rollback?.();
    notify.error(e);
    void after?.();
    return false;
  }
  void after?.();
  toast.success(message, {
    duration: 6_000,
    action: {
      label: undoLabel ?? t.undo,
      onClick: () => {
        rollback?.();
        undo()
          .then(() => toast(t.undone, { duration: 2_000 }))
          .catch((e) => notify.error(e))
          .finally(() => void after?.());
      },
    },
  });
  return true;
}

/**
 * 按钮的「进行中」。
 *
 *   const [saving, save] = usePending();
 *   <Button pending={saving} onClick={() => save(async () => { await call(…); notify.success(t.saved); })}>
 *
 * `run` 里抛出的错误会被接住并 `notify.error`，然后返回 `undefined`；不想这样就
 * 自己在里面 try。同一时间只跑一个：进行中再点直接忽略。
 */
export function usePending(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await fn();
    } catch (e) {
      notify.error(e);
      return undefined;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return [pending, run];
}
