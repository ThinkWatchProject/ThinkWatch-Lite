import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ImportRow, SyncConflict, SyncView } from "@/types";
import {
  countRows,
  initialConflictPicks,
  initialPicks,
  keepBothProblem,
  mergeDecisions,
  pickAll,
  refKey,
  remoteDevice,
  renameProblem,
  resolveDecisions,
  unresolved,
} from "./decide";
import { ago, itemLabel, itemWithUnits } from "./labels";
import { sentence, stateMark } from "./Notices";
import { draftOf, EMPTY_TARGET, passphraseProblem, sameTarget, targetOf, targetProblem } from "./target";
import { syncOn } from "./useSync";

const row = (kind: ImportRow["item"]["kind"], name: string, status: ImportRow["status"], extra: Partial<ImportRow> = {}): ImportRow => ({
  item: { kind, name },
  status,
  global: kind === "global",
  flags: [],
  differs: [],
  suggested_name: status === "conflict" ? `${name} (2)` : null,
  error: null,
  refs: [],
  rename_flags: [],
  ...extra,
});

describe("同步位置的表单", () => {
  it("三种位置各自写成 core 要的形状，地址去空白、密码原样，文件夹不经代理", () => {
    expect(targetOf({ ...EMPTY_TARGET, type: "folder", path: "  /Volumes/NAS/ThinkWatch ", proxy: "clash" })).toEqual({
      type: "folder",
      path: "/Volumes/NAS/ThinkWatch",
      proxy: "direct",
    });
    expect(
      targetOf({ ...EMPTY_TARGET, type: "webdav", url: " https://dav.example.com/tw ", user: " me ", pass: " p w ", proxy: "clash" }),
    ).toEqual({ type: "webdav", url: "https://dav.example.com/tw", user: "me", pass: " p w ", proxy: "clash" });
    const s3 = {
      type: "s3" as const,
      endpoint: "https://x.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "tw",
      prefix: "lite/",
      access_key_id: "AKIA",
      secret_access_key: "s",
      proxy: "direct",
    };
    expect(targetOf(draftOf(s3))).toEqual(s3);
  });

  it("换了类型再换回来，填过的还在；别的类型的格子不算改过", () => {
    const d = draftOf({ type: "webdav", url: "https://a", user: "u", pass: "p", proxy: "direct" });
    const moved = { ...d, type: "s3" as const, bucket: "b" };
    expect({ ...moved, type: "webdav" as const }.url).toBe("https://a");
    expect(sameTarget(d, { ...d, bucket: "anything" })).toBe(true);
    expect(sameTarget(d, { ...d, pass: "q" })).toBe(false);
  });

  it("还差哪一格", () => {
    expect(targetProblem({ ...EMPTY_TARGET })).toBe("path");
    expect(targetProblem({ ...EMPTY_TARGET, type: "webdav" })).toBe("url");
    expect(targetProblem({ ...EMPTY_TARGET, type: "webdav", url: "dav.example.com" })).toBe("url_scheme");
    expect(targetProblem({ ...EMPTY_TARGET, type: "webdav", url: "http://192.168.1.2/dav" })).toBeNull();
    expect(targetProblem({ ...EMPTY_TARGET, type: "s3", endpoint: "https://s3" })).toBe("bucket");
    expect(targetProblem({ ...EMPTY_TARGET, type: "s3", endpoint: "https://s3", bucket: "b", access_key_id: "k" })).toBe(
      "secret_access_key",
    );
  });

  it("同步口令至少 12 个字符（按字符数，不按字节），两次一样", () => {
    expect(passphraseProblem("短口令", "短口令")).toBe("short");
    expect(passphraseProblem("一二三四五六七八九十甲乙", "一二三四五六七八九十甲乙")).toBeNull();
    expect(passphraseProblem("correct horse", "correct house")).toBe("mismatch");
  });
});

describe("加入同步时的合并", () => {
  const rows = [
    row("provider", "openrouter", "new"),
    row("provider", "公司中转", "conflict", { differs: ["conn", "models"] }),
    row("provider", "bedrock", "error"),
    row("route", "default", "same"),
    row("global", "failover", "conflict"),
  ];

  it("冲突没有缺省值；全部改名导入跳过全局设置（它只能覆盖或跳过）", () => {
    const picks = initialPicks(rows);
    expect(unresolved(rows, picks)).toBe(2);
    const all = pickAll(rows, picks, "rename");
    expect(all[refKey(rows[1]!.item)]).toEqual({ choice: "rename", name: "公司中转 (2)" });
    expect(all[refKey(rows[4]!.item)]?.choice).toBeNull();
    expect(unresolved(rows, all)).toBe(1);
    expect(unresolved(rows, pickAll(rows, all, "skip"))).toBe(0);
  });

  it("新增的导入、冲突照选的、相同和错误的不交", () => {
    const picks = pickAll(rows, initialPicks(rows), "overwrite");
    picks[refKey(rows[1]!.item)] = { choice: "rename", name: " 公司中转 (MBA) " };
    expect(mergeDecisions(rows, picks)).toEqual([
      { item: { kind: "provider", name: "openrouter" }, action: "import" },
      { item: { kind: "provider", name: "公司中转" }, action: "rename", new_name: "公司中转 (MBA)" },
      { item: { kind: "global", name: "failover" }, action: "overwrite" },
    ]);
    expect(countRows(rows)).toEqual({ new: 1, conflict: 2, same: 1, error: 1 });
  });

  it("改名改得不对的不算选好：空的、和原名一样、和同类的另一项撞名", () => {
    const r = rows[1]!;
    const k = refKey(r.item);
    const base = initialPicks(rows);
    expect(renameProblem(rows, { ...base, [k]: { choice: "rename", name: " " } }, r)).toBe("empty");
    expect(renameProblem(rows, { ...base, [k]: { choice: "rename", name: "公司中转" } }, r)).toBe("same");
    expect(renameProblem(rows, { ...base, [k]: { choice: "rename", name: "openrouter" } }, r)).toBe("taken");
    // 别的种类里有同名的不算撞
    expect(renameProblem(rows, { ...base, [k]: { choice: "rename", name: "default" } }, r)).toBeNull();
  });
});

describe("同步冲突", () => {
  const c = (id: string, name: string, device: string, both = true): SyncConflict => ({
    id,
    item: { kind: "provider", name },
    units: ["conn"],
    local: { device: "Mac mini", at_ms: 1, deleted: false },
    remote: { device, at_ms: 2, deleted: false },
    diff: [],
    both_allowed: both,
    options: both ? ["local", "remote", "both"] : ["local", "remote"],
    reason: null,
  });

  it("只交选了的；两者都保留带新名字，缺省「名称 (设备)」", () => {
    const list = [c("a", "公司中转", "MacBook Air"), c("b", "长上下文", "MacBook Air")];
    const picks = initialConflictPicks(list);
    expect(picks.a).toEqual({ take: null, name: "公司中转 (MacBook Air)" });
    expect(resolveDecisions(list, picks)).toEqual([]);
    picks.a = { ...picks.a!, take: "both" };
    picks.b = { ...picks.b!, take: "remote" };
    expect(resolveDecisions(list, picks)).toEqual([
      { id: "a", take: "both", new_name: "公司中转 (MacBook Air)" },
      { id: "b", take: "remote" },
    ]);
    // 名字和原名一样的不交
    picks.a = { take: "both", name: "公司中转" };
    expect(keepBothProblem(list[0]!, picks.a)).toBe("same");
    expect(resolveDecisions(list, picks).map((d) => d.id)).toEqual(["b"]);
  });

  it("冲突都来自同一台设备时表头写它的名字", () => {
    expect(remoteDevice([c("a", "x", "MacBook Air"), c("b", "y", "MacBook Air")])).toBe("MacBook Air");
    expect(remoteDevice([c("a", "x", "MacBook Air"), c("b", "y", "build-server")])).toBeNull();
  });
});

describe("同步里的写法", () => {
  it("对象和合并单位", () => {
    setLang("zh");
    expect(itemLabel({ kind: "provider", name: "公司中转" })).toBe("上游「公司中转」");
    expect(itemLabel({ kind: "global", name: "failover" })).toBe("故障转移");
    expect(itemLabel({ kind: "security_rule", name: "content/项目代号" })).toBe("安全规则「项目代号」");
    expect(itemLabel({ kind: "route_order", name: "" })).toBe("路由顺序");
    expect(itemWithUnits({ kind: "provider", name: "公司中转" }, ["conn", "billing"])).toBe("上游「公司中转」· 连接、计费");
    expect(itemWithUnits({ kind: "route", name: "长上下文" }, ["all"])).toBe("路由「长上下文」");
    setLang("en");
    expect(itemWithUnits({ kind: "provider", name: "relay" }, ["conn"])).toBe("Upstream “relay” · connection");
    setLang("zh");
  });

  it("多久之前：刚刚、几分钟前、今天几点、更早写日期", () => {
    setLang("zh");
    const now = new Date(2026, 9, 18, 16, 42).getTime();
    expect(ago(now - 20_000, now)).toBe("刚刚");
    expect(ago(now - 2 * 60_000, now)).toBe("2 分钟前");
    expect(ago(new Date(2026, 9, 18, 9, 31).getTime(), now)).toBe("今天 09:31");
    expect(ago(new Date(2026, 9, 16, 11, 2).getTime(), now)).toBe("10-16 11:02");
  });
});

describe("同步状态", () => {
  const view: SyncView = {
    state: "unreachable",
    target: null,
    encrypted: true,
    device: null,
    last_synced_ms: 100,
    failing_since_ms: 50,
    error: null,
    devices: [],
    conflicts: 0,
    skipped: 0,
    notices: [],
    excluded: [],
    excluded_cascade: [],
  };

  it("关着才算没开；忽略的印记随下一次出事换掉", () => {
    expect(syncOn(view)).toBe(true);
    expect(syncOn({ ...view, state: "off" })).toBe(false);
    expect(syncOn(undefined)).toBe(false);
    expect(stateMark(view)).not.toBe(stateMark({ ...view, failing_since_ms: 900 }));
    expect(stateMark(view)).not.toBe(stateMark({ ...view, state: "auth_failed" }));
  });
});

describe("同步原因的写法", () => {
  it("core 的半句单独成行时写成整句；中文整句不动", () => {
    expect(sentence("the sync location could not be reached: timeout")).toBe("The sync location could not be reached: timeout.");
    expect(sentence("无法连接同步位置：超时。")).toBe("无法连接同步位置：超时。");
    expect(sentence("")).toBe("");
  });
});

describe("加入同步时 core 定了的项", () => {
  it("默认网关密钥采用同步数据：不给选、不算没选的冲突、不交处理", () => {
    const rows: ImportRow[] = [
      { item: { kind: "key", name: "default" }, status: "conflict", global: false, flags: [], differs: ["all"], suggested_name: null, error: null, refs: [], rename_flags: [] },
      { item: { kind: "provider", name: "relay" }, status: "conflict", global: false, flags: [], differs: ["conn"], suggested_name: "relay (2)", error: null, refs: [], rename_flags: [] },
    ];
    const auto = [{ item: { kind: "key" as const, name: "default" }, action: "overwrite" as const, reason: "default_key" as const }];
    const picks = initialPicks(rows, auto);
    expect(Object.keys(picks)).toHaveLength(1);
    expect(unresolved(rows, picks, auto)).toBe(1);
    expect(countRows(rows, auto).conflict).toBe(1);
    const all = pickAll(rows, picks, "skip", auto);
    expect(unresolved(rows, all, auto)).toBe(0);
    expect(mergeDecisions(rows, all, auto).map((d) => d.item.name)).toEqual(["relay"]);
  });
});
