// 截图程序：在系统的 WKWebView 里逐张打开截图页，拍下来，套上 macOS 的窗口框。
//
//   swiftc -swift-version 5 -O scripts/shots/capture.swift -o <bin>
//   <bin> <站点目录> <输出目录> [--only overview,keys] [--langs zh,en] [--themes light,dark]
//         [--today <文件>] [--text <目录>] [--eval <文件>]
//
// 平时不直接跑它，跑 `pnpm shots`（scripts/shots/shots.sh）。
//
// **为什么用 WKWebView，不用无头 Chromium。**应用在 macOS 上就是跑在它里面的：字体、
// 原生控件、滚动条都是它画的样子。截图要的是用户在自己的 Mac 上看到的那一屏。
//
// **窗口要真的「在屏幕上」。**离屏的 WKWebView 被当成看不见的页面：
// requestAnimationFrame 不跑、CSS 动画停在第一帧、计时器被节流 —— 拍出来是一个
// 淡入到一半的对话框。所以窗口放在屏幕外很远的地方、但照常 orderFront，再关掉
// WebKit 的遮挡检测和隐藏页面节流：页面认为自己可见，用户的屏幕上什么都不出现。

import AppKit
import WebKit

setvbuf(stdout, nil, _IONBF, 0)

// MARK: - 参数

var args = Array(CommandLine.arguments.dropFirst())
func option(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  let v = args[i + 1]
  args.removeSubrange(i...(i + 1))
  return v
}
func list(_ s: String?) -> [String]? { s.map { $0.split(separator: ",").map(String.init) } }

let only = list(option("--only")).map(Set.init)
let langs = list(option("--langs")) ?? ["zh", "en"]
let themes = list(option("--themes")) ?? ["light", "dark"]
/// 调试用：每张图的页面文字另存一份，不看图也能核对上面写了什么
let textDir = option("--text").map { URL(fileURLWithPath: $0).standardizedFileURL }
/// 截图页算好的「今天的用量」写到这里，菜单栏那几张图照着画
let todayFile = option("--today").map { URL(fileURLWithPath: $0).standardizedFileURL }
/// 调试用：拍之前在页面里跑这个文件里的表达式，把结果打出来（量元素的位置、找被截断的字）
let probe = option("--eval").map { try! String(contentsOfFile: $0, encoding: .utf8) }
guard args.count == 2 else {
  FileHandle.standardError.write(
    "用法：capture <站点目录> <输出目录> [--only 场景,…] [--langs zh,en] [--themes light,dark] [--today <文件>] [--text <目录>] [--eval <文件>]\n".data(using: .utf8)!)
  exit(2)
}
let site = URL(fileURLWithPath: args[0]).standardizedFileURL
let out = URL(fileURLWithPath: args[1]).standardizedFileURL

// MARK: - 尺寸

/// 网页的大小，点。应用窗口默认 1100 × 720，这里少拍 30 点：图的比例和以前那一套一样，
/// 官网按 2360 × 1540 排的版不用动
let pageW = 1100.0
let pageH = 690.0
/// 视网膜的 2 倍
let scale = 2.0
/// 窗口四周留给阴影的边，点
let margin = 40.0
/// macOS 26 上标题栏式窗口的圆角，点（量的是 NSThemeFrame 的 `_cornerRadius`）
let corner = 16.0

// MARK: - 站点

/// 把构建好的截图页按 `shots://app/<路径>` 交给 WKWebView。**不起本地服务器**：
/// 端口常被别的开发服务器占着，而这里只要读几个文件
final class Site: NSObject, WKURLSchemeHandler {
  let root: URL
  init(root: URL) { self.root = root }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let file = root.appendingPathComponent(String(url.path.dropFirst()))
    guard let data = try? Data(contentsOf: file) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let types = [
      "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
      "svg": "image/svg+xml", "png": "image/png", "woff2": "font/woff2",
    ]
    let type = types[file.pathExtension] ?? "application/octet-stream"
    task.didReceive(
      HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type])!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// 页面里的报错收进 `window.__shotLog`。截图页出了错也会画出一屏东西，不看这个就会拍下
/// 一张少了半页的图
let consoleHook = """
  (() => {
    const log = (window.__shotLog = []);
    const text = (a) => a instanceof Error ? (a.stack || a.message) : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })();
    for (const level of ["error", "warn"]) {
      const orig = console[level].bind(console);
      console[level] = (...a) => { log.push(level + ": " + a.map(text).join(" ")); orig(...a); };
    }
    addEventListener("error", (e) => log.push("error: " + e.message + " @ " + e.filename + ":" + e.lineno));
    addEventListener("unhandledrejection", (e) => log.push("error: unhandled " + text(e.reason)));
  })();
  """

/// 页面上放不下的表格：表格外那一层能横着滚，而内容比它宽。拍出来就是右边几列被切掉的
/// 一张图，所以这样的场景不拍，报出来（每一处是「要多宽 > 有多宽」，单位是点）
let clippedTables = """
  [...document.querySelectorAll("table")].flatMap((t) => {
    const r = t.getBoundingClientRect();
    if (r.width === 0) return [];
    for (let el = t.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowX;
      if (o !== "auto" && o !== "scroll" && o !== "hidden") continue;
      return el.scrollWidth > el.clientWidth + 1 ? [`${el.scrollWidth} > ${el.clientWidth}`] : [];
    }
    return r.right > innerWidth + 1 ? [`${Math.ceil(r.right)} > ${innerWidth}`] : [];
  })
  """

// MARK: - 拍

struct PageState: Decodable {
  struct Shot: Decodable {
    let state: String
    let message: String?
  }
  let shot: Shot?
  let list: [String]?
  let log: [String]
}

@MainActor
final class Shooter {
  let window: NSWindow
  let handler: Site

  init(site: URL) {
    handler = Site(root: site)
    window = NSWindow(
      contentRect: NSRect(x: -32000, y: -32000, width: pageW, height: pageH),
      styleMask: [.borderless], backing: .buffered, defer: false)
    window.orderFront(nil)
  }

  func webView(dark: Bool) -> WKWebView {
    let cfg = WKWebViewConfiguration()
    // 每张图一个干净的存储：应用把侧栏开合、归组开关记在 localStorage 里
    cfg.websiteDataStore = .nonPersistent()
    cfg.setURLSchemeHandler(handler, forURLScheme: "shots")
    cfg.userContentController.addUserScript(
      WKUserScript(source: consoleHook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // 私有的偏好设置，按 KVC 的 `_set<Key>:` 找得到。没有这一项的系统上跳过
    for key in ["hiddenPageDOMTimerThrottlingEnabled", "pageVisibilityBasedProcessSuppressionEnabled"] {
      if cfg.preferences.responds(to: NSSelectorFromString("_set\(key.prefix(1).uppercased())\(key.dropFirst()):")) {
        cfg.preferences.setValue(false, forKey: key)
      }
    }
    let web = WKWebView(frame: NSRect(x: 0, y: 0, width: pageW, height: pageH), configuration: cfg)
    if web.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")) {
      web.setValue(false, forKey: "windowOcclusionDetectionEnabled")
    }
    // 不管这台 Mac 的屏幕是几倍，都按 2 倍画
    if web.responds(to: NSSelectorFromString("_setOverrideDeviceScaleFactor:")) {
      web.setValue(scale, forKey: "overrideDeviceScaleFactor")
    }
    // 深浅色只看这个：应用跟着 `prefers-color-scheme` 走，而 WKWebView 的这一项随外观翻
    web.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    window.contentView = web
    return web
  }

  /// 打开一页，等它说「可以拍了」
  func open(_ web: WKWebView, _ query: String) async throws -> PageState {
    web.load(URLRequest(url: URL(string: "shots://app/scripts/shots/index.html?\(query)")!))
    let t0 = Date()
    while true {
      try await Task.sleep(nanoseconds: 100_000_000)
      let raw = try? await web.evaluateJavaScript(
        "JSON.stringify({ shot: window.__shot ?? null, list: window.__shotList ?? null, log: window.__shotLog ?? [] })")
      if let raw = raw as? String, let state = try? JSONDecoder().decode(PageState.self, from: Data(raw.utf8)),
        let shot = state.shot, shot.state != "loading"
      {
        return state
      }
      if Date().timeIntervalSince(t0) > 60 { throw Failure("等了 60 秒，页面还没摆好：\(query)") }
    }
  }

  func shoot(scene: String, lang: String, dark: Bool) async throws -> CGImage {
    let web = webView(dark: dark)
    let state = try await open(web, "scene=\(scene)&lang=\(lang)")
    for line in state.log { print("    \(line)") }
    if state.shot?.state == "error" { throw Failure(state.shot?.message ?? "场景出错") }
    if state.log.contains(where: { $0.hasPrefix("error") }) { throw Failure("页面报了错（见上）") }
    if let clipped = try await web.evaluateJavaScript(clippedTables) as? [String], !clipped.isEmpty {
      throw Failure(
        "表格在 \(Int(pageW)) 点宽的窗口里放不下（\(clipped.joined(separator: "，"))），拍出来右边是切掉的。"
          + "这一个场景可以收起侧栏：scenes.ts 里给它 `storage: { rail: \"collapsed\" }`")
    }
    if let probe {
      let out = try? await web.evaluateJavaScript(probe)
      print("    \(out.map { "\($0)" } ?? "（没有结果）")")
    }
    if let textDir, let text = try? await web.evaluateJavaScript("document.body.innerText") as? String {
      let file = textDir.appendingPathComponent("\(lang)/\(scene)-\(dark ? "dark" : "light").txt")
      try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try? text.write(to: file, atomically: true, encoding: .utf8)
    }
    // **连着两张一样才算拍到。**页面说好了之后仍可能有东西在变（新行的动效、晚到一步的
    // 重画），拍到半截的那一帧，同一张图两次就对不上
    var last = try await snapshot(web)
    for _ in 0..<20 {
      try await Task.sleep(nanoseconds: 300_000_000)
      let next = try await snapshot(web)
      if next.data == last.data { return next.image }
      last = next
    }
    throw Failure("等了 6 秒，页面还在变")
  }

  func snapshot(_ web: WKWebView) async throws -> (image: CGImage, data: Data) {
    let cfg = WKSnapshotConfiguration()
    cfg.afterScreenUpdates = true
    let image = try await web.takeSnapshot(configuration: cfg)
    guard let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw Failure("截不到图") }
    guard cg.width == Int(pageW * scale), cg.height == Int(pageH * scale) else {
      throw Failure("截到的图是 \(cg.width)×\(cg.height)，应为 \(Int(pageW * scale))×\(Int(pageH * scale))")
    }
    guard let data = cg.dataProvider?.data as Data? else { throw Failure("读不到像素") }
    return (cg, data)
  }

  func scenes() async throws -> [String] {
    let web = webView(dark: false)
    let state = try await open(web, "list")
    guard let list = state.list else { throw Failure("读不到场景列表") }
    if let todayFile, let json = try await web.evaluateJavaScript("JSON.stringify(window.__shotToday)") as? String {
      try json.write(to: todayFile, atomically: true, encoding: .utf8)
    }
    return list
  }
}

struct Failure: Error, CustomStringConvertible {
  let description: String
  init(_ s: String) { description = s }
}

// MARK: - 窗口框

/// 套上 macOS 的窗口：圆角、细边、阴影、红绿灯。**照 macOS 26 的尺寸画**：红绿灯直径
/// 14 点，左边缘在 9 / 32 / 55 点，上边缘在 9 点（Overlay 标题栏，量的是 standardWindowButton）
func frame(_ page: CGImage, dark: Bool) -> CGImage {
  let w = Int((pageW + margin * 2) * scale)
  let h = Int((pageH + margin * 2) * scale)
  let ctx = CGContext(
    data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .none
  // 下面按点画。**阴影的偏移和模糊不跟着缩放**，那两个数写的是像素
  ctx.scaleBy(x: scale, y: scale)
  let win = CGRect(x: margin, y: margin, width: pageW, height: pageH)
  let shape = CGPath(roundedRect: win, cornerWidth: corner, cornerHeight: corner, transform: nil)
  let black = { (a: Double) in CGColor(gray: 0, alpha: a) }

  // 阴影：一层大而软的，一层贴着窗口边的
  for (dy, blur, alpha) in [(20.0, 70.0, dark ? 0.52 : 0.3), (2.0, 6.0, dark ? 0.5 : 0.16)] {
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -dy), blur: blur, color: black(alpha))
    ctx.addPath(shape)
    ctx.setFillColor(black(1))
    ctx.fillPath()
    ctx.restoreGState()
  }

  // 网页。y 轴朝上，CGImage 按原样画进去就是正的
  ctx.saveGState()
  ctx.addPath(shape)
  ctx.clip()
  ctx.draw(page, in: win)
  ctx.restoreGState()

  // 红绿灯
  let top = margin + pageH
  for (i, (r, g, b)) in [(255.0, 95.0, 87.0), (254.0, 188.0, 46.0), (40.0, 200.0, 64.0)].enumerated() {
    let dot = CGRect(x: margin + 9 + Double(i) * 23, y: top - 9 - 14, width: 14, height: 14)
    ctx.setFillColor(CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: 1))
    ctx.fillEllipse(in: dot)
    ctx.setStrokeColor(black(dark ? 0.2 : 0.1))
    ctx.setLineWidth(0.5)
    ctx.strokeEllipse(in: dot.insetBy(dx: 0.25, dy: 0.25))
  }

  // 边：浅色是一道淡淡的深线；深色是外面一道黑、里面一道亮
  let px = 1 / scale
  func stroke(_ inset: Double, _ color: CGColor) {
    let r = win.insetBy(dx: inset + px / 2, dy: inset + px / 2)
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: corner - inset, cornerHeight: corner - inset, transform: nil))
    ctx.setStrokeColor(color)
    ctx.setLineWidth(px)
    ctx.strokePath()
  }
  if dark {
    stroke(0, black(0.9))
    stroke(px, CGColor(gray: 1, alpha: 0.14))
  } else {
    stroke(0, black(0.16))
  }
  return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) throws {
  try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
    throw Failure("写不了 \(url.path)")
  }
  // 144 dpi：在预览里按 1 倍的大小打开
  CGImageDestinationAddImage(dest, image, [kCGImagePropertyDPIWidth: 144, kCGImagePropertyDPIHeight: 144] as CFDictionary)
  guard CGImageDestinationFinalize(dest) else { throw Failure("写不了 \(url.path)") }
}

// MARK: - 主流程

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

Task { @MainActor in
  var failed: [String] = []
  do {
    let shooter = Shooter(site: site)
    let all = try await shooter.scenes()
    if let only, let unknown = only.first(where: { !all.contains($0) }) { throw Failure("没有这个场景：\(unknown)") }
    for scene in all where only?.contains(scene) ?? true {
      for lang in langs {
        for theme in themes {
          let name = "\(lang)/\(scene)-\(theme).png"
          do {
            let page = try await shooter.shoot(scene: scene, lang: lang, dark: theme == "dark")
            try writePNG(frame(page, dark: theme == "dark"), to: out.appendingPathComponent(name))
            print("  \(name)")
          } catch {
            print("  \(name) 失败：\(error)")
            failed.append(name)
          }
        }
      }
    }
  } catch {
    print("失败：\(error)")
    exit(1)
  }
  if !failed.isEmpty {
    print("\(failed.count) 张没拍成：\(failed.joined(separator: ", "))")
    exit(1)
  }
  exit(0)
}
app.run()
