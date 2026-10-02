//! 弹框那一段，**只用 gtk**（不引 Tauri、不引 `crate::`）：在别的平台上能原样摘进一个小
//! crate 做类型检查（GTK 的库不在这台机器上时，用假的 pkg-config 描述文件就够 `cargo check`）。

use gtk::prelude::*;

pub struct Text<'a> {
    pub title: &'a str,
    pub message: &'a str,
    pub detail: &'a str,
    pub accept: &'a str,
    pub cancel: &'a str,
}

/// 弹出来，`run` 自己转一个消息循环，直到用户回答。**默认是取消**：回车不会变成一次确认
pub fn run(parent: Option<&gtk::ApplicationWindow>, text: &Text<'_>, danger: bool) -> bool {
    let dialog = gtk::MessageDialog::new(
        parent,
        gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
        if danger {
            gtk::MessageType::Error
        } else {
            gtk::MessageType::Warning
        },
        gtk::ButtonsType::None,
        text.message,
    );
    dialog.set_title(text.title);
    dialog.set_secondary_text(Some(text.detail));
    dialog.add_button(text.cancel, gtk::ResponseType::Cancel);
    let accept = dialog.add_button(text.accept, gtk::ResponseType::Accept);
    if danger {
        accept.style_context().add_class("destructive-action");
    }
    dialog.set_default_response(gtk::ResponseType::Cancel);
    let answer = dialog.run();
    dialog.close();
    answer == gtk::ResponseType::Accept
}
