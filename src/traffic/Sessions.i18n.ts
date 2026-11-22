import { messages } from "@/i18n";

/**
 * 会话那一侧的文案：归组表的组头、会话详情。
 *
 * 费用那一格的说明和概览页说的是同一批事（估算、无法计价、无用量），
 * 措辞跟着 `Dashboard.i18n.ts` 走 —— 同一件事在两页上不该有两种说法。
 * 区别只在量词：概览按请求数，这里按轮次。缓存的两个词（缓存读取、新输入）
 * 也和概览的缓存构成条一样。
 */
export const sessionsText = messages(
  {
    // 组头
    expandSession: "展开此会话",
    collapseSession: "收起此会话",
    turnCount: (n: number) => `${n} 轮`,
    /** 组头上 token 那一格的悬停说明 */
    peakContext: "上下文峰值",
    /** 组头上失败数的悬停说明。格子里只有红点和数字 */
    failedTip: (n: number) => `此会话中 ${n} 轮失败`,
    /** 正在进行的会话：开始时刻前那个跳动的点的悬停说明 */
    runningTip: (n: number) => `此会话中 ${n} 轮进行中`,
    sessionActions: "此会话的操作",
    openSession: "打开会话",
    copySessionId: "复制会话 ID",

    // 费用那一格。格子里只有一个数，合计缺了轮次时写成「≥」下限；
    // **估算、无法计价、无用量各说各的**，一句一段写在悬停里
    estimatedTip: (amount: string) =>
      `其中 ${amount} 为估算值：请求在响应结束前断开或中断，输出用量计至断开时；或模型的单价取自其他平台。`,
    unpriced: "无法计价",
    noPricedTurnsTip: "此会话中没有可计价的轮次",
    unpricedTurnsTip: (n: number) => `${n} 轮所用的模型未定价，费用未计入合计`,
    noUsageTurnsTip: (n: number) =>
      `${n} 轮没有用量数据：上游未报告，或连接在报告之前已结束。这些轮次的费用无法计算，未计入合计`,

    // 详情
    title: "会话",
    /** 详情的两个标签：几个总数和每轮的费用；按对话重放的每一轮 */
    tabSummary: "概况",
    tabConversation: "对话",
    /** `at` 是开始时刻写出来的样子 */
    startedAt: (at: string) => `${at} 开始`,
    turns: "轮次",
    duration: "时长",
    cost: "费用",
    failedTurns: "失败",
    loadFailed: "会话读取失败",
    /** 模型名之间的分隔符 */
    modelSep: "、",
    usage: (input: string, output: string, cacheRead: string) =>
      `输入 ${input} / 输出 ${output} · 缓存读取 ${cacheRead}`,

    growthTitle: "每轮输入 token",
    cacheReads: "缓存读取",
    uncachedInput: "新输入",
    peak: (v: string) => `峰值 ${v}`,
    /** 柱子的悬停说明 */
    growthBar: (turn: number, total: string, read: string, input: string) =>
      `第 ${turn} 轮 · ${total} token（缓存读取 ${read} · 新输入 ${input}）`,

    waterfallTitle: "每轮费用",
    /** 瀑布里单独一轮的标注 */
    turnFailed: "失败",
    turnCancelled: "已取消",
    turnRunning: "进行中",
  },
  {
    expandSession: "Expand this session",
    collapseSession: "Collapse this session",
    turnCount: (n: number) => (n === 1 ? "1 turn" : `${n} turns`),
    peakContext: "Peak context",
    failedTip: (n: number) =>
      n === 1 ? "1 turn in this session failed." : `${n} turns in this session failed.`,
    runningTip: (n: number) =>
      n === 1 ? "1 turn in this session is in progress." : `${n} turns in this session are in progress.`,
    sessionActions: "Actions for this session",
    openSession: "Open session",
    copySessionId: "Copy session ID",

    estimatedTip: (amount: string) =>
      `${amount} of this is estimated: requests disconnected or were interrupted before the response finished, and output usage is counted up to the disconnect; or the model's price was taken from another platform.`,
    unpriced: "Unpriced",
    noPricedTurnsTip: "No turn in this session could be priced.",
    unpricedTurnsTip: (n: number) =>
      n === 1
        ? "1 turn used a model with no price, so its cost is not included in the total."
        : `${n} turns used models with no price, so their cost is not included in the total.`,
    noUsageTurnsTip: (n: number) =>
      n === 1
        ? "1 turn has no usage data: the upstream did not report it, or the connection ended before it was reported. Its cost cannot be calculated and is not included in the total."
        : `${n} turns have no usage data: the upstream did not report it, or the connection ended before it was reported. Their cost cannot be calculated and is not included in the total.`,

    title: "Session",
    tabSummary: "Summary",
    tabConversation: "Conversation",
    startedAt: (at: string) => `Started ${at}`,
    turns: "Turns",
    duration: "Duration",
    cost: "Cost",
    failedTurns: "Failed",
    loadFailed: "Could not load the session",
    modelSep: ", ",
    usage: (input: string, output: string, cacheRead: string) =>
      `Input ${input} / Output ${output} · Cache reads ${cacheRead}`,

    growthTitle: "Input tokens per turn",
    cacheReads: "Cache reads",
    uncachedInput: "Uncached input",
    peak: (v: string) => `Peak ${v}`,
    growthBar: (turn: number, total: string, read: string, input: string) =>
      `Turn ${turn} · ${total} tokens (cache reads ${read} · uncached input ${input})`,

    waterfallTitle: "Cost per turn",
    turnFailed: "Failed",
    turnCancelled: "Canceled",
    turnRunning: "In progress",
  },
  {
    "zh-Hant": {
      expandSession: "展開此會話",
      collapseSession: "收起此會話",
      turnCount: (n: number) => `${n} 輪`,
      failedTip: (n: number) => `此會話中 ${n} 輪失敗`,
      runningTip: (n: number) => `此會話中 ${n} 輪進行中`,
      sessionActions: "此會話的操作",
      openSession: "開啟會話",
      copySessionId: "複製會話 ID",
      estimatedTip: (amount: string) => `其中 ${amount} 為估算值：請求在回應結束前斷開或中斷，輸出用量計至斷開時；或模型的單價取自其他平臺。`,
      unpriced: "無法計價",
      noPricedTurnsTip: "此會話中沒有可計價的輪次",
      unpricedTurnsTip: (n: number) => `${n} 輪所用的模型未定價，費用未計入合計`,
      noUsageTurnsTip: (n: number) => `${n} 輪沒有用量資料：上游未報告，或連線在報告之前已結束。這些輪次的費用無法計算，未計入合計`,
      title: "會話",
      tabSummary: "概況",
      tabConversation: "對話",
      startedAt: (at: string) => `${at} 開始`,
      turns: "輪次",
      duration: "時長",
      cost: "費用",
      failedTurns: "失敗",
      loadFailed: "會話讀取失敗",
      usage: (input: string, output: string, cacheRead: string) => `輸入 ${input} / 輸出 ${output} · 快取讀取 ${cacheRead}`,
      growthTitle: "每輪輸入 token",
      cacheReads: "快取讀取",
      uncachedInput: "新輸入",
      growthBar: (turn: number, total: string, read: string, input: string) => `第 ${turn} 輪 · ${total} token（快取讀取 ${read} · 新輸入 ${input}）`,
      waterfallTitle: "每輪費用",
      turnFailed: "失敗",
      turnRunning: "進行中",
    },
    ko: {
      cost: "비용",
      failedTurns: "실패",
      turnFailed: "실패",
      turnRunning: "진행 중",
    },
    es: {
      expandSession: "Ampliar este período de sesiones",
      collapseSession: "Contraer esta sesión",
      turnCount: (n: number) => (n === 1 ? "1 turno" : `${n} giros`),
      peakContext: "Contexto de pico",
      failedTip: (n: number) => n === 1 ? "1 turno en esta sesión falló." : `${n} los giros en esta sesión fallaron.`,
      runningTip: (n: number) => n === 1 ? "1 turn in this session is in progress." : `${n} giros en esta sesión están en curso.`,
      sessionActions: "Medidas para este período de sesiones",
      openSession: "Sesión abierta",
      copySessionId: "Copiar el ID de sesión",
      estimatedTip: (amount: string) => `${amount} de esto se estima: solicitudes desconectadas o fueron interrumpidas antes de que la respuesta terminara, y el uso de salida se cuenta hasta la desconexión; o el precio del modelo fue tomado de otra plataforma.`,
      unpriced: "Sin precio",
      noPricedTurnsTip: "Ninguna vuelta en esta sesión podría tener precio.",
      unpricedTurnsTip: (n: number) => n === 1
        ? "1 turno utilizado un modelo sin precio, por lo que su costo no está incluido en el total."
        : `${n} gira modelos usados sin precio, por lo que su costo no está incluido en el total.`,
      noUsageTurnsTip: (n: number) => n === 1
        ? "1 turn no tiene datos de uso: el upstream no lo reportó, o la conexión terminó antes de ser reportado. Su costo no puede ser calculado y no está incluido en el total."
        : `${n} los giros no tienen datos de uso: el upstream no lo reportó, o la conexión terminó antes de ser reportado. Su costo no puede ser calculado y no está incluido en el total.`,
      title: "Sesión",
      tabSummary: "Resumen",
      tabConversation: "Conversación",
      startedAt: (at: string) => `Iniciada ${at}`,
      turns: "Gira",
      duration: "Duración",
      cost: "Coste",
      failedTurns: "Error",
      loadFailed: "No se pudo cargar la sesión",
      usage: (input: string, output: string, cacheRead: string) => `Entrada ${input} / Salida ${output} · Caché lee ${cacheRead}`,
      growthTitle: "tokens de entrada por turno",
      cacheReads: "Caché lee",
      uncachedInput: "Entrada sin encallar",
      peak: (v: string) => `Pico ${v}`,
      growthBar: (turn: number, total: string, read: string, input: string) => `Gire ${turn} · ${total} tokens (la caché dice ${read} · entrada no caché ${input})`,
      waterfallTitle: "Costo por turno",
      turnFailed: "Error",
      turnCancelled: "Cancelado",
      turnRunning: "En curso",
    },
  },
);
