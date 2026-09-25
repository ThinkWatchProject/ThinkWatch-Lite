// 这一张图是哪个场景、哪种语言。mock 的数据按它摆（连着远程时列表里当前的是哪一条……）
import { sceneOf } from "../scenes";

const q = new URLSearchParams(location.search);

export const P = {
  scene: sceneOf(q.get("scene")),
  lang: (q.get("lang") === "en" ? "en" : "zh") as "zh" | "en",
  /** 打开哪一页 */
  page: sceneOf(q.get("scene"))?.page ?? null,
  /** 连着远程 core（`homelab`） */
  remote: sceneOf(q.get("scene"))?.remote === true,
  /** `homelab` 还没存进连接列表 */
  adding: sceneOf(q.get("scene"))?.adding === true,
} as const;
