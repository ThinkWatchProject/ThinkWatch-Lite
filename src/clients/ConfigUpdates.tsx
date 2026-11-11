import type { DetectedClient } from "@/types";
import { useText } from "@/i18n";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { clientsText } from "./clients.i18n";

/** Local and WSL connections use the same reviewed update flow. */
export function ConfigUpdates({ clients, asking, onUpdate, disabled = false }: {
  clients: readonly DetectedClient[];
  asking: string | null;
  onUpdate: (client: DetectedClient) => void;
  disabled?: boolean;
}) {
  const t = useText(clientsText);
  return clients.filter((c) => c.config_needs_update).map((c) => (
    <Banner key={c.id} layout="inline" tone="warning" className="mb-3" actions={
      <Button size="sm" variant="outline" pending={asking === c.id} disabled={disabled} onClick={() => onUpdate(c)}>
        {t.updateConfig}
      </Button>
    }>
      {t.configNeedsUpdate(c.name)}
    </Banner>
  ));
}
