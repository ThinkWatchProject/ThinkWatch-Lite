import type { AliasView, KnownModel, ProviderModelsView } from "@/types";

/** Each option value is a literal upstream ID. Core supplies the effective target for each alias. */
export function pinnedChoices(
  provider: string,
  inventory: ProviderModelsView | undefined,
  known: readonly KnownModel[],
  aliases: readonly AliasView[],
): Map<string, string[]> {
  const choices = new Map<string, string[]>();
  if (inventory) {
    for (const row of inventory.models) if (row.enabled) choices.set(row.id, []);
  } else {
    for (const row of known) if (!row.alias && row.providers.includes(provider)) choices.set(row.id, []);
  }
  for (const alias of aliases) {
    const target = alias.served_by.find((p) => p.provider === provider);
    if (!target) continue;
    const names = choices.get(target.model);
    if (names) {
      names.push(alias.name);
    } else if (!inventory || inventory.source === "none") {
      // Core can resolve an alias on an upstream without a published model list.
      choices.set(target.model, [alias.name]);
    }
  }
  return choices;
}
