import { useState, type ReactNode } from "react";
import { usePending } from "@/ui/notify";
import type { PickedFile } from "@/types";
import { backupApi } from "./api";
import { ImportDialog } from "./ImportDialog";

/**
 * 「导入配置…」：先弹系统的「打开」对话框选配置包，选了才打开导入对话框。设置里、上游页的
 * 空状态各用一份。`dialog` 放进页面里渲染
 */
export function useImport(onImported?: () => void): { start: () => void; picking: boolean; dialog: ReactNode } {
  const [file, setFile] = useState<PickedFile | null>(null);
  const [picking, pick] = usePending();
  const start = () =>
    void pick(async () => {
      const f = await backupApi.open();
      if (f) setFile(f);
    });
  const dialog = file && <ImportDialog file={file} onClose={() => setFile(null)} onImported={onImported} />;
  return { start, picking, dialog };
}
