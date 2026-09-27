import { describe, expect, it } from "vitest";
import type { DetectedClient, WslGroup } from "@/types";
import { settingsText } from "./SettingsPage.i18n";
import { restoreNames } from "./UninstallSection";

const t = settingsText.zh;

/** 一个客户端。`adopted` 为真是接管着的 */
const client = (name: string, adopted: boolean) => ({ name, adopted_at_ms: adopted ? 1 : null }) as DetectedClient;

/** WSL 里的一个发行版 */
const distro = (name: string, clients: DetectedClient[], error = false) =>
  ({ distro: name, clients, ...(error ? { error: { code: "wsl.unreadable", args: {}, text: "" } } : {}) }) as WslGroup;

/**
 * 卸载确认框里「会被还原的客户端」。**卸载连 WSL 里的也还原**（`restore_all` 逐个
 * 发行版读一遍），按下去之前就要列出来 —— 原来只列这台电脑上的。
 */
describe("卸载会还原哪些客户端", () => {
  it("这台电脑上的和 WSL 里接管着的都列出来，WSL 里的带着发行版", () => {
    const names = restoreNames(
      [client("Claude Code", true), client("Cursor", false)],
      [distro("Ubuntu", [client("Claude Code", true), client("Codex", false)]), distro("Debian", [])],
      t,
    );
    expect(names).toEqual(["Claude Code", "Claude Code (WSL · Ubuntu)"]);
  });

  it("不在 Windows 上：没有 WSL，只列这台电脑上的", () => {
    expect(restoreNames([client("Codex", true)], [], t)).toEqual(["Codex"]);
  });

  /** 列一半等于说另一半不会被还原：有一处没读到就只说「还原已接管的客户端」 */
  it("有一处没读到、或者有个发行版读不动，就不列名字", () => {
    expect(restoreNames(undefined, [], t)).toBeNull();
    expect(restoreNames([client("Codex", true)], undefined, t)).toBeNull();
    expect(restoreNames([client("Codex", true)], [distro("Ubuntu", [], true)], t)).toBeNull();
  });
});
