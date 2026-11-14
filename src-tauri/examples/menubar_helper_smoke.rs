//! macOS 菜单辅助进程的原生往返检查，不启动 Tauri 或 core。
//!
//! `cargo run --manifest-path src-tauri/Cargo.toml --example menubar_helper_smoke`
//! 临时打开菜单、触发第一项，断言动作通过管道返回，关闭输入后子进程退出。
//! 全屏空间仍须实际鼠标点击验收，不能用这条程序触发的点击代替。

#[cfg(all(target_os = "macos", debug_assertions))]
fn main() {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2_app_kit::{NSApplication, NSMenu, NSView};
    use thinkwatch_lite_lib::menubar::{helper, macos, model};

    fn containing_menu(view: &NSView) -> Option<Retained<NSMenu>> {
        if let Some(item) = view.enclosingMenuItem() {
            // 菜单仍由 menubar::macos 持有。
            if let Some(menu) = unsafe { item.menu() } {
                return Some(menu);
            }
        }
        view.subviews().iter().find_map(|v| containing_menu(&v))
    }

    if std::env::args().any(|arg| arg == "--menubar-helper") {
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_secs(1));
            macos::on_main(|mtm| macos::preview::open_menu_later(mtm, 0.1));
            std::thread::sleep(Duration::from_secs(1));
            macos::on_main(|mtm| {
                assert!(macos::preview::is_open(), "原生菜单没有打开");
                let menu = NSApplication::sharedApplication(mtm)
                    .windows()
                    .iter()
                    .filter_map(|window| window.contentView())
                    .find_map(|view| containing_menu(&view))
                    .expect("菜单没有挂出自定义行");
                menu.cancelTrackingWithoutAnimation();
                menu.performActionForItemAtIndex(0);
            });
            // 父端断管道应结束进程；失败时不让测试无限等待。
            std::thread::sleep(Duration::from_secs(15));
            std::process::exit(4);
        });
        assert!(helper::run_if_requested());
        return;
    }

    for drop_while_open in [false, true] {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("--menubar-helper")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut input = child.stdin.take().unwrap();
        let frame = serde_json::json!({
            "snapshot": model::Snapshot::default(),
            "style": "full", "lang": "zh", "theme": null,
        });
        writeln!(input, "{frame}").unwrap();
        input.flush().unwrap();
        let mut opened = false;
        let mut closed = false;
        let mut action = false;
        for line in BufReader::new(child.stdout.take().unwrap()).lines() {
            let event: serde_json::Value = serde_json::from_str(&line.unwrap()).unwrap();
            println!("{event}");
            opened |= event == serde_json::json!({"Open": true});
            closed |= event == serde_json::json!({"Open": false});
            if drop_while_open && opened {
                break;
            }
            if event == serde_json::json!({"Action": "OpenMain"}) {
                action = true;
                break;
            }
        }
        drop(input);
        assert!(
            child.wait().unwrap().success(),
            "辅助进程没有随管道关闭退出"
        );
        if drop_while_open {
            assert!(opened, "菜单没有打开");
            println!("PASS: EOF closes helper while its menu is tracking");
        } else {
            assert!(opened && closed && action, "菜单开合或动作没有完整回传");
            println!("PASS: native menu action and helper EOF cleanup");
        }
    }
}

#[cfg(not(all(target_os = "macos", debug_assertions)))]
fn main() {
    eprintln!("This check requires a macOS debug build and an active desktop session.");
}
