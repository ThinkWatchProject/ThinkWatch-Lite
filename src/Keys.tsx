import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tip } from "@/ui/tip";
import type { Overview, PatchOp } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { EMPTY } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

/**
 * 网关密钥。
 *
 * **这是访问控制的唯一入口。**端口决定谁能敲门,密钥决定谁能进来 ——
 * 没有密钥,即使从 127.0.0.1 也连不上(core 里是硬行为,不分内外网)。
 *
 * 在此之前这一整页不存在:密钥是「监听与访问」里的一行只读文本,
 * 建不了、改不了、删不了、也绑不了路由。而下面每一件事都依赖它:
 *
 * · **区分客户端。**所有客户端共用一把密钥时,`RequestFacts.client`
 *   永远是同一个值 —— 于是流量和会话里分不出是谁发的,每客户端并发
 *   上限形同虚设,按密钥绑路由也无从谈起。
 * · **绑路由。**一把密钥绑一条路由;没绑就走默认路由。
 * · **吊销。**某个客户端的配置泄露了,要能只换它那一把,而不是全换。
 */
/**
 * 这把密钥能看到哪些模型。
 *
 * 三态,而且**第三态是「一个都不给」** —— 一个写成 `[]` 的空列表。
 * 那不是坏状态,是「临时停掉这个客户端」的正当用法,所以界面上要能
 * 明确选到它,而不是只能通过「删掉最后一条」意外抵达。
 *
 * 三态之间**每个方向都要能走回去**。第一版只有「全部 → 限制」这一
 * 扇单向门:进了限制态就再也回不到全部,因为协议里当时没有「把这个
 * 键抹掉」的说法。回去的那条路是写 `null` —— 和路由解绑同一个做法。
 */
function AllowCell({
  client,
  allow,
  busy,
  onPatch,
}: {
  client: string;
  allow: string[] | null;
  busy: boolean;
  onPatch: (ops: PatchOp[]) => void;
}) {
  const [adding, setAdding] = useState("");
  if (allow === null) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="tw-label text-neutral-500">全部</span>
        <button
          disabled={busy}
          onClick={() => onPatch([{ op: "clear", path: `/clients/${client}/allow` }])}
          className="tw-label text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
        >
          限制
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {allow.length === 0 && (
        <span className="rounded bg-amber-100 px-1.5 tw-label text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          一个都不给
        </span>
      )}
      <button
        disabled={busy}
        onClick={() =>
          onPatch([{ op: "replace", path: `/clients/${client}/allow`, value: null }])
        }
        className="tw-label text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
      >
        全部
      </button>
      {allow.map((m, i) => (
        <span
          key={m}
          className="flex items-center gap-1 rounded border border-neutral-300 px-1.5 font-mono tw-label dark:border-neutral-700"
        >
          {m}
          <button
            disabled={busy}
            onClick={() => onPatch([{ op: "remove", path: `/clients/${client}/allow/${i}` }])}
            className="text-neutral-400 hover:text-red-600 disabled:opacity-30"
            aria-label={`不再允许 ${m}`}
          >
            ×
          </button>
        </span>
      ))}
      <Input
        className="w-24 font-mono"
        value={adding}
        disabled={busy}
        placeholder="glob"
        onChange={(e) => setAdding(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && adding.trim()) {
            onPatch([
              { op: "append", path: `/clients/${client}/allow`, item: adding.trim() },
            ]);
            setAdding("");
          }
        }}
      />
    </div>
  );
}

export default function Keys({
  ov,
  configVersion,
  onChanged,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const routes = ov.routes ?? [];
  const defaultRoute = ov.default_route ?? "默认";

  async function patch(ops: PatchOp[], tag: string) {
    if (!configVersion) {
      setErr("还没读到配置版本，稍等一下再试");
      return false;
    }
    setBusy(tag);
    setErr(null);
    try {
      await invoke("patch_config", { ops, baseVersion: configVersion });
      onChanged();
      return true;
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    if (ov.clients.some((c) => c.name === name)) {
      setErr(`已经有一把叫「${name}」的密钥了`);
      return;
    }
    setBusy("new");
    try {
      // **密钥由 core 生成。**字母表（去掉了 0/O、1/I/l）和长度是安全
      // 决定，在界面里再写一份的话，迟早只有一处被改。
      const key = await invoke<string>("new_key");
      // 名字和密钥**一次写入**。分两次的话，中间那一刻配置里有一把
      // 没有密钥的 client —— 那是个加载不了的状态。
      const ok = await patch(
        [{ op: "append", path: "/clients", item: `name: ${name}\nkey: ${key}` }],
        "new",
      );
      if (ok) {
        setAdding(false);
        setNewName("");
      }
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
      setBusy(null);
    }
  }

  async function regenerate(name: string) {
    setBusy(name);
    try {
      const key = await invoke<string>("new_key");
      await patch([{ op: "replace", path: `/clients/${name}/key`, value: key }], name);
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-5">
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="tw-title font-semibold">网关密钥</h2>
          <p className="tw-body text-neutral-500">
            没有密钥连不上，本机也一样。
          </p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setAdding(true)}
          >
            新建
          </Button>
        </div>

        {adding && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
            <Input
              className="flex-1"
              autoFocus
              value={newName}
              placeholder="给它起个名字，比如 codex"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <Button
              size="sm"
              disabled={busy === "new" || !newName.trim()}
              onClick={() => void create()}
            >
              建
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdding(false)}
            >
              取消
            </Button>
          </div>
        )}

        <table className="mt-3 w-full tw-body">
          <thead className="text-left text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-1.5 font-medium">名字</th>
              <th className="font-medium">密钥</th>
              <th className="font-medium">路由</th>
              <th className="font-medium">并发上限</th>
              <th className="font-medium">可见模型</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ov.clients.map((c) => (
              <tr
                key={c.name}
                className="border-b border-neutral-100 dark:border-neutral-900"
              >
                <td className="py-1.5 font-medium">{c.name}</td>
                <td className="font-mono text-neutral-500">{c.key}</td>
                <td>
                  {/*
                    不绑就是走默认路由 —— 选项里把它写出来，而不是留一个
                    空白。**空白读起来是「还没配」，而它其实一直在生效。**
                  */}
                  <Select
                    value={c.route ?? EMPTY}
                    disabled={busy === c.name}
                    onValueChange={(v) =>
                      void patch(
                        [
                          {
                            op: "replace",
                            path: `/clients/${c.name}/route`,
                            value: v === EMPTY ? null : v,
                          },
                        ],
                        c.name,
                      )
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={EMPTY}>默认（{defaultRoute}）</SelectItem>
                        {routes
                          .filter((r) => !r.default)
                          .map((r) => (
                            <SelectItem key={r.name} value={r.name}>
                              {r.name}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </td>
                <td>
                  <Input
                    variant="inline"
                    className="w-16 font-mono"
                    defaultValue={c.max_concurrent ?? ""}
                    placeholder="不限"
                    disabled={busy === c.name}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const v = raw === "" ? null : Number(raw);
                      if (v !== null && (!Number.isFinite(v) || v < 1)) {
                        setErr("并发上限要是一个 1 以上的整数，或者留空表示不限");
                        return;
                      }
                      if ((c.max_concurrent ?? null) === v) return;
                      void patch(
                        [
                          {
                            op: "replace",
                            path: `/clients/${c.name}/max_concurrent`,
                            value: v,
                          },
                        ],
                        c.name,
                      );
                    }}
                  />
                </td>
                <td>
                  {/*
                    **三态,而且第三态是「一个都不给」。**留空 = 只按方言
                    过滤;写了 glob = 再按它保留;写一个空列表 = 这把密钥
                    看不到任何模型,也就用不了 —— 那是「临时停掉这个客户端」
                    的正当用法,而不是一个坏状态。
                  */}
                  <AllowCell
                    client={c.name}
                    allow={c.allow ?? null}
                    busy={busy === c.name}
                    onPatch={(ops) => void patch(ops, c.name)}
                  />
                </td>
                <td className="text-right">
                  <Tip text="换一把新的。旧的立刻失效 —— 用着它的客户端要重新配。">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy === c.name}
                      onClick={() => void regenerate(c.name)}
                    >
                      换密钥
                    </Button>
                  </Tip>
                  {/*
                    **最后一把不给删。**删光之后谁也连不上，而且配置会
                    加载失败（`validate` 要求至少一把）—— 那时网关起不来，
                    用户看到的是「core 连续失败」，而原因在三步之前。
                  */}
                  <Tip
                    text={
                      ov.clients.length <= 1
                        ? "这是最后一把。删掉之后谁也连不上，配置也会加载失败。"
                        : "删掉它。用着它的客户端立刻连不上。"
                    }
                  >
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={busy === c.name || ov.clients.length <= 1}
                      onClick={() => setConfirmDelete(c.name)}
                    >
                      删除
                    </Button>
                  </Tip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {err && <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>}
      </section>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删掉密钥「{confirmDelete}」？</DialogTitle>
            <DialogDescription>
              用着它的客户端会立刻连不上，要重新配一把。配置有版本历史，删错了能回滚。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const name = confirmDelete;
                setConfirmDelete(null);
                if (name) void patch([{ op: "remove", path: `/clients/${name}` }], name);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
