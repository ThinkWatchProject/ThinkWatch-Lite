import { messages } from "@/i18n";
import { andList } from "./routing.i18n";

export const chainMapText = messages(
  {
    /** 读屏读出来的整张图 */
    label: (keys: number, routes: number, groups: number, upstreams: number) =>
      `路由图：${keys} 把密钥、${routes} 条路由、${groups} 个策略组、${upstreams} 个上游`,
    keys: "密钥",
    routes: "路由",
    groups: "策略组",
    upstreams: "上游",
    defaultRoute: "默认路由",
    usesRoute: (name: string) => `使用路由「${name}」`,
    ruleCount: (n: number) => `${n} 条规则`,
    keyCount: (n: number) => `${n} 把密钥`,
    unusedRoute: "未被密钥使用",
    unreferenced: "未被引用",
    unreachable: "未被任何路由使用",
    members: (kind: string, members: string[]) => `${kind}：${members.join(" → ")}`,
    membersUnordered: (kind: string, members: string[]) => `${kind}：${members.join("、")}`,
    denyBy: (route: string, rule: string) => `${route} · ${rule}`,
    inFlight: (n: number) => `${n} 个请求进行中`,
  },
  {
    label: (keys: number, routes: number, groups: number, upstreams: number) =>
      `Routing map: ${keys} ${keys === 1 ? "key" : "keys"}, ${routes} ${routes === 1 ? "route" : "routes"}, ${groups} ${groups === 1 ? "group" : "groups"}, ${upstreams} ${upstreams === 1 ? "upstream" : "upstreams"}`,
    keys: "Keys",
    routes: "Routes",
    groups: "Groups",
    upstreams: "Upstreams",
    defaultRoute: "Default route",
    usesRoute: (name: string) => `Uses route “${name}”`,
    ruleCount: (n: number) => (n === 1 ? "1 rule" : `${n} rules`),
    keyCount: (n: number) => (n === 1 ? "1 key" : `${n} keys`),
    unusedRoute: "Not used by any key",
    unreferenced: "Not referenced",
    unreachable: "Not used by any route",
    members: (kind: string, members: string[]) => `${kind}: ${members.join(" → ")}`,
    membersUnordered: (kind: string, members: string[]) => `${kind}: ${andList(members)}`,
    denyBy: (route: string, rule: string) => `${route} · ${rule}`,
    inFlight: (n: number) => (n === 1 ? "1 request in progress" : `${n} requests in progress`),
  },
);
