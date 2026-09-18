//! `UNUserNotificationCenter` 的那几个调用。
//!
//! **不依赖 Tauri，也不依赖总线** —— 这样它能被一个单独的小程序原样引用，换一个
//! bundle id 在真机上验证，而不必动正在用的那个应用（同一个 bundle id、同一个数据
//! 目录，两个一起跑会互相干扰）。

use std::sync::OnceLock;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{AnyThread, define_class, msg_send};
use objc2_foundation::{NSArray, NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationInterruptionLevel, UNNotificationPresentationOptions, UNNotificationRequest,
    UNNotificationResponse, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

/// 点了哪一条（它的 identifier）。**delegate 的回调里拿不到别的东西**，只能放这里
type OnClick = Box<dyn Fn(String) + Send + Sync>;
static ON_CLICK: OnceLock<OnClick> = OnceLock::new();

/// 能不能用：只有装好的 `.app` 能用。`tauri dev` 那种不在应用包里的二进制，
/// 去拿通知中心会直接抛异常，进程退出
pub fn available() -> bool {
    let bundle = NSBundle::mainBundle();
    bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
}

/// 接上通知中心。**要在启动时就调** —— 点通知把应用拉起来的那一次，delegate 得已经在了
pub fn install(on_click: OnClick) {
    let _ = ON_CLICK.set(on_click);
    let delegate = Delegate::new();
    let center = UNUserNotificationCenter::currentNotificationCenter();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // 通知中心只弱引用 delegate：**让它活到进程结束**
    std::mem::forget(delegate);
}

define_class!(
    // SAFETY: NSObject 对子类没有额外要求；这个类没有实现 Drop
    #[unsafe(super(NSObject))]
    #[name = "ThinkWatchNoticeDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// 应用在前台时收到通知：**只进通知中心，不弹横幅** —— 用户正看着界面，
        /// 工具栏的提醒列表已经说了。设了 delegate 就必须实现这一条，否则前台一律不显示
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            done: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            done.call((UNNotificationPresentationOptions::List,));
        }

        /// 点了通知
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            done: &block2::DynBlock<dyn Fn()>,
        ) {
            let key = response.notification().request().identifier().to_string();
            if let Some(f) = ON_CLICK.get() {
                f(key);
            }
            done.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        // SAFETY: NSObject 的 init
        unsafe { msg_send![super(this), init] }
    }
}

/// 发一条，或者替换同一个 `key` 的那一条。**先问授权**：第一次会弹系统询问，之后
/// 立刻用存下的答案 —— 放在第一条要打断用户的提醒之前问，那时用户知道这是为了什么。
///
/// `quiet`：只是更新计数的那一次**不亮屏、不出声**，替换掉通知中心里那一条就好
pub fn post(key: String, title: String, body: String, thread: String, quiet: bool) {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let then = RcBlock::new(move |granted: Bool, _err: *mut NSError| {
        if !granted.as_bool() {
            // 用户没允许：提醒照样在应用里，不再追问
            return;
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&title));
        content.setBody(&NSString::from_str(&body));
        // 同一类的归在一起
        content.setThreadIdentifier(&NSString::from_str(&thread));
        content.setInterruptionLevel(if quiet {
            UNNotificationInterruptionLevel::Passive
        } else {
            UNNotificationInterruptionLevel::Active
        });
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&key),
            &content,
            None,
        );
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let logged = RcBlock::new(|err: *mut NSError| {
            // SAFETY: 通知中心给的要么是空指针，要么是一个有效的 NSError
            if let Some(e) = unsafe { err.as_ref() } {
                tracing::debug!("系统通知未能发出：{}", e.localizedDescription());
            }
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&logged));
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &then,
    );
}

/// 撤回：通知中心里的那一条，和还没发出去的那一条
pub fn withdraw(key: &str) {
    let center = UNUserNotificationCenter::currentNotificationCenter();
    let ids = NSArray::from_retained_slice(&[NSString::from_str(key)]);
    center.removeDeliveredNotificationsWithIdentifiers(&ids);
    center.removePendingNotificationRequestsWithIdentifiers(&ids);
}
