import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn 组件合并 className 用的。条件类一律走它，不要手拼模板字符串。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 下拉里代表「空」的那一项。
 *
 * **Radix 的 `SelectItem` 不收空字符串**（传了会抛）。而配置里「这个
 * 字段不写」恰恰就是空串的意思 —— 「全部客户端」「默认路由」「自动判」
 * 都是它。所以显示层用这个哨兵，写回配置时再换回 `null`。
 *
 * 用 U+2400（␀ SYMBOL FOR NULL）而不是 `__none__`：路由名和上游名是
 * 用户起的，`__none__` 他起得出来，这个起不出来。
 */
export const EMPTY = "\u2400";
