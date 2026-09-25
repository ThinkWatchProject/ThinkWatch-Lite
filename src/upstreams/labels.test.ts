import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ProviderView } from "@/types";
import { l1ErrorText, modelFace, planLabel } from "./labels";

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
    billing: "per-token",
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

describe("链路测速失败的那句话", () => {
  const base = { target: "hk", ok: false as const, segments: [], total_ms: 0 };

  it("卡在哪一步 + 为什么，两样都说", () => {
    // 「TCP 握手失败」说不出是地址错了还是代理没起来
    const text = l1ErrorText({
      ...base,
      failed: { step: "tcp", peer: "proxy" },
      error: {
        code: "l1.tcp.refused",
        args: { addr: "127.0.0.1:1080" },
        text: "127.0.0.1:1080 refused the connection.",
      },
    });
    expect(text).toContain("TCP 握手");
    expect(text).toContain("127.0.0.1:1080 拒绝连接");
  });

  it("不认识的码退回 core 给的那句英文", () => {
    const text = l1ErrorText({
      ...base,
      error: { code: "l1.something.new", text: "Something new." },
    });
    expect(text).toBe("Something new.");
  });

  it("连原因都没有时也要有一句话", () => {
    expect(l1ErrorText(base)).not.toBe("");
  });
});

describe("planLabel", () => {
  it("names a known plan the way Codex does, renamed plans included", () => {
    expect(planLabel("plus")).toBe("Plus");
    expect(planLabel("prolite")).toBe("Pro");
    expect(planLabel("team")).toBe("Business");
    expect(planLabel("business")).toBe("Enterprise");
    expect(planLabel("self_serve_business_prolite")).toBe("Business Premium");
  });

  it("shows a word it does not know as it came, never as 'unknown'", () => {
    expect(planLabel("pro_ultra")).toBe("pro_ultra");
    // 对象原型上的名字不算认得
    expect(planLabel("constructor")).toBe("constructor");
    expect(planLabel(null)).toBeNull();
    expect(planLabel("")).toBeNull();
  });
});
