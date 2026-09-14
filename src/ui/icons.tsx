/**
 * 源列表的图标。
 *
 * **手写,不引图标库。**九个 16px 的描边图形大约一百行,而
 * `lucide-react` 是一个依赖、一整套用不到的图形、以及一份需要跟着升级
 * 的东西。这个代码库已经有手写 SVG 图表和手写 PNG 编码器的先例,理由
 * 是同一个。
 *
 * 画法对齐 SF Symbols 的观感:16×16 画布、1.5 描边、圆头圆角、留 2px
 * 边距。**不要改成填充式** —— 描边和填充混在一列里,眼睛会把填充的那
 * 个读成「选中」。
 *
 * 最要紧的一条:**这九个图形必须两两分得开**。路由 / 网关 / 客户端是
 * 三个容易混的概念,收起来只剩图标时,认错的代价是点错页。所以它们用
 * 的是三种不同的骨架(分叉的箭头、上下两层的机架、一台笔电),而不是
 * 三个方块加不同的小装饰。
 */

type P = { className?: string; size?: number };

function S({ size = 16, className, children }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 概览 —— 仪表盘指针 */
export const IconDashboard = (p: P) => (
  <S {...p}>
    <path d="M2.6 12.4a6.4 6.4 0 1 1 10.8 0" />
    <path d="M8 12.4 10.7 8.6" />
  </S>
);

/** 流量 —— 一列长短不一的记录 */
export const IconFlow = (p: P) => (
  <S {...p}>
    <path d="M2.6 4.4h10.8" />
    <path d="M2.6 8h7.4" />
    <path d="M2.6 11.6h9.1" />
  </S>
);

/** 会话 —— 两个叠起来的气泡 */
export const IconSession = (p: P) => (
  <S {...p}>
    <rect x="2" y="3" width="9" height="6.6" rx="2" />
    <path d="M5 12.6h6a2 2 0 0 0 2-2V6.4" />
  </S>
);

/** 发现 —— 放大镜。看证据,不是配策略 */
export const IconFindings = (p: P) => (
  <S {...p}>
    <circle cx="7.2" cy="7.2" r="4.3" />
    <path d="M10.5 10.5 13.4 13.4" />
  </S>
);

/** 防护 —— 盾牌带勾。配策略,不是看证据 */
export const IconGuard = (p: P) => (
  <S {...p}>
    <path d="M8 2.2 13 4.2v3.9c0 3-2.1 5-5 5.7-2.9-.7-5-2.7-5-5.7V4.2Z" />
    <path d="M5.9 7.9 7.4 9.4l2.8-3" />
  </S>
);

/** 路由 —— 一条进来,分叉出去 */
export const IconRoute = (p: P) => (
  <S {...p}>
    <path d="M2.4 8h3.2l2.6-3.7h5.4" />
    <path d="M8.2 11.7h5.4" />
    <path d="M11.7 2.6 13.6 4.3 11.7 6" />
    <path d="M11.7 10 13.6 11.7 11.7 13.4" />
  </S>
);

/** 网关 —— 上下两层的机架 */
export const IconGateway = (p: P) => (
  <S {...p}>
    <rect x="2.2" y="2.6" width="11.6" height="4.6" rx="1.4" />
    <rect x="2.2" y="8.8" width="11.6" height="4.6" rx="1.4" />
    <path d="M4.8 4.9h.01" />
    <path d="M4.8 11.1h.01" />
  </S>
);

/** 客户端 —— 一台笔电 */
export const IconClient = (p: P) => (
  <S {...p}>
    <rect x="2.4" y="3.2" width="11.2" height="7.4" rx="1.4" />
    <path d="M1.4 13.2h13.2" />
  </S>
);

/** 设置 —— 两条推子。齿轮留给系统设置,别撞 */
export const IconSettings = (p: P) => (
  <S {...p}>
    <path d="M2.4 4.6h4.2" />
    <path d="M9.4 4.6h4.2" />
    <circle cx="8" cy="4.6" r="1.7" />
    <path d="M2.4 11.4h2.2" />
    <path d="M7.4 11.4h6.2" />
    <circle cx="6" cy="11.4" r="1.7" />
  </S>
);

/**
 * 收起 / 展开源列表。
 *
 * 用的是系统那个图形:一个矩形,左边一栏填实。**填的那一栏就是源列表
 * 本身**,所以它同时说明了「这个按钮管的是左边那条」和「它现在是开
 * 的」—— 换成箭头就只剩方向,说不出管的是什么。
 */
export const IconSidebar = (p: P) => (
  <S {...p}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6.2 3v10" />
  </S>
);
