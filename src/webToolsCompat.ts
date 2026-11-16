import type * as Api from "./generated/tw-api";

// Search adapters belong to the connected Core. Keep the pinned generated API
// intact while allowing these capability IDs to grow independently of Lite.
export type SearchEngine = string;
export type WebSearchEngine = { id: SearchEngine; name: string; min_interval_ms: number };
export type WebToolsConfig = Omit<Api.WebToolsConfig, "engines"> & { engines: SearchEngine[] };
export type WebToolsSave = Omit<Api.WebToolsSave, "config"> & { config: WebToolsConfig };
export type WebSource = Omit<Api.WebSource, "engine"> & { engine: SearchEngine | null };
export type WebToolResult = Omit<Api.WebToolResult, "sources"> & { sources: WebSource[] };
export type WebToolsView = Omit<Api.WebToolsView, "config" | "available_engines"> & {
  config: WebToolsConfig;
  available_engines?: WebSearchEngine[];
};
export type Endpoints = Omit<Api.Endpoints, "WebTools" | "SaveWebTools" | "TestWebTool"> & {
  WebTools: Omit<Api.Endpoints["WebTools"], "res"> & { res: WebToolsView };
  SaveWebTools: Omit<Api.Endpoints["SaveWebTools"], "req"> & { req: WebToolsSave };
  TestWebTool: Omit<Api.Endpoints["TestWebTool"], "res"> & { res: WebToolResult };
};

export const legacyEngines: WebSearchEngine[] = [
  { id: "bing", name: "Bing", min_interval_ms: 0 },
  { id: "duckduckgo", name: "DuckDuckGo", min_interval_ms: 0 },
];

export function engineName(id: string, available = legacyEngines): string {
  return available.find((engine) => engine.id === id)?.name ?? id;
}
