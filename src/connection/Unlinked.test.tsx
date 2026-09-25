import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ConnView } from "./api";
import { Mismatch } from "./Unlinked";

/** 连着服务器 homelab，它的 core 比这一版应用配的新 */
const view: ConnView = {
  profiles: [
    { id: "local", name: "This Mac", local: true, host: null, port: null, addr: null, last_connected_at: null },
    {
      id: "homelab",
      name: "homelab",
      local: false,
      host: "192.168.1.20",
      port: 24817,
      addr: "192.168.1.20:24817",
      last_connected_at: null,
    },
  ],
  current: "homelab",
  last_used: "homelab",
  startup: "last",
  link: {
    kind: "down",
    error: { kind: "version_mismatch", ours: "0.47.0", theirs: "0.48.0" },
    attempt: 1,
    at_ms: 0,
    retry_in_ms: 30_000,
    ever: false,
  },
  required_core: "0.47.0",
  data_dir: "~/.thinkwatch",
};

describe("版本不一致页", () => {
  /**
   * 服务器比应用新时，`twcore upgrade` 不带版本什么也不会改变：页面给的命令指定应用配的
   * 那一版。命令放在可以选中的 `<pre>` 里，照原样复制到服务器上执行
   */
  it("给出装本应用那一版的命令，服务器较新时也是这一条", () => {
    const cases = [
      ["zh", "服务器需要运行 core 0.47.0。在服务器上执行以下命令安装此版本，服务器上现有的版本较新或较旧均适用："],
      [
        "en",
        "The server needs core 0.47.0. Run this command on the server to install that version, whether the installed one is newer or older:",
      ],
    ] as const;
    for (const [lang, sentence] of cases) {
      setLang(lang);
      const html = renderToStaticMarkup(<Mismatch view={view} ours="0.47.0" theirs="0.48.0" />);
      expect(html, lang).toContain(sentence);
      expect(html, lang).toMatch(/<pre [^>]*\bselect-text\b[^>]*>sudo twcore upgrade --version 0\.47\.0 --restart<\/pre>/);
    }
  });
});
