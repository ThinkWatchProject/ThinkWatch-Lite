/**
 * 新建、编辑别名的对话框里那份草稿怎么变。和画面分开，好测。
 *
 * **名称恰好是上游的模型名时，自动列成第一个上游模型**（`auto`）：起一个和真模型同名的
 * 别名，通常是想把这个模型在其他上游的名称收到一起。只在列表还空着时这样做；名称再改，
 * 自动列进来的那一个跟着撤掉；用户删了它，同一个名称就不再自动列；用户自己加了别的，
 * 它就不再算自动的。
 */
import type { Msg } from "@/types";

export interface Draft {
  name: string;
  models: string[];
  /** 自动列进来的那一个。用户动过列表就是 `null` */
  auto: string | null;
  /** 自动列进来、又被删掉的 */
  declined: string[];
}

export function draftOf(name: string, models: string[]): Draft {
  return { name, models, auto: null, declined: [] };
}

/** 改名称。`offered`：这个名称是不是某个上游的真模型。编辑时不自动列 */
export function withName(d: Draft, name: string, offered: (m: string) => boolean, creating: boolean): Draft {
  if (!creating) return { ...d, name };
  const n = name.trim();
  let models = d.models;
  let auto = d.auto;
  if (auto !== null && auto !== n) {
    models = models.filter((m) => m !== auto);
    auto = null;
  }
  if (n && auto === null && models.length === 0 && !d.declined.includes(n) && offered(n)) {
    models = [n];
    auto = n;
  }
  return { ...d, name, models, auto };
}

/** 加一个上游模型。空的、已经列着的不加 */
export function withModel(d: Draft, model: string): Draft {
  const m = model.trim();
  if (!m || d.models.includes(m)) return d;
  return { ...d, models: [...d.models, m], auto: null };
}

export function withoutModel(d: Draft, model: string): Draft {
  const models = d.models.filter((x) => x !== model);
  if (model !== d.auto) return { ...d, models };
  return { ...d, models, auto: null, declined: [...d.declined, model] };
}

/** 列表里只有自动列进来的那一个 */
export function onlyAuto(d: Draft): boolean {
  return d.auto !== null && d.models.length === 1 && d.models[0] === d.auto;
}

/**
 * 页脚已经说了缺什么（填写名称、添加上游模型），这两条 core 的问题不在名称下面用红字再说一遍
 * —— 而且一打开对话框就是一片红
 */
const SAID_IN_FOOTER = new Set(["config.alias_empty_name", "config.alias_no_models"]);
/** 别名只指向它自己（`x: x`）。名称自动列成第一个上游模型时，页脚说下一步，不用红字 */
export const ONLY_ITSELF = "config.alias_only_itself";

/** core 说的问题里，名称下面用红字列出的那些 */
export function shownProblems(problems: readonly Msg[], d: Draft): Msg[] {
  const auto = onlyAuto(d);
  return problems.filter((m) => !SAID_IN_FOOTER.has(m.code) && !(auto && m.code === ONLY_ITSELF));
}
