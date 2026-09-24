"""生成 macOS 应用图标。

    python3 src-tauri/icons/render.py            # 重新生成并装进 icons/
    python3 src-tauri/icons/render.py <目录>     # 只导出各个尺寸，用来看效果

第一种用法产出 tauri.conf.json 里列的那几个文件（32x32.png、128x128.png、
128x128@2x.png、icon.icns），Windows 构建要的 icon.ico，以及 Linux 的
256x256.png、512x512.png。**别手工改
它们** —— 它们是这个脚本的输出，手改会和脚本悄悄分叉，下次谁重新生成一次
就被覆盖了。

不依赖 SVG 光栅化工具，也不依赖图像库（只要 numpy，PNG 编码在下面）：
每个形状用 SDF（有符号距离场）给出「到边界的距离」，再按一个像素的宽度
算覆盖度。好处是分辨率无关，**每个尺寸都是原生画的，不是把大图缩下来**。

标识和企业版是同一个构型（一个 T，竖笔同时是 W 的轴），但**不是同一组
坐标**。企业版那版（web/public/favicon.svg）要塞进一圈内框里，所以横笔
只有 14 宽、W 只有 6 深；这里没有内框，字形放大到填满整块，横笔 18 宽、
W 8 深。改企业版那个标识时，这里不会自动跟着变。
"""
import numpy as np, zlib, struct, sys, shutil, tempfile, subprocess, pathlib

# **霓虹。**近黑的底，TW 本身是发光的霓虹管。
#
# 之前几版都是「一块饱和色 + 一个白标记」，换个字母就是另一个应用。这一版
# 让标记自己带光。底色压到近黑是为了给光留地方 —— 霓虹在白天不好看，
# 理由一样。
BG_TOP    = (0x0D, 0x0F, 0x22)   # 靛蓝，左上受一点光
BG_BOTTOM = (0x02, 0x02, 0x08)   # 近黑
NEON_A    = (0x22, 0xE5, 0xF2)   # 青，笔画左端
NEON_B    = (0xF0, 0x5C, 0xD8)   # 品红，笔画右端

# macOS 的图标网格：内容占画布约 80.5%，四周留透明边。
# 不留的话，它在程序坞里会比旁边所有应用都大一圈。
CONTENT = 824 / 1024

# 字形。坐标在 32×32 的格子里，多段折线，圆头圆角由 SDF 天然带出来。
STROKES = [
    [(7, 9), (25, 9)],                 # T 横
    [(16, 9), (16, 17)],               # T 竖（同时是 W 的轴）
    [(7, 17), (11.5, 25), (16, 17)],   # W 左
    [(16, 17), (20.5, 25), (25, 17)],  # W 右
]

# 大小两套配方。**小的不是把大图缩下来，是重画**：按比例缩下去笔画会细到
# 一个像素以下，抗锯齿会把它抹成一条灰线。
#
# 这几个数是三轮返工试出来的，往回调之前先读上一条注释：
#   half —— 笔画半宽。粗过 2 会把 T 的竖和 W 的夹角堵上，远看是个色块。
#           细而硬才显得精致：扫一眼扫到的应该是字形，不是墨。
#   glow —— (半径, 强度)。半径 3.5 和 1.5 都试过，结果一样：图标上一多半
#           的可见面积成了光晕，整体发虚。**光要窄到贴着笔画**，作用是把
#           边缘的颜色压满，不是让笔画周围亮起来。
BIG   = dict(half=1.40, mark=1.00, glow=(0.30, 0.22))
SMALL = dict(half=1.75, mark=1.04, glow=(0.25, 0.18))   # ≤ 64px

# 管芯留多少白。整根往白里调是让它「看起来在发光」的直觉做法，结果是颜色
# 变淡 —— 真的霓虹是管壁上颜色最浓，只有芯过曝成白。
CORE_WHITE = 0.25


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    """到圆角矩形边界的有符号距离，里面为负。"""
    qx = np.abs(px - cx) - (hw - r)
    qy = np.abs(py - cy) - (hh - r)
    outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
    inside = np.minimum(np.maximum(qx, qy), 0)
    return outside + inside - r


def sd_segment(px, py, ax, ay, bx, by):
    """到线段的距离。多段取 min 之后，接头处自然是圆的。"""
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    h = np.clip((pax * bax + pay * bay) / denom, 0.0, 1.0) if denom else 0.0
    return np.hypot(pax - bax * h, pay - bay * h)


def cover(d, aa):
    """距离 → 覆盖度。aa 是一个像素在 32 格坐标下的宽度。"""
    return np.clip(0.5 - d / aa, 0.0, 1.0)


def render(size):
    """画一张，返回 RGBA 的 uint8 数组。"""
    content_px = size * CONTENT
    scale = content_px / 32.0
    off = (size - content_px) / 2.0

    ys, xs = np.mgrid[0:size, 0:size]
    px = (xs + 0.5 - off) / scale
    py = (ys + 0.5 - off) / scale
    aa = 1.0 / scale
    r = SMALL if size <= 64 else BIG

    img = np.zeros((size, size, 4), dtype=np.float64)

    # ── 底：圆角方 + 左上一点径向受光 + 顶部内高光，否则是一块死黑 ──
    body = sd_round_rect(px, py, 16, 16, 16, 16, 7)
    cov = cover(body, aa)
    t = np.clip(np.hypot(px - 9.0, py - 7.0) / 30.0, 0, 1)[..., None] ** 2.2
    grad = np.array(BG_TOP) * (1 - t) + np.array(BG_BOTTOM) * t
    rim = np.clip(1.0 + body / 1.2, 0, 1) * np.clip(1.0 - py / 9.0, 0, 1)
    grad = grad + (255 - grad) * (rim**2 * 0.20)[..., None]
    img[..., :3] = grad / 255.0
    img[..., 3:4] = cov[..., None]

    # ── 霓虹管 ────────────────────────────────────────────────────
    d = np.full((size, size), 1e9)
    for pts in STROKES:
        pts = [(16 + (x - 16) * r["mark"], 16 + (y - 16) * r["mark"]) for x, y in pts]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            d = np.minimum(d, sd_segment(px, py, ax, ay, bx, by))
    d = d - r["half"]

    # 颜色沿 x 从青到品红。**不是整根一个色** —— 单色霓虹在一排图标里就是
    # 「一个发光的青字」，渐变才让它有材质。
    u = np.clip((px - 7) / 18.0, 0, 1)[..., None]
    col = (np.array(NEON_A) * (1 - u) + np.array(NEON_B) * u) / 255.0

    radius, strength = r["glow"]
    g = np.exp(-np.clip(d, 0, None) / radius) * strength * cov
    img[..., :3] = img[..., :3] + (col - img[..., :3]) * g[..., None]

    # 管内：到中线的归一化距离，0 在管壁、1 在芯。次方 1.5 让白只占中间
    # 一小条，管壁保持满饱和。
    inner = np.clip(-d / r["half"], 0, 1)[..., None]
    core = col + (1.0 - col) * (inner**1.5 * CORE_WHITE)
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


def png_bytes(arr):
    """和 `write_png` 同一份编码，只是不落盘 —— ICO 里塞的就是这些字节。"""
    import io as _io
    buf = _io.BytesIO()
    h, w, _ = arr.shape
    raw = b"".join(b"\x00" + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    buf.write(b"\x89PNG\r\n\x1a\n")
    buf.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
    buf.write(chunk(b"IDAT", zlib.compress(raw, 9)))
    buf.write(chunk(b"IEND", b""))
    return buf.getvalue()


def write_ico(path, cache):
    """Windows 的 `.ico`：一个装着若干张图的壳子。

    **每一张都是原生画的，不是把大图缩下来。**这正是这个脚本存在的理由在
    Windows 上兑现的地方 —— 那里最常被看到的是任务栏通知区那个 16×16，
    而一张 256 缩到 16 的霓虹笔画只会糊成一团。

    里面塞的是 PNG（Vista 起支持），不是 BMP：省掉一份 AND 掩码，而这个
    项目的最低系统是 Win10。
    """
    sizes = sorted(ICO_SIZES)
    imgs = [png_bytes(cache[s]) for s in sizes]
    # ICONDIR：保留位、类型 1 = 图标、张数
    out = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    for size, data in zip(sizes, imgs):
        # 宽高各一个字节，**256 写成 0** —— 一个字节放不下 256
        out += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0,  # 调色板张数，真彩色写 0
            0,  # 保留位
            1,  # 色彩平面
            32,  # 每像素位数
            len(data),
            offset,
        )
        offset += len(data)
    pathlib.Path(path).write_bytes(out + b"".join(imgs))


# `.ico` 里放哪几个尺寸。
#
# 16 是通知区和标题栏，32 是 Alt-Tab 和高 DPI 下的通知区，48 是资源管理器的
# 中图标，256 是大图标和属性对话框。48 以下每一个都真的会被单独拿出来用，
# 所以每一个都单独画。
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)

# .iconset 里每个名字对应的像素数。@2x 是逻辑尺寸的两倍，所以
# icon_16x16@2x 和 icon_32x32 都是 32 像素，只是系统在不同场合取不同的那个。
ICONSET = {
    "icon_16x16": 16,     "icon_16x16@2x": 32,
    "icon_32x32": 32,     "icon_32x32@2x": 64,
    "icon_128x128": 128,  "icon_128x128@2x": 256,
    "icon_256x256": 256,  "icon_256x256@2x": 512,
    "icon_512x512": 512,  "icon_512x512@2x": 1024,
}

# tauri.conf.json 的 bundle.icon 里列的那几个（除 icns 外）。
#
# 256 和 512 是 Linux 的（`tauri.linux.conf.json`）：AppImage 按像素尺寸装进
# `hicolor/<宽>x<高>/apps/`，而 `128x128@2x.png` 在那里落进的是 `256x256@2`，
# 不是桌面环境找大图标时去的那个目录。256 也是应用自己写菜单条目时装进用户
# 目录的那一张（`src/desktop_entry.rs`）。
BUNDLE_PNGS = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "256x256.png": 256,
    "512x512.png": 512,
}

PREVIEW_SIZES = (16, 32, 64, 128, 256, 512, 1024)


def install(icons_dir):
    """渲染 → 打成 .icns → 写进 icons/。整条链子在这里，不在谁的终端历史里。"""
    cache = {}
    with tempfile.TemporaryDirectory() as tmp:
        iconset = pathlib.Path(tmp) / "tw.iconset"
        iconset.mkdir()
        for name, size in ICONSET.items():
            if size not in cache:
                cache[size] = render(size)
            write_png(iconset / f"{name}.png", cache[size])
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(icons_dir / "icon.icns")],
            check=True,
        )
    for name, size in BUNDLE_PNGS.items():
        write_png(icons_dir / name, cache[size])
    # Windows 那一份。**和 icns 同一批渲染**，不是事后拿 png 转的 ——
    # 两条路会在某次改完形状之后悄悄分叉。
    for size in ICO_SIZES:
        if size not in cache:
            cache[size] = render(size)
    write_ico(icons_dir / "icon.ico", cache)
    print(f"  icon.icns + icon.ico + {' + '.join(BUNDLE_PNGS)} → {icons_dir}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        out = pathlib.Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        for s in PREVIEW_SIZES:
            write_png(out / f"{s}.png", render(s))
            print(f"  {s}x{s}")
    elif not shutil.which("iconutil"):
        sys.exit("iconutil 只有 macOS 上有。想看效果的话给个目录，只导出 PNG。")
    else:
        install(pathlib.Path(__file__).resolve().parent)
