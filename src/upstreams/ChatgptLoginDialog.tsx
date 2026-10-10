import { useState } from "react";
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
import type { Overview } from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { useAccountLogin } from "./accountLogin";
import { AccountPanel } from "./AccountPanel";
import { chatgptLoginText } from "./ChatgptLoginDialog.i18n";
import { ProxyField } from "./ConnectionSection";
import { FormItem } from "./parts";

/**
 * 给已有的 ChatGPT 账号上游换一次凭据（编辑对话框「账号」一节里的「重新登录」）。
 *
 * 新建 ChatGPT 账号上游不走这里，在新建上游的「账号」一步里登录。这里名称固定、说明不再
 * 拦一次（此前已经看过并同意了），出站代理可以换（登录本身也经它发出）。**登录只能有一次
 * 在进行**：关掉对话框就取消这一次（`useAccountLogin`）。
 */
export function ChatgptLoginDialog({
  ov,
  relogin,
  onClose,
  onSaved,
}: {
  ov: Overview;
  /** 换凭据的那个上游：名称固定，出站方式沿用它的 */
  relogin: { name: string; proxy: string };
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(chatgptLoginText);
  const common = useText(commonText);
  const [proxy, setProxy] = useState(relogin.proxy);
  const login = useAccountLogin("chatgpt", (provider) => onSaved(provider));
  const done = login.phase.at === "done";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* 点到外面不关：登录进行中时关掉就是放弃这一次登录。Esc、×、取消照常 */}
      <DialogContent className="sm:max-w-[640px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.desc(<span className="font-mono">{relogin.name}</span>)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormItem label={t.name} htmlFor="relogin-name">
              <Input id="relogin-name" className="font-mono" value={relogin.name} disabled />
            </FormItem>
            <ProxyField
              ov={ov}
              value={proxy}
              onChange={setProxy}
              disabled={login.waiting || done}
            />
          </div>
          <AccountPanel
            login={login}
            params={{ name: relogin.name, proxy, family: "zai" }}
            blocked={false}
            relogin
          />
        </div>

        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>{t.finish}</Button>
          ) : login.waiting ? (
            <Button variant="outline" onClick={() => void login.cancel()}>
              {t.cancelSignIn}
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
