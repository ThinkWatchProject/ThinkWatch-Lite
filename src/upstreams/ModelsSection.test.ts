import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ModelRow } from "@/types";
import { catalogOf, modelCount } from "./ModelsSection";

// 断言按中文写：不随跑测试那台机器的系统语言变
beforeAll(() => setLang("zh"));

function row(patch: Partial<ModelRow> & { id: string }): ModelRow {
  return { enabled: true, estimated: false, aliases: [], manual: false, listed: true, ...patch };
}

describe("编辑对话框的模型一节", () => {
  it("只记上游自己列出的：手动添加的以表单为准，不混进来", () => {
    const c = catalogOf({
      provider: "chatgpt",
      source: "discovered",
      status: "listed",
      fetching: false,
      models: [
        row({ id: "gpt-5.5" }),
        row({ id: "gpt-5.4", manual: true }),
        row({ id: "gpt-6-luna", manual: true, listed: false }),
      ],
    });
    expect(c.listed).toEqual(["gpt-5.5", "gpt-5.4"]);
  });

  it("上游不提供清单：一个也不算上游列出的", () => {
    const c = catalogOf({
      provider: "ollama",
      source: "manual",
      status: "no_list",
      fetching: false,
      models: [row({ id: "qwen3-coder:30b", manual: true, listed: false })],
    });
    expect(c.listed).toEqual([]);
  });

  it("标题旁的数：上游列出的和手动添加的分开说", () => {
    expect(modelCount(true, 4, 0)).toBe("4 个");
    expect(modelCount(true, 4, 1)).toBe("上游列出 4 个，手动添加 1 个");
    // 没有清单：标签已经说了「手动添加」，这里只说数
    expect(modelCount(false, 0, 2)).toBe("2 个");
    expect(modelCount(false, 0, 0)).toBeNull();
  });

  it("英文界面同样分开说", () => {
    setLang("en");
    try {
      expect(modelCount(true, 1, 0)).toBe("1 model");
      expect(modelCount(true, 4, 1)).toBe("4 listed by the upstream, 1 added by hand");
      expect(modelCount(false, 0, 2)).toBe("2 models");
    } finally {
      setLang("zh");
    }
  });
});
