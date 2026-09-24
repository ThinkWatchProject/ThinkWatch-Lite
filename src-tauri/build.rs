fn main() {
    core_tag();
    tauri_build::build()
}

/// 这一版应用配的是哪一版 core：`Cargo.lock` 里 tw-api 锁到的 tag，去掉开头的 `v`。
///
/// 连远程 core 时版本对不上，界面要说出「本应用需要 core X」。**从锁文件读，不另写
/// 一份**：打包脚本取 twcore 看的也是这一行（`scripts/fetch-core.sh`），两处说的
/// 必然是同一版。读不到（临时用 `[patch]` 指向本地 core 时就是这样）记成 `dev`
fn core_tag() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    let mut in_api = false;
    let mut tag = None;
    for line in lock.lines() {
        if line.starts_with("name = ") {
            in_api = line == "name = \"tw-api\"";
        } else if in_api
            && line.starts_with("source = ")
            && let Some(i) = line.find("tag=v")
        {
            let rest = &line[i + "tag=v".len()..];
            let end = rest.find(['#', '&', '"']).unwrap_or(rest.len());
            tag = Some(rest[..end].to_string());
        }
    }
    println!(
        "cargo:rustc-env=TW_CORE_TAG={}",
        tag.unwrap_or_else(|| "dev".into())
    );
}
