import { describe, expect, it } from "vitest";

import { launchPhase } from "./phase";

const say = (state: string, linked = false, tries = 0, err: string | null = null) =>
  launchPhase(state, linked, tries, err);

describe("启动画面说什么", () => {
  it("没出事时只有两句：在起，或者在取数", () => {
    expect(say("starting").what).toBe("正在启动网关");
    expect(say("starting").problem).toBeNull();
    // 守护等控制面答应了才报运行中：见到它就是在取数了
    expect(say("running:42").what).toBe("正在载入数据");
    expect(say("running:42", true).what).toBe("正在载入数据");
  });

  it("为改配置主动重启的那一下照「在起」算", () => {
    expect(say("restarting:0:0").problem).toBeNull();
    expect(say("restarting:0:0").what).toBe("正在启动网关");
  });

  it("崩了在重启：说第几次、多久后，连着崩才标红", () => {
    const p = say("restarting:1:1000").problem;
    expect(p?.what).toBe("core 已退出，正在进行第 1 次重启");
    expect(p?.next).toBe("1 秒后重试");
    expect(p?.bad).toBe(false);
    expect(say("restarting:3:2000").problem?.bad).toBe(true);
  });

  it("程序运行不了：说原因，给重新启动", () => {
    const p = say("failed:无法运行 /x/twcore：没有执行权限").problem;
    expect(p).toMatchObject({ what: "core 程序无法运行", next: "无法运行 /x/twcore：没有执行权限", bad: true, retry: true });
  });

  it("找不到程序：说原因，重新启动没用就不给", () => {
    expect(say("missing:应用包里没有 twcore").problem).toMatchObject({ bad: true, retry: false });
  });

  it("答应过却连着读不到状态：说读不到的原因", () => {
    const why = "控制面协议版本不一致：core 为 8，界面为 9。请重新构建。";
    // 读失败一次可能只是刚好赶上，不说
    expect(say("running:42", false, 1, why).problem).toBeNull();
    expect(say("running:42", false, 2, why).problem).toMatchObject({ what: "无法读取网关状态", next: why, retry: true });
  });

  it("连上之后不再说出了什么事：那是顶上那条带子的事", () => {
    expect(say("restarting:1:1000", true).problem).toBeNull();
  });
});
