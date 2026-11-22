import { messages } from "@/i18n";

export const launchText = messages(
  {
    starting: "正在启动网关",
    loading: "正在载入数据",
    slow: (secs: number) => `启动耗时较长，已用 ${secs} 秒`,
    /** 网关起来了、也答应了，状态却读不到：多半是两边版本对不上 */
    readFailed: "无法读取网关状态",
  },
  {
    starting: "Starting the gateway",
    loading: "Loading data",
    slow: (secs: number) => `Starting is taking longer than usual: ${secs} s so far`,
    readFailed: "The gateway status could not be read",
  },
  {
    "zh-Hant": {
      starting: "正在啟動閘道器",
      loading: "正在載入資料",
      slow: (secs: number) => `啟動耗時較長，已用 ${secs} 秒`,
      readFailed: "無法讀取閘道器狀態",
    },
    ja: {
      starting: "ゲートウェイを起動しています",
      loading: "データを読み込んでいます",
      slow: (secs: number) => `起動に時間がかかっています（${secs} 秒経過）`,
      readFailed: "ゲートウェイの状態を取得できませんでした",
    },
    ko: {
      starting: "게이트웨이 시작 중",
      loading: "데이터 불러오는 중",
      slow: (secs: number) => `시작에 시간이 오래 걸리고 있습니다(${secs}초 경과).`,
      readFailed: "게이트웨이 상태를 읽을 수 없습니다.",
    },
    es: {
      starting: "Iniciando la puerta de enlace",
      loading: "Cargando datos",
      slow: (secs: number) => `El inicio está tardando más de lo habitual (${secs} s).`,
      readFailed: "No se pudo leer el estado de la puerta de enlace.",
    },
  },
);
