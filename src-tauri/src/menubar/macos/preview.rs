//! 开发用：给 `examples/menubar_*.rs` 看样子的几样 —— 离屏把菜单画成图、写成 PNG，
//! 把挂出来的菜单点开、收起、逐项打出来。
//!
//! **只在开发构建里**（`debug_assertions`），同 `memcheck`：发布包里用不着，预览程序
//! 也只用 `cargo run`（开发构建）跑。

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{AnyThread, MainThreadMarker, msg_send, sel};
use objc2_app_kit::{
    NSAttributedStringNSStringDrawing, NSBezierPath, NSColor, NSControlStateValueOn, NSFont,
    NSImage, NSMenu,
};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize};

use super::info::{draw_info, info_height, info_of, quota_text};
use super::{MENU_WIDTH, OPEN, PAD, TEXT_X, UI, attributed, bar_image, rect, symbol, thickness};
use crate::menubar::model::{Bar, Item, Row};

/// 菜单开着吗（预览程序等它被点开）
pub fn is_open() -> bool {
    OPEN.with(|o| o.get())
}

/// 开发用：过 `delay` 秒像用户点了一下那样把菜单打开（预览程序用）。
///
/// **走 run loop 的延时调用，不走 GCD。**菜单的跟踪循环要是嵌在一个主队列任务里，
/// CFRunLoop 为了不让主队列重入，那期间不再处理主队列 —— 投递过来的更新全都要等
/// 菜单关上。用户真点菜单栏时跟踪循环是从事件分发开始的，没有这个问题
pub fn open_menu_later(mtm: MainThreadMarker, delay: f64) {
    let button = UI.with(|ui| ui.borrow().as_ref().and_then(|ui| ui.item.button(mtm)));
    if let Some(button) = button {
        let none: Option<&AnyObject> = None;
        let _: () = unsafe {
            msg_send![&*button, performSelector: sel!(performClick:), withObject: none, afterDelay: delay]
        };
    }
}

/// 开发用：把开着的菜单收起来
pub fn close_menu() {
    UI.with(|ui| {
        if let Some(ui) = ui.borrow().as_ref() {
            ui.menu.cancelTracking();
        }
    });
}

/// 此刻菜单里有什么，一行一项，子菜单缩进、勾选的打 ✓、分隔线写成 `---`。
/// **给预览程序用**（`menubar_preview -- --dump`）：没有屏幕录制权限时，核对原生菜单
/// 真长什么样只能靠它
pub fn describe_menu() -> Vec<String> {
    fn walk(menu: &NSMenu, depth: usize, out: &mut Vec<String>) {
        for i in 0..menu.numberOfItems() {
            let Some(item) = menu.itemAtIndex(i) else {
                continue;
            };
            let pad = "  ".repeat(depth);
            if item.isSeparatorItem() {
                out.push(format!("{pad}---"));
                continue;
            }
            let title = item
                .attributedTitle()
                .map(|t| t.string().to_string())
                .unwrap_or_else(|| item.title().to_string());
            let check = if item.state() == NSControlStateValueOn {
                "✓ "
            } else {
                ""
            };
            let title = if title.is_empty() && item.view().is_some() {
                "[自绘]".to_string()
            } else {
                title
            };
            out.push(format!("{pad}{check}{title}"));
            if let Some(sub) = item.submenu() {
                walk(&sub, depth + 1, out);
            }
        }
    }
    UI.with(|ui| {
        let mut out = Vec::new();
        if let Some(ui) = ui.borrow().as_ref() {
            walk(&ui.menu, 0, &mut out);
        }
        out
    })
}

/// 开发用：把菜单栏那一块和整份菜单离屏画成一张图，用来看样子
/// （`examples/menubar_preview.rs`）。**标准菜单项画的是近似的样子** —— 真的由
/// AppKit 画；自定义的几行和菜单栏那一块是真的。
pub fn preview_image(bar: &Bar, rows: &[Row], dark: bool) -> Retained<NSImage> {
    use objc2_app_kit::{
        NSAffineTransformNSAppKitAdditions, NSAppearance, NSAppearanceNameAqua,
        NSAppearanceNameDarkAqua, NSGraphicsContext,
    };
    use objc2_foundation::NSAffineTransform;

    let quota = quota_text(rows);
    let heights: Vec<f64> = rows
        .iter()
        .map(|r| match r {
            Row::Separator => 11.0,
            Row::Item(_) => 24.0,
            other => info_height(&info_of(other, quota)),
        })
        .collect();
    let bar_img = bar_image(bar);
    let bar_h = thickness() + 8.0;
    let total = bar_h + 10.0 + heights.iter().sum::<f64>() + 10.0;
    let width = MENU_WIDTH + 24.0;
    let rows = rows.to_vec();
    let block = RcBlock::new(move |_r: NSRect| -> Bool {
        let name = unsafe {
            if dark {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            }
        };
        let Some(appearance) = NSAppearance::appearanceNamed(name) else {
            return Bool::NO;
        };
        let rows = rows.clone();
        let heights = heights.clone();
        let bar_img = bar_img.clone();
        let draw = RcBlock::new(move || {
            // 桌面和菜单栏
            let desk = if dark {
                (0.11, 0.12, 0.16)
            } else {
                (0.86, 0.89, 0.94)
            };
            NSColor::colorWithSRGBRed_green_blue_alpha(desk.0, desk.1, desk.2, 1.0).setFill();
            NSBezierPath::fillRect(rect(0.0, 0.0, width, total));
            let sz = bar_img.size();
            let at = rect(width - 12.0 - sz.width, 4.0, sz.width, sz.height);
            if bar_img.isTemplate() {
                // 模板图在真菜单栏上由系统着色：这里照样染一遍，深色菜单栏上是白字
                let src = bar_img.clone();
                let paint = RcBlock::new(move |r: NSRect| -> Bool {
                    src.drawInRect(r);
                    let tint = if dark {
                        NSColor::whiteColor()
                    } else {
                        NSColor::blackColor()
                    };
                    tint.setFill();
                    objc2_app_kit::NSRectFillUsingOperation(
                        r,
                        objc2_app_kit::NSCompositingOperation::SourceAtop,
                    );
                    Bool::YES
                });
                NSImage::imageWithSize_flipped_drawingHandler(sz, true, &paint).drawInRect(at);
            } else {
                bar_img.drawInRect(at);
            }
            // 菜单的底
            let menu_bg = if dark {
                (0.17, 0.17, 0.19)
            } else {
                (0.96, 0.96, 0.97)
            };
            NSColor::colorWithSRGBRed_green_blue_alpha(menu_bg.0, menu_bg.1, menu_bg.2, 1.0)
                .setFill();
            NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(
                rect(12.0, bar_h, MENU_WIDTH, total - bar_h - 4.0),
                12.0,
                12.0,
            )
            .fill();
            let mut y = bar_h + 6.0;
            for (row, h) in rows.iter().zip(heights.iter()) {
                let Some(ctx) = NSGraphicsContext::currentContext() else {
                    return;
                };
                ctx.saveGraphicsState();
                let t = NSAffineTransform::transform();
                t.translateXBy_yBy(12.0, y);
                t.concat();
                let r = rect(0.0, 0.0, MENU_WIDTH, *h);
                match row {
                    Row::Separator => {
                        NSColor::separatorColor().setFill();
                        NSBezierPath::fillRect(rect(PAD, 5.0, MENU_WIDTH - PAD * 2.0, 1.0));
                    }
                    Row::Item(i) => preview_item(i, r),
                    other => draw_info(&info_of(other, quota), r, false),
                }
                ctx.restoreGraphicsState();
                y += h;
            }
        });
        appearance.performAsCurrentDrawingAppearance(&draw);
        Bool::YES
    });
    NSImage::imageWithSize_flipped_drawingHandler(NSSize::new(width, total), true, &block)
}

/// 标准菜单项的近似样子：图标、标题、右边的淡色字或快捷键
fn preview_item(i: &Item, b: NSRect) {
    let color = if i.enabled {
        NSColor::labelColor()
    } else {
        NSColor::tertiaryLabelColor()
    };
    if let Some(icon) = i.icon.filter(|s| !s.is_empty())
        && let Some(img) = symbol(
            icon,
            Some(&*if i.accent {
                NSColor::controlAccentColor()
            } else {
                color.clone()
            }),
        )
    {
        img.drawInRect(rect(PAD, 4.0, 16.0, 16.0));
    }
    let font = NSFont::menuFontOfSize(0.0);
    attributed(&i.title, &font, &color).drawAtPoint(NSPoint::new(TEXT_X, 3.0));
    let right = i
        .key
        .map(|k| format!("⌘{}", k.to_uppercase()))
        .or_else(|| i.right.clone())
        .or_else(|| (!i.submenu.is_empty()).then(|| "›".to_string()));
    if let Some(r) = right {
        let a = attributed(&r, &font, &NSColor::secondaryLabelColor());
        a.drawAtPoint(NSPoint::new(b.size.width - PAD - a.size().width, 3.0));
    }
}

/// 开发用：把一张图写成 PNG
pub fn write_png(image: &NSImage, path: &std::path::Path) -> bool {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    // 按 2 倍画，和 Retina 上看到的一样
    let size = image.size();
    let mut proposed = rect(0.0, 0.0, size.width * 2.0, size.height * 2.0);
    let Some(cg) =
        (unsafe { image.CGImageForProposedRect_context_hints(&mut proposed, None, None) })
    else {
        return false;
    };
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
    let props = NSDictionary::new();
    let Some(data) =
        (unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) })
    else {
        return false;
    };
    std::fs::write(path, data.to_vec()).is_ok()
}
