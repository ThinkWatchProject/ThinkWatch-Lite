import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ProviderView } from "@/types";
import { modelFace } from "./labels";

// 断言按中文写：不随跑测试那台机器的系统语言变
beforeAll(() => setLang("zh"));

function p(patch: Partial<ProviderView>): ProviderView {
  return {
    name: "x",
    base_url: "https://x.example",
    base_url_masked: false,
    auth_header: "x-api-key",
    protocol: "anthropic",
    protocol_explicit: false,
    proxy: "direct",
    on_proxy_fail: "fail",
    models: [],
    models_only: null,
    model_source: "discovered",
    model_status: "listed",
    model_fetching: false,
    model_count: 7,
    disabled: false,
    health: "ok",
    billing: null,
    billing_effective: "per-token",
    trust: "untrusted",
    trust_explicit: false,
    redact: [],
    redact_explicit: false,
    references: [],
    pricing: null,
    ...patch,
  } as ProviderView;
}

describe("modelFace", () => {
  it("counts what an upstream serves and says when the range is narrowed", () => {
    expect(modelFace(p({}))).toEqual({ count: 7, note: null, warn: false });
    expect(modelFace(p({ models_only: ["claude-*"] })).note).toBe("指定范围");
  });

  it("tells not-yet-asked, refused and no-list apart instead of calling all of them 未获取", () => {
    const none = { model_source: "none", model_count: 0 } as const;
    expect(modelFace(p({ ...none, model_status: "pending" }))).toEqual({ count: null, note: "获取中", warn: false });
    expect(modelFace(p({ ...none, model_status: "failed", model_fetching: true })).note).toBe("获取中");
    expect(modelFace(p({ ...none, model_status: "failed" }))).toEqual({ count: null, note: "获取失败", warn: true });
    expect(modelFace(p({ ...none, model_status: "no_list" }))).toEqual({
      count: null,
      note: "未提供清单",
      warn: false,
    });
  });

  it("keeps showing a manual list that stands in for a failed or missing one", () => {
    const face = modelFace(p({ model_source: "manual", model_status: "failed", model_count: 2 }));
    expect(face).toEqual({ count: 2, note: "手动清单", warn: false });
  });
});
