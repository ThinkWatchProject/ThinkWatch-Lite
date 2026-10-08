import { Suspense, createContext, lazy, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LOCAL, connApi, type ConnView, type Profile, type ServerInfo } from "./api";
import { useConnection } from "./useConnection";

/*
  **这一层和启动画面一起最先加载**（见 `App`），所以两个对话框和报错用的译文表都等用到时
  才载入：它们带着表单、试连结果、core 的整张译文表，启动画面不该等它们。
*/
const ProfileDialog = lazy(() => import("./ProfileDialog").then((m) => ({ default: m.ProfileDialog })));
const SwitchDialog = lazy(() => import("./SwitchDialog").then((m) => ({ default: m.SwitchDialog })));

/** 切回本机没成：报一句 */
function reportSwitchError(e: unknown) {
  void Promise.all([import("sonner"), import("@/i18n/core.i18n")]).then(([{ toast }, { errorText }]) =>
    toast.error(errorText(e)),
  );
}

interface Actions {
  /** 连接列表和当前状态。还没读到是 null */
  view: ConnView | null;
  add: () => void;
  edit: (p: Profile) => void;
  /** 打开设置页的「连接」一节 */
  manage: () => void;
  /** 切到这一条。本机直接切；远程先试连、再确认 */
  switchTo: (id: string) => void;
}

const Ctx = createContext<Actions>({
  view: null,
  add: () => {},
  edit: () => {},
  manage: () => {},
  switchTo: () => {},
});

/**
 * 让主界面落到某一页。主界面在按连接重挂的那一层里面，够不着它的状态，所以和菜单栏、
 * 通知一样发一条 `open-view`（见 `App` 里的 `go`）
 */
export function openView(view: string) {
  window.dispatchEvent(new CustomEvent<string>("tw-open-view", { detail: view }));
}

export function useConnections(): Actions {
  return useContext(Ctx);
}

/**
 * 连接的对话框和动作，**挂在主界面外层**：侧栏的切换器、设置里的「连接」一节、未连接
 * 页、菜单栏转过来的切换，打开的是同一个对话框。
 *
 * 它在按连接重挂的那一层外面（见 `App`）：切换成功、主界面整个换掉的时候，这里不跟着
 * 重来。
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const view = useConnection();
  const [editing, setEditing] = useState<{ profile: Profile | null } | null>(null);
  const [switching, setSwitching] = useState<{ target: Profile; tested: ServerInfo | null } | null>(
    null,
  );

  /**
   * 列表还没读到时要切的那一条。菜单栏里选了一条远程连接、窗口是为这一下新建的：
   * 落页比列表先到
   */
  const pending = useRef<string | null>(null);

  const actions = useMemo<Actions>(
    () => ({
      view,
      add: () => setEditing({ profile: null }),
      manage: () => openView("settings"),
      edit: (p) => {
        setSwitching(null);
        setEditing({ profile: p });
      },
      switchTo: (id) => {
        if (!view) {
          pending.current = id;
          return;
        }
        if (id === view.current) return;
        if (id === LOCAL) {
          // 切回本机不用确认：本机 core 拉起来，指着服务器的客户端不受影响
          connApi.switchTo(LOCAL, false).catch(reportSwitchError);
          return;
        }
        const target = view.profiles.find((p) => p.id === id);
        if (target) setSwitching({ target, tested: null });
      },
    }),
    [view],
  );

  useEffect(() => {
    if (!view || pending.current === null) return;
    const id = pending.current;
    pending.current = null;
    actions.switchTo(id);
  }, [view, actions]);

  return (
    <Ctx.Provider value={actions}>
      {children}
      {/*
        两个对话框都等连接列表读到了再出现：试连遇到版本不一致时，命令里的版本来自它。

        **按它们对着的那一条连接挂**（`key`）：开着的时候换了一条（菜单栏上又选了另一条
        连接），对话框要整个重来。不然上一条的试连结果、填了一半的名字地址和密钥、「同时
        改指向」的勾都留在新的那一条上 —— 保存时写进的是另一条连接。
      */}
      <Suspense fallback={null}>
        {editing && view && (
          <ProfileDialog
            key={editing.profile?.id ?? "new"}
            editing={editing.profile}
            isCurrent={editing.profile !== null && editing.profile.id === view.current}
            required={view.required_core}
            onClose={() => setEditing(null)}
            onSaved={(p, andSwitch) => {
              setEditing(null);
              if (andSwitch) setSwitching({ target: p, tested: andSwitch });
            }}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {switching && view && (
          <SwitchDialog
            key={switching.target.id}
            target={switching.target}
            tested={switching.tested}
            required={view.required_core}
            onClose={() => setSwitching(null)}
            onEdit={(p) => {
              setSwitching(null);
              setEditing({ profile: p });
            }}
          />
        )}
      </Suspense>
    </Ctx.Provider>
  );
}
