import { useState } from "react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { DetectedClient } from "@/types";
import { ClientMark, Tile, useDialogFocus } from "@/keys/parts";
import { api } from "./api";
import { clientsText } from "./clients.i18n";

/**
 * 更改一个客户端的配置文件路径（行菜单里的「更改路径…」）：它读的不是默认位置那一份时
 * （`CLAUDE_CONFIG_DIR`、`CODEX_HOME` 挪过，或者装在别处），接管、还原都改这里指定的文件。
 *
 * 默认位置写在输入框下面，和它不一样时给「恢复默认」；空的不算默认。**接管着的不能改**：
 * 接管记录和能还原的原文都在原来那个文件旁边，先还原。写得对不对（完整路径、文件夹在
 * 不在、后缀对不对）由 Rust 那一侧核对。
 */
export function PathDialog({
  client,
  onClose,
  onSaved,
}: {
  /** 这台电脑上的、能换位置的那一个（`default_path` 不为空） */
  client: DetectedClient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  const dialogFocus = useDialogFocus();
  const fallback = client.default_path ?? "";
  const [path, setPath] = useState(client.path);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adopted = client.adopted_at_ms != null;
  const value = path.trim();
  const missing = value === "" ? t.enterPath : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setPath(client.id, value === fallback ? null : value);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-lg" {...dialogFocus}>
        <DialogHeader className="flex-row items-center gap-3">
          <Tile className="size-9 rounded-lg [&_svg]:size-[18px]">
            <ClientMark id={client.id} name={client.name} size={18} />
          </Tile>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle>{t.pathTitle(client.name)}</DialogTitle>
            <DialogDescription>{t.pathDesc}</DialogDescription>
          </div>
        </DialogHeader>

        {adopted && (
          <Banner layout="inline" tone="warning">
            {t.pathAdopted}
          </Banner>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="client-path" className="tw-body font-medium">
            {t.pathLabel}
          </label>
          <Input
            id="client-path"
            className="font-mono"
            value={path}
            placeholder={fallback}
            disabled={adopted}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setPath(e.target.value);
              setError(null);
            }}
          />
          <p className="tw-label break-all text-muted-foreground">
            {t.pathDefault(fallback)}
            {value !== fallback && !adopted && (
              <Button
                type="button"
                variant="link"
                className="ml-2 h-auto p-0 tw-label font-normal text-foreground underline-offset-2"
                onClick={() => {
                  setPath(fallback);
                  setError(null);
                }}
              >
                {t.pathRestore}
              </Button>
            )}
          </p>
        </div>

        <Banner layout="inline" tone="error" show={error !== null}>
          {error}
        </Banner>

        <DialogFooter className="items-center">
          {missing && !adopted && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            pending={saving}
            disabled={adopted || missing !== null || value === client.path}
            onClick={() => void save()}
          >
            {common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
