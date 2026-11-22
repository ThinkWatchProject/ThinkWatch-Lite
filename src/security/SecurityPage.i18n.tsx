import type { ReactNode } from "react";
import { messages } from "@/i18n";
import type { SecurityOutcome } from "@/types";

/** 英文句中的「Since 9/8」要小写开头 */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const securityPageText = messages(
  {
    /** 和源列表里那一项同一个词 */
    log: "日志",
    /** 页头上几项防护各处于哪种状态：「2 项开启」 */
    modes: {
      enforce: "项开启",
      observe: "项监控",
      off: "项关闭",
    },
    /**
     * 页头上日志那段时间里一共命中了几次。`count` 是条数（英文按它分单复数），
     * `n` 是画好的数字。自定义区间的名字本身是「9/8 至今」，不再加「内」
     */
    hits: (_count: number, n: ReactNode, range: string, custom: boolean) => (
      <>
        {custom ? range : `${range}内`} {n} 次命中
      </>
    ),
    /** 页头上各做了什么：「1 已切断」。和日志「处置」一栏同一组词 */
    outcomes: {
      cut: "已切断",
      blocked: "已拒绝",
      stripped: "已删除",
      replaced: "已替换",
      recorded: "仅记录",
    } satisfies Record<SecurityOutcome, string>,
    loadFailed: "安全设置读取失败",
    /** 撤销提示 */
    ruleOn: (name: string) => `已启用「${name}」`,
    ruleOff: (name: string) => `已停用「${name}」`,
    actionSet: (name: string, action: string) => `「${name}」的动作已改为「${action}」`,
    modeSet: (guard: string, mode: string) => `${guard}已切换为「${mode}」`,
    ruleCreated: (name: string) => `已创建规则「${name}」`,
  },
  {
    log: "Log",
    modes: {
      enforce: "on",
      observe: "monitoring",
      off: "off",
    },
    hits: (count: number, n: ReactNode, range: string, custom: boolean) => (
      <>
        {n} {count === 1 ? "match" : "matches"} {custom ? lower(range) : `in the last ${range}`}
      </>
    ),
    outcomes: {
      cut: "cut off",
      blocked: "refused",
      stripped: "deleted",
      replaced: "replaced",
      recorded: "recorded",
    },
    loadFailed: "The security settings could not be loaded",
    ruleOn: (name: string) => `“${name}” turned on`,
    ruleOff: (name: string) => `“${name}” turned off`,
    actionSet: (name: string, action: string) => `Action for “${name}” set to ${action}`,
    modeSet: (guard: string, mode: string) => `${guard} set to ${mode}`,
    ruleCreated: (name: string) => `Rule “${name}” created`,
  },
  {
    "zh-Hant": {
      log: "日誌",
      modes: {
        enforce: "項開啟",
        observe: "項監控",
        off: "項關閉",
      },
      hits: (_count: number, n: ReactNode, range: string, custom: boolean) => (<>
        {custom ? range : `${range}內`} {n} 次命中
       </>),
      outcomes: {
        cut: "已切斷",
        blocked: "已拒絕",
        stripped: "已刪除",
        replaced: "已替換",
        recorded: "僅記錄",
      } satisfies Record<SecurityOutcome, string>,
      loadFailed: "安全設定讀取失敗",
      ruleOn: (name: string) => `已啟用「${name}」`,
      actionSet: (name: string, action: string) => `「${name}」的動作已改為「${action}」`,
      modeSet: (guard: string, mode: string) => `${guard}已切換為「${mode}」`,
      ruleCreated: (name: string) => `已建立規則「${name}」`,
    },
    ja: {
      log: "ログ",
      modes: { enforce: "件有効", observe: "件監視中", off: "件無効" },
      hits: (_count: number, n: ReactNode, range: string, custom: boolean) => (<>{custom ? range : `過去 ${range}`} に {n} 件検出</>),
      outcomes: { cut: "切断", blocked: "拒否", stripped: "削除", replaced: "置換", recorded: "記録のみ" },
      loadFailed: "セキュリティ設定を読み込めませんでした",
      ruleOn: (name: string) => `「${name}」を有効にしました`,
      ruleOff: (name: string) => `「${name}」を無効にしました`,
      actionSet: (name: string, action: string) => `「${name}」の処理を「${action}」に設定しました`,
      modeSet: (guard: string, mode: string) => `${guard}を「${mode}」に設定しました`,
      ruleCreated: (name: string) => `ルール「${name}」を作成しました`,
    },
    es: {
      log: "Registro",
      modes: {
        enforce: "el",
        observe: "seguimiento",
        off: "apagado",
      },
      hits: (count: number, n: ReactNode, range: string, custom: boolean) => (<>
        {n} {count === 1 ? "igualar" : "coincidencias"} {custom ? lower(range) : `en el último ${range}`}
       </>),
      outcomes: {
        cut: "cortado",
        blocked: "denegada",
        stripped: "borrado",
        replaced: "sustituido",
        recorded: "registrados",
      },
      loadFailed: "La configuración de seguridad no se pudo cargar",
      ruleOn: (name: string) => `“${name}” activado`,
      ruleOff: (name: string) => `“${name}” apagado`,
      actionSet: (name: string, action: string) => `Acción «${name}» establecida en ${action}`,
      modeSet: (guard: string, mode: string) => `${guard} Se fija en ${mode}`,
      ruleCreated: (name: string) => `Regla “${name}” creada`,
    },
  },
);
