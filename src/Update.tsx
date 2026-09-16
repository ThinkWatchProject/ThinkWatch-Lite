import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/ui/field";
import { Progress } from "@/ui/progress";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { toast } from "sonner";

/** 这一份是怎么装上来的。决定更新由谁做。 */
export type Install = "homebrew" | "standalone" | "dev";

export interface UpdateView {
  version: string;
  install: Install;
  can_self_update: boolean;
  check_updates: boolean;
}

export interface Found {
  version: string;
  notes?: string | null;
}

/**
 * 有新版本的时候，这一档该怎么装。
 *
 * **Homebrew 装的那一份不给安装按钮。**它不是「这里暂时没做」——
 * 应用自己把包换掉之后，Homebrew 记的版本号指向一个已经不在磁盘上的
 * 版本，下一次 `brew upgrade` 会把旧的那版盖回来。所以这一档只说该执行
 * 什么，由用户在自己的终端里做。
 */
export function howToUpdate(install: Install): { can: boolean; how: string } {
  switch (install) {
    case "homebrew":
      return {
        can: false,
        how: "这一份由 Homebrew 管理，在终端中执行下面这条命令完成更新。",
      };
    case "standalone":
      return { can: true, how: "下载并替换当前版本，完成后应用会重新启动。" };
    case "dev":
      return { can: false, how: "当前运行的是开发构建，不执行自动更新。" };
  }
}

/** 下载进度。总长未知时不画进度条 —— 一根假装知道的进度条比没有更糟。 */
function Downloading({ done, total }: { done: number; total: number | null }) {
  if (total == null) {
    return (
      <p className="tw-body text-muted-foreground">
        正在下载…（{(done / 1_048_576).toFixed(1)} MB）
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <Progress value={(done / total) * 100} />
      <p className="tw-label text-muted-foreground">
        {(done / 1_048_576).toFixed(1)} / {(total / 1_048_576).toFixed(1)} MB
      </p>
    </div>
  );
}

/**
 * 更新。
 *
 * 三件事：现在是哪一版、要不要自动去看有没有新的、有新的时候怎么装。
 * 第三件取决于这一份是怎么装上来的，而那个判断在 Rust 里 —— 界面只是
 * 把它说出来。
 */
export default function Update() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  /** 这次会话查过没有 —— 「已是最新版本」只有在真查过之后才该说。 */
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number | null] | null>(null);

  useEffect(() => {
    void invoke<UpdateView>("update_state").then(setView).catch(() => {});
  }, []);

  // 后台那轮自动检查查到了也要在这里显示出来，而不是只弹一条通知 ——
  // 通知划掉就没了，而用户来这一页正是为了处理它。
  useEffect(() => {
    const un = listen<Found>("update-found", (e) => {
      setFound(e.payload);
      setLooked(true);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // 载荷是「这一块多大、总共多大」，要自己累加 —— 事件报的是增量，
  // 不是已下载总量。
  useEffect(() => {
    const un = listen<[number, number | null]>("update-progress", (e) => {
      const [chunk, total] = e.payload;
      setProgress((p) => [(p?.[0] ?? 0) + chunk, total ?? p?.[1] ?? null]);
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const look = useCallback(async () => {
    setBusy(true);
    try {
      setFound(await invoke<Found | null>("update_check"));
      setLooked(true);
    } catch (e) {
      toast.error("检查更新失败：" + (typeof e === "string" ? e : String(e)));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!view) return null;
  const { can, how } = howToUpdate(view.install);

  return (
    <section>
      <h2 className="tw-title font-semibold">更新</h2>

      <Field orientation="horizontal" className="mt-2">
        <Switch
          id="check-updates"
          checked={view.check_updates}
          onCheckedChange={async (checked) => {
            const want = checked === true;
            const before = view;
            // 先画上，以后端返回的实际状态为准 —— 写不进去的时候
            // 开关必须弹回去（和开机自启同一条纪律）。
            setView({ ...view, check_updates: want });
            try {
              setView(await invoke<UpdateView>("set_update_check", { on: want }));
            } catch (err) {
              setView(before);
              toast.error(typeof err === "string" ? err : String(err));
            }
          }}
        />
        <FieldContent>
          <FieldLabel htmlFor="check-updates">自动检查新版本</FieldLabel>
          <FieldDescription>
            默认不开。打开后启动时检查一次，此后每六小时一次，只读取版本清单，
            不下载任何内容。
          </FieldDescription>
        </FieldContent>
      </Field>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void look()}>
          {busy && <Spinner />}
          立即检查
        </Button>
        {looked && !found && (
          <span className="tw-body text-muted-foreground">
            已是最新版本 {view.version}
          </span>
        )}
      </div>

      {found && (
        <div className="mt-3 space-y-2 rounded-md border p-3">
          <p className="tw-body font-medium">
            新版本 {found.version}
            <span className="ml-2 font-normal text-muted-foreground">
              当前 {view.version}
            </span>
          </p>
          {found.notes && (
            <p className="max-w-prose whitespace-pre-wrap tw-body text-muted-foreground">
              {found.notes}
            </p>
          )}
          <p className="tw-body text-muted-foreground">{how}</p>
          {can ? (
            progress ? (
              <Downloading done={progress[0]} total={progress[1]} />
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await invoke("update_install");
                  } catch (e) {
                    setProgress(null);
                    setBusy(false);
                    toast.error(typeof e === "string" ? e : String(e));
                  }
                }}
              >
                {busy && <Spinner />}
                安装并重新启动
              </Button>
            )
          ) : (
            view.install === "homebrew" && (
              <code className="block rounded bg-muted px-2 py-1.5 font-mono tw-label">
                brew upgrade --cask thinkwatch-lite
              </code>
            )
          )}
        </div>
      )}
    </section>
  );
}
