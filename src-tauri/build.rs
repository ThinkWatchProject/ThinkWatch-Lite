fn main() {
    core_tag();
    tauri_build::build()
}

/// 这一版应用配的是哪一版 core：`Cargo.lock` 里锁到的 tw-api 的版本号。
///
/// 连远程 core 时版本对不上，界面要说出「本应用需要 core X」。**从锁文件读，不另写
/// 一份**。读版本号而不是 tag：临时钉在某个提交上（还没发版）时没有 tag，而 core 的
/// 各个 crate 和 twcore 共用同一个版本号
fn core_tag() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    let mut in_api = false;
    let mut version = None;
    for line in lock.lines() {
        if line.starts_with("name = ") {
            in_api = line == "name = \"tw-api\"";
        } else if in_api && let Some(v) = line.strip_prefix("version = ") {
            version = Some(v.trim_matches('"').to_string());
        }
    }
    println!(
        "cargo:rustc-env=TW_CORE_TAG={}",
        version.unwrap_or_else(|| "dev".into())
    );
}
