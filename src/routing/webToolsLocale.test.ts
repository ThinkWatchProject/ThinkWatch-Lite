import { describe, expect, it } from "vitest";
import { localeName, localeOptions } from "./webToolsLocale";

describe("search locale choices", () => {
  it("shows translated names and distinguishes writing systems", () => {
    expect(localeName("language", "zh-Hans", "zh")).toContain("简体");
    expect(localeName("language", "zh-Hant", "en")).toContain("Traditional");
    expect(localeName("region", "US", "zh")).toBe("美国");
    expect(localeName("region", "GB", "en")).toBe("United Kingdom");
  });

  it("keeps auto empty and preserves a valid tag set outside the picker", () => {
    const options = localeOptions("language", "en", "pt-BR", "System (English)", "Current selection");
    expect(options[0]).toEqual({ value: "", label: "System (English)" });
    expect(options.find((o) => o.value === "pt-BR")?.label).toContain("Brazil");
    expect(options.some((o) => o.value === "zh-Hans")).toBe(true);
    expect(options.some((o) => o.value === "zh-Hant")).toBe(true);
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });

  it("offers named countries and handles an unknown system locale without inventing one", () => {
    const options = localeOptions("region", "zh", "", "跟随系统", "当前设置");
    expect(options).toContainEqual({ value: "CN", label: "中国" });
    expect(options).toContainEqual({ value: "JP", label: "日本" });
    expect(options.every((o) => !o.value || o.label !== o.value)).toBe(true);
    expect(localeName("language", "", "en")).toBeUndefined();
    expect(localeName("language", "malformed_tag", "en")).toBeUndefined();
  });
});
