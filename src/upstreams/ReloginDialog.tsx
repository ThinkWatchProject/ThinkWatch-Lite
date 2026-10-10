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
import type { Overview, ZaiFamily } from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { useAccountLogin, type LoginKind } from "./accountLogin";
import { AccountPanel } from "./AccountPanel";
import { ProxyField } from "./ConnectionSection";
import { FormItem } from "./parts";
import { reloginText } from "./ReloginDialog.i18n";

/** 给哪个已有的账号上游换凭据 */
export interface Relogin {
  kind: LoginKind;
  name: string;
  proxy: string;
  /** Z.ai / BigModel 是哪一边。ChatGPT 用不到 */
  family: ZaiFamily;
}

/**
 * 给已有的账号上游换一次凭据：ChatGPT 账号（编辑对话框「账号」一节里的「重新登录」），或者
 * Z.ai / BigModel 的上游登录账号换一把密钥（core 按同名、同站点只换密钥，别的设置不动）。
 *
 * 新建账号上游不走这里，在新建上游的「账号」一步里登录。名称固定，出站代理可以换（登录本身
 * 也经它发出）。ChatGPT 的说明此前已经看过并同意了，不再拦一次；Z.ai 的那几条（会在账号里
 * 建一把密钥）照样要确认 —— 那个上游的密钥可能是手填的，从没登录过。**登录只能有一次在进行**：
 * 关掉对话框就取消这一次（`useAccountLogin`）。
 */
export function ReloginDialog({
  ov,
  relogin,
  onClose,
  onSaved,
}: {
  ov: Overview;
  relogin: Relogin;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(reloginText);
  const common = useText(commonText);
  const [proxy, setProxy] = useState(relogin.proxy);
  const login = useAccountLogin(relogin.kind, (provider) => onSaved(provider));
  const done = login.phase.at === "done";
  const site = relogin.family === "zai" ? "Z.ai" : "BigModel";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* 点到外面不关：登录进行中时关掉就是放弃这一次登录。Esc、×、取消照常 */}
      <DialogContent className="sm:max-w-[640px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{relogin.kind === "chatgpt" ? t.chatgptTitle : t.zaiTitle(site)}</DialogTitle>
          <DialogDescription>
            {relogin.kind === "chatgpt"
              ? t.chatgptDesc(<span className="font-mono">{relogin.name}</span>)
              : t.zaiDesc(<span className="font-mono">{relogin.name}</span>)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FormItem label={t.name} htmlFor="relogin-name">
              <Input id="relogin-name" className="font-mono" value={relogin.name} disabled />
            </FormItem>
            <ProxyField ov={ov} value={proxy} onChange={setProxy} disabled={login.waiting || done} />
          </div>
          <AccountPanel
            login={login}
            params={{ name: relogin.name, proxy, family: relogin.family }}
            blocked={false}
            relogin
            notices={relogin.kind === "zai"}
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
