import { messages } from "@/i18n";

export const routeConfirmText = messages(
  {
    setDefaultTitle: (name: string) => `将「${name}」设为默认路由`,
    keysWillMove: "未指定路由的密钥将改用此路由。",
    noKeysMove: "当前所有密钥均已指定路由，更换默认路由不影响现有密钥。",
    previousDefault: "默认",
    keepsRoute: (name: string) => `「${name}」保留为普通路由，可继续指定给密钥。`,
    deleteTitle: (name: string) => `删除路由「${name}」`,
    usersMove: "以下密钥使用此路由，删除后改用所选路由。可在版本历史中恢复。",
    unused: "此路由未被密钥使用。删除后可在版本历史中恢复。",
    reassignTo: "改用路由",
    defaultOption: (name: string) => `${name}（默认路由）`,
    defaultRoute: "默认路由",
  },
  {
    setDefaultTitle: (name: string) => `Set “${name}” as the default route`,
    keysWillMove: "Keys without an assigned route will switch to this route.",
    noKeysMove: "Every key already has an assigned route, so changing the default route does not affect existing keys.",
    previousDefault: "default",
    keepsRoute: (name: string) => `“${name}” remains a regular route and can still be assigned to keys.`,
    deleteTitle: (name: string) => `Delete route “${name}”`,
    usersMove:
      "The keys below use this route and will switch to the selected route. The route can be restored from the version history.",
    unused: "No key uses this route. Once deleted, it can be restored from the version history.",
    reassignTo: "Reassign to",
    defaultOption: (name: string) => `${name} (default route)`,
    defaultRoute: "Default route",
  },
);
