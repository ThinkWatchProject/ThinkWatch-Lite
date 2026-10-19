import { messages } from "@/i18n";

export const joinWizardText = messages(
  {
    title: "开启同步",
    steps: { location: "同步位置", encryption: "加密", merge: "合并" },
    stepOf: (n: number, name: string) => `${n} ${name}`,
    skipped: "不加密",
    locationDesc: "多台设备共用一份配置，并在同步位置保存最新与上一个版本。",
    test: "测试连接",
    testing: "正在连接同步位置",
    emptyOk: "可以读写。同步位置为空，将以本机配置开始同步。",
    existingOk: (n: number, encrypted: boolean) =>
      `可以读写。同步位置已有同步数据（${n > 0 ? `${n} 台设备，` : ""}${encrypted ? "已加密" : "未加密"}）。`,
    notWritable: "同步位置不可写入",
    testFailed: "无法连接同步位置",
    // 第 2 步：新建
    encrypt: "以同步口令加密",
    noEncrypt: "不加密",
    encryptDesc: "选择是否加密同步内容。同一同步位置上的所有设备采用同一设置。",
    encryptHint: "其他设备加入时输入同一口令。口令遗失且没有设备仍在同步时，同步数据无法解密。",
    plainTitle: "同步内容不加密",
    plainBody:
      "同步位置的服务商可读取配置与密钥，对同步位置有写入权限的任何人也可以改动配置。经同步新增或脚本有变化的插件在本设备为停用状态，须在本设备启用。",
    // 第 2 步：加入
    joinDesc: "同步位置已有同步数据，以同步口令加密。输入其他设备上设置的同步口令。",
    wrongPassphrase: "同步口令不正确。",
    devices: (list: string) => `已在同步的设备：${list}`,
    enterPassphrase: "输入同步口令。",
    deviceLine: (name: string, when: string) => `${name}（${when}）`,
    deviceSep: "、",
    // 第 3 步
    mergeDesc: "本机已有配置。以导入的规则合并同步数据，冲突项逐项选择处理方式。",
    mode: { merge: "合并", use_remote: "使用同步数据替换本机配置" },
    replaceNote: "本机当前配置保留在备份中。本机客户端正在使用的网关密钥并入同步数据。",
    noDifferences: "同步数据与本机配置一致。",
    // 按钮
    back: "上一步",
    next: "下一步",
    enable: "开启同步",
    join: "加入同步",
    unresolved: (n: number) => `尚有 ${n} 项冲突未选择处理方式。`,
    failed: "未能开启同步",
  },
  {
    title: "Turn on sync",
    steps: { location: "Location", encryption: "Encryption", merge: "Merge" },
    stepOf: (n: number, name: string) => `${n} ${name}`,
    skipped: "Not encrypted",
    locationDesc: "Devices share one configuration; the sync location keeps the latest and the previous version.",
    test: "Test connection",
    testing: "Connecting to the sync location",
    emptyOk: "Readable and writable. The sync location is empty; syncing starts from this device's configuration.",
    existingOk: (n: number, encrypted: boolean) =>
      `Readable and writable. The sync location already holds sync data (${n > 0 ? `${n === 1 ? "1 device" : `${n} devices`}, ` : ""}${encrypted ? "encrypted" : "not encrypted"}).`,
    notWritable: "The sync location is not writable",
    testFailed: "The sync location cannot be reached",
    encrypt: "Encrypt with a passphrase",
    noEncrypt: "Do not encrypt",
    encryptDesc: "Choose whether synced content is encrypted. All devices on a sync location use the same setting.",
    encryptHint:
      "Other devices enter the same passphrase when they join. If the passphrase is lost and no device is still syncing, the sync data cannot be decrypted.",
    plainTitle: "Synced content is not encrypted",
    plainBody:
      "The storage provider can read the configuration and its keys, and anyone who can write to the sync location can change the configuration. Plugins that arrive or change their script through sync stay off on this device until turned on here.",
    joinDesc: "The sync location already holds sync data encrypted with a sync passphrase. Enter the passphrase set on the other devices.",
    wrongPassphrase: "The sync passphrase is not correct.",
    devices: (list: string) => `Devices already syncing: ${list}`,
    enterPassphrase: "Enter the sync passphrase.",
    deviceLine: (name: string, when: string) => `${name} (${when})`,
    deviceSep: ", ",
    mergeDesc: "This device already has a configuration. The sync data is merged with the import rules; choose what to do with each conflict.",
    mode: { merge: "Merge", use_remote: "Replace this device's configuration with the sync data" },
    replaceNote:
      "The current configuration stays in the backups. Gateway keys used by clients on this device are added to the sync data.",
    noDifferences: "The sync data matches this device's configuration.",
    back: "Back",
    next: "Next",
    enable: "Turn on sync",
    join: "Join sync",
    unresolved: (n: number) => (n === 1 ? "1 conflict has no choice yet." : `${n} conflicts have no choice yet.`),
    failed: "Sync could not be turned on",
  },
);
