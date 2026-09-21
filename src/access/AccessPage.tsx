import type { Overview } from "@/types";
import { KeysSection } from "@/keys/KeysPage";
import { Exposure } from "./Exposure";
import { Limits } from "./Limits";

/**
 * 接入：别人怎么连到这个网关，以及谁能连。
 *
 * **这一页由「网关」和「密钥」合并而来。**「网关」是个错名 —— 这个应用
 * 整体就是网关，而那一页装的是监听范围、并发，和「谁能连」的一半；另一半
 * （密钥）在隔壁。并发也是分开的：全局那几个数在一页，每把密钥自己的上限
 * 在另一页，两个数从来没有同屏出现过。
 *
 * 三节的顺序就是一个请求进来的顺序：先到哪个地址，再验哪把密钥，
 * 最后受哪个并发上限约束。
 */
export function AccessPage({
  ov,
  configVersion,
  onChanged,
  onOpenConfigFile,
  onNavigate,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
  onOpenConfigFile: (focus: string | null) => void;
  onNavigate: (tab: string) => void;
}) {
  return (
    <div className="flex flex-col gap-7 p-5">
      <Exposure ov={ov} configVersion={configVersion} />
      <KeysSection
        ov={ov}
        configVersion={configVersion}
        onChanged={onChanged}
        onOpenConfigFile={onOpenConfigFile}
        onNavigate={onNavigate}
      />
      <Limits ov={ov} configVersion={configVersion} />
    </div>
  );
}
