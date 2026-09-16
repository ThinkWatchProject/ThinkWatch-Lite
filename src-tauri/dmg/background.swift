// 磁盘映像窗口的背景图。
//
// 用法：swift src-tauri/dmg/background.swift src-tauri/dmg
// 产出 background.png（1x）和 background@2x.png；dmgbuild 看到 @2x 会自己
// 用 tiffutil 合成一张 HiDPI 的 TIFF。
//
// **生成出来的图也提交。**CI 不跑这个脚本 —— 它只在改版面时手工跑一次；
// 留着它是为了下次改的时候不用从一张 PNG 倒推当初的尺寸和坐标。
//
// **只能是浅色。**窗口一旦设了背景图，Finder 就一律按浅色模式画图标下面的
// 文件名（黑字），不跟随系统的深色模式 —— 深色背景在那时候就是黑底黑字。
//
// 坐标和 settings.py 里的 icon_locations 是同一套：点，原点在左上。

import AppKit

let width: CGFloat = 600
let height: CGFloat = 380

/// 两个图标的中心。改这里就要同时改 settings.py
let appCenter = CGPoint(x: 165, y: 150)
let appsCenter = CGPoint(x: 435, y: 150)
let iconSize: CGFloat = 128

func srgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: alpha)
}

func render(scale: CGFloat, to url: URL) {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(
        data: nil, width: Int(width * scale), height: Int(height * scale),
        bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    // 左上为原点、单位为点 —— 和 Finder 摆图标用的是同一套坐标
    ctx.translateBy(x: 0, y: height * scale)
    ctx.scaleBy(x: scale, y: -scale)

    // 底色：很浅的冷灰，自上而下略微加深一点，不是一整块死白
    let ground = CGGradient(
        colorsSpace: space, colors: [srgb(0xFAFBFD), srgb(0xEEF0F5)] as CFArray,
        locations: [0, 1])!
    ctx.drawLinearGradient(
        ground, start: .zero, end: CGPoint(x: 0, y: height), options: [])

    // 箭头：从应用图标的右边缘指向「应用程序」的左边缘，颜色取自图标
    // 里那道渐变。细线、圆头 —— 它是一个提示，不该比两个图标更抢眼。
    let gap: CGFloat = 26
    let from = CGPoint(x: appCenter.x + iconSize / 2 + gap, y: appCenter.y)
    let to = CGPoint(x: appsCenter.x - iconSize / 2 - gap, y: appsCenter.y)
    let head: CGFloat = 11
    let arrow = CGMutablePath()
    arrow.move(to: from)
    arrow.addLine(to: to)
    arrow.move(to: CGPoint(x: to.x - head, y: to.y - head))
    arrow.addLine(to: to)
    arrow.addLine(to: CGPoint(x: to.x - head, y: to.y + head))
    ctx.saveGState()
    ctx.addPath(arrow)
    ctx.setLineWidth(3.5)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.replacePathWithStrokedPath()
    ctx.clip()
    let accent = CGGradient(
        colorsSpace: space,
        colors: [srgb(0x4FD3F2), srgb(0x9C7CF6), srgb(0xE27FE6)] as CFArray,
        locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(accent, start: from, end: to, options: [])
    ctx.restoreGState()

    // 文字。AppKit 画字要一个「翻转过的」上下文才和上面的坐标一致
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: true)
    func line(_ text: String, size: CGFloat, weight: NSFont.Weight, color: CGColor, y: CGFloat) {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: NSColor(cgColor: color)!,
            .paragraphStyle: style,
        ]
        NSAttributedString(string: text, attributes: attrs)
            .draw(in: CGRect(x: 0, y: y, width: width, height: size * 1.6))
    }
    line("将 ThinkWatch Lite 拖到 Applications 文件夹", size: 14, weight: .medium, color: srgb(0x3A3F4B), y: 278)
    line("首次打开如被系统拦截：系统设置 › 隐私与安全性 › 仍要打开", size: 12, weight: .regular, color: srgb(0x7A8090), y: 306)
    NSGraphicsContext.restoreGraphicsState()

    let image = ctx.makeImage()!
    let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
    // 标上像素密度，Finder 才知道 @2x 那张是给 Retina 的，而不是一张大图
    let dpi = 72 * scale
    CGImageDestinationAddImage(
        dest, image,
        [kCGImagePropertyDPIWidth: dpi, kCGImagePropertyDPIHeight: dpi] as CFDictionary)
    CGImageDestinationFinalize(dest)
}

let out = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".")
render(scale: 1, to: out.appendingPathComponent("background.png"))
render(scale: 2, to: out.appendingPathComponent("background@2x.png"))
print("wrote background.png and background@2x.png")
