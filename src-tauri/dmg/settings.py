# 磁盘映像的版面，给 dmgbuild 用。
#
# 用法（release.yml 里就是这么调的）：
#   dmgbuild -s src-tauri/dmg/settings.py \
#     -D app="…/ThinkWatch Lite.app" -D dir=src-tauri/dmg -D icon=src-tauri/icons/icon.icns \
#     "ThinkWatch Lite" ThinkWatch-Lite-<版本>-arm64.dmg
#
# **为什么不让 Tauri 打这个映像。**Tauri 摆图标、贴背景靠一段驱动 Finder 的
# AppleScript，而在 CI 上它会自己跳过那一段（`CI=true` 时加 `--skip-jenkins`）
# —— 于是发出去的映像是 Finder 的默认窗口：图标随便摆、没有背景、没有提示。
# dmgbuild 直接写出 Finder 读的那份 .DS_Store，不需要 Finder 也不需要图形
# 界面，在 CI 上和在本地得到的是同一个窗口。
#
# 坐标是点，原点在左上，和 background.swift 里画箭头用的是同一套 —— 改一边
# 要改另一边。

import os.path

app = defines["app"]
name = os.path.basename(app)

files = [app]
symlinks = {"Applications": "/Applications"}

# 映像挂上之后，桌面和 Finder 侧栏里显示的那个卷图标
icon = defines["icon"]

# lzfse 压缩：比 zlib 小，解压更快；系统要求是 macOS 10.11，而应用本身
# 要 12 以上
format = "ULFO"

# 旁边有 background@2x.png 的话，dmgbuild 会合成一张 HiDPI 的 TIFF
background = os.path.join(defines["dir"], "background.png")

window_rect = ((200, 120), (600, 380))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
arrange_by = None
icon_size = 128
text_size = 13

# **不设 `hide_extensions`。**它靠往 `.app` 根目录写一个 FinderInfo 扩展属性来
# 藏后缀，而那会让 `codesign --verify --strict` 判这个包带着「detritus」——
# 签名在严格校验下不成立，Homebrew 读不出签名者，Gatekeeper 可能报「已损坏」。
# 实测过。Finder 默认本来就不显示 `.app` 的后缀，这个设置换不来任何东西。

icon_locations = {
    name: (165, 150),
    "Applications": (435, 150),
}
