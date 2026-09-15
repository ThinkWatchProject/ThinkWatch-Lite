import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn 组件合并 className 用的。条件类一律走它，不要手拼模板字符串。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
