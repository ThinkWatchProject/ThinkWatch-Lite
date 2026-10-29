import { describe, expect, it } from "vitest";
import { holdTarget } from "./useHold";

/** 页面滚动层 682 高；热力图换区间前在视口 300 处 */
const view = { clientHeight: 682 };

describe("点热力图之后热力图留在原处", () => {
  it("上面那几块变矮了：往回滚同样的距离", () => {
    // 上面的卡片矮了一截，热力图往上挪了 110
    expect(holdTarget({ ...view, scrollTop: 759, scrollHeight: 1458, top: 190 }, 300)).toEqual({ scrollTop: 649, short: 0 });
  });

  it("上面那几块变高了：往下滚", () => {
    expect(holdTarget({ ...view, scrollTop: 400, scrollHeight: 1600, top: 380 }, 300)).toEqual({ scrollTop: 480, short: 0 });
  });

  it("页面短了、滚不到那么下面：差的那一截要在页尾垫出来", () => {
    // 想滚到 759，最多只能到 1194 - 682 = 512
    expect(holdTarget({ ...view, scrollTop: 512, scrollHeight: 1194, top: 547 }, 300)).toEqual({ scrollTop: 759, short: 247 });
  });

  it("没动：原地", () => {
    expect(holdTarget({ ...view, scrollTop: 300, scrollHeight: 1400, top: 300 }, 300)).toEqual({ scrollTop: 300, short: 0 });
  });
});
