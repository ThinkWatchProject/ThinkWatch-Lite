//! 每一类提醒怎么对待：弹系统通知、只进应用内、还是不要。
//!
//! **按类，不按条。**「不再提醒这一条」对一个明天还会再发生的事没有意义；用户
//! 真正要表达的是「这一类事别打断我」。

use std::collections::BTreeMap;
use std::path::Path;

/// 提醒的类别。**和去重键的前缀一一对应**（见 [`Category::of`]）
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    /// 网关停止转发
    Gateway,
    /// 上游无法连接
    Upstream,
    /// 订阅额度用完
    Quota,
    /// 凭据失效、被拒绝、写不回配置
    Credential,
    /// 代理不通
    Proxy,
    /// 可疑的工具调用、客户端配置里出现的可疑内容
    Security,
    /// 配置文件没过校验
    Config,
    /// 磁盘空间不足
    Storage,
}

impl Category {
    /// 设置页上的顺序：先是「什么都用不了了」，再是「某一处要处理」
    pub const ALL: [Category; 8] = [
        Category::Gateway,
        Category::Upstream,
        Category::Quota,
        Category::Credential,
        Category::Proxy,
        Category::Security,
        Category::Config,
        Category::Storage,
    ];

    /// 去重键属于哪一类
    pub fn of(key: &str) -> Category {
        let kind = key.split(':').next().unwrap_or(key);
        match kind {
            "gateway" => Category::Gateway,
            "upstream" => Category::Upstream,
            "quota" => Category::Quota,
            "credential" | "auth" | "writeback" => Category::Credential,
            "proxy" => Category::Proxy,
            "toolwall" | "scan" => Category::Security,
            "storage" => Category::Storage,
            // 认不出来的归到配置：那是唯一一个不挂在某个对象上的类
            _ => Category::Config,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Category::Gateway => "网关停止转发",
            Category::Upstream => "上游无法连接",
            Category::Quota => "订阅额度用完",
            Category::Credential => "凭据失效或被拒绝",
            Category::Proxy => "代理不通",
            Category::Security => "可疑的工具调用与客户端配置",
            Category::Config => "配置文件未通过校验",
            Category::Storage => "磁盘空间不足",
        }
    }

    /// 出厂设置。
    ///
    /// **上游无法连接默认只进应用内**：多数人配了回退，一家上游挂了请求照样有人接，
    /// 为一次被接住的故障打断用户不值得；而熔断信号本身就会随流量开开合合。
    fn default_mode(self) -> Mode {
        match self {
            Category::Upstream => Mode::App,
            _ => Mode::System,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// 弹系统通知（级别够的话）
    System,
    /// 只进应用内的提醒列表
    App,
    /// 不记录
    Off,
}

/// 用户改过的那几类。**没改过的不存**，出厂设置变了会跟着变
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Prefs {
    #[serde(default)]
    modes: BTreeMap<Category, Mode>,
}

impl Prefs {
    pub fn mode(&self, c: Category) -> Mode {
        self.modes.get(&c).copied().unwrap_or(c.default_mode())
    }

    pub fn set(&mut self, c: Category, m: Mode) {
        if m == c.default_mode() {
            self.modes.remove(&c);
        } else {
            self.modes.insert(c, m);
        }
    }
}

/// 读不出来就按出厂设置：一份坏掉的设置不该挡住提醒
pub fn load(file: &Path) -> Prefs {
    std::fs::read(file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(file: &Path, p: &Prefs) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut text = serde_json::to_vec_pretty(p).map_err(std::io::Error::other)?;
    text.push(b'\n');
    std::fs::write(file, text)
}
