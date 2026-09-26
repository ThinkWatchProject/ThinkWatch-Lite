//! 产品截图里的菜单栏：`pnpm shots` 调它，用真的画法（`menubar::macos`）画出 README 和
//! 官网用的那几张图。**不起应用、不碰 `~/.thinkwatch`。**
//!
//! ```sh
//! cargo run --manifest-path src-tauri/Cargo.toml --example menubar_shots -- \
//!   --out docs/screenshots [--today <token 数> <费用微分> <请求数> <失败数>] [--now <毫秒>]
//! ```
//!
//! 写出两样：
//!
//! - `menubar-{light,dark}.png`：菜单栏上的那一块（标识和两行数字），放在一段菜单栏底色上。
//!   和语言无关：上面只有数字。
//! - `{zh,en}/menubar-menu-{light,dark}.png`：点开之后的菜单。**标准菜单项是近似画的**（真的
//!   由 AppKit 画，离屏拿不到），自定义的几行和菜单栏那一块是真的，见 `macos::preview_image`。
//!
//! 数据和截图页（scripts/shots/）是同一个场景：今天的用量由 `--today` 传进来，就是概览上
//! 的那几个数；ChatGPT 额度、正在跑的那一条请求、连接列表和截图页里的一致。
//!
//! **时钟也是截图页那一只。**`--now` 是截图页定住的那一刻（`scripts/shots/boot.ts` 的
//! `NOW`）：额度还有多久重置、正在跑的那一条跑了几秒，都从它算，所以哪天拍出来都一样。
//! 不给就用同一刻（本地时间 2026-09-25 16:42:07）。

#[cfg(target_os = "macos")]
fn main() {
    use std::path::{Path, PathBuf};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSApplicationActivationPolicy, NSBezierPath, NSBitmapImageFileType,
        NSBitmapImageRep, NSCalibratedRGBColorSpace, NSColor, NSColorRenderingIntent, NSColorSpace,
        NSCompositingOperation, NSGraphicsContext, NSImage, NSRectFillUsingOperation,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};
    use thinkwatch_lite_lib::i18n::{self, Lang};
    use thinkwatch_lite_lib::menubar::{macos, model};

    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |name: &str, n: usize| -> Option<Vec<String>> {
        let i = args.iter().position(|a| a == name)?;
        Some(args.get(i + 1..=i + n)?.to_vec())
    };
    let out = PathBuf::from(arg("--out", 1).expect("用法：menubar_shots --out <目录>")[0].clone());
    // 今天的用量。截图页算好了传进来；单独跑的时候用一组像样的数
    let today = arg("--today", 4)
        .map(|v| {
            v.iter()
                .map(|s| s.parse::<i64>().expect("--today 要四个整数"))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![11_200_000, 9_870_000, 214, 2]);

    let mtm = MainThreadMarker::new().expect("主线程");
    NSApplication::sharedApplication(mtm)
        .setActivationPolicy(NSApplicationActivationPolicy::Accessory);

    let now = arg("--now", 1)
        .map(|v| v[0].parse::<u64>().expect("--now 要一个毫秒数"))
        .unwrap_or_else(|| {
            // 和 boot.ts 一样按本地时间取这一刻，换了时区拍出来的字也一样
            // SAFETY: tm 是只含整数和指针的 C 结构，全零是合法的值
            let mut tm: libc::tm = unsafe { std::mem::zeroed() };
            tm.tm_year = 2026 - 1900;
            tm.tm_mon = 8;
            tm.tm_mday = 25;
            tm.tm_hour = 16;
            tm.tm_min = 42;
            tm.tm_sec = 7;
            tm.tm_isdst = -1;
            // SAFETY: 传进去的是上面那一块 tm，mktime 只按本地时区换算、改写它
            let secs = unsafe { libc::mktime(&mut tm) };
            u64::try_from(secs).expect("本地时间换算不出") * 1000
        });
    const MIN: u64 = 60_000;
    const HOUR: u64 = 60 * MIN;
    let snapshot = || model::Snapshot {
        gateway: model::Gateway::Running,
        addr: Some("127.0.0.1:8788".into()),
        today: Some(model::Today {
            tokens: today[0],
            cost_micros: today[1],
            requests: today[2],
            failed: today[3],
        }),
        quotas: vec![model::Quota {
            provider: "chatgpt".into(),
            windows: vec![
                model::Window {
                    window: "5h".into(),
                    used_percent: 58.0,
                    resets_at_ms: Some(now + HOUR + 48 * MIN),
                    status: None,
                    credits: None,
                },
                model::Window {
                    window: "weekly".into(),
                    used_percent: 31.0,
                    resets_at_ms: Some(now + 3 * 24 * HOUR + 7 * HOUR),
                    status: None,
                    credits: None,
                },
            ],
            reset_credits: None,
        }],
        live: vec![model::Live {
            id: 48_117,
            app: Some("claude-code".into()),
            key: "claude-code".into(),
            model: "claude-sonnet-5".into(),
            started_ms: now - 6_000,
        }],
        rate: Some(64),
        notices_on: true,
        connections: vec![
            model::Connection {
                id: "local".into(),
                name: thinkwatch_lite_lib::tr!("本机", "This Mac").into(),
                current: true,
            },
            model::Connection {
                id: "p-homelab".into(),
                name: "homelab".into(),
                current: false,
            },
            model::Connection {
                id: "p-build".into(),
                name: "build-server".into(),
                current: false,
            },
        ],
        now_ms: now,
        ..Default::default()
    };

    /*
      **正好按 2 倍写。**`macos::write_png` 按屏幕的倍数再乘 2，在视网膜屏上出来的是 4 倍，
      换一台机器又不一样；这里自己开一块 2 倍的画布画进去，再转成 sRGB 存盘。
    */
    let write = |image: &Retained<NSImage>, path: &Path| {
        let size = image.size();
        // SAFETY: planes 传空，AppKit 自己分配；其余参数是一块 8 位 RGBA 的画布
        let rep = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                std::ptr::null_mut(),
                (size.width * 2.0).round() as isize,
                (size.height * 2.0).round() as isize,
                8,
                4,
                true,
                false,
                NSCalibratedRGBColorSpace,
                0,
                0,
            )
        }
        .expect("开不了画布");
        rep.setSize(size);
        let ctx = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep).expect("画不进画布");
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&ctx));
        image.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), size));
        NSGraphicsContext::restoreGraphicsState_class();
        let srgb = rep
            .bitmapImageRepByConvertingToColorSpace_renderingIntent(
                &NSColorSpace::sRGBColorSpace(),
                NSColorRenderingIntent::Default,
            )
            .expect("转不成 sRGB");
        // SAFETY: 空字典是合法的属性表
        let data = unsafe {
            srgb.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }
        .expect("编不成 PNG");
        std::fs::create_dir_all(path.parent().unwrap()).expect("建不了目录");
        std::fs::write(path, data.to_vec()).expect("写不了文件");
        println!("  {}", path.display());
    };

    // 菜单栏上的那一块：一段菜单栏底色，模板图照系统的样子染成黑或白
    let (bar, _) = model::build(&snapshot(), model::Style::Full);
    for dark in [false, true] {
        let item = macos::bar_image(&bar);
        let size = item.size();
        let (w, h) = ((size.width + 28.0).ceil(), 32.0);
        let block = RcBlock::new(move |_: NSRect| -> Bool {
            let bg = if dark { 40.0 / 255.0 } else { 236.0 / 255.0 };
            let blue = if dark { 43.0 / 255.0 } else { 238.0 / 255.0 };
            NSColor::colorWithSRGBRed_green_blue_alpha(bg, bg, blue, 1.0).setFill();
            NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(w, h)),
                8.0,
                8.0,
            )
            .fill();
            let at = NSRect::new(
                NSPoint::new((w - size.width) / 2.0, (h - size.height) / 2.0),
                size,
            );
            let src = item.clone();
            let paint = RcBlock::new(move |r: NSRect| -> Bool {
                src.drawInRect(r);
                if src.isTemplate() {
                    let tint = if dark {
                        NSColor::whiteColor()
                    } else {
                        NSColor::blackColor()
                    };
                    tint.setFill();
                    NSRectFillUsingOperation(r, NSCompositingOperation::SourceAtop);
                }
                Bool::YES
            });
            NSImage::imageWithSize_flipped_drawingHandler(size, true, &paint).drawInRect(at);
            Bool::YES
        });
        let chip = NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(w, h), true, &block);
        write(
            &chip,
            &out.join(format!(
                "menubar-{}.png",
                if dark { "dark" } else { "light" }
            )),
        );
    }

    // 点开之后的菜单，两种语言
    for (lang, dir) in [(Lang::Zh, "zh"), (Lang::En, "en")] {
        i18n::set(lang);
        let (bar, rows) = model::build(&snapshot(), model::Style::Full);
        for dark in [false, true] {
            let image = macos::preview_image(&bar, &rows, dark);
            let name = format!("menubar-menu-{}.png", if dark { "dark" } else { "light" });
            write(&image, &out.join(dir).join(name));
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {}
