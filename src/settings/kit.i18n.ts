import { messages } from "@/i18n";

/** 设置页的骨架（目录、分组、保存栏）自己说的几句 */
export const kitText = messages(
  {
    index: "设置目录",
    unsaved: "有未保存的更改",
    saved: "已保存",
    discard: "放弃更改",
    offline: "连接到 core 后可修改此项。",
    loadFailed: "无法读取",
    /** 改配置文件的两节读不到网关配置时，那一行的标题 */
    configFailed: "无法读取网关配置",
  },
  {
    index: "Settings sections",
    unsaved: "Unsaved changes",
    saved: "Saved",
    discard: "Discard changes",
    offline: "Available once connected to a core.",
    loadFailed: "Could not load",
    configFailed: "The gateway configuration could not be read",
  },
  {
    "zh-Hant": {
      index: "設定目錄",
      unsaved: "有未儲存的更改",
      saved: "已儲存",
      discard: "放棄更改",
      offline: "連線到 core 後可修改此項。",
      loadFailed: "無法讀取",
      configFailed: "無法讀取閘道器配置",
    },
    ja: {
      index: "設定項目",
      unsaved: "未保存の変更があります",
      saved: "保存しました",
      discard: "変更を破棄",
      offline: "core に接続すると設定できます。",
      loadFailed: "読み込めませんでした",
      configFailed: "ゲートウェイの設定を読み込めませんでした",
    },
    ko: {
      index: "설정 항목",
      unsaved: "저장하지 않은 변경 사항",
      saved: "저장됨",
      discard: "변경 사항 취소",
      offline: "core에 연결하면 사용할 수 있습니다.",
      loadFailed: "불러올 수 없음",
      configFailed: "게이트웨이 설정을 읽을 수 없습니다.",
    },
    es: {
      index: "Secciones de configuración",
      unsaved: "Cambios sin guardar",
      saved: "Guardado",
      discard: "Descartar cambios",
      offline: "Disponible al conectarse a un core.",
      loadFailed: "No se pudo cargar",
      configFailed: "No se pudo leer la configuración de la puerta de enlace.",
    },
  },
);
