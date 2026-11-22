import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isLinux, isMac } from "@/platform";
import type { Adopted } from "./api";

/** 句中嵌着的一段代码（配置项、命令）。怎么画由组件决定 */
type Code = (text: string) => ReactNode;

/** 这台机器叫什么（切换确认框里按所在的地方分开数时）。有 WSL 的只有 Windows */
const hereZh = isMac ? "这台 Mac" : "这台电脑";
const hereEn = isMac ? "this Mac" : "this computer";

/** 还指着本机网关的客户端里有没有 WSL 里的：有才按所在的地方分开数 */
const anyInWsl = (a: Adopted) => a.places.some((p) => p.distro !== null);

/** 启动时按住哪个键 */
const holdZh = isMac ? "Option" : "Alt";

/**
 * 本机那一条叫什么：中文一律「本机」，英文按平台 —— macOS 上是「This Mac」，别的平台是
 * 「This computer」。应用那一侧（菜单栏、托盘的「连接」子菜单）写法一样，见 Rust 的
 * `connection::store::local_name`
 */
const localZh = "本机";
const localEn = isMac ? "This Mac" : "This computer";

/**
 * 连接：侧栏的切换器、设置里的「连接」一节、添加与编辑、切换确认、未连接页、
 * 断线横幅、启动时的连接选择。
 */
export const connText = messages(
  {
    /** 内置的那一条。显示连接的名字一律经 `profileName`（describe.tsx） */
    local: localZh,
    localNote: (dir: string) => `${dir} · 内置，不可删除`,
    localCore: "本地 core",
    localStopped: "本地 core · 已停止",

    // 侧栏
    switcherTip: "切换连接",
    menuTitle: "连接",
    addRemote: "添加远程连接…",
    manage: "管理连接…",
    connected: "已连接",
    connecting: "正在连接",
    unlinked: "未连接",

    // 设置 → 连接
    title: "连接",
    add: "添加远程连接",
    intro: isMac
      ? "应用同一时间连接一个 core。连接到远程 core 时，本机 core 停止运行，本机数据保留。"
      : "应用同一时间连接一个 core。连接到远程 core 时，本机的 core 停止运行，本机数据保留。",
    current: "当前",
    switchTo: "切换到此连接",
    switchShort: "切换",
    actionsFor: (name: string) => `「${name}」的操作`,
    lastConnected: (when: string) => `上次连接 ${when}`,
    neverConnected: "尚未连接",
    coreVersion: (v: string) => `core ${v}`,
    startupLabel: "启动时连接",
    startupLast: "上次使用的连接",
    startupLocal: localZh,
    startupHint: isLinux
      ? "连续两次启动未能完成时，下次启动先显示连接选择。"
      : `按住 ${holdZh} 键启动应用时，先显示连接选择。`,
    deleteTitle: (name: string) => `删除连接「${name}」`,
    deleteBody: "保存在本机的密钥一并删除。服务器上的 core 不受影响。",

    // 添加与编辑
    addTitle: "添加远程连接",
    editTitle: "编辑连接",
    dialogDesc: "连接到运行在另一台机器上的 ThinkWatch core。",
    name: "名称",
    namePlaceholder: "例如 home-server",
    host: "地址",
    hostHint: "主机名或 IP 地址。",
    port: "控制端口",
    portHint: (code: Code) => <>服务器配置中 {code("listen.control.remote.port")} 的值。</>,
    key: "密钥",
    keyHint: (code: Code) => (
      <>
        在服务器上执行 {code("twcore control-key")} 获取。仅保存在本机，只有当前用户可以读取。
      </>
    ),
    test: "测试连接",
    testOk: (version: string, gateway: string | null) =>
      `连接成功 · core ${version}${gateway ? ` · 网关 ${gateway}` : ""}`,
    saveAndSwitch: "保存并切换",
    enterName: "填写名称",
    nameTaken: "已有同名的连接",
    enterHost: "填写地址",
    badHost: "地址格式不正确",
    badPort: "端口应为 1–65535 之间的整数",
    enterKey: "填写密钥",
    badKey: "密钥应为 64 位十六进制字符",

    // 连接失败的几种说法：标题一句，下一步一句
    unreachable: (addr: string) => `无法连接到 ${addr}`,
    unreachableNext: (code: Code) => (
      <>检查地址和端口，以及服务器配置中 {code("listen.control.remote")} 是否已启用。</>
    ),
    timeoutNext: (code: Code) => (
      <>连接超时。检查地址和端口，以及服务器配置中 {code("listen.control.remote")} 是否已启用。</>
    ),
    closed: "连接被服务器关闭",
    closedNext: (code: Code) => (
      <>本机地址可能不在服务器配置 {code("listen.control.remote.allow_from")} 中。</>
    ),
    wrongKey: "密钥不正确",
    wrongKeyNext: (code: Code) => <>在服务器上执行 {code("twcore control-key")} 查看当前密钥。</>,
    mismatch: (theirs: string, ours: string) => `版本不一致：服务器 core ${theirs}，本应用需要 ${ours}`,
    /**
     * **不说「升级」。**服务器可能比应用新，这时要装的是一个更旧的版本。命令指定版本，
     * 新旧都照装，见 `coreInstallCommand`
     */
    mismatchNext: (code: Code, command: string) => (
      <>在服务器上执行 {code(command)} 安装本应用需要的版本，然后重新连接。</>
    ),
    reasonTimeout: "连接超时",
    reasonUnreachable: "无法访问该地址",

    // 切换
    testingTitle: (name: string) => `正在连接 ${name}…`,
    failedTitle: (name: string) => `无法切换到 ${name}`,
    confirmTitle: (name: string) => `切换到 ${name}`,
    switchedTo: (name: string) => `已切换到 ${name}`,
    /** WSL 里也有的，按所在的地方分开数：「这台电脑 2 个、WSL · Ubuntu 1 个」 */
    adoptedWarn: (a: Adopted) => {
      const at = a.local_addr ? ` ${a.local_addr}` : "";
      if (!anyInWsl(a)) return `已接管的 ${a.count} 个客户端仍指向本机网关${at}。`;
      const parts = a.places.map((p) => `${p.distro === null ? hereZh : `WSL · ${p.distro}`} ${p.count} 个`);
      return `已接管的客户端仍指向本机网关${at}：${parts.join("、")}。`;
    },
    adoptedWarnNext: (name: string) =>
      `切换后本机网关停止，这些客户端的请求会失败，直到重新连接本机，或在客户端页将它们改为指向 ${name}。`,
    retarget: (name: string) => `同时将这些客户端改为指向 ${name}`,
    localStops: "本机 core 将在在途请求结束后停止",
    localKept: "，本机的配置、密钥和请求历史保留。",
    remoteConfig: (name: string) => `切换后，上游、路由、密钥等页面显示和修改的是 ${name} 上的配置。`,
    switchAction: "切换",
    editConnection: "编辑连接",
    keyUnreadable: "无法读取保存在本机的密钥，请在编辑连接时重新填写。",
    gone: "该连接已被删除。",

    // 未连接页
    cannotConnect: (name: string) => `无法连接到 ${name}`,
    connectingTo: (name: string) => `正在连接 ${name}`,
    address: "地址",
    reason: "原因",
    retry: "重试",
    retryIn: (attempt: number, secs: number) => `第 ${attempt} 次，${secs} 秒后`,
    retrying: (attempt: number) => `第 ${attempt} 次，正在连接`,
    retryNow: "立即重试",
    switchToLocal: "切换到本机",
    autoResume: "连接恢复后自动回到上次打开的页面。",
    mismatchTitle: (name: string) => `${name} 上的 core 版本与本应用不一致`,
    server: "服务器",
    appNeeds: "本应用需要",
    /** 下面接着的是 `coreInstallCommand` 给的命令。服务器比应用新时也是这一条 */
    runOnServer: (version: string) =>
      `服务器需要运行 core ${version}。在服务器上执行以下命令安装此版本，服务器上现有的版本较新或较旧均适用：`,
    reconnect: "重新连接",

    // 安全模式、配置文件读不了
    configBroken: "配置文件有误，网关未启动",
    safeMode: "安全模式",
    configBrokenLead: "core 无法读取配置文件，客户端的请求暂不转发。修正配置文件或从备份恢复可用的版本即可恢复转发。",
    file: "文件",
    location: "位置",
    lineAt: (line: number, stage: string) => `第 ${line} 行 · ${stage}错误`,
    stageOnly: (stage: string) => `${stage}错误`,
    openConfigFile: "打开配置文件",
    restoreFromBackup: "从备份恢复…",
    configBrokenResume: "保存修正后的配置后，网关自动恢复。",
    /** 升级之后新 core 读不了配置：网关还在旧 core 上按更新前的配置转发 */
    configBrokenHeldTitle: "更新后的配置文件有误",
    configBrokenHeld:
      "新版本无法读取配置文件。网关暂按更新前的配置运行，客户端的请求照常转发；修正配置文件或从备份恢复可用的版本后，自动切换到新版本。",
    configBrokenHeldResume: "保存修正后的配置后，自动切换到新版本。",

    // 断线横幅
    lostBanner: (name: string, attempt: number) =>
      attempt > 0
        ? `与 ${name} 的连接已断开，正在重连（第 ${attempt} 次）。页面内容为断开前的状态，暂不可修改。`
        : `与 ${name} 的连接已断开，正在重连。页面内容为断开前的状态，暂不可修改。`,

    // 启动时的连接选择
    pickTitle: "选择连接",
    pickOption: `按住 ${holdZh} 键启动。选择这次要连接的 core。`,
    pickUnfinished: "上次启动未能完成。选择这次要连接的 core。",
    lastUsed: "上次使用",
    connect: "连接",
  },
  {
    local: localEn,
    localNote: (dir: string) => `${dir} · Built in, cannot be deleted`,
    localCore: "Local core",
    localStopped: "Local core · Stopped",

    switcherTip: "Switch connection",
    menuTitle: "Connection",
    addRemote: "Add remote connection…",
    manage: "Manage connections…",
    connected: "Connected",
    connecting: "Connecting",
    unlinked: "Not connected",

    title: "Connection",
    add: "Add remote connection",
    intro: isMac
      ? "The app connects to one core at a time. While it is connected to a remote core, the core on this Mac stops running; its data is kept."
      : "The app connects to one core at a time. While it is connected to a remote core, the core on this computer stops running; its data is kept.",
    current: "Current",
    switchTo: "Switch to this connection",
    switchShort: "Switch",
    actionsFor: (name: string) => `Actions for “${name}”`,
    lastConnected: (when: string) => `Last connected ${when}`,
    neverConnected: "Never connected",
    coreVersion: (v: string) => `core ${v}`,
    startupLabel: "Connect at startup",
    startupLast: "Last used connection",
    startupLocal: localEn,
    startupHint: isLinux
      ? "After two startups in a row fail to finish, the next startup shows the connection choice first."
      : `Hold ${holdZh} while opening the app to choose a connection first.`,
    deleteTitle: (name: string) => `Delete connection “${name}”`,
    deleteBody: "The key saved on this computer is deleted as well. The core on the server is not affected.",

    addTitle: "Add remote connection",
    editTitle: "Edit connection",
    dialogDesc: "Connect to a ThinkWatch core running on another machine.",
    name: "Name",
    namePlaceholder: "e.g. home-server",
    host: "Address",
    hostHint: "Host name or IP address.",
    port: "Control port",
    portHint: (code: Code) => <>The value of {code("listen.control.remote.port")} in the server's config.</>,
    key: "Key",
    keyHint: (code: Code) => (
      <>
        Run {code("twcore control-key")} on the server to get it. Saved only on this computer, readable by the current user alone.
      </>
    ),
    test: "Test connection",
    testOk: (version: string, gateway: string | null) =>
      `Connected · core ${version}${gateway ? ` · gateway ${gateway}` : ""}`,
    saveAndSwitch: "Save and switch",
    enterName: "Enter a name",
    nameTaken: "A connection with this name already exists",
    enterHost: "Enter an address",
    badHost: "The address is not valid",
    badPort: "The port must be a whole number from 1 to 65535",
    enterKey: "Enter the key",
    badKey: "The key must be 64 hexadecimal characters",

    unreachable: (addr: string) => `Cannot connect to ${addr}`,
    unreachableNext: (code: Code) => (
      <>Check the address and port, and whether {code("listen.control.remote")} is enabled in the server's config.</>
    ),
    timeoutNext: (code: Code) => (
      <>
        The connection timed out. Check the address and port, and whether {code("listen.control.remote")} is
        enabled in the server's config.
      </>
    ),
    closed: "The server closed the connection",
    closedNext: (code: Code) => (
      <>This computer's address may be missing from {code("listen.control.remote.allow_from")} in the server's config.</>
    ),
    wrongKey: "The key is not correct",
    wrongKeyNext: (code: Code) => <>Run {code("twcore control-key")} on the server to see the current key.</>,
    mismatch: (theirs: string, ours: string) =>
      `Version mismatch: the server runs core ${theirs}; this app needs ${ours}`,
    mismatchNext: (code: Code, command: string) => (
      <>Run {code(command)} on the server to install the version this app needs, then connect again.</>
    ),
    reasonTimeout: "The connection timed out",
    reasonUnreachable: "The address is not reachable",

    testingTitle: (name: string) => `Connecting to ${name}…`,
    failedTitle: (name: string) => `Cannot switch to ${name}`,
    confirmTitle: (name: string) => `Switch to ${name}`,
    switchedTo: (name: string) => `Switched to ${name}`,
    adoptedWarn: (a: Adopted) => {
      const at = a.local_addr ? ` ${a.local_addr}` : "";
      const lead =
        a.count === 1
          ? `1 connected client still points to the local gateway${at}`
          : `${a.count} connected clients still point to the local gateway${at}`;
      if (!anyInWsl(a)) return `${lead}.`;
      const parts = a.places.map((p) => (p.distro === null ? `${p.count} on ${hereEn}` : `${p.count} in WSL · ${p.distro}`));
      return `${lead}: ${parts.join(", ")}.`;
    },
    /** 接在上一句（加粗的那一段）后面：开头的空格隔开两句 */
    adoptedWarnNext: (name: string) =>
      ` After the switch, the local gateway stops and their requests fail until the app switches back, or until they are pointed at ${name} on the Clients page.`,
    retarget: (name: string) => `Also point these clients at ${name}`,
    localStops: "The local core stops once in-progress requests finish",
    localKept: "; its config, keys and request history are kept.",
    remoteConfig: (name: string) =>
      `After the switch, the Upstreams, Routing, Keys and other pages show and change the config on ${name}.`,
    switchAction: "Switch",
    editConnection: "Edit connection",
    keyUnreadable: "The key saved on this computer could not be read. Enter it again by editing the connection.",
    gone: "This connection has been deleted.",

    cannotConnect: (name: string) => `Cannot connect to ${name}`,
    connectingTo: (name: string) => `Connecting to ${name}`,
    address: "Address",
    reason: "Reason",
    retry: "Retry",
    retryIn: (attempt: number, secs: number) => `Attempt ${attempt}, in ${secs} s`,
    retrying: (attempt: number) => `Attempt ${attempt}, connecting`,
    retryNow: "Retry now",
    switchToLocal: isMac ? "Switch to this Mac" : "Switch to this computer",
    autoResume: "Once the connection is restored, the app returns to the page that was open.",
    mismatchTitle: (name: string) => `The core on ${name} does not match this app`,
    server: "Server",
    appNeeds: "This app needs",
    runOnServer: (version: string) =>
      `The server needs core ${version}. Run this command on the server to install that version, whether the installed one is newer or older:`,
    reconnect: "Reconnect",

    configBroken: "The configuration file has an error; the gateway is not running",
    safeMode: "Safe mode",
    configBrokenLead:
      "Core cannot read its configuration file, so client requests are not forwarded. Fix the file or restore a working version from the backups to recover.",
    file: "File",
    location: "Location",
    lineAt: (line: number, stage: string) => `Line ${line} · ${stage} error`,
    stageOnly: (stage: string) => `${stage} error`,
    openConfigFile: "Open configuration file",
    restoreFromBackup: "Restore from backup…",
    configBrokenResume: "Once a corrected configuration is saved, the gateway resumes on its own.",
    configBrokenHeldTitle: "The configuration file has an error after the update",
    configBrokenHeld:
      "The new version cannot read the configuration file. The gateway runs with the configuration from before the update and keeps forwarding client requests; fix the file or restore a working version from the backups to switch to the new version.",
    configBrokenHeldResume: "Once a corrected configuration is saved, the new version takes over on its own.",

    lostBanner: (name: string, attempt: number) =>
      attempt > 0
        ? `Disconnected from ${name}. Reconnecting (attempt ${attempt}). The page shows the state before the disconnect and cannot be changed for now.`
        : `Disconnected from ${name}. Reconnecting. The page shows the state before the disconnect and cannot be changed for now.`,

    pickTitle: "Choose a connection",
    pickOption: `${holdZh} was held at startup. Choose the core to connect to this time.`,
    pickUnfinished: "The last startup did not finish. Choose the core to connect to this time.",
    lastUsed: "Last used",
    connect: "Connect",
  },
  {
    "zh-Hant": {
      local: ("本機"),
      localNote: (dir: string) => `${dir} · 內建，不可刪除`,
      switcherTip: "切換連線",
      menuTitle: "連線",
      addRemote: "新增遠端連線…",
      manage: "管理連線…",
      connected: "已連線",
      connecting: "正在連線",
      unlinked: "未連線",
      title: "連線",
      add: "新增遠端連線",
      intro: isMac
        ? "應用同一時間連線一個 core。連線到遠端 core 時，本機 core 停止執行，本機資料保留。"
        : "應用同一時間連線一個 core。連線到遠端 core 時，本機的 core 停止執行，本機資料保留。",
      current: "當前",
      switchTo: "切換到此連線",
      switchShort: "切換",
      lastConnected: (when: string) => `上次連線 ${when}`,
      neverConnected: "尚未連線",
      startupLabel: "啟動時連線",
      startupLast: "上次使用的連線",
      startupLocal: ("本機"),
      startupHint: isLinux
        ? "連續兩次啟動未能完成時，下次啟動先顯示連線選擇。"
        : `按住 ${holdZh} 鍵啟動應用時，先顯示連線選擇。`,
      deleteTitle: (name: string) => `刪除連線「${name}」`,
      deleteBody: "儲存在本機的金鑰一併刪除。伺服器上的 core 不受影響。",
      addTitle: "新增遠端連線",
      editTitle: "編輯連線",
      dialogDesc: "連線到執行在另一臺機器上的 ThinkWatch core。",
      name: "名稱",
      hostHint: "主機名或 IP 地址。",
      port: "控制埠",
      portHint: (code: Code) => <>伺服器配置中 {code("listen.control.remote.port")} 的值。</>,
      key: "金鑰",
      keyHint: (code: Code) => (<>
        在伺服器上執行 {code("twcore control-key")} 獲取。僅儲存在本機，只有當前使用者可以讀取。
       </>),
      test: "測試連線",
      testOk: (version: string, gateway: string | null) => `連線成功 · core ${version}${gateway ? ` · 閘道器 ${gateway}` : ""}`,
      saveAndSwitch: "儲存並切換",
      enterName: "填寫名稱",
      nameTaken: "已有同名的連線",
      enterHost: "填寫地址",
      badHost: "地址格式不正確",
      badPort: "埠應為 1–65535 之間的整數",
      enterKey: "填寫金鑰",
      badKey: "金鑰應為 64 位十六進位制字元",
      unreachable: (addr: string) => `無法連線到 ${addr}`,
      unreachableNext: (code: Code) => (<>檢查地址和埠，以及伺服器配置中 {code("listen.control.remote")} 是否已啟用。</>),
      timeoutNext: (code: Code) => (<>連線超時。檢查地址和埠，以及伺服器配置中 {code("listen.control.remote")} 是否已啟用。</>),
      closed: "連線被伺服器關閉",
      closedNext: (code: Code) => (<>本機地址可能不在伺服器配置 {code("listen.control.remote.allow_from")} 中。</>),
      wrongKey: "金鑰不正確",
      wrongKeyNext: (code: Code) => <>在伺服器上執行 {code("twcore control-key")} 檢視當前金鑰。</>,
      mismatch: (theirs: string, ours: string) => `版本不一致：伺服器 core ${theirs}，本應用需要 ${ours}`,
      mismatchNext: (code: Code, command: string) => (<>在伺服器上執行 {code(command)} 安裝本應用需要的版本，然後重新連線。</>),
      reasonTimeout: "連線超時",
      reasonUnreachable: "無法訪問該地址",
      testingTitle: (name: string) => `正在連線 ${name}…`,
      failedTitle: (name: string) => `無法切換到 ${name}`,
      confirmTitle: (name: string) => `切換到 ${name}`,
      switchedTo: (name: string) => `已切換到 ${name}`,
      adoptedWarn: (a: Adopted) => {
        const at = a.local_addr ? ` ${a.local_addr}` : "";
        if (!anyInWsl(a))
          return `已接管的 ${a.count} 個用戶端仍指向本機閘道器${at}。`;
        const parts = a.places.map((p) => `${p.distro === null ? (isMac ? "這臺 Mac" : "這臺電腦") : `WSL · ${p.distro}`} ${p.count} 個`);
        return `已接管的用戶端仍指向本機閘道器${at}：${parts.join("、")}。`;
      },
      adoptedWarnNext: (name: string) => `切換後本機閘道器停止，這些用戶端的請求會失敗，直到重新連線本機，或在用戶端頁將它們改為指向 ${name}。`,
      retarget: (name: string) => `同時將這些用戶端改為指向 ${name}`,
      localStops: "本機 core 將在在途請求結束後停止",
      localKept: "，本機的配置、金鑰和請求歷史保留。",
      remoteConfig: (name: string) => `切換後，上游、路由、金鑰等頁面顯示和修改的是 ${name} 上的配置。`,
      switchAction: "切換",
      editConnection: "編輯連線",
      keyUnreadable: "無法讀取儲存在本機的金鑰，請在編輯連線時重新填寫。",
      gone: "該連線已被刪除。",
      cannotConnect: (name: string) => `無法連線到 ${name}`,
      connectingTo: (name: string) => `正在連線 ${name}`,
      retry: "重試",
      retryIn: (attempt: number, secs: number) => `第 ${attempt} 次，${secs} 秒後`,
      retrying: (attempt: number) => `第 ${attempt} 次，正在連線`,
      retryNow: "立即重試",
      switchToLocal: "切換到本機",
      autoResume: "連線恢復後自動回到上次開啟的頁面。",
      mismatchTitle: (name: string) => `${name} 上的 core 版本與本應用不一致`,
      server: "伺服器",
      appNeeds: "本應用需要",
      runOnServer: (version: string) => `伺服器需要執行 core ${version}。在伺服器上執行以下命令安裝此版本，伺服器上現有的版本較新或較舊均適用：`,
      reconnect: "重新連線",
      configBroken: "配置檔案有誤，閘道器未啟動",
      configBrokenLead: "core 無法讀取配置檔案，用戶端的請求暫不轉發。修正配置檔案或從備份恢復可用的版本即可恢復轉發。",
      file: "檔案",
      lineAt: (line: number, stage: string) => `第 ${line} 行 · ${stage}錯誤`,
      stageOnly: (stage: string) => `${stage}錯誤`,
      openConfigFile: "開啟配置檔案",
      restoreFromBackup: "從備份恢復…",
      configBrokenResume: "儲存修正後的配置後，閘道器自動恢復。",
      configBrokenHeldTitle: "更新後的配置檔案有誤",
      configBrokenHeld: "新版本無法讀取配置檔案。閘道器暫按更新前的配置執行，用戶端的請求照常轉發；修正配置檔案或從備份恢復可用的版本後，自動切換到新版本。",
      configBrokenHeldResume: "儲存修正後的配置後，自動切換到新版本。",
      lostBanner: (name: string, attempt: number) => attempt > 0
        ? `與 ${name} 的連線已斷開，正在重連（第 ${attempt} 次）。頁面內容為斷開前的狀態，暫不可修改。`
        : `與 ${name} 的連線已斷開，正在重連。頁面內容為斷開前的狀態，暫不可修改。`,
      pickTitle: "選擇連線",
      pickOption: `按住 ${holdZh} 鍵啟動。選擇這次要連線的 core。`,
      pickUnfinished: "上次啟動未能完成。選擇這次要連線的 core。",
      connect: "連線",
    },
    ja: {
      local: isMac ? "この Mac" : "この端末",
      localNote: (dir: string) => `${dir} · 組み込みの接続（削除不可）`,
      localCore: "ローカル core",
      localStopped: "ローカル core · 停止中",
      switcherTip: "接続を切り替え",
      menuTitle: "接続",
      addRemote: "リモート接続を追加…",
      manage: "接続を管理…",
      connected: "接続済み",
      connecting: "接続中",
      unlinked: "未接続",
      title: "接続",
      add: "リモート接続を追加",
      intro: "同時に接続できる core は 1 つです。リモート core に接続している間はローカル core が停止します。ローカルのデータは保持されます。",
      current: "現在の接続",
      switchTo: "この接続に切り替え",
      switchShort: "切り替え",
      actionsFor: (name: string) => `「${name}」の操作`,
      lastConnected: (when: string) => `最終接続：${when}`,
      neverConnected: "接続履歴なし",
      coreVersion: (v: string) => `core ${v}`,
      startupLabel: "起動時の接続",
      startupLast: "最後に使った接続",
      startupLocal: isMac ? "この Mac" : "この端末",
      startupHint: isLinux
        ? "起動に 2 回続けて失敗すると、次回の起動時に接続の選択画面が表示されます。"
        : `${holdZh} キーを押しながらアプリを開くと、接続を選択できます。`,
      deleteTitle: (name: string) => `接続「${name}」を削除`,
      deleteBody: "この端末に保存したキーも削除します。サーバー上の core には影響しません。",
      addTitle: "リモート接続を追加",
      editTitle: "接続を編集",
      dialogDesc: "別の端末で実行中の ThinkWatch core に接続します。",
      name: "名前",
      namePlaceholder: "例：home-server",
      host: "アドレス",
      hostHint: "ホスト名または IP アドレス。",
      port: "制御ポート",
      portHint: (code: Code) => <>サーバーの設定にある {code("listen.control.remote.port")} の値です。</>,
      key: "制御キー",
      keyHint: (code: Code) => <>サーバーで {code("twcore control-key")} を実行して取得します。この端末に保存され、現在のユーザーだけが読み取れます。</>,
      test: "接続をテスト",
      testOk: (version: string, gateway: string | null) => `接続成功 · core ${version}${gateway ? ` · ゲートウェイ ${gateway}` : ""}`,
      saveAndSwitch: "保存して切り替え",
      enterName: "名前を入力してください",
      nameTaken: "同じ名前の接続がすでにあります",
      enterHost: "アドレスを入力してください",
      badHost: "アドレスが無効です",
      badPort: "ポートには 1〜65535 の整数を入力してください",
      enterKey: "キーを入力してください",
      badKey: "キーは 64 桁の16進数で入力してください",
      unreachable: (addr: string) => `${addr} に接続できません`,
      unreachableNext: (code: Code) => <>アドレスとポート、およびサーバーの設定で {code("listen.control.remote")} が有効か確認してください。</>,
      timeoutNext: (code: Code) => <>接続がタイムアウトしました。アドレスとポート、およびサーバーの設定で {code("listen.control.remote")} が有効か確認してください。</>,
      closed: "サーバーが接続を閉じました",
      closedNext: (code: Code) => <>サーバーの設定の {code("listen.control.remote.allow_from")} に、この端末のアドレスが登録されているか確認してください。</>,
      wrongKey: "キーが正しくありません",
      wrongKeyNext: (code: Code) => <>サーバーで {code("twcore control-key")} を実行して現在のキーを確認してください。</>,
      mismatch: (theirs: string, ours: string) => `バージョンが一致しません。サーバーは core ${theirs}、このアプリには ${ours} が必要です。`,
      mismatchNext: (code: Code, command: string) => <>サーバーで {code(command)} を実行して必要なバージョンをインストールし、再接続してください。</>,
      reasonTimeout: "接続がタイムアウトしました",
      reasonUnreachable: "アドレスに到達できません",
      testingTitle: (name: string) => `${name} に接続中…`,
      failedTitle: (name: string) => `${name} に切り替えられませんでした`,
      confirmTitle: (name: string) => `${name} に切り替え`,
      switchedTo: (name: string) => `${name} に切り替えました`,
      adoptedWarn: (a: Adopted) => {
        const at = a.local_addr ? ` ${a.local_addr}` : "";
        const lead = `${a.count} 件のクライアントは引き続きローカルゲートウェイ${at}を参照しています`;
        if (!anyInWsl(a))
          return `${lead}。`;
        const parts = a.places.map((p) => `${p.distro === null ? "この端末" : `WSL · ${p.distro}`}：${p.count} 件`);
        return `${lead}（${parts.join("、")}）。`;
      },
      adoptedWarnNext: (name: string) => `切り替えるとローカルゲートウェイが停止します。ローカルに戻すか、クライアントページで接続先を ${name} に変えるまで、これらのリクエストは失敗します。`,
      retarget: (name: string) => `これらのクライアントの接続先も ${name} に変更する`,
      localStops: "処理中のリクエストが完了するとローカル core が停止します",
      localKept: "。ローカルの設定、キー、リクエスト履歴は保持されます。",
      remoteConfig: (name: string) => `切り替え後は、アップストリーム、ルーティング、キーなどのページで ${name} の設定を表示・変更します。`,
      switchAction: "切り替え",
      editConnection: "接続を編集",
      keyUnreadable: "この端末に保存されたキーを読み取れませんでした。接続を編集して再入力してください。",
      gone: "この接続は削除されました。",
      cannotConnect: (name: string) => `${name} に接続できません`,
      connectingTo: (name: string) => `${name} に接続しています`,
      address: "アドレス",
      reason: "原因",
      retry: "再試行",
      retryIn: (attempt: number, secs: number) => `${secs} 秒後に再試行（${attempt} 回目）`,
      retrying: (attempt: number) => `接続中（${attempt} 回目）`,
      retryNow: "今すぐ再試行",
      switchToLocal: "ローカルに切り替え",
      autoResume: "接続が復旧すると、開いていたページに戻ります。",
      mismatchTitle: (name: string) => `${name} の core のバージョンがこのアプリと一致しません`,
      server: "サーバー",
      appNeeds: "アプリが必要とするバージョン",
      runOnServer: (version: string) => `サーバーには core ${version} が必要です。現在のバージョンにかかわらず、サーバーで次のコマンドを実行してインストールしてください。`,
      reconnect: "再接続",
      configBroken: "設定ファイルにエラーがあり、ゲートウェイが停止しています",
      safeMode: "セーフモード",
      configBrokenLead: "core が設定ファイルを読み取れないため、リクエストを転送していません。設定を修正するか、正常なバックアップを復元してください。",
      file: "ファイル",
      location: "場所",
      lineAt: (line: number, stage: string) => `${line} 行目 · ${stage}エラー`,
      stageOnly: (stage: string) => `${stage}エラー`,
      openConfigFile: "設定ファイルを開く",
      restoreFromBackup: "バックアップから復元…",
      configBrokenResume: "修正した設定を保存すると、ゲートウェイが自動的に再開します。",
      configBrokenHeldTitle: "更新後の設定ファイルにエラーがあります",
      configBrokenHeld: "新しいバージョンで設定ファイルを読み取れません。更新前の設定で転送を続けています。設定を修正するか、正常なバックアップを復元すると新しいバージョンに切り替わります。",
      configBrokenHeldResume: "修正した設定を保存すると、新しいバージョンに自動で切り替わります。",
      lostBanner: (name: string, attempt: number) => `${name} との接続が切断されました。再接続中${attempt > 0 ? `（${attempt} 回目）` : ""}。復旧するまでは切断前のデータを表示し、変更はできません。`,
      pickTitle: "接続を選択",
      pickOption: `起動時に ${holdZh} キーが押されました。接続する core を選んでください。`,
      pickUnfinished: "前回の起動が完了しませんでした。接続する core を選んでください。",
      lastUsed: "最後に使用",
      connect: "接続",
    },
    ko: {
      local: (isMac ? "이 Mac" : "이 컴퓨터"),
      localNote: (dir: string) => `${dir} · 기본 연결(삭제할 수 없음)`,
      localCore: "로컬 core",
      localStopped: "로컬 core · 중지됨",
      switcherTip: "연결 전환",
      menuTitle: "연결",
      addRemote: "원격 연결 추가…",
      manage: "연결 관리…",
      connected: "연결됨",
      connecting: "연결 중",
      unlinked: "연결 안 됨",
      title: "연결",
      add: "원격 연결 추가",
      current: "현재",
      switchTo: "이 연결로 전환",
      switchShort: "전환",
      actionsFor: (name: string) => `「${name}」 작업`,
      lastConnected: (when: string) => `마지막 연결: ${when}`,
      neverConnected: "연결 기록 없음",
      startupLabel: "시작 시 연결",
      startupLast: "마지막으로 사용한 연결",
      startupLocal: (isMac ? "이 Mac" : "이 컴퓨터"),
      startupHint: isLinux
        ? "두 번 연속 시작에 실패하면 다음 실행 시 연결 선택 화면이 열립니다."
        : `앱을 열 때 ${holdZh} 키를 누르고 있으면 연결을 먼저 선택할 수 있습니다.`,
      deleteTitle: (name: string) => `연결 「${name}」 삭제`,
      deleteBody: "이 컴퓨터에 저장된 키도 삭제됩니다. 서버의 core에는 영향이 없습니다.",
      addTitle: "원격 연결 추가",
      editTitle: "연결 편집",
      dialogDesc: "다른 컴퓨터에서 실행 중인 ThinkWatch core에 연결합니다.",
      name: "이름",
      namePlaceholder: "예: home-server",
      host: "주소",
      hostHint: "호스트 이름 또는 IP 주소.",
      port: "제어 포트",
      key: "키",
      test: "연결 테스트",
      saveAndSwitch: "저장 후 전환",
      enterName: "이름을 입력하세요.",
      nameTaken: "같은 이름의 연결이 이미 있습니다.",
      enterHost: "주소를 입력하세요.",
      badHost: "주소가 올바르지 않습니다.",
      badPort: "포트는 1~65535 사이의 정수여야 합니다.",
      enterKey: "키를 입력하세요.",
      badKey: "키는 16진수 64자리여야 합니다.",
      unreachable: (addr: string) => `${addr}에 연결할 수 없습니다.`,
      closed: "서버가 연결을 끊었습니다.",
      wrongKey: "키가 올바르지 않습니다.",
      reasonTimeout: "연결 시간이 초과되었습니다.",
      reasonUnreachable: "주소에 연결할 수 없습니다.",
      testingTitle: (name: string) => `${name}에 연결 중…`,
      failedTitle: (name: string) => `${name}(으)로 전환할 수 없습니다.`,
      confirmTitle: (name: string) => `${name}(으)로 전환`,
      switchedTo: (name: string) => `${name}(으)로 전환했습니다.`,
      switchAction: "전환",
      editConnection: "연결 편집",
      gone: "삭제된 연결입니다.",
      cannotConnect: (name: string) => `${name}에 연결할 수 없습니다.`,
      address: "주소",
      reason: "원인",
      retry: "다시 시도",
      retryNow: "지금 다시 시도",
      server: "서버",
      reconnect: "다시 연결",
      safeMode: "안전 모드",
      file: "파일",
      location: "위치",
      openConfigFile: "설정 파일 열기",
      restoreFromBackup: "백업에서 복원…",
      pickTitle: "연결 선택",
      lastUsed: "최근 사용",
      connect: "연결",
      intro: "앱은 한 번에 core 하나에 연결합니다. 원격 core에 연결하면 이 컴퓨터의 core가 중지됩니다. 로컬 데이터는 유지됩니다.",
      portHint: (code: Code) => <>서버 설정의 {code("listen.control.remote.port")} 값입니다.</>,
      keyHint: (code: Code) => <>서버에서 {code("twcore control-key")} 명령을 실행하면 키를 확인할 수 있습니다. 키는 이 컴퓨터에만 저장되며 현재 사용자만 읽을 수 있습니다.</>,
      testOk: (version: string, gateway: string | null) => `연결 성공 · core ${version}${gateway ? ` · 게이트웨이 ${gateway}` : ""}`,
      unreachableNext: (code: Code) => <>주소와 포트가 맞는지, 서버 설정의 {code("listen.control.remote")}이(가) 켜져 있는지 확인하세요.</>,
      timeoutNext: (code: Code) => <>연결 시간이 초과되었습니다. 주소와 포트가 맞는지, 서버 설정의 {code("listen.control.remote")}이(가) 켜져 있는지 확인하세요.</>,
      closedNext: (code: Code) => <>서버 설정의 {code("listen.control.remote.allow_from")}에 이 컴퓨터의 주소가 들어 있는지 확인하세요.</>,
      wrongKeyNext: (code: Code) => <>서버에서 {code("twcore control-key")} 명령으로 현재 키를 확인하세요.</>,
      mismatch: (theirs: string, ours: string) => `버전이 일치하지 않습니다. 서버는 core ${theirs}을(를) 실행 중이며, 앱에는 ${ours}이(가) 필요합니다.`,
      mismatchNext: (code: Code, command: string) => <>서버에서 {code(command)} 명령으로 필요한 버전을 설치한 후 다시 연결하세요.</>,
      adoptedWarn: (a: Adopted) => {
        const at = a.local_addr ? ` ${a.local_addr}` : "";
        const lead = `연결된 클라이언트 ${a.count}개가 여전히 로컬 게이트웨이${at}을(를) 사용합니다`;
        if (!anyInWsl(a)) return `${lead}.`;
        const places = a.places.map((p) => `${p.distro === null ? "이 컴퓨터" : `WSL · ${p.distro}`}: ${p.count}개`);
        return `${lead}(${places.join(", ")}).`;
      },
      adoptedWarnNext: (name: string) => ` 전환하면 로컬 게이트웨이가 중지됩니다. 로컬로 돌아오거나 클라이언트 페이지에서 ${name}(으)로 설정하기 전까지 이 클라이언트의 요청은 실패합니다.`,
      retarget: (name: string) => `이 클라이언트의 연결 대상도 ${name}(으)로 변경`,
      localStops: "진행 중인 요청을 처리한 뒤 로컬 core가 중지됩니다",
      localKept: ". 설정, 키 및 요청 기록은 유지됩니다.",
      remoteConfig: (name: string) => `전환 후에는 업스트림, 라우팅, 키 등의 페이지에서 ${name}의 설정을 확인하고 변경할 수 있습니다.`,
      keyUnreadable: "이 컴퓨터에 저장된 키를 읽을 수 없습니다. 연결을 편집하여 키를 다시 입력하세요.",
      connectingTo: (name: string) => `${name}에 연결 중`,
      retryIn: (attempt: number, secs: number) => `${secs}초 후 다시 시도(${attempt}번째)`,
      retrying: (attempt: number) => `연결 중(${attempt}번째 시도)`,
      switchToLocal: isMac ? "이 Mac으로 전환" : "이 컴퓨터로 전환",
      autoResume: "연결이 복구되면 현재 열려 있던 페이지로 돌아갑니다.",
      mismatchTitle: (name: string) => `${name}의 core 버전이 앱과 일치하지 않습니다`,
      appNeeds: "앱에 필요한 버전",
      runOnServer: (version: string) => `서버에 core ${version}이(가) 필요합니다. 현재 버전과 관계없이 서버에서 다음 명령을 실행하세요.`,
      configBroken: "설정 파일 오류로 게이트웨이가 중지되었습니다",
      configBrokenLead: "core가 설정 파일을 읽을 수 없어 클라이언트 요청을 전달하지 않습니다. 설정을 수정하거나 정상적인 백업을 복원하세요.",
      lineAt: (line: number, stage: string) => `${line}번째 줄 · ${stage} 오류`,
      stageOnly: (stage: string) => `${stage} 오류`,
      configBrokenResume: "수정한 설정을 저장하면 게이트웨이가 자동으로 다시 작동합니다.",
      configBrokenHeldTitle: "업데이트 후 설정 파일에 오류가 있습니다",
      configBrokenHeld: "새 버전이 설정 파일을 읽을 수 없습니다. 업데이트 이전 설정으로 요청을 계속 전달합니다. 설정을 수정하거나 정상적인 백업을 복원하면 새 버전으로 전환됩니다.",
      configBrokenHeldResume: "수정한 설정을 저장하면 새 버전으로 자동 전환합니다.",
      lostBanner: (name: string, attempt: number) => `${name} 연결이 끊겼습니다. 다시 연결 중${attempt > 0 ? `(${attempt}번째 시도)` : ""}입니다. 연결이 복구될 때까지 이전 상태를 표시하며 변경할 수 없습니다.`,
      pickOption: `시작할 때 ${holdZh} 키를 눌렀습니다. 연결할 core를 선택하세요.`,
      pickUnfinished: "지난 번 실행이 완료되지 않았습니다. 연결할 core를 선택하세요.",
    },
    es: {
      local: (isMac ? "Este Mac" : "Este equipo"),
      localNote: (dir: string) => `${dir} · Conexión integrada, no se puede eliminar`,
      localCore: "Core local",
      localStopped: "Core local · Detenido",
      switcherTip: "Cambiar de conexión",
      menuTitle: "Conexión",
      addRemote: "Añadir conexión remota…",
      manage: "Gestionar conexiones…",
      connected: "Conectado",
      connecting: "Conectando",
      unlinked: "Sin conexión",
      title: "Conexión",
      add: "Añadir conexión remota",
      intro: isMac
        ? "La aplicación se conecta a un núcleo a la vez. Mientras que está conectado a un centro remoto, el núcleo en este Mac deja de funcionar; sus datos se mantienen."
        : "La aplicación se conecta a un núcleo a la vez. Si bien está conectada a un centro remoto, el núcleo de este equipo deja de funcionar; sus datos se mantienen.",
      current: "Actual",
      switchTo: "Cambiar a esta conexión",
      switchShort: "Cambiar",
      actionsFor: (name: string) => `Acciones para «${name}»`,
      lastConnected: (when: string) => `Última conexión: ${when}`,
      neverConnected: "Sin conexiones anteriores",
      coreVersion: (v: string) => `Núcleo ${v}`,
      startupLabel: "Conexión al iniciar",
      startupLast: "Última conexión utilizada",
      startupLocal: (isMac ? "Este Mac" : "Este equipo"),
      startupHint: isLinux
        ? "Si el inicio falla dos veces seguidas, la próxima vez se mostrará el selector de conexión."
        : `Mantén pulsada la tecla ${(isMac ? "Opción" : "Alt")} al abrir la aplicación para elegir una conexión.`,
      deleteTitle: (name: string) => `Eliminar la conexión «${name}»`,
      deleteBody: "También se elimina la clave guardada en este equipo. El core del servidor sigue funcionando.",
      addTitle: "Añadir conexión remota",
      editTitle: "Editar conexión",
      dialogDesc: "Conéctate a un core de ThinkWatch en otro equipo.",
      name: "Nombre",
      namePlaceholder: "p. ej., home-server",
      host: "Dirección",
      hostHint: "Nombre del equipo o dirección IP.",
      port: "Puerto de control",
      portHint: (code: Code) => <>El valor de {code("listen.control.remote.port")} en la configuración del servidor.</>,
      key: "Clave",
      keyHint: (code: Code) => (<>
        Corre {code("twcore control-key")} en el servidor para conseguirlo. Guardado sólo en este equipo, legible por el usuario actual solo.
       </>),
      test: "Probar conexión",
      testOk: (version: string, gateway: string | null) => `· núcleo conectado ${version}${gateway ? ` · puerta de entrada ${gateway}` : ""}`,
      saveAndSwitch: "Guardar y cambiar",
      enterName: "Introduce un nombre.",
      nameTaken: "Ya existe una conexión con ese nombre.",
      enterHost: "Introduce una dirección.",
      badHost: "La dirección no es válida.",
      badPort: "El puerto debe ser un entero entre 1 y 65535.",
      enterKey: "Introduce la clave.",
      badKey: "La clave debe tener 64 caracteres hexadecimales.",
      unreachable: (addr: string) => `No se puede conectar con ${addr}.`,
      unreachableNext: (code: Code) => (<>Compruebe la dirección y el puerto, y si {code("listen.control.remote")} está activado en la configuración del servidor.</>),
      timeoutNext: (code: Code) => (<>
        El tiempo de conexión se ha agotado. Compruebe la dirección y el puerto, y si {code("listen.control.remote")} is
        enabled in the server's config.
       </>),
      closed: "El servidor cerró la conexión.",
      closedNext: (code: Code) => (<>La dirección de esta computadora puede faltar de {code("listen.control.remote.allow_from")} en la configuración del servidor.</>),
      wrongKey: "La clave no es correcta.",
      wrongKeyNext: (code: Code) => <>Corre {code("twcore control-key")} en el servidor para ver la clave actual.</>,
      mismatch: (theirs: string, ours: string) => `Desajuste de versiones: el servidor ejecuta el núcleo ${theirs}; esta aplicación necesita ${ours}`,
      mismatchNext: (code: Code, command: string) => (<>Corre {code(command)} en el servidor para instalar la versión que necesita esta aplicación, luego vuelva a conectarse.</>),
      reasonTimeout: "Se agotó el tiempo de conexión.",
      reasonUnreachable: "No se puede acceder a la dirección.",
      testingTitle: (name: string) => `Conectando con ${name}…`,
      failedTitle: (name: string) => `No se puede cambiar a ${name}.`,
      confirmTitle: (name: string) => `Cambiar a ${name}`,
      switchedTo: (name: string) => `Se cambió a ${name}.`,
      adoptedWarn: (a: Adopted) => {
        const at = a.local_addr ? ` ${a.local_addr}` : "";
        const lead = a.count === 1
          ? `1 cliente conectado sigue apuntando a la puerta de enlace local${at}`
          : `${a.count} Los clientes conectados todavía apuntan a la puerta de enlace local${at}`;
        if (!anyInWsl(a))
          return `${lead}.`;
        const parts = a.places.map((p) => (p.distro === null ? `${p.count} el ${(isMac ? "este Mac" : "esta computadora")}` : `${p.count} en WSL · ${p.distro}`));
        return `${lead}: ${parts.join(", ")}.`;
      },
      adoptedWarnNext: (name: string) => ` Después del interruptor, la puerta de enlace local se detiene y sus solicitudes fallan hasta que la aplicación se desplace hacia atrás, o hasta que se apunten a ${name} en la página Clientes.`,
      retarget: (name: string) => `También señale a estos clientes en ${name}`,
      localStops: "El núcleo local se detiene una vez finalizadas las solicitudes en curso",
      localKept: "; su configuración, claves e historial de peticiones se mantienen.",
      remoteConfig: (name: string) => `Después del conmutador, los Upstreams, Routing, Keys y otras páginas muestran y cambian la configuración en ${name}.`,
      switchAction: "Cambiar",
      editConnection: "Editar conexión",
      keyUnreadable: "La clave guardada en este equipo no se pudo leer. Ingrese de nuevo editando la conexión.",
      gone: "Se eliminó esta conexión.",
      cannotConnect: (name: string) => `No se puede conectar con ${name}.`,
      connectingTo: (name: string) => `Conectando a ${name}`,
      address: "Dirección",
      reason: "Motivo",
      retry: "Reintentar",
      retryIn: (attempt: number, secs: number) => `Intento ${attempt}, en ${secs} s`,
      retrying: (attempt: number) => `Intento ${attempt}, conexión`,
      retryNow: "Reintentar ahora",
      switchToLocal: isMac ? "Cambiar a este Mac" : "Cambiar a este ordenador",
      autoResume: "Una vez restaurada la conexión, la aplicación vuelve a la página que estaba abierta.",
      mismatchTitle: (name: string) => `El núcleo en ${name} no coincide con esta aplicación`,
      server: "Servidor",
      appNeeds: "Esta aplicación necesita",
      runOnServer: (version: string) => `El servidor necesita núcleo ${version}. Ejecute este comando en el servidor para instalar esa versión, ya sea que el instalado sea más nuevo o más antiguo:`,
      reconnect: "Volver a conectar",
      configBroken: "El archivo de configuraciónuración tiene un error; la puerta de enlace no se está ejecutando",
      safeMode: "Modo seguro",
      configBrokenLead: "Core no puede leer su archivo de configuraciónuración, por lo que las solicitudes del cliente no se reenvían. Corrija el archivo o restaurar una versión de trabajo de las copias de seguridad para recuperar.",
      file: "Archivo",
      location: "Ubicación",
      lineAt: (line: number, stage: string) => `Error en la línea ${line} · ${stage}`,
      stageOnly: (stage: string) => `Error ${stage}`,
      openConfigFile: "Abrir archivo de configuración",
      restoreFromBackup: "Restaurar desde una copia…",
      configBrokenResume: "Una vez que se guarda una configuración corregida, la puerta de enlace se reanuda por sí sola.",
      configBrokenHeldTitle: "El archivo de configuraciónuración tiene un error después de la actualización",
      configBrokenHeld: "La nueva versión no puede leer el archivo de configuraciónuración. La puerta de enlace se ejecuta con la configuración de antes de la actualización y sigue reenviando peticiones del cliente; arreglar el archivo o restaurar una versión de trabajo de las copias de seguridad para cambiar a la nueva versión.",
      configBrokenHeldResume: "Una vez que se guarda una configuración corregida, la nueva versión se hace cargo por sí sola.",
      lostBanner: (name: string, attempt: number) => attempt > 0
        ? `Desconectado de ${name}. Reconectar (intento ${attempt}). La página muestra el estado anterior a la desconexión y no se puede cambiar por ahora.`
        : `Desconectado de ${name}. Reconectar. La página muestra el estado antes de la desconexión y no se puede cambiar por ahora.`,
      pickTitle: "Elegir una conexión",
      pickOption: `${(isMac ? "Opción" : "Alt")} se celebró en el inicio. Elija el núcleo para conectarse a esta vez.`,
      pickUnfinished: "La última startup no terminó. Elija el núcleo para conectarse a esta vez.",
      lastUsed: "Última usada",
      connect: "Conectar",
    },
  },
);
