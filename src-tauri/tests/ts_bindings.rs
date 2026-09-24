//! 前端用的控制面类型由钉着的那版 tw-api 生成，提交在 `src/generated/tw-api.ts`。
//!
//! **生成的文件和钉着的 core 对得上。**升级 core 之后没重新生成的话，前端
//! 照着旧的协议写、类型检查照样通过 —— 这条测试在那个 PR 上拦住它。
//!
//! 重新生成：`UPDATE_TS=1 cargo test --manifest-path src-tauri/Cargo.toml --test ts_bindings`

#[test]
fn the_committed_bindings_match_the_pinned_core() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/generated/tw-api.ts");
    let want = tw_api::ts::typescript();
    if std::env::var_os("UPDATE_TS").is_some() {
        std::fs::write(path, &want).unwrap();
        return;
    }
    // Windows 上检出的是 CRLF
    let have = std::fs::read_to_string(path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    assert!(
        have == want,
        "src/generated/tw-api.ts 和钉着的 tw-api 不一致。重新生成：\n  UPDATE_TS=1 cargo test --manifest-path src-tauri/Cargo.toml --test ts_bindings"
    );
}
