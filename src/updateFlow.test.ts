import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import { canInstall, describeStep } from "./updateFlow";

describe("谁能在窗口里直接装", () => {
  /**
   * 这一条是产品决定，不是界面细节：Homebrew 装的那一份自己替换之后，
   * 下一次 `brew upgrade` 会把旧版本盖回来。Rust 那一侧也挡着。
   */
  it("Homebrew 装的不给安装按钮", () => {
    expect(canInstall("homebrew")).toBe(false);
  });

  it("从网页下载的可以", () => {
    expect(canInstall("standalone")).toBe(true);
  });

  it("deb 装的也可以：安装那一步由系统授权", () => {
    expect(canInstall("deb")).toBe(true);
  });

  it("开发构建不自己更新", () => {
    expect(canInstall("dev")).toBe(false);
  });
});

describe("安装进行到哪一步", () => {
  it("下载时报已下载和总大小", () => {
    expect(describeStep({ step: "downloading" }, 7_550_000, 13_000_000)).toBe(
      "正在下载 7.2 / 12.4 MB",
    );
  });

  /** 服务器没给总长时，「/ 0.0 MB」是在编一个数 */
  it("总长未知时不报总长", () => {
    const text = describeStep({ step: "downloading" }, 7_550_000, null);
    expect(text).toBe("正在下载 7.2 MB");
    expect(text).not.toContain("/");
  });

  /**
   * 等请求结束的那一段可能有几分钟。**不说在等什么，用户会以为卡住了**
   * —— 而他很可能正是那个发请求的人。
   */
  it("等待时说清在等几个请求", () => {
    expect(describeStep({ step: "waiting", in_flight: 2 }, 0, null)).toBe(
      "等待 2 个进行中的请求结束",
    );
  });

  it("英文按调用那一刻的语言说，请求数分单复数", () => {
    setLang("en");
    expect(describeStep({ step: "downloading" }, 7_550_000, 13_000_000)).toBe(
      "Downloading 7.2 / 12.4 MB",
    );
    expect(describeStep({ step: "waiting", in_flight: 1 }, 0, null)).toBe(
      "Waiting for 1 request in progress to finish",
    );
    expect(describeStep({ step: "waiting", in_flight: 2 }, 0, null)).toBe(
      "Waiting for 2 requests in progress to finish",
    );
  });
});
