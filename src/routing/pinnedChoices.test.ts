import { expect, it } from "vitest";
import type { AliasView, ProviderModelsView } from "@/types";
import { pinnedChoices } from "./pinnedChoices";

const coding: AliasView = {
  name: "coding", models: [], shadows: [], requests_24h: 0,
  served_by: [{ provider: "relay", model: "raw" }, { provider: "other", model: "other-raw" }],
};

it("offers the ID Core resolves on a provider without a model list, including its other aliases", () => {
  const inventory: ProviderModelsView = { provider: "relay", source: "none", status: "no_list", fetching: false, models: [] };
  const options = pinnedChoices("relay", inventory, [], [coding, { ...coding, name: "daily" }]);
  expect([...options]).toEqual([["raw", ["coding", "daily"]]]);
});

it("a refreshed provider inventory excludes disabled or removed IDs even if the alias view is older", () => {
  const inventory: ProviderModelsView = {
    provider: "relay", source: "discovered", status: "listed", fetching: false,
    models: [{ id: "raw", enabled: false, manual: false, listed: true, estimated: false, aliases: ["coding"] }],
  };
  const removed = { ...coding, name: "old", served_by: [{ provider: "relay", model: "removed" }] };
  expect([...pinnedChoices("relay", inventory, [], [coding, removed])]).toEqual([]);
});
