import { messages } from "@/i18n";

export const writeText = messages(
  {
    /** 确认过的代码不在了：拨不了开关（开关要和代码一起交） */
    approvedMissing: "此插件已确认的代码不存在，无法切换开关。请先在此插件的代码页中保存代码。",
  },
  {
    approvedMissing:
      "The approved code of this plugin is missing, so it cannot be switched on or off. Save the code in the plugin's Code tab first.",
  },
  {
    "zh-Hant": {
      approvedMissing: "此外掛已確認的程式碼不存在，無法切換開關。請先在此外掛的內碼表中儲存程式碼。",
    },
    es: {
      approvedMissing: "Falta el código aprobado de este plugin, por lo que no se puede activar o desactivar. Guardar el código en la pestaña Código del plugin primero.",
    },
  },
);
