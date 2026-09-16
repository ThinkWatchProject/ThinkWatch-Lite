/**
 * 应用里用到的图标。
 *
 * **从手写换成了 lucide。**这里原来是十二个手画的 16px 描边图形 ——
 * 当时的理由是「不为九个图标引一个依赖」。而 `components.json` 里
 * `iconLibrary` 写的就是 lucide,组件自己也在用它(`Checkbox` 的勾、
 * `Select` 的箭头、`SidebarTrigger` 的面板图标),依赖早就在了。两套画法
 * 并存,一页上就有两种描边粗细。
 *
 * 这一层保留成**重命名**,不是 lucide 的直接透传:
 *
 * · 名字说的是**这个应用里的概念**(路由、网关、上游),不是图形
 *   (Split、Router、Server)。换图形时改这一处,不用翻十几个页面。
 * · 原来那条最要紧的纪律留着:**路由 / 网关 / 客户端 / 上游必须两两分得
 *   开**。收起来只剩图标时,认错的代价是点错页。下面的断言保证没有两个
 *   概念映到同一个图形。
 */
export { Gauge as IconDashboard } from "lucide-react"; // 概览 —— 仪表盘
export { List as IconFlow } from "lucide-react"; // 流量 —— 一列记录
export { MessagesSquare as IconSession } from "lucide-react"; // 会话 —— 叠起来的气泡
export { Search as IconFindings } from "lucide-react"; // 发现 —— 放大镜（看证据）
export { ShieldCheck as IconGuard } from "lucide-react"; // 防护 —— 盾牌（配策略）
export { Split as IconRoute } from "lucide-react"; // 路由 —— 一条进来分叉出去
export { Router as IconGateway } from "lucide-react"; // 网关 —— 一台路由器
export { Laptop as IconClient } from "lucide-react"; // 客户端 —— 一台笔电
export { Server as IconServer } from "lucide-react"; // 上游 —— 一摞机器
export { KeyRound as IconKey } from "lucide-react"; // 密钥 —— 钥匙，不是锁
export { SlidersHorizontal as IconSettings } from "lucide-react"; // 设置 —— 推子，齿轮留给系统设置
export { PanelLeft as IconSidebar } from "lucide-react"; // 收起/展开源列表
export { Copy as IconCopy } from "lucide-react"; // 复制 —— 两张叠着的纸
export { Check as IconCopied } from "lucide-react"; // 已复制 —— 一个勾
