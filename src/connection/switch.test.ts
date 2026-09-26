import { describe, expect, it } from "vitest";
import { setLang, textOf } from "@/i18n";
import type { Adopted } from "./api";
import { connText } from "./connection.i18n";

const warn = (a: Adopted) => textOf(connText).adoptedWarn(a);

describe("切换确认里还指着本机网关的客户端", () => {
  it("只有这台电脑上的：说一共几个", () => {
    const a: Adopted = { count: 2, local_addr: "127.0.0.1:8788", places: [{ distro: null, count: 2 }] };
    expect(warn(a)).toBe("已接管的 2 个客户端仍指向本机网关 127.0.0.1:8788。");
    setLang("en");
    expect(warn(a)).toBe("2 connected clients still point to the local gateway 127.0.0.1:8788.");
  });

  it("WSL 里也有的：按所在的地方分开数", () => {
    const a: Adopted = {
      count: 3,
      local_addr: "127.0.0.1:8788",
      places: [
        { distro: null, count: 2 },
        { distro: "Ubuntu", count: 1 },
      ],
    };
    expect(warn(a)).toBe("已接管的客户端仍指向本机网关 127.0.0.1:8788：这台电脑 2 个、WSL · Ubuntu 1 个。");
    setLang("en");
    expect(warn(a)).toBe(
      "3 connected clients still point to the local gateway 127.0.0.1:8788: 2 on this computer, 1 in WSL · Ubuntu.",
    );
  });

  it("只有 WSL 里的也照样分开说", () => {
    const a: Adopted = { count: 1, local_addr: "127.0.0.1:8788", places: [{ distro: "Debian", count: 1 }] };
    expect(warn(a)).toBe("已接管的客户端仍指向本机网关 127.0.0.1:8788：WSL · Debian 1 个。");
    setLang("en");
    expect(warn(a)).toBe("1 connected client still points to the local gateway 127.0.0.1:8788: 1 in WSL · Debian.");
  });
});
