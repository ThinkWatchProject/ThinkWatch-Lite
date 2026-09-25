import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ConnectError } from "./api";
import { coreInstallCommand, describeError, profileName, shortReason } from "./describe";

/** 这一版应用配的 core（`ConnView.required_core`） */
const REQUIRED = "0.47.0";

const ALL: ConnectError[] = [
  { kind: "unreachable", addr: "192.168.1.20:8789" },
  { kind: "timeout", addr: "192.168.1.20:8789" },
  { kind: "closed", addr: "192.168.1.20:8789" },
  { kind: "wrong_key" },
  { kind: "version_mismatch", ours: "0.47.0", theirs: "0.48.0" },
];

/** 一段界面文字画出来之后读到的字：去掉标签 */
function plain(node: ReactNode): string {
  return renderToStaticMarkup(<>{node}</>).replace(/<[^>]*>/g, "");
}

describe("连接失败的原因", () => {
  /** 每一种都要说出发生了什么和下一步：设计稿 ③ 的几种说法 */
  it("每一种都有标题和下一步，两种语言都是", () => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      for (const e of ALL) {
        const d = describeError(e, REQUIRED);
        expect(d.title, `${lang} ${e.kind}`).toBeTruthy();
        expect(d.next, `${lang} ${e.kind}`).toBeTruthy();
        expect(shortReason(e), `${lang} ${e.kind}`).toBeTruthy();
      }
    }
    setLang("zh");
  });

  it("版本不一致说出两个版本号", () => {
    setLang("zh");
    const d = describeError({ kind: "version_mismatch", ours: "0.48.0", theirs: "0.47.2" }, "0.48.0");
    expect(d.title).toBe("版本不一致：服务器 core 0.47.2，本应用需要 0.48.0");
  });

  it("超时和地址不通标题一样，下一步不一样", () => {
    setLang("zh");
    const a = describeError({ kind: "timeout", addr: "h:1" }, REQUIRED);
    const b = describeError({ kind: "unreachable", addr: "h:1" }, REQUIRED);
    expect(a.title).toBe("无法连接到 h:1");
    expect(a.title).toBe(b.title);
    expect(shortReason({ kind: "timeout", addr: "h:1" })).toBe("连接超时");
  });
});

describe("版本不一致时在服务器上执行的命令", () => {
  /**
   * **指定版本，不是升级到最新。**服务器上的 core 必须是应用配的那一版；服务器比应用新时，
   * 升级到最新什么也不会改变，`--version` 那一版比服务器上的旧也照装
   */
  it("装的是本应用配的那一版，装完重启服务", () => {
    expect(coreInstallCommand("0.47.0")).toBe("sudo twcore upgrade --version 0.47.0 --restart");
  });

  /** 服务器比应用新（0.48.0 对 0.47.0）：下一步是装应用那一版，不叫「升级」 */
  it("对话框里的下一步给出这条命令，两种语言都不说升级", () => {
    const e: ConnectError = { kind: "version_mismatch", ours: "0.47.0", theirs: "0.48.0" };
    setLang("zh");
    expect(plain(describeError(e, REQUIRED).next)).toBe(
      "在服务器上执行 sudo twcore upgrade --version 0.47.0 --restart 安装本应用需要的版本，然后重新连接。",
    );
    setLang("en");
    expect(plain(describeError(e, REQUIRED).next)).toBe(
      "Run sudo twcore upgrade --version 0.47.0 --restart on the server to install the version this app needs, then connect again.",
    );
  });

  /**
   * 没发版的构建之间版本号相同、协议不同，错误里的 `ours` 带着协议号（见 Rust 的
   * `connector::link_error`）。命令里只能是版本号本身，所以用的是 `required`
   */
  it("命令里的版本来自应用配的那一版，不是错误里那一串", () => {
    setLang("en");
    const e: ConnectError = {
      kind: "version_mismatch",
      ours: "0.47.0 (control protocol 20)",
      theirs: "0.47.0 (control protocol 21)",
    };
    expect(plain(describeError(e, REQUIRED).next)).toContain(" sudo twcore upgrade --version 0.47.0 --restart ");
  });
});

describe("连接的名字", () => {
  /**
   * 本机那一条不用 Rust 给的名字：换语言时界面当场换，不等下一次推送。英文按平台 ——
   * 这里不在应用里、没有注入平台，走的是非 macOS 那一支
   */
  it("本机按界面语言和平台写，远程用用户起的名字", () => {
    const local = { local: true, name: "This Mac" };
    setLang("en");
    expect(profileName(local)).toBe("This computer");
    expect(profileName({ local: false, name: "home-server" })).toBe("home-server");
    setLang("zh");
    expect(profileName(local)).toBe("本机");
  });
});
