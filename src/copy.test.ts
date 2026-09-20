import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 文案的机械检查。
 *
 * 这里测的不是逻辑，是**几类会反复回来的错误**。每一条都至少犯过一次，
 * 而它们的共同点是：编译通过、类型正确、跑起来也不报错，只是界面上显示
 * 的东西不对。没有东西会告诉你，除非有人正好看到那一屏。
 */

const SRC = "src";

/**
 * 界面文案所在的文件：组件、名称表，以及迁出来的词表（`*.i18n.ts(x)`）。
 *
 * **名称表也要查。**core 0.4 起固定集合的字段只发标识符，「手动选择」
 * 「磁盘空间不足」这些显示文字搬进了 `labels.ts`，不查的话它们就在这条
 * 检查的视线之外。
 */
function copyFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...copyFiles(p));
    else if (e.name.endsWith(".tsx") || e.name === "labels.ts" || e.name.endsWith(".i18n.ts")) out.push(p);
  }
  return out;
}

/** 去掉注释 —— 注释是写给开发者的，不受这些规矩管。 */
function visible(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const files = copyFiles(SRC).map((f) => ({
  path: f,
  text: visible(readFileSync(f, "utf8")),
}));

describe("界面文案", () => {
  /**
   * **犯过三次了。**`**粗体**` 是 Markdown，JSX 的文本节点里它就是四个
   * 星号，会原样显示给用户。注释里可以那么写，界面上不行。
   */
  it("JSX 文本里没有 Markdown 的粗体星号", () => {
    const bad: string[] = [];
    for (const f of files) {
      // >文本** 或 **文本< —— 出现在标签之间的星号
      for (const m of f.text.matchAll(/>[^<>{}]*\*\*[^<>{}]*</g)) {
        bad.push(`${f.path}: ${m[0].slice(0, 60).trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 产品不自称「我们」，也不替用户说「我」。
   *
   * 生产力工具用名词短语和祈使句陈述状态：「写入客户端配置」而不是
   * 「帮我写进客户端配置」，「标记已读」而不是「我看过了」。
   */
  it("界面上不出现第一人称", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/(我们|帮我|我看过|我的改动)/g)) {
        const i = m.index ?? 0;
        bad.push(`${f.path}: …${f.text.slice(Math.max(0, i - 18), i + 14).replace(/\s+/g, " ")}…`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 同一个动作只能有一种说法。
   *
   * 「关掉」和「关闭」曾经在两个对话框上各用一个 —— 用户不会意识到那是
   * 同一个动作，只会觉得这个产品是好几个人拼起来的。
   */
  it("同义词没有混用", () => {
    const pairs: [RegExp, string][] = [
      [/关掉/g, "统一用「关闭」"],
      [/测一下|测速一下/g, "统一用「测试」"],
      [/算账/g, "统一用「预估」或「计算」"],
      [/花费|成本/g, "统一用「费用」"],
    ];
    const bad: string[] = [];
    for (const f of files) {
      for (const [re, hint] of pairs) {
        for (const m of f.text.matchAll(re)) {
          bad.push(`${f.path}: ${m[0]} —— ${hint}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 字号只能从那五级里选（tw-display 是概览上那个金额，只此一处）。
   *
   * 按尺寸命名的类（`text-xs`）和硬编码的 `text-[12px]` 是同一个毛病：
   * 下一个人按「看起来差不多大」来选，于是层级又没了。
   *
   * **`src/ui/` 不在此列。**那里放的是 shadcn 抄进来的组件，它们统一
   * 写 `text-sm` / `text-xs`。这不是破例：下面那条检查保证这两个名字
   * 在 `index.css` 里被绑到 13px 和 11px —— 也就是 tw-body 和 tw-label
   * 本身。同一个字阶，两个名字，不是第五第六级。
   */
  it("没有绕过 type scale 的字号", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.path.startsWith(join(SRC, "ui"))) continue;
      for (const m of f.text.matchAll(/text-(xs|sm|base|\[\d+px\])/g)) {
        bad.push(`${f.path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * **书面语，不是口语。**
   *
   * 这是一个给人管账和排查的工具，界面上的每一句都是产品文案，不是
   * 聊天。「花在哪儿」「哪家更快」「排这么多秒还没轮到就放弃」这类
   * 写法读着亲切，但它们在一个要给人看账单的界面里显得不可靠。
   *
   * 这里列的是几个反复出现的口语标记，不是完整的语感检查 —— 那件事
   * 机器做不了。它拦的是最容易滑回去的那几个。
   */
  it("文案是书面语", () => {
    const spoken = [
      "就好",
      "就行",
      "怎么",
      "哪家",
      "哪儿",
      "啥",
      "扫一眼",
      "攒着",
      "别的设备",
      "这么多秒",
      // 画图那一轮滑回去的几个：把 bar 叫「条子」、把成本说成「亏钱」
      "条子",
      "亏钱",
      "回本",
      "送上去",
      "白跑",
      // 上游页重做时清掉的几个：「不花钱」「随便点」这种说法不该出现在计费相关的界面上
      "花钱",
      "随便点",
      "稍等",
      // 上游页以外那一轮清掉的。口头的判断（要是、多半、还没）和结果（连不上、
      // 起不来、写好了），把上游叫「这家」「每家」，对话式的收尾（知道了、吗？），
      // 以及直接称呼用户的「你」—— 陈述式的文案用不到它
      "要是",
      "马上",
      "多半",
      "还没",
      "没法",
      "看看",
      "接下来",
      "为什么",
      "连不上",
      "起不来",
      "读不动",
      "写好了",
      "什么都不用",
      // 密钥的「可见模型」第三态原本写的是「一个都不给」。三态现在是
      // 全部 / 指定范围 / 无 —— 都在回答同一个问题，都是陈述式
      "都不给",
      "拿到",
      "删掉",
      "发出去",
      "换回来",
      "在听",
      "只看",
      "只计到",
      "那一刻",
      "一分钱",
      "一字节",
      "打码",
      "这家",
      "那家",
      "一家",
      "每家",
      "知道了",
      "吗？",
      "你",
    ];
    const bad: string[] = [];
    for (const f of files) {
      for (const w of spoken) {
        if (f.text.includes(w)) bad.push(`${f.path}: 「${w}」`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * **界面上不许出现我们的工作流。**
   *
   * 「值得报一个 issue」曾经写在上游探测的结果里 —— 那是把维护者的流程
   * 塞给用户。他要知道的只是「这会不会影响我」;想告诉我们的话,设置里
   * 的诊断包本来就在那儿。
   *
   * 同理不该出现在界面上的还有:仓库、提交、编译、单元测试、调试。这些
   * 词一旦出现,说明这个功能服务的是我们,不是用他产品的人。
   */
  it("文案里没有开发流程的词", () => {
    const words = [
      "issue",
      "git",
      "仓库",
      "提交代码",
      "编译",
      "单元测试",
      "回归",
      "调试",
      "堆栈",
    ];
    // 英文词按整词匹配：名称表里的 `github-oauth-token`、`digitalocean-token`
    // 是标识符，不是在说 git
    const found = (text: string, w: string) =>
      /^[a-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(text) : text.includes(w);
    const bad: string[] = [];
    for (const f of files) {
      for (const w of words) {
        if (found(f.text, w)) bad.push(`${f.path}: 「${w}」`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 上面那条豁免赖以成立的前提。
   *
   * 绑定一旦没了，`text-sm` 会悄悄退回 Tailwind 默认的 14px —— 一个
   * 字阶里没有的字号，而且是从组件里渗进来的，不会有任何一处代码看起来
   * 是错的。
   */
  it("text-sm / text-xs 绑在字阶上", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toContain("--text-sm: 0.8125rem"); // 13px = tw-body
    expect(css).toContain("--text-xs: 0.6875rem"); // 11px = tw-label
  });
});
