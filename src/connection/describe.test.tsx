import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ConnectError } from "./api";
import { describeError, shortReason } from "./describe";

const ALL: ConnectError[] = [
  { kind: "unreachable", addr: "192.168.1.20:8789" },
  { kind: "timeout", addr: "192.168.1.20:8789" },
  { kind: "closed", addr: "192.168.1.20:8789" },
  { kind: "wrong_key" },
  { kind: "version_mismatch", ours: "0.48.0", theirs: "0.47.2" },
];

describe("连接失败的原因", () => {
  /** 每一种都要说出发生了什么和下一步：设计稿 ③ 的几种说法 */
  it("每一种都有标题和下一步，两种语言都是", () => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      for (const e of ALL) {
        const d = describeError(e);
        expect(d.title, `${lang} ${e.kind}`).toBeTruthy();
        expect(d.next, `${lang} ${e.kind}`).toBeTruthy();
        expect(shortReason(e), `${lang} ${e.kind}`).toBeTruthy();
      }
    }
    setLang("zh");
  });

  it("版本不一致说出两个版本号", () => {
    setLang("zh");
    const d = describeError({ kind: "version_mismatch", ours: "0.48.0", theirs: "0.47.2" });
    expect(d.title).toBe("版本不一致：服务器 core 0.47.2，本应用需要 0.48.0");
  });

  it("超时和地址不通标题一样，下一步不一样", () => {
    setLang("zh");
    const a = describeError({ kind: "timeout", addr: "h:1" });
    const b = describeError({ kind: "unreachable", addr: "h:1" });
    expect(a.title).toBe("无法连接到 h:1");
    expect(a.title).toBe(b.title);
    expect(shortReason({ kind: "timeout", addr: "h:1" })).toBe("连接超时");
  });
});
