"""把 ThinkWatch 的 TW 标识渲染成 macOS 应用图标。

几何完全取自企业版的 web/public/favicon.svg 和
web/src/components/brand/think-watch-mark.tsx（两者逐点一致），
所以桌面端的图标和企业版界面里那个是同一个标识。

本机没有任何 SVG 光栅化工具，所以这里用 SDF（有符号距离场）直接算覆盖度：
每个形状给出「到边界的距离」，再按一个像素宽度做抗锯齿。好处是分辨率无关，
16px 和 1024px 都是原生渲染，不是把大图缩下来——缩出来的小图，2px 的描边
会糊成一团灰。
"""
import numpy as np, zlib, struct, sys, pathlib

# **霓虹。**近黑的靛蓝底，TW 本身是发光的霓虹管。
#
# 前面几版都是「一块色 + 一个标记」，换个字母就是另一个应用。这一版让
# 标记自己带光：笔画沿 x 从青渐变到品红，外面三层辉光。底色压到近黑，
# 是为了让光有地方亮 —— 霓虹在白天不好看，理由一样。
BG_TOP    = (0x0D, 0x0F, 0x22)   # 靛蓝，左上受一点光
BG_BOTTOM = (0x02, 0x02, 0x08)   # 近黑
NEON_A    = (0x22, 0xE5, 0xF2)   # 青，笔画左端
NEON_B    = (0xF0, 0x5C, 0xD8)   # 品红，笔画右端

# macOS 的图标网格：内容占画布约 80.5%，四周留透明边。
# 不留的话，它在程序坞里会比旁边所有应用都大一圈。
CONTENT = 824 / 1024


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    """到圆角矩形边界的有符号距离，里面为负。"""
    qx = np.abs(px - cx) - (hw - r)
    qy = np.abs(py - cy) - (hh - r)
    outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
    inside = np.minimum(np.maximum(qx, qy), 0)
    return outside + inside - r


def sd_segment(px, py, ax, ay, bx, by):
    """到线段的距离。圆头和圆角接头是这个函数天然带的——
    多段取 min 之后，接头处自然是圆的。"""
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    h = np.clip((pax * bax + pay * bay) / denom, 0.0, 1.0) if denom else 0.0
    return np.hypot(pax - bax * h, pay - bay * h)


def cover(d, aa):
    """距离 → 覆盖度。aa 是一个像素在 viewBox 单位下的宽度。"""
    return np.clip(0.5 - d / aa, 0.0, 1.0)


def render(size):
    """画一张。

    底是近黑的圆角方（保留一点径向受光和顶部内高光，否则是一块死黑），
    TW 是一根霓虹管：

      · 颜色沿 x 从青到品红。**不是整根一个色** —— 单色霓虹在一排图标里
        就是「一个发光的青字」，渐变才让它有材质。
      · **笔画要细。**这一版之前用过 2.15 的半宽，想着「粗一点更实」，
        结果相反：粗笔画在这个字形里把 T 的竖和 W 的夹角糊成一坨，
        远看是个色块。细而硬的线才显得精致 —— 图标是给人扫一眼的，
        扫到的应该是字形，不是墨。
      · **辉光是一道边光，不是光晕。**半径 0.30，比一个像素还窄。
        之前试过 3.5 和 1.5，两次的结果都是同一个：图标上一多半的可见
        面积成了光，整体发虚。**光要窄到贴着笔画**，它的作用是让边缘
        带上饱和的颜色，不是让笔画周围亮起来。
      · 中心只留很少的白（0.25）。整根往白里调会变成浅色的雾；真的霓虹
        是管壁上颜色最浓。

    **小尺寸（≤64）另算。**笔画按比例会细到亚像素，所以单独给一个更粗
    的半宽、字形放大 4%、边光再收窄一点。这不是把大图缩下来，是重画。
    """
    content_px = size * CONTENT
    scale = content_px / 32.0
    off = (size - content_px) / 2.0

    ys, xs = np.mgrid[0:size, 0:size]
    px = (xs + 0.5 - off) / scale
    py = (ys + 0.5 - off) / scale
    aa = 1.0 / scale
    small = size <= 64

    img = np.zeros((size, size, 4), dtype=np.float64)

    # ── 底 ──────────────────────────────────────────────────────
    body = sd_round_rect(px, py, 16, 16, 16, 16, 7)
    cov = cover(body, aa)
    r = np.hypot(px - 9.0, py - 7.0) / 30.0
    t = np.clip(r, 0, 1)[..., None] ** 2.2
    grad = np.array(BG_TOP) * (1 - t) + np.array(BG_BOTTOM) * t
    rim = np.clip(1.0 + body / 1.2, 0, 1) * np.clip(1.0 - py / 9.0, 0, 1)
    grad = grad + (255 - grad) * (rim**2 * 0.20)[..., None]
    img[..., :3] = grad / 255.0
    img[..., 3:4] = cov[..., None]

    # ── 霓虹管 ──────────────────────────────────────────────────
    logo_scale = 1.04 if small else 1.0
    half = 1.75 if small else 1.40
    strokes = [
        [(7, 9), (25, 9)],                 # T 横
        [(16, 9), (16, 17)],               # T 竖（同时是 W 的轴）
        [(7, 17), (11.5, 25), (16, 17)],   # W 左
        [(16, 17), (20.5, 25), (25, 17)],  # W 右
    ]
    d = np.full((size, size), 1e9)
    for pts in strokes:
        pts = [(16 + (x - 16) * logo_scale, 16 + (y - 16) * logo_scale) for x, y in pts]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            d = np.minimum(d, sd_segment(px, py, ax, ay, bx, by))
    d = d - half

    u = np.clip((px - 7) / 18.0, 0, 1)[..., None]
    col = (np.array(NEON_A) * (1 - u) + np.array(NEON_B) * u) / 255.0

    k, strength = (0.25, 0.18) if small else (0.30, 0.22)
    g = np.exp(-np.clip(d, 0, None) / k) * strength * cov
    img[..., :3] = img[..., :3] + (col - img[..., :3]) * g[..., None]

    # 管内：到中线的归一化距离，0 在管壁、1 在芯。次方 1.5 让白只占中间
    # 一小条，管壁保持满饱和。
    inner = np.clip(-d / half, 0, 1)[..., None]
    core = col + (1.0 - col) * (inner**1.5 * 0.25)
    c = cover(d, aa)[..., None]
    img[..., :3] = img[..., :3] * (1 - c) + core * c

    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


def write_png(path, arr):
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    pathlib.Path(path).write_bytes(png)


if __name__ == "__main__":
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 64, 128, 256, 512, 1024):
        write_png(out / f"{s}.png", render(s))
        print(f"  {s}x{s}")
