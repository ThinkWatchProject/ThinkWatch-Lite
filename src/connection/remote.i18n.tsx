import { messages } from "@/i18n";
import { isMac } from "@/platform";

/** 这台机器叫什么。设计稿里写「这台 Mac」，别的平台写「这台电脑」 */
const hereZh = isMac ? "这台 Mac" : "这台电脑";
/** 「这台 Mac 上」：拉丁字母和汉字之间留一个空格，「这台电脑上」不留 */
const onHereZh = isMac ? "这台 Mac 上" : "这台电脑上";
const hereEn = isMac ? "this Mac" : "this computer";
const HereEn = isMac ? "This Mac" : "This computer";

/**
 * 连着远程 core 时各页多说的那几句（设计稿 ⑧ 和「远程模式的功能差异」）：客户端、
 * MCP 改的是这台机器，设置分成「应用自己的」和「服务器的」，登录和环境变量说清
 * 取的是哪一边。
 *
 * 带 `${变量名}` 的几句是普通字符串，不是模板字符串：那是写给用户看的占位写法。
 */
export const remoteText = messages(
  {
    // 客户端页、MCP 页顶上的说明
    clientsNote: (name: string, gateway: string) =>
      `此处检查和修改的是${onHereZh}的客户端配置，使其指向 ${name} 的网关 ${gateway}；服务器上的客户端不受影响。`,
    mcpNote: (name: string) =>
      `此处检查和修改的是${onHereZh}客户端的 MCP 配置、技能与钩子；${name} 上的不受影响。`,

    // 还指着本机网关的客户端。WSL 那几组各说各的，所以页上有 WSL 分组时，页顶这一句
    // 说明是这台电脑上的
    localLeft: (n: number, addr: string) =>
      `${n} 个已接管的客户端仍指向本机网关 ${addr}。本机网关已停止，这些客户端的请求会失败。`,
    localLeftHere: (n: number, addr: string) =>
      `${onHereZh}有 ${n} 个已接管的客户端仍指向本机网关 ${addr}。本机网关已停止，这些客户端的请求会失败。`,
    retargetTo: (name: string) => `改为指向 ${name}`,
    retargeted: (name: string, clients: string[]) => `已改为指向 ${name}：${clients.join("、")}。`,
    retargetFailedTitle: (name: string) => `以下客户端未能改为指向 ${name}`,
    retargetNone: "无需修改任何客户端。",
    /** 客户端名和原因之间 */
    sep: "：",

    // 设置
    appGroup: `${onHereZh}的应用`,
    serverGroup: (name: string) => `${name} 的配置`,
    controlReadOnly: "远程控制的监听与密钥只能在服务器上修改。",
    connection: "连接",
    serverCore: "服务器 core",
    uninstallServer: (name: string) => `只影响${hereZh}：${name} 上的配置和数据不受影响。`,

    // 账号登录、环境变量、系统代理
    deviceOnly: (name: string) =>
      `浏览器登录完成后会回到运行 core 的那台机器，而当前连接的是 ${name}，因此只能用设备码登录。`,
    headersHint: "随每个请求发送。值中的 ${变量名} 读取服务器上 core 进程的环境变量。",
    keyHint: "${变量名} 读取服务器上 core 进程的环境变量。",
    profileHint:
      "读取服务器上运行 core 的用户的 AWS 凭证文件（~/.aws/credentials、~/.aws/config）中的这个 profile，只支持写有访问密钥的 profile。",
    systemProxy: "服务器的系统代理",
  },
  {
    clientsNote: (name: string, gateway: string) =>
      `This page checks and changes the client configuration on ${hereEn}, pointing it at the gateway of ${name} (${gateway}). Clients on the server are not affected.`,
    mcpNote: (name: string) =>
      `This page checks and changes the MCP configuration, skills and hooks of the clients on ${hereEn}. Those on ${name} are not affected.`,

    localLeft: (n: number, addr: string) =>
      n === 1
        ? `1 connected client still points to the local gateway ${addr}. The local gateway has stopped, so its requests fail.`
        : `${n} connected clients still point to the local gateway ${addr}. The local gateway has stopped, so their requests fail.`,
    localLeftHere: (n: number, addr: string) =>
      n === 1
        ? `1 connected client on ${hereEn} still points to the local gateway ${addr}. The local gateway has stopped, so its requests fail.`
        : `${n} connected clients on ${hereEn} still point to the local gateway ${addr}. The local gateway has stopped, so their requests fail.`,
    retargetTo: (name: string) => `Point at ${name}`,
    retargeted: (name: string, clients: string[]) => `Now pointed at ${name}: ${clients.join(", ")}.`,
    retargetFailedTitle: (name: string) => `These clients could not be pointed at ${name}`,
    retargetNone: "No client needed changing.",
    sep: ": ",

    appGroup: `The app on ${hereEn}`,
    serverGroup: (name: string) => `Configuration on ${name}`,
    controlReadOnly: "The remote control listener and its key can only be changed on the server.",
    connection: "Connection",
    serverCore: "Server core",
    uninstallServer: (name: string) =>
      `${HereEn} only: the configuration and data on ${name} are not affected.`,

    deviceOnly: (name: string) =>
      `A browser sign-in returns to the machine that runs core, and this app is connected to ${name}, so only the device code sign-in is available.`,
    headersHint: "Sent with every request. ${NAME} in a value reads an environment variable of the core process on the server.",
    keyHint: "${NAME} reads an environment variable of the core process on the server.",
    profileHint:
      "Reads this profile from the AWS credential files of the user running core on the server (~/.aws/credentials, ~/.aws/config). Only profiles that hold access keys are supported.",
    systemProxy: "The server's system proxy",
  },
  {
    "zh-Hant": {
      clientsNote: (name: string, gateway: string) => `此處檢查和修改的是${(isMac ? "這臺 Mac 上" : "這臺電腦上")}的用戶端配置，使其指向 ${name} 的閘道器 ${gateway}；伺服器上的用戶端不受影響。`,
      mcpNote: (name: string) => `此處檢查和修改的是${(isMac ? "這臺 Mac 上" : "這臺電腦上")}用戶端的 MCP 配置、技能與鉤子；${name} 上的不受影響。`,
      localLeft: (n: number, addr: string) => `${n} 個已接管的用戶端仍指向本機閘道器 ${addr}。本機閘道器已停止，這些用戶端的請求會失敗。`,
      localLeftHere: (n: number, addr: string) => `${(isMac ? "這臺 Mac 上" : "這臺電腦上")}有 ${n} 個已接管的用戶端仍指向本機閘道器 ${addr}。本機閘道器已停止，這些用戶端的請求會失敗。`,
      retargetTo: (name: string) => `改為指向 ${name}`,
      retargeted: (name: string, clients: string[]) => `已改為指向 ${name}：${clients.join("、")}。`,
      retargetFailedTitle: (name: string) => `以下用戶端未能改為指向 ${name}`,
      retargetNone: "無需修改任何用戶端。",
      appGroup: `${(isMac ? "這臺 Mac 上" : "這臺電腦上")}的應用`,
      controlReadOnly: "遠端控制的監聽與金鑰只能在伺服器上修改。",
      connection: "連線",
      serverCore: "伺服器 core",
      uninstallServer: (name: string) => `隻影響${(isMac ? "這臺 Mac" : "這臺電腦")}：${name} 上的配置和資料不受影響。`,
      deviceOnly: (name: string) => `瀏覽器登入完成後會回到執行 core 的那臺機器，而當前連線的是 ${name}，因此只能用裝置碼登入。`,
      headersHint: "隨每個請求傳送。值中的 ${變數名} 讀取伺服器上 core 程序的環境變數。",
      keyHint: "${變數名} 讀取伺服器上 core 程序的環境變數。",
      profileHint: "讀取伺服器上執行 core 的使用者的 AWS 憑證檔案（~/.aws/credentials、~/.aws/config）中的這個 profile，只支援寫有訪問金鑰的 profile。",
      systemProxy: "伺服器的系統代理",
    },
    ja: {
      clientsNote: (name: string, gateway: string) => `この端末のクライアント設定を確認・変更し、${name} のゲートウェイ（${gateway}）に接続します。サーバー上のクライアントには影響しません。`,
      mcpNote: (name: string) => `この端末のクライアントの MCP 設定、スキル、フックを確認・変更します。${name} 上の設定には影響しません。`,
      localLeft: (n: number, addr: string) => `${n} 件のクライアントがローカルゲートウェイ ${addr} を参照しています。ゲートウェイが停止しているため、リクエストは失敗します。`,
      localLeftHere: (n: number, addr: string) => `この端末の ${n} 件のクライアントがローカルゲートウェイ ${addr} を参照しています。ゲートウェイが停止しているため、リクエストは失敗します。`,
      retargetTo: (name: string) => `接続先を ${name} に変更`,
      retargeted: (name: string, clients: string[]) => `接続先を ${name} に変更しました：${clients.join("、")}。`,
      retargetFailedTitle: (name: string) => `次のクライアントの接続先を ${name} に変更できませんでした`,
      retargetNone: "変更が必要なクライアントはありません。",
      sep: "：",
      appGroup: "この端末のアプリ",
      serverGroup: (name: string) => `${name} の設定`,
      controlReadOnly: "リモート制御のリッスン設定とキーはサーバーで変更してください。",
      connection: "接続",
      serverCore: "サーバーの core",
      uninstallServer: (name: string) => `この端末のみに適用されます。${name} 上の設定やデータには影響しません。`,
      deviceOnly: (name: string) => `ブラウザーでのログインは core を実行する端末に戻ります。現在は ${name} に接続しているため、デバイスコードでログインしてください。`,
      headersHint: "リクエストごとに送信します。値に ${NAME} を指定すると、サーバーの core プロセスの環境変数を参照します。",
      keyHint: "${NAME} はサーバーの core プロセスの環境変数を参照します。",
      profileHint: "サーバー上で core を実行しているユーザーの AWS 認証情報ファイル（~/.aws/credentials、~/.aws/config）からプロファイルを読み込みます。アクセスキーを含むプロファイルに対応しています。",
      systemProxy: "サーバーのシステムプロキシ",
    },
    ko: {
      connection: "연결",
      uninstallServer: (name: string) => `${(isMac ? "이 Mac" : "이 컴퓨터")} only: the configuration and data on ${name} are not affected.`,
      clientsNote: (name: string, gateway: string) => `이 컴퓨터의 클라이언트 설정을 확인하고 수정해 ${name}의 게이트웨이(${gateway})에 연결할 수 있습니다. 서버의 클라이언트에는 영향이 없습니다.`,
      mcpNote: (name: string) => `이 컴퓨터에서 클라이언트의 MCP 설정, 스킬 및 훅을 확인하고 수정합니다. ${name}의 설정에는 영향이 없습니다.`,
      localLeft: (n: number, addr: string) => `연결된 클라이언트 ${n}개가 여전히 로컬 게이트웨이 ${addr}을(를) 사용합니다. 로컬 게이트웨이가 중지되어 요청이 실패합니다.`,
      localLeftHere: (n: number, addr: string) => `이 컴퓨터의 클라이언트 ${n}개가 여전히 로컬 게이트웨이 ${addr}을(를) 사용합니다. 로컬 게이트웨이가 중지되어 요청이 실패합니다.`,
      retargetTo: (name: string) => `연결 대상을 ${name}(으)로 변경`,
      retargeted: (name: string, clients: string[]) => `연결 대상을 ${name}(으)로 변경했습니다: ${clients.join(", ")}.`,
      retargetFailedTitle: (name: string) => `다음 클라이언트를 ${name}(으)로 변경하지 못했습니다`,
      retargetNone: "변경할 클라이언트가 없습니다.",
      appGroup: "이 컴퓨터의 앱",
      serverGroup: (name: string) => `${name}의 설정`,
      controlReadOnly: "원격 제어 수신 설정과 키는 서버에서 변경할 수 있습니다.",
      serverCore: "서버의 core",
      deviceOnly: (name: string) => `브라우저 로그인은 core를 실행하는 컴퓨터로 돌아옵니다. 현재 ${name}에 연결되어 있어 기기 코드로만 로그인할 수 있습니다.`,
      headersHint: "요청마다 전송합니다. 값에 ${NAME}을 사용하면 서버의 core 프로세스 환경 변수를 읽습니다.",
      keyHint: "${NAME}은 서버의 core 프로세스 환경 변수를 읽습니다.",
      profileHint: "서버에서 core를 실행하는 사용자의 AWS 인증 정보 파일(~/.aws/credentials, ~/.aws/config)에서 프로필을 읽습니다. 액세스 키가 있는 프로필을 지원합니다.",
      systemProxy: "서버의 시스템 프록시",
    },
    es: {
      clientsNote: (name: string, gateway: string) => `Esta página comprueba y cambia la configuración del cliente en ${(isMac ? "este Mac" : "esta computadora")}, apuntando a la puerta de enlace de ${name} (${gateway}). Los clientes en el servidor no se ven afectados.`,
      mcpNote: (name: string) => `Esta página comprueba y cambia la configuración de MCP, las habilidades y los ganchos de los clientes en ${(isMac ? "este Mac" : "esta computadora")}. Aquellos en ${name} no se ven afectados.`,
      localLeft: (n: number, addr: string) => n === 1
        ? `1 cliente conectado sigue apuntando a la puerta de enlace local ${addr}. La puerta de entrada local se ha detenido, por lo que sus peticiones fallan.`
        : `${n} los clientes conectados todavía apuntan a la puerta local ${addr}. La puerta local se ha detenido, por lo que sus solicitudes fallan.`,
      localLeftHere: (n: number, addr: string) => n === 1
        ? `1 cliente conectado en ${(isMac ? "este Mac" : "esta computadora")} sigue apuntando a la puerta local ${addr}. La puerta local se ha detenido, por lo que sus solicitudes fallan.`
        : `${n} clientes conectados en ${(isMac ? "este Mac" : "esta computadora")} todavía apuntan a la puerta local ${addr}. La puerta local se ha detenido, por lo que sus solicitudes fallan.`,
      retargetTo: (name: string) => `Punto de ${name}`,
      retargeted: (name: string, clients: string[]) => `Ahora apunta a ${name}: ${clients.join(", ")}.`,
      retargetFailedTitle: (name: string) => `Estos clientes no pudieron señalarse a ${name}`,
      retargetNone: "Ningún cliente necesitaba cambiar.",
      appGroup: `La aplicación en ${(isMac ? "este Mac" : "esta computadora")}`,
      serverGroup: (name: string) => `Configuración en ${name}`,
      controlReadOnly: "El oyente de control remoto y su llave sólo se pueden cambiar en el servidor.",
      connection: "Conexión",
      serverCore: "Núcleo del servidor",
      uninstallServer: (name: string) => `${(isMac ? "Este Mac" : "Este equipo")} únicamente: la configuración y los datos en ${name} no se verán afectados.`,
      deviceOnly: (name: string) => `Un inicio de sesión del navegador vuelve a la máquina que ejecuta el núcleo, y esta aplicación está conectada a ${name}, por lo que sólo está disponible el inicio de entrada del código del dispositivo.`,
      headersHint: "Enviado con cada petición. ${NAME} En un valor se lee una variable de entorno del proceso de núcleo en el servidor.",
      keyHint: "${NAME} lee una variable de entorno del proceso central en el servidor.",
      profileHint: "Lee este perfil desde los archivos de credencial AWS del usuario que ejecuta el núcleo en el servidor (~/.aws/credentials, ~/.aws/config). Sólo se admiten perfiles que contienen claves de acceso.",
      systemProxy: "El proxy del sistema del servidor",
    },
  },
);
