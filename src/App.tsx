import { useRef, useState } from "react";
import { useConnections, ConnectionProvider } from "./connection/ConnectionProvider";
import { currentProfile } from "./connection/api";
import { resetResources } from "@/lib/resource";
import { RequestsProvider } from "./useRequests";
import { LaunchScreen } from "./launch/LaunchScreen";
import { useCoreLink } from "./shell/useCoreLink";
import { lazyPart, usePart } from "./shell/lazyPart";

/*
  **主窗口最先加载的只有这一小块**：连接、和 core 之间的那一层（`useCoreLink`）、启动画面。
  主界面（源列表、工具栏、各页）是另一块，在启动画面下面加载 —— 冷启动时启动画面不用等
  它解析完才出现。模块一求值就开始载入它，**落地页（概览）也同时开始载入**，不等主界面
  载入完再去要：两块排着队载入的话，热启动的窗口要多藏一截才出现。
*/
const Workspace = lazyPart(() => import("./shell/Workspace").then((m) => m.default));
void Workspace.preload().catch(() => {});
void import("./overview/OverviewPage").catch(() => {});

/**
 * 主窗口。
 *
 * **换了连接，主界面整个重挂。**流量、会话、概览、各页的缓存都属于原来那个 core ——
 * 两边的请求编号还会重叠 —— 一样样去清，漏一处就是把一台机器的数据安在另一台头上。
 * 连接的对话框挂在重挂的那一层外面（`ConnectionProvider`），切换那一下不跟着消失。
 */
export default function App() {
  return (
    <ConnectionProvider>
      <PerConnection />
    </ConnectionProvider>
  );
}

function PerConnection() {
  const { view } = useConnections();
  // 第一次读到的那个连接不算「换了」：那是启动时本来就要连的
  const seen = useRef<{ id: string | null; n: number }>({ id: null, n: 0 });
  if (view && seen.current.id !== view.current) {
    if (seen.current.id !== null) {
      seen.current.n += 1;
      // 各页的取数缓存（`useResource`）属于原来那个 core
      resetResources();
    }
    seen.current.id = view.current;
  }
  return <Shell key={seen.current.n} first={seen.current.n === 0} />;
}

/**
 * 一个连接上的主窗口：和 core 之间的那一层、主界面、启动画面。
 *
 * **这一层在实时请求上不重画。**请求列表在 `useRequests` 的 store 里，谁用谁订阅（见
 * `RequestsView`）；这里只有连接状态、概览这些「现在什么情况」，变得很少。
 */
function Shell({ first }: { first: boolean }) {
  const conn = useConnections();
  const profile = conn.view ? currentProfile(conn.view) : undefined;
  /** 落地的那一页取好了首屏的数据（主界面报上来的），启动画面等它再交接 */
  const [viewReady, setViewReady] = useState(false);
  const link = useCoreLink({ first, link: conn.view?.link ?? null, viewReady });
  const View = usePart(Workspace);

  return (
    <RequestsProvider value={link.feed.store}>
      {/* 主界面那一块还在载入：什么都不画。冷启动时上面盖着启动画面，热启动时窗口还藏着 */}
      {View && <View link={link} onViewReady={setViewReady} />}
      {link.launching && (
        <LaunchScreen
          remote={profile && !profile.local ? profile.name : null}
          state={link.core}
          linked={link.linked}
          tries={link.tries}
          linkError={link.linkError}
          ready={link.handover}
          onGone={link.endLaunch}
        />
      )}
    </RequestsProvider>
  );
}
