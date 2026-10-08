import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { describeCore, surfaceOf } from "./describe";

afterEach(() => setLang("zh"));

describe("侧栏左下角的 core 状态", () => {
  it("在跑、在起、在重启：说第几次，收起时另写一句短的", () => {
    expect(describeCore("running:4242")).toEqual({ text: "运行中", short: "运行中", tone: "ok" });
    expect(describeCore("starting")).toEqual({ text: "启动中", short: "启动中", tone: "warn" });
    expect(describeCore("restarting:3:4000")).toEqual({ text: "重启中（第 3 次）", short: "重启中", tone: "warn" });
  });

  it("安全模式标红，控制面答应了没有都一样", () => {
    expect(describeCore("safe_mode")).toEqual({ text: "安全模式 · 网关未运行", short: "安全模式", tone: "bad" });
    expect(describeCore("safe_mode:4242")).toEqual(describeCore("safe_mode"));
  });

  it("程序运行不了、起来又退出：都是无法启动，原因在启动画面上说", () => {
    expect(describeCore("failed:没有执行权限")).toEqual({ text: "无法启动", short: "无法启动", tone: "bad" });
    expect(describeCore("exited:已有实例在运行")).toEqual(describeCore("failed:x"));
  });

  it("别的都算已停止：停了、找不到程序、远程没连上、认不出的", () => {
    for (const raw of ["stopped", "missing:应用包里没有 twcore", "unlinked", "running", ""]) {
      expect(describeCore(raw)).toEqual({ text: "已停止", short: "已停止", tone: "bad" });
    }
  });

  it("跟着界面语言", () => {
    setLang("en");
    expect(describeCore("restarting:2:1000").text).toBe("Restarting (attempt 2)");
    expect(describeCore("safe_mode").short).toBe("Safe\u00a0mode");
  });
});

describe("配置文件里的一段归哪一页", () => {
  it("上游、密钥、路由、安全、插件各管自己那几段", () => {
    expect(surfaceOf("providers")).toBe("upstreams");
    expect(surfaceOf("proxies")).toBe("upstreams");
    expect(surfaceOf("pricing")).toBe("upstreams");
    expect(surfaceOf("clients")).toBe("keys");
    expect(surfaceOf("routes")).toBe("routing");
    expect(surfaceOf("groups")).toBe("routing");
    expect(surfaceOf("default_route")).toBe("routing");
    expect(surfaceOf("security")).toBe("security");
    expect(surfaceOf("plugins")).toBe("plugins");
  });

  it("监听、日志保留和认不出的段落到设置页", () => {
    expect(surfaceOf("listen")).toBe("settings");
    expect(surfaceOf("retention")).toBe("settings");
    expect(surfaceOf(null)).toBe("settings");
  });
});
