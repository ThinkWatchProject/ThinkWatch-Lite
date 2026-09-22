import { messages } from "@/i18n";

export const configTextText = messages(
  {
    /** 配置文件里各段在界面上叫什么 */
    sections: {
      providers: "上游",
      proxies: "代理",
      pricing: "价目表",
      clients: "密钥",
      routes: "路由",
      groups: "策略组",
      default_route: "默认路由",
      listen: "监听",
      client_probes: "客户端探测请求",
      security: "防护",
    },
    staleTitle: "文件已被其他进程修改",
    staleBody: "此时保存将覆盖该进程所做的修改。",
    useFile: "放弃本地修改，使用文件中的版本",
    keepMine: "保留本地修改并覆盖文件",
    cursorAt: (section: string) => `光标位于${section}`,
    showInApp: "在界面中查看",
    unsaved: "有未保存的修改",
  },
  {
    sections: {
      providers: "upstream",
      proxies: "proxy",
      pricing: "price sheet",
      clients: "key",
      routes: "route",
      groups: "group",
      default_route: "default route",
      listen: "listening",
      client_probes: "client probes",
      security: "protection",
    },
    staleTitle: "The file was changed by another process",
    staleBody: "Saving now overwrites the changes that process made.",
    useFile: "Discard local changes and use the version in the file",
    keepMine: "Keep local changes and overwrite the file",
    cursorAt: (section: string) => `Cursor in ${section}`,
    showInApp: "Show in app",
    unsaved: "Unsaved changes",
  },
);
