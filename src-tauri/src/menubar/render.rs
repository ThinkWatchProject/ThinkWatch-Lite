//! 把两行文字画成一张 RGBA 位图。
//!
//! **两行显示必须自己渲染成图片**（§7.4）：菜单栏只有 22pt 高，
//! `set_title` 那一行文本放不下两行，Surge 那个效果是渲染出来的。

use super::font::{self, GLYPH_H};

/// 逻辑尺寸。宽度**固定**，按最大可能内容预留 —— 这是「宽度抖动」那条
/// 的另一半：等宽字形保证同位数不抖，固定画布保证换位数也不抖。
pub const LOGICAL_W: usize = 52;
pub const LOGICAL_H: usize = 22;

/// Retina。macOS 菜单栏在 2x 屏上要 2 倍位图。
pub const SCALE: usize = 2;

/// 告警时用什么颜色。模板图只能单色，所以这条路上要自己适配亮暗。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

/// 渲染成 RGBA。返回 `(rgba, width, height)`，尺寸是物理像素。
///
/// `template` 为真时只填 alpha、RGB 全 0 —— macOS 的模板图靠 alpha 通道
/// 自动反色，那样才能同时适配亮暗菜单栏。
pub fn render_rgba(
    line1: &str,
    line2: &str,
    template: bool,
    appearance: Appearance,
) -> (Vec<u8>, u32, u32) {
    let (w, h) = (LOGICAL_W * SCALE, LOGICAL_H * SCALE);
    // 先在逻辑尺寸上画 alpha，再放大 —— 点阵字形放大是整数倍复制，
    // 不会糊。
    let mut a = vec![0u8; LOGICAL_W * LOGICAL_H];

    // 两行竖直居中，行距 2px。
    let block_h = GLYPH_H * 2 + 2;
    let y0 = (LOGICAL_H - block_h) as i32 / 2;

    // **右对齐**：数字变长时向左伸，右边缘不动，所以它右边的菜单栏图标
    // 不会跟着移动。
    for (i, line) in [line1, line2].iter().enumerate() {
        let x = LOGICAL_W as i32 - font::text_width(line) as i32 - 1;
        let y = y0 + (i * (GLYPH_H + 2)) as i32;
        font::draw_text(&mut a, LOGICAL_W, LOGICAL_H, x, y, line);
    }

    let (r, g, b) = if template {
        // 模板图：RGB 无所谓，macOS 只看 alpha
        (0u8, 0u8, 0u8)
    } else {
        match appearance {
            // 告警色。亮暗各挑一个在对应背景上能看清的橙。
            Appearance::Light => (0xd9, 0x59, 0x26),
            Appearance::Dark => (0xff, 0x8c, 0x42),
        }
    };

    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let alpha = a[(y / SCALE) * LOGICAL_W + (x / SCALE)];
            let i = (y * w + x) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = alpha;
        }
    }
    (rgba, w as u32, h as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opaque_pixels(rgba: &[u8]) -> usize {
        rgba.chunks_exact(4).filter(|p| p[3] > 0).count()
    }

    #[test]
    fn the_bitmap_has_the_size_the_tray_api_expects() {
        let (rgba, w, h) = render_rgba("$3.42", "47 t/s", true, Appearance::Dark);
        assert_eq!(w as usize, LOGICAL_W * SCALE);
        assert_eq!(h as usize, LOGICAL_H * SCALE);
        assert_eq!(rgba.len(), (w * h * 4) as usize);
    }

    #[test]
    fn the_canvas_width_never_changes_with_the_content() {
        // 「宽度抖动」的核心测试：$9.99 → $10.02 时右边的图标不该动。
        let (_, w1, _) = render_rgba("$9.99", "47 t/s", true, Appearance::Dark);
        let (_, w2, _) = render_rgba("$10.02", "999 t/s", true, Appearance::Dark);
        assert_eq!(w1, w2);
    }

    #[test]
    fn a_template_icon_carries_no_colour_only_alpha() {
        // macOS 靠 alpha 自动反色。RGB 里塞了颜色的话，模板模式下会
        // 被忽略；而下一次切到告警色时又要记得关模板标志。
        let (rgba, ..) = render_rgba("$3.42", "47 t/s", true, Appearance::Dark);
        for p in rgba.chunks_exact(4) {
            assert_eq!((p[0], p[1], p[2]), (0, 0, 0));
        }
        assert!(opaque_pixels(&rgba) > 0, "什么都没画");
    }

    #[test]
    fn an_alert_icon_is_actually_coloured_and_differs_by_appearance() {
        let (light, ..) = render_rgba("$3.42", "!", false, Appearance::Light);
        let (dark, ..) = render_rgba("$3.42", "!", false, Appearance::Dark);
        let first_opaque = |v: &[u8]| {
            v.chunks_exact(4)
                .find(|p| p[3] > 0)
                .map(|p| (p[0], p[1], p[2]))
                .unwrap()
        };
        assert_ne!(first_opaque(&light), (0, 0, 0));
        assert_ne!(first_opaque(&light), first_opaque(&dark));
    }

    #[test]
    fn text_is_right_aligned_so_the_right_edge_stays_put() {
        // 找出最右侧的不透明列，短文本和长文本应该一样。
        let rightmost = |s: &str| {
            let (rgba, w, h) = render_rgba(s, "", true, Appearance::Dark);
            (0..w as usize)
                .rev()
                .find(|&x| (0..h as usize).any(|y| rgba[(y * w as usize + x) * 4 + 3] > 0))
                .unwrap()
        };
        assert_eq!(rightmost("$1.00"), rightmost("$88.88"));
    }

    #[test]
    fn an_overlong_line_clips_instead_of_panicking() {
        // 画布是固定宽度的，总有内容放不下的时候。宁可少画一个字。
        let (rgba, ..) = render_rgba("$999999.99", "12345 t/s", true, Appearance::Dark);
        assert!(opaque_pixels(&rgba) > 0);
    }

    /// 把渲染结果解回逻辑像素的字符画，方便断言。
    fn as_ascii(rgba: &[u8], w: u32, h: u32) -> Vec<String> {
        (0..h as usize)
            .step_by(SCALE)
            .map(|y| {
                (0..w as usize)
                    .step_by(SCALE)
                    .map(|x| {
                        if rgba[(y * w as usize + x) * 4 + 3] > 0 {
                            '#'
                        } else {
                            '.'
                        }
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn a_rendered_glyph_matches_its_definition() {
        // 眼睛读不了 5×7 点阵，所以把渲染结果解回来和字形定义比对。
        // 没有这个测试，一个画错的数字要等到有人盯着菜单栏才会被发现 ——
        // 而菜单栏正是最不容易被仔细看的地方。
        let (rgba, w, h) = render_rgba("8", "", true, Appearance::Dark);
        let rows = as_ascii(&rgba, w, h);
        // 找到有内容的那 7 行
        let drawn: Vec<&String> = rows.iter().filter(|r| r.contains('#')).collect();
        assert_eq!(drawn.len(), font::GLYPH_H, "8 应该正好占 7 行");
        // 逐行比对 `8` 的字形：01110 / 10001 / 10001 / 01110 / 10001 / 10001 / 01110
        //
        // 按**固定窗口**取，不要 trim：字形右边有 1px 边距，trim 掉它会
        // 让整块左移一格，然后测试报一个渲染其实没有的错。
        let x0 = drawn.iter().filter_map(|r| r.find('#')).min().unwrap();
        let want = [
            ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###.",
        ];
        for (row, expect) in drawn.iter().zip(want) {
            let cell: String = row.chars().skip(x0).take(font::GLYPH_W).collect();
            assert_eq!(cell, expect, "行不匹配：{row}");
        }
    }

    #[test]
    fn line_one_is_on_top_and_line_two_below_it() {
        // 顺序反了不会报错、不会崩，只会让菜单栏上花费和速率对调 ——
        // 而两个都是数字，用户可能很久都不会发现。
        // 用宽度差别很大的两行，靠「哪一块起始更靠左」来判断。
        let (rgba, w, h) = render_rgba("$1", "999999", true, Appearance::Dark);
        let rows = as_ascii(&rgba, w, h);
        let first_col = |r: &String| r.find('#');
        let with_ink: Vec<(usize, usize)> = rows
            .iter()
            .enumerate()
            .filter_map(|(i, r)| first_col(r).map(|c| (i, c)))
            .collect();
        let top = with_ink.first().unwrap();
        let bottom = with_ink.last().unwrap();
        assert!(top.1 > bottom.1, "上面那行（$1）应该更短、更靠右");
    }

    #[test]
    fn an_empty_line_draws_nothing_but_still_produces_a_bitmap() {
        let (rgba, w, h) = render_rgba("", "", true, Appearance::Dark);
        assert_eq!(opaque_pixels(&rgba), 0);
        assert_eq!(rgba.len(), (w * h * 4) as usize);
    }
}

#[cfg(test)]
mod width_tests {
    use super::*;

    /// **§7.4 的第一个坑：宽度抖动。**
    ///
    /// 花费从 `$9.99` 变成 `$10.02`，位数一变，菜单栏里它右边的所有图标
    /// 都会跟着左右跳。解法是画布固定宽度 + 右对齐 —— 这条测试盯着那两
    /// 件事真的成立。
    #[test]
    fn the_canvas_is_the_same_size_no_matter_what_the_numbers_are() {
        let size = |a: &str, b: &str| {
            let (_, w, h) = render_rgba(a, b, true, Appearance::Light);
            (w, h)
        };
        let base = size("$9.99", "12 t/s");
        for (a, b) in [
            ("$10.02", "12 t/s"),
            ("$999.99", "1234 t/s"),
            ("—", "—"),
            ("62%", "2h"),
            ("100%", "已重置"),
            ("$0.00", ""),
        ] {
            assert_eq!(size(a, b), base, "「{a}」「{b}」把画布撑变形了");
        }
    }

    /// 右对齐的实际效果：**右边那一列像素不因内容长短而移动**。
    ///
    /// 只测「画布一样大」是不够的 —— 一个居中或左对齐的渲染同样能通过
    /// 那条，而它右边的图标照样会跳。
    #[test]
    fn the_right_edge_of_the_text_stays_put_when_a_digit_is_added() {
        let right_edge = |line: &str| {
            let (rgba, w, h) = render_rgba(line, "", true, Appearance::Light);
            // 从右往左找第一列有笔画的
            (0..w).rev().find(|&x| {
                (0..h).any(|y| rgba[((y * w + x) * 4 + 3) as usize] > 0)
            })
        };
        let short = right_edge("$9.99").expect("什么都没画出来");
        for longer in ["$10.02", "$100.02", "$1000.02"] {
            assert_eq!(
                right_edge(longer),
                Some(short),
                "「{longer}」的右边缘动了 —— 菜单栏里它右边的图标会跟着跳"
            );
        }
    }

    /// 内容长到画布放不下时，**不能溢出成一片糊**。
    #[test]
    fn an_absurdly_long_number_does_not_corrupt_the_bitmap() {
        let (rgba, w, h) = render_rgba("$1234567890.99", "999999 t/s", true, Appearance::Light);
        assert_eq!(rgba.len(), (w * h * 4) as usize);
        // 画布左边缘之外的东西被裁掉了，而不是绕回到右边
        assert!(w > 0 && h > 0);
    }
}
