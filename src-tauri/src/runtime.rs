//! The shell carries control traffic; AI execution belongs to the Core process.
//! Keep its I/O scheduler small even on a many-core workstation. File scans and
//! package operations use Tokio's on-demand blocking pool, which retires idle threads.

use std::sync::OnceLock;
use std::time::Duration;

fn build(parallelism: usize) -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(parallelism.clamp(1, 2))
        .thread_name("twlite-io")
        .thread_keep_alive(Duration::from_secs(10))
        .enable_all()
        .build()
}

pub(super) fn install() {
    // Tauri takes a handle, so retain ownership for the lifetime of the process.
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    let runtime = RUNTIME.get_or_init(|| {
        build(std::thread::available_parallelism().map_or(1, usize::from))
            .expect("creating the desktop I/O runtime")
    });
    tauri::async_runtime::set(runtime.handle().clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_many_core_desktop_does_not_allocate_a_worker_for_each_cpu() {
        let runtime = build(80).unwrap();
        assert_eq!(runtime.metrics().num_workers(), 2);
        runtime.block_on(async {
            assert_eq!(tokio::task::spawn_blocking(|| 42).await.unwrap(), 42);
            tokio::time::sleep(Duration::from_millis(1)).await;
        });
        assert_eq!(build(1).unwrap().metrics().num_workers(), 1);
    }
}
