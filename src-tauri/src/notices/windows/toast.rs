//! `ToastNotificationManager` 的那几个调用。
//!
//! **只依赖标准库和 `windows` crate，不依赖 Tauri，也不依赖总线** —— 这样它能被原样
//! 拷进一个单独的小 crate，在 macOS 上对着 Windows 的 target 跑 clippy（整个 workspace
//! 有 C 依赖，交叉编译不了），也能在真机上换一个 AUMID 单独验证。
//!
//! 不用初始化 COM：`windows` crate 取激活工厂时发现线程没进单元，会自己进隐式 MTA。
//!
//! 给哪个 AUMID 发都行，**登记是另一回事**：名字和图标靠注册表里的那一项（见
//! `winreg`），没登记的 AUMID 照样弹得出来，只是名字是原始的 ID、没有图标。别调
//! `ToastNotifier.Setting` 去探「能不能发」：一个 AUMID 第一次发通知之前它报 0x80070490。

use ::windows::Data::Xml::Dom::XmlDocument;
use ::windows::UI::Notifications::{
    NotificationData, NotificationUpdateResult, ToastNotification, ToastNotificationManager,
};
use ::windows::core::{HSTRING, Result};

/// 标题和正文：XML 里的 `{title}`、`{body}` 从这里取值
fn data(title: &str, body: &str) -> Result<NotificationData> {
    let data = NotificationData::new()?;
    let values = data.Values()?;
    values.Insert(&HSTRING::from("title"), &HSTRING::from(title))?;
    values.Insert(&HSTRING::from("body"), &HSTRING::from(body))?;
    // 序号留 0：**0 表示无条件接受**。总线自己保证先后，这里不必再排一次
    Ok(data)
}

/// 发一条，或者换掉同一个 tag + group 的那一条。
///
/// `quiet`：**不弹横幅，直接进操作中心**。窗口在前台时、以及原地更新找不到原来那一条
/// 而要把它放回去时用
pub fn post(
    aumid: &str,
    xml: &str,
    tag: &str,
    group: &str,
    title: &str,
    body: &str,
    quiet: bool,
) -> Result<()> {
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    toast.SetTag(&HSTRING::from(tag))?;
    toast.SetGroup(&HSTRING::from(group))?;
    toast.SetData(&data(title, body)?)?;
    toast.SetSuppressPopup(quiet)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))?.Show(&toast)
}

/// 原地更新标题和正文。**不重新弹、不出声**。
///
/// 返回 `false`：操作中心里已经没有这一条了（被用户划掉、过期），更新没有落到任何
/// 地方 —— 要不要放回去由调用方定
pub fn update(aumid: &str, tag: &str, group: &str, title: &str, body: &str) -> Result<bool> {
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))?;
    let r = notifier.UpdateWithTagAndGroup(
        &data(title, body)?,
        &HSTRING::from(tag),
        &HSTRING::from(group),
    )?;
    Ok(r == NotificationUpdateResult::Succeeded)
}

/// 撤回：操作中心里的那一条
pub fn withdraw(aumid: &str, tag: &str, group: &str) -> Result<()> {
    ToastNotificationManager::History()?.RemoveGroupedTagWithId(
        &HSTRING::from(tag),
        &HSTRING::from(group),
        &HSTRING::from(aumid),
    )
}

/// 清掉通知中心里这个 AUMID 的全部通知。卸载时用：登记删掉之后，留下的那几条只剩
/// 一个原始的 ID，点开也落不到任何地方
pub fn clear(aumid: &str) -> Result<()> {
    ToastNotificationManager::History()?.ClearWithId(&HSTRING::from(aumid))
}
