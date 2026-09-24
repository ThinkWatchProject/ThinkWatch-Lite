import { useConnections } from "./ConnectionProvider";
import { remoteOf, type RemoteCore } from "./api";

/**
 * 连着远程 core 吗，是哪一台。**连本机时是 null** —— 各页据此说明「改的是这台 Mac，
 * 不是服务器」、藏掉只在本机有意义的东西。
 *
 * 读的是连接那一层推过来的状态（`connection` 事件），不问 core：远程连不上时照样
 * 答得出来。不在连接那一层里面（隔离预览）时当作本机。
 */
export function useRemote(): RemoteCore | null {
  return remoteOf(useConnections().view);
}
