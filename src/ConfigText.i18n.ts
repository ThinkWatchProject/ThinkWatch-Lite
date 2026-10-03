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
    /**
     * 写配置原文（保存文件、恢复版本）要装上、启用、换掉批准的代码的那个插件改得了回答里的
     * 工具调用：这条路做不了，只能在插件页里做（那里会弹系统的确认框）
     */
    pluginConfirm: {
      title: "此更改须在插件页中确认",
      /** `reason` 是 core 的那句话 */
      notSaved: (reason: string) => `配置文件未保存。${reason}`,
      notRestored: (reason: string) => `未恢复此版本。${reason}`,
      open: "打开插件页",
    },
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
    pluginConfirm: {
      title: "This change has to be confirmed on the Plugins page",
      notSaved: (reason: string) => `The config file was not saved. ${reason}`,
      notRestored: (reason: string) => `This version was not restored. ${reason}`,
      open: "Open Plugins",
    },
  },
);
