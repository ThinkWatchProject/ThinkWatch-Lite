/**
 * PROVISIONAL —— 插件的 JS 文件是唯一的真相（约定附录 4，core v0.59.0、协议 35）。
 *
 * **core 发版之前只能这样。**钉着的 core v0.58.0 生成的 `src/generated/tw-api.ts` 还是旧的
 * 样子：出错时怎么办、适用范围、设置的值存在配置里，由 `UpdatePlugin` 改。附录 4 之后它们
 * 都写在插件文件的 manifest 里（设置项的 `value` 取代了 `default`，多了 `on_error`），
 * 一个插件只有一种写法：把整份代码和开关交给 `SavePlugin`，core 自己分辨是只改了数据还是
 * 改了代码。界面其余的代码不知道这一层：`src/types.ts` 用这里的同名类型盖住生成的那几个
 * （显式转出优先于 `export type *`），`src/control.ts` 的端点表也从这里取。
 *
 * 和 v0.58.0 相比：
 *
 * - 新增 `SavePlugin`（`PUT /plugins/{id}`，网页可调）、`PluginRewrite`（`POST /plugins/rewrite`，
 *   网页可调，没有副作用：按表单的值改写代码里的 manifest）；
 * - 新增三个要在系统的确认框里点头之后才发的端点（**网页不可调**，只有 Rust 的命令发）：
 *   `CreatePluginConfirmed`、`SavePluginConfirmed`、`ApprovePluginFileConfirmed`；
 * - `CreatePlugin`、`ApprovePluginFile` 进了网页的白名单，`CreatePlugin` 只带代码、ID 和开关；
 * - 删掉 `UpdatePlugin`、`UpdatePluginConfirmed`、`ReplacePluginSource`。
 *
 * 约定没写死、这里先按最可能的样子写的（接上时以生成的为准）：
 *
 * - `PluginCreate` 只剩 `{ source, id, enabled, base_version }`（出错时、范围、设置都在代码里）；
 * - `SettingSpecView` 是 `{ key, kind, label, value }`；`PluginView` 不再有 `settings`
 *   （值在 `settings_schema[].value` 里）；`ManifestView` 多了 `on_error`；
 * - 插件文件在确认之后被改过（状态「文件已更改」）时，用确认过的代码拨开关（`SavePlugin`，
 *   代码和确认过的一样）**不动磁盘上那份**：界面的开关就是这么拨的。
 *
 * 接上正式版（core v0.59.0 发版、钉点升上去之后）：
 *
 * 1. 升级 core 钉点、`cargo update`，重新生成 `src/generated/tw-api.ts`
 *    （`UPDATE_TS=1 cargo test --manifest-path src-tauri/Cargo.toml --test ts_bindings`）；
 * 2. 删掉 `src/types.ts` 里标着「临时」的那一段转出；`src/control.ts` 的 `Endpoints`、
 *    `EndpointTable` 改回从 `./generated/tw-api` 取（`EndpointTable` 换回 `typeof ENDPOINTS`）；
 * 3. Rust 那边照 `src-tauri/src/plugins/wire.rs` 顶上的步骤换；
 * 4. core 新加的码（如 `gw.plugin.manifest_not_data`）补进 `src/i18n/core.zh.json`；
 * 5. 删掉这个文件，`pnpm typecheck`：名字或形状和这里不一样的地方会在用到它的那一处报错。
 */
import type * as G from "@/generated/tw-api";

// ─── 插件文件里的 manifest ───

/**
 * 插件声明的一个设置项。`label` 是**插件写的字**：界面当纯文本显示。`value` 是它现在的值，
 * **写在插件文件里**（取代了 `default`），和 `kind` 同一种类型
 */
export type SettingSpecView = { key: string; kind: G.SettingKind; label: string; value: G.SettingValue };

/** 插件文件里的 manifest。出错时怎么办（`on_error`）也写在里面，默认是拒绝 */
export type ManifestView = Omit<G.ManifestView, "settings_schema"> & {
  on_error: G.OnError;
  settings_schema: SettingSpecView[];
};

/** 读一份代码看到的东西。**什么都没留下** */
export type PluginInspection = Omit<G.PluginInspection, "manifest"> & { manifest: ManifestView | null };

/**
 * 一个装上了的插件（`GET /plugins`），按运行的顺序。`on_error`、`scope`、`settings_schema`
 * 都是从它的文件里读出来的
 */
export type PluginView = Omit<G.PluginView, "settings_schema" | "settings"> & { settings_schema: SettingSpecView[] };

// ─── 写 ───

/**
 * 装一个插件（`POST /plugins`，网页可调；改得了回答里工具调用的要点头，走
 * `POST /plugins/confirmed`）。出错时怎么办、范围、设置都在代码里
 */
export type PluginCreate = { source: string; id?: string | null; enabled: boolean; base_version?: string | null };

/**
 * 保存一个插件（`PUT /plugins/{id}`）：**整份代码**和开关。core 和确认过的那一份比：只改了
 * manifest 里的数据（出错时、范围、设置的值）的不必点头；改得了工具调用的插件，打开它、
 * 改代码要点头（`control.plugin.needs_confirmation`，走 `PUT /plugins/{id}/confirmed`）
 */
export type PluginSave = { source: string; enabled: boolean; base_version?: string | null };

/** 按表单改写代码里的 manifest（`POST /plugins/rewrite`）。**没有副作用** */
export type PluginRewrite = {
  source: string;
  on_error: G.OnError;
  scope: G.PluginScope;
  /** 每一个声明了的设置项的值 */
  settings: { [key in string]: G.SettingValue };
};

/** 改写之后的代码：manifest 那一段换成新写的，其余每个字节都和原来一样 */
export type PluginRewritten = { source: string };

// ─── 端点 ───

type Changed = {
  Plugins: { req: null; res: Array<PluginView> };
  PluginInspect: { req: G.PluginSource; res: PluginInspection };
  CreatePlugin: { req: PluginCreate; res: G.ConfigWritten };
  CreatePluginConfirmed: { req: PluginCreate; res: G.ConfigWritten };
  SavePlugin: { req: PluginSave; res: G.ConfigWritten };
  SavePluginConfirmed: { req: PluginSave; res: G.ConfigWritten };
  ApprovePluginFileConfirmed: { req: G.PluginApprove; res: G.ConfigWritten };
  PluginRewrite: { req: PluginRewrite; res: PluginRewritten };
};

/** v0.59.0 删掉的 */
type Removed = "UpdatePlugin" | "UpdatePluginConfirmed" | "ReplacePluginSource";

/** 各端点的请求和响应 */
export type Endpoints = Omit<G.Endpoints, keyof Changed | Removed> & Changed;

/** 新加的那几个端点的方法、路径和路径参数（和 core 的 `tw_api::ep` 同一种写法） */
type Added = {
  CreatePluginConfirmed: { method: "POST"; path: "/plugins/confirmed"; params: readonly []; format: "json" };
  SavePlugin: { method: "PUT"; path: "/plugins/{id}"; params: readonly ["id"]; format: "json" };
  SavePluginConfirmed: { method: "PUT"; path: "/plugins/{id}/confirmed"; params: readonly ["id"]; format: "json" };
  ApprovePluginFileConfirmed: {
    method: "POST";
    path: "/plugins/{id}/approve/confirmed";
    params: readonly ["id"];
    format: "json";
  };
  PluginRewrite: { method: "POST"; path: "/plugins/rewrite"; params: readonly []; format: "json" };
};

/** 端点表的类型（`src/control.ts` 按它数路径参数） */
export type EndpointTable = Omit<typeof G.ENDPOINTS, Removed> & Added;
