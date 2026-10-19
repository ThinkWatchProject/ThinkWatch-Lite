import { useState } from "react";
import { FileDownIcon } from "lucide-react";
import { useTauriEvent } from "@/lib/tauriEvent";
import { notify } from "@/ui/notify";
import { modalOpen } from "@/palette/keys";
import { useText } from "@/i18n";
import type { DroppedFile, PickedFile } from "@/types";
import { backupText } from "./backup.i18n";
import { ImportDialog } from "./ImportDialog";

/** Rust 那边的两个事件（`src-tauri/src/export.rs`）：拖着配置包进出窗口、放下的那一个 */
const DRAG_EVENT = "import-drag";
const DROP_EVENT = "import-file";

/**
 * 配置包拖进主窗口（规格 5.1）：拖着的时候整窗盖一层提示，放下打开导入对话框。**文件由 Rust
 * 读**，这里拿到的是内容。
 *
 * `ready`：连上了、配置能用（不在安全模式、远程没断）。不然拖进来不理 —— 导入要对着一份读得了的
 * 配置比。已经开着别的对话框时也不理，不把正在填的表单盖住。
 */
export function DropImport({ ready, onImported }: { ready: boolean; onImported: () => void }) {
  const t = useText(backupText);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const accepting = ready && file === null;

  useTauriEvent<boolean>(DRAG_EVENT, (e) => setOver(e.payload && accepting && !modalOpen()));
  useTauriEvent<DroppedFile>(DROP_EVENT, (e) => {
    setOver(false);
    if (!accepting || modalOpen()) return;
    if (e.payload.kind === "failed") notify.error(e.payload.error);
    else setFile(e.payload.file);
  });

  return (
    <>
      {over && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-xs motion-fade"
        >
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-foreground/25 bg-popover px-12 py-10 shadow-lg">
            <FileDownIcon className="size-7 text-muted-foreground" />
            <p className="tw-head text-foreground">{t.dropHere}</p>
          </div>
        </div>
      )}
      {file && <ImportDialog file={file} onClose={() => setFile(null)} onImported={onImported} />}
    </>
  );
}
