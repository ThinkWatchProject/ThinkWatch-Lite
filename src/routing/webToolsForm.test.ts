import { describe, expect, it } from "vitest";
import { domains, domainList, selectedEngines, validWebConfig } from "./webToolsForm";
import type { WebToolsConfig } from "@/types";

const config: WebToolsConfig = {
  mode: "core", engines: [], proxy: "system", language: "", region: "", allowed_domains: [], blocked_domains: [],
  max_results: 8, read_pages: 2, max_page_chars: 12000, timeout_secs: 30, max_concurrent: 4, interval_ms: 1000, cache_secs: 600, max_tool_calls: 8, fallback_to_upstream: false,
};

describe("web tool configuration", () => {
  it("keeps unfinished input when saving, normalizes and deduplicates pasted lists", () => {
    expect(domainList(["example.org"], "EXAMPLE.org, docs.example.org\napi.example.org")).toEqual(["example.org", "docs.example.org", "api.example.org"]);
    expect(validWebConfig({ ...config, allowed_domains: domainList([], "example.org bad/path") })).toBe(false);
    expect(validWebConfig({ ...config, blocked_domains: Array.from({ length: 101 }, (_, i) => `host${i}.org`) })).toBe(false);
  });
  it("makes Automatic exclusive without treating explicit all-engine selection as automatic", () => {
    expect(selectedEngines([], ["auto", "bing"])).toEqual(["bing"]);
    expect(selectedEngines(["bing"], ["bing", "duckduckgo"])).toEqual(["bing", "duckduckgo"]);
    expect(selectedEngines(["duckduckgo"], ["duckduckgo", "bing"])).toEqual(["duckduckgo", "bing"]);
    expect(selectedEngines(["duckduckgo", "bing"], ["duckduckgo", "bing", "auto"])).toEqual([]);
  });
  it("returns to Automatic after deselecting the last engine or Automatic itself", () => {
    expect(selectedEngines(["bing", "duckduckgo"], ["duckduckgo"])).toEqual(["duckduckgo"]);
    expect(selectedEngines(["duckduckgo"], [])).toEqual([]);
    expect(selectedEngines([], [])).toEqual([]);
  });
  it("accepts hostnames and rejects URLs and wildcard filters", () => {
    expect(domains(" SQLite.org, docs.example.org\nsqlite.org ")).toEqual(["sqlite.org", "docs.example.org"]);
    expect(validWebConfig({ ...config, allowed_domains: ["sqlite.org"] })).toBe(true);
    for (const domain of ["https://sqlite.org", "*.sqlite.org", "sqlite.org:443", "-sqlite.org"]) {
      expect(validWebConfig({ ...config, allowed_domains: [domain] })).toBe(false);
    }
  });
  it("accepts zero cache/page-prefetch and rejects invalid resource limits", () => {
    expect(validWebConfig({ ...config, cache_secs: 0, read_pages: 0 })).toBe(true);
    expect(validWebConfig({ ...config, max_concurrent: 0 })).toBe(false);
    expect(validWebConfig({ ...config, timeout_secs: NaN })).toBe(false);
    expect(validWebConfig({ ...config, max_tool_calls: 1.5 })).toBe(false);
  });
});
