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

BG   = (0x1E, 0x2A, 0x4A)   # 深靛蓝，企业版 favicon 的底色
INK  = (0x3D, 0xDB, 0xD9)   # 青色，描边

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


def over(dst, color, alpha):
    """把一个纯色按 alpha 合成到 dst（premultiplied 之外的常规 over）。"""
    a = alpha[..., None]
    src = np.array(color, dtype=np.float64) / 255.0
    dst_rgb, dst_a = dst[..., :3], dst[..., 3:4]
    out_a = a + dst_a * (1 - a)
    safe = np.where(out_a > 0, out_a, 1)
    out_rgb = (src * a + dst_rgb * dst_a * (1 - a)) / safe
    return np.concatenate([out_rgb, out_a], axis=-1)


def render(size):
    # viewBox 是 32 单位；内容区占 CONTENT，居中
    content_px = size * CONTENT
    scale = content_px / 32.0
    off = (size - content_px) / 2.0

    ys, xs = np.mgrid[0:size, 0:size]
    # 像素中心 → viewBox 坐标
    px = (xs + 0.5 - off) / scale
    py = (ys + 0.5 - off) / scale
    aa = 1.0 / scale  # 一个像素在 viewBox 里有多宽

    img = np.zeros((size, size, 4), dtype=np.float64)

    # 底：整块 32×32 圆角矩形，rx=7（favicon.svg 第一行）
    d = sd_round_rect(px, py, 16, 16, 16, 16, 7)
    img = over(img, BG, cover(d, aa))

    # 内框：x=3 y=3 w=26 h=26 rx=6，描边 2 —— 「审计边界」
    d = np.abs(sd_round_rect(px, py, 16, 16, 13, 13, 6)) - 1.0
    img = over(img, INK, cover(d, aa))

    # T 的横和竖、W 的两个 V。全部 2.4 宽、圆头圆角。
    strokes = [
        [(9, 10), (23, 10)],              # T 横
        [(16, 10), (16, 16)],             # T 竖（同时是 W 的轴）
        [(9, 16), (12, 22), (16, 16)],    # W 左
        [(16, 16), (20, 22), (23, 16)],   # W 右
    ]
    d = np.full((size, size), 1e9)
    for pts in strokes:
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            d = np.minimum(d, sd_segment(px, py, ax, ay, bx, by))
    img = over(img, INK, cover(d - 1.2, aa))

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
