//! 接管 Claude Desktop 时网关上的那条路由规则。
//!
//! 网关模式下 Claude Desktop 只认名称像 Claude 的模型（`tw_adopt::desktop::looks_like_claude`）；
//! 网关一个都不列时它开不了会话。这时接管写进它配置的是 `tw_adopt::desktop::FALLBACK_MODEL`，
//! 确认框里选一个上游模型，接管时在**它的密钥**上加一条「指定模型」规则：
//!
//! ```yaml
//! - name: Claude Desktop
//!   when: { client: claude-desktop }        # 它的那把密钥
//!   to:                                     # 提供所选模型的每一家，按顺序备用
//!     - { provider: zai, model: glm-4.6 }
//!     - { provider: bigmodel, model: glm-4.6 }
//! ```
//!
//! 插在这把密钥所用路由的**最前面**：它发来什么 Claude 名称都接得住，以后它换默认模型名
//! 也不受影响；别的客户端用同一个名称不受影响。**不建全局别名** —— 别名会改变这个名称对
//! 所有客户端的意思。取消接管时删掉这条规则；网关后来有了它认的模型、再接管一次时也删掉
//! （它的配置里换成了真的 Claude 模型，规则留着会把它们都改发走）。
//!
//! **认这条规则看名字和条件**：名字是 [`RULE_NAME`]、条件恰好只有「密钥 = 它的那把」，
//! 而且仍是我们加的样子（去向是指定模型、没有拒绝和改写）。用户改过名字或条件，或者改成了
//! 转发到上游、策略组，加了拒绝、改写，就不再是这里管的那条：还原不删它，接管也不覆盖它
//! （同一条路由里同名时报错，请用户先处理）。用户只换了指定的模型的，仍是这条。
//!
//! 先有规则再写它的配置（和「先有钥匙」同一个道理）；配置没写成就把规则改回去。还原时先
//! 还原文件、再删规则 —— 退路不依赖网关，删不成就提醒去路由页删。

use tw_api::{
    ConditionField, ConditionView, KnownModel, Overview, PinnedModel, RouteInput, RouteSave,
    RouteView, RuleInput, RuleTarget, RuleView, ep,
};
use tw_types::{Msg, msg};

use crate::control::ControlClient;
use crate::wire::{DesktopPick, DesktopRule, ModelChoice};

/// 那条规则的名字
pub const RULE_NAME: &str = "Claude Desktop";

// ---------------------------------------------------------------- 网关此刻的样子

/// 算这条规则要知道的：路由、密钥（`/overview`）和各家上游提供的模型（`/models`）
#[derive(Debug, Clone)]
pub struct Snapshot {
    pub overview: Overview,
    pub known: Vec<KnownModel>,
}

/// 一起问
pub async fn snapshot(control: &ControlClient) -> Result<Snapshot, Msg> {
    let (overview, known) = tokio::join!(
        control.call::<ep::Overview>(&[], &()),
        control.call::<ep::KnownModels>(&[], &())
    );
    Ok(Snapshot {
        overview: overview.map_err(failed)?,
        known: known.map_err(failed)?,
    })
}

fn failed(e: anyhow::Error) -> Msg {
    crate::error::CmdError::from(e).into_msg()
}

impl Snapshot {
    /// 这把密钥走的路由：绑了的那条，没绑的是默认路由
    fn route_of(&self, key: &str) -> &str {
        self.overview
            .clients
            .iter()
            .find(|k| k.name == key)
            .and_then(|k| k.route.as_deref())
            .unwrap_or(&self.overview.default_route)
    }

    fn route(&self, name: &str) -> Option<&RouteView> {
        self.overview.routes.iter().find(|r| r.name == name)
    }

    /// 网关列出的这些里，哪家上游的哪个模型可以选：按列出的顺序，同名只算一次；
    /// 别名、没有上游提供的不算（指定模型要的是上游自己的名称）
    pub fn choices(&self, listed: &[String]) -> Vec<ModelChoice> {
        let mut out: Vec<ModelChoice> = Vec::new();
        for m in listed {
            if out.iter().any(|c| &c.model == m) {
                continue;
            }
            if let Some(k) = self
                .known
                .iter()
                .find(|k| &k.id == m && k.alias.is_none() && !k.providers.is_empty())
            {
                out.push(ModelChoice {
                    model: k.id.clone(),
                    providers: k.providers.clone(),
                });
            }
        }
        out
    }
}

/// 读到的一条规则写回去的样子。**读 `RuleView`、写 `RuleInput` 是同一套字段**（路由页也是
/// 这样往返的），只读视图里的那几项（`catch_all`、`phase_two`、`shadowed`）不要。改写原样往返
fn input(r: &RuleView) -> RuleInput {
    RuleInput {
        name: r.name.clone(),
        conditions: r.conditions.clone(),
        to: r.to.clone(),
        deny: r.deny.clone(),
        set: r.set.clone(),
    }
}

/// 一条路由此刻的规则，按写回去的样子
fn rules_of(route: &RouteView) -> Vec<RuleInput> {
    route.rules.iter().map(input).collect()
}

/// 这把密钥的那条规则：只有它的密钥这一个条件
fn key_only(rule: &RuleInput, key: &str) -> bool {
    matches!(rule.conditions.as_slice(), [c] if c.field == ConditionField::Client && c.values == [key])
}

/// 是接管时加的那一条（见文件头）：名字、条件对得上，仍是指定模型、没有拒绝和改写
pub fn is_ours(rule: &RuleInput, key: &str) -> bool {
    rule.name == RULE_NAME
        && key_only(rule, key)
        && matches!(&rule.to, Some(RuleTarget::Models(ms)) if !ms.is_empty())
        && rule.deny.is_none()
        && rule.set.is_none()
}

/// 选了这个模型时规则的去向：提供它的每一家，按网关排的顺序备用
pub fn pinned(choice: &ModelChoice) -> Vec<PinnedModel> {
    choice
        .providers
        .iter()
        .map(|p| PinnedModel {
            provider: p.clone(),
            model: choice.model.clone(),
        })
        .collect()
}

fn models_of(rule: &RuleInput) -> Option<Vec<PinnedModel>> {
    match &rule.to {
        Some(RuleTarget::Models(ms)) => Some(ms.clone()),
        _ => None,
    }
}

/// 同一条路由里已经有一条同名的规则，不是我们加的那条：不覆盖它
fn name_taken(route: &str) -> Msg {
    msg!(
        "adopt.plan.claude_desktop.rule_name_taken", route = route, rule = RULE_NAME =>
        "The route {route} already has a rule named {rule} that was not added for Claude \
         Desktop. Rename or delete that rule on the Routing page, then connect Claude Desktop again."
    )
}

/// 确认框之后网关这边变了：要选模型却没选、选的已经没有上游提供、或者不再需要选。
/// 什么都不写，界面重算一份给人看（和 `adopt.plan.stale` 一样处理）
pub fn gateway_changed(client: &str) -> Msg {
    msg!(
        "adopt.plan.gateway_changed", client = client =>
        "The models the gateway offers to {client} changed while the change was being reviewed, \
         so nothing was written. Look at the change again"
    )
}

/// 确认框里给人看的那条规则。**不写任何东西。**
///
/// `pick` 是 `tw_adopt::desktop::model_pick`（还原时、网关有它认的模型时为空）：
///
/// - 要选：规则在这把密钥所用路由里的位置（已有就是那一条，没有就是第一条），可选的
///   模型，以及已有的那条此刻指定的模型；
/// - 不用选：已有的那条（要删的），没有就什么都不用改（`None`）。
pub fn view(
    s: &Snapshot,
    key: &str,
    pick: Option<&tw_adopt::desktop::ModelPick>,
) -> Result<Option<DesktopRule>, Msg> {
    let shown =
        |route: &str, i: usize, rule: Option<&RuleInput>, pick: Option<DesktopPick>| DesktopRule {
            route: route.to_string(),
            position: u32::try_from(i + 1).unwrap_or(u32::MAX),
            name: RULE_NAME.to_string(),
            key: key.to_string(),
            pick,
            current: rule.and_then(models_of),
        };
    match pick {
        Some(p) => {
            let name = s.route_of(key);
            let Some(route) = s.route(name) else {
                return Ok(None);
            };
            let rules = rules_of(route);
            let ours = rules.iter().position(|r| is_ours(r, key));
            if ours.is_none() && rules.iter().any(|r| r.name == RULE_NAME) {
                return Err(name_taken(name));
            }
            let pick = DesktopPick {
                written: p.written.clone(),
                choices: s.choices(&p.listed),
            };
            let i = ours.unwrap_or(0);
            Ok(Some(shown(name, i, ours.map(|i| &rules[i]), Some(pick))))
        }
        None => {
            Ok(find_ours(s, key)
                .map(|(route, rules, i)| shown(&route.name, i, Some(&rules[i]), None)))
        }
    }
}

/// 我们那条在哪：这把密钥所用的路由先找，再找别的（密钥后来换了路由）。交回那条路由、
/// 它写回去的规则和我们那条的位置
fn find_ours<'a>(s: &'a Snapshot, key: &str) -> Option<(&'a RouteView, Vec<RuleInput>, usize)> {
    let mine = s.route_of(key);
    let routes = s
        .route(mine)
        .into_iter()
        .chain(s.overview.routes.iter().filter(|r| r.name != mine));
    for r in routes {
        let rules = rules_of(r);
        if let Some(i) = rules.iter().position(|x| is_ours(x, key)) {
            return Some((r, rules, i));
        }
    }
    None
}

/// 要写的一处：一条路由的规则从 `before` 换成 `after`，按 `base_version` 那一版改
#[derive(Debug, Clone)]
pub struct Change {
    pub route: String,
    pub before: Vec<RuleInput>,
    pub after: Vec<RuleInput>,
    pub base_version: String,
}

/// 接管时要对网关做的改动（[`view`] 给人看的那一份，按落盘这一刻的网关重算）。
///
/// `chosen` 是确认框里选的模型。和此刻的网关对不上（要选却没选、选的没有上游提供了、
/// 不用选却选了）就是 [`gateway_changed`]；已经是这样了是 `None`。
pub fn change(
    s: &Snapshot,
    client: &str,
    key: &str,
    pick: Option<&tw_adopt::desktop::ModelPick>,
    chosen: Option<&str>,
) -> Result<Option<Change>, Msg> {
    let version = s.overview.config_version.clone();
    let Some(p) = pick else {
        if chosen.is_some() {
            return Err(gateway_changed(client));
        }
        // 网关有它认的模型了：之前加的那条要删
        return Ok(removal(s, key));
    };
    let choices = s.choices(&p.listed);
    let choice = match chosen {
        // 没得选：照写兜底的那个名字，不加规则（和网关一个模型都没有时的其他客户端一样）
        None if choices.is_empty() => return Ok(None),
        None => return Err(gateway_changed(client)),
        Some(m) => choices
            .iter()
            .find(|c| c.model == m)
            .ok_or_else(|| gateway_changed(client))?,
    };
    let to = pinned(choice);
    let name = s.route_of(key);
    let route = s.route(name).ok_or_else(|| route_missing(name))?;
    let before = rules_of(route);
    let mut after = before.clone();
    match after.iter().position(|r| is_ours(r, key)) {
        Some(i) if models_of(&after[i]).as_ref() == Some(&to) => return Ok(None),
        // 用户挪过它的位置：留在原处，只换模型
        Some(i) => after[i].to = Some(RuleTarget::Models(to)),
        None if after.iter().any(|r| r.name == RULE_NAME) => return Err(name_taken(name)),
        None => after.insert(
            0,
            RuleInput {
                name: RULE_NAME.to_string(),
                conditions: vec![ConditionView {
                    field: ConditionField::Client,
                    values: vec![key.to_string()],
                }],
                to: Some(RuleTarget::Models(to)),
                deny: None,
                set: None,
            },
        ),
    }
    Ok(Some(Change {
        route: name.to_string(),
        before,
        after,
        base_version: version,
    }))
}

/// 删掉我们那条（还原时，或者不再需要它时）：一次一条路由，先找这把密钥所用的那条。
/// 那条路由里我们的规则一起删。没有就是 `None`
pub fn removal(s: &Snapshot, key: &str) -> Option<Change> {
    let (route, before, _) = find_ours(s, key)?;
    let after = before
        .iter()
        .filter(|r| !is_ours(r, key))
        .cloned()
        .collect();
    Some(Change {
        route: route.name.clone(),
        before,
        after,
        base_version: s.overview.config_version.clone(),
    })
}

fn route_missing(route: &str) -> Msg {
    crate::error::CmdError::plain(format!("The route `{route}` was not found.")).into_msg()
}

// ---------------------------------------------------------------- 写

/// 只换这条路由的规则。**不带 `keys`**：密钥用哪条路由不动
async fn save(
    control: &ControlClient,
    route: &str,
    rules: &[RuleInput],
    base_version: &str,
) -> Result<String, Msg> {
    let save = RouteSave {
        route: RouteInput {
            name: route.to_string(),
            rules: rules.to_vec(),
        },
        base_version: Some(base_version.to_string()),
        keys: None,
    };
    Ok(control
        .call::<ep::UpdateRoute>(&[route], &save)
        .await
        .map_err(failed)?
        .version)
}

/// 写一处改动。交回写完之后配置的版本（改回去时用）
pub async fn write(control: &ControlClient, c: &Change) -> Result<String, Msg> {
    save(control, &c.route, &c.after, &c.base_version).await
}

/// 把 [`write`] 写的那一处改回去：那之后别人又改过配置的话不改（版本对不上，core 拒绝）
pub async fn revert(control: &ControlClient, c: &Change, version: &str) -> Result<(), Msg> {
    save(control, &c.route, &c.before, version)
        .await
        .map(|_| ())
}

/// 规则加上了、Claude Desktop 的配置却没写成，规则也没能改回去：两件事一起说
pub fn not_reverted(c: &Change, error: &Msg, revert: &Msg) -> Msg {
    msg!(
        "adopt.claude_desktop.rule_not_reverted",
        detail = error.text.clone(),
        route = c.route.clone(),
        rule = RULE_NAME,
        reason = revert.text.clone()
        => "The routing rule {rule} added to the route {route} for Claude Desktop is still there: \
            Claude Desktop could not be connected ({detail}), and the rule could not be taken out \
            again ({reason}). Delete it on the Routing page."
    )
}

/// 还原之后删掉这把密钥的那条规则。删不成（或者问不到网关）交回要提醒的那一句
///
/// `owner` 是这一份 Claude Desktop 的密钥归在谁名下。一次删一条路由里的，删完再看一遍：
/// 密钥换过路由时，两条路由里可能都有
pub async fn remove_after_restore(control: &ControlClient, owner: &str) -> Option<Msg> {
    let unchecked = |e: Msg| {
        msg!(
            "adopt.claude_desktop.rule_unchecked", rule = RULE_NAME, detail = e.text =>
            "Claude Desktop is restored, but the gateway could not be asked to delete the routing \
             rule {rule} added when it was connected ({detail}). If the rule is still there, delete \
             it on the Routing page."
        )
    };
    let mut s = match snapshot(control).await {
        Ok(s) => s,
        Err(e) => return Some(unchecked(e)),
    };
    let key = s
        .overview
        .clients
        .iter()
        .find(|k| k.client.as_deref() == Some(owner))?
        .name
        .clone();
    // 每条路由至多改一次
    for _ in 0..=s.overview.routes.len() {
        let c = removal(&s, &key)?;
        if let Err(e) = write(control, &c).await {
            return Some(msg!(
                "adopt.claude_desktop.rule_left",
                route = c.route.clone(),
                rule = RULE_NAME,
                detail = e.text
                => "Claude Desktop is restored, but the rule {rule} in the route {route} could \
                    not be deleted ({detail}). Delete it on the Routing page."
            ));
        }
        s = match snapshot(control).await {
            Ok(s) => s,
            Err(e) => return Some(unchecked(e)),
        };
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tw_adopt::desktop::ModelPick;

    fn rule(name: &str, key: Option<&str>, to: Option<RuleTarget>) -> RuleInput {
        RuleInput {
            name: name.into(),
            conditions: key
                .map(|k| {
                    vec![ConditionView {
                        field: ConditionField::Client,
                        values: vec![k.into()],
                    }]
                })
                .unwrap_or_default(),
            to,
            deny: None,
            set: None,
        }
    }

    /// 写进配置之后 `/overview` 里读到的样子
    fn view_of(r: RuleInput) -> RuleView {
        RuleView {
            catch_all: r.conditions.is_empty(),
            phase_two: false,
            shadowed: false,
            name: r.name,
            conditions: r.conditions,
            to: r.to,
            deny: r.deny,
            set: r.set,
        }
    }

    /// 规则和改动按线上的 JSON 比：core 的这几个类型不带 `PartialEq`
    fn json<T: serde::Serialize + ?Sized>(x: &T) -> serde_json::Value {
        serde_json::to_value(x).unwrap()
    }

    fn change_json(c: &Change) -> serde_json::Value {
        serde_json::json!({
            "route": c.route, "before": c.before, "after": c.after, "base_version": c.base_version
        })
    }

    /// 一份 `/overview`：路由和密钥之外的几项照一个空网关填
    fn overview(routes: serde_json::Value, clients: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "config_version": "v1",
            "default_route": "default",
            "routes": routes,
            "clients": clients,
            "providers": [], "proxies": [], "groups": [], "client_probes": [], "price_sheets": [],
            "listen": {"bind": "loopback", "port": 8788, "allow_from": [], "default_allow_from": [], "exposed": false},
            "security": {"redact": "observe", "inspect_tools": "observe", "content": "observe"},
            "retention": {"body_days": 7, "row_days": 90, "body_max_bytes": 0, "body_bytes_now": 0},
            "failover": {"failures_to_pause": 3, "pause_secs": 60, "max_pause_secs": 600, "no_balance_pause_secs": 1800,
                         "quota_pause_secs": 3600, "rate_limit_max_pause_secs": 3600, "stream_start_wait_secs": 15}
        })
    }

    fn pin(provider: &str, model: &str) -> PinnedModel {
        PinnedModel {
            provider: provider.into(),
            model: model.into(),
        }
    }

    /// 一个网关：默认路由 `default`（Opus 拒绝、兜底），`codex` 路由；密钥 `claude-desktop`
    /// 没绑路由，`cd-2` 绑了 `codex`；glm-4.6 由 zai、bigmodel 提供，kimi-k2 由 moonshot，
    /// `fast` 是别名
    fn gateway() -> Snapshot {
        let json = overview(
            serde_json::json!([
                {"name": "default", "default": true, "builtin": false, "has_catch_all": true, "clients": [],
                 "rules": [
                    {"name": "no-opus", "conditions": [{"field": "model", "values": ["claude-opus-*"]}],
                     "deny": "Opus is off", "catch_all": false, "phase_two": false, "shadowed": false},
                    {"name": "long", "conditions": [{"field": "input_tokens", "values": [">200k"]}],
                     "to": "gemini", "set": {"model": "gemini-2.5-pro"}, "catch_all": false, "phase_two": false, "shadowed": false},
                    {"name": "rest", "conditions": [], "to": "__all__", "catch_all": true, "phase_two": false, "shadowed": false}
                 ]},
                {"name": "codex", "default": false, "builtin": false, "has_catch_all": true, "clients": ["cd-2"],
                 "rules": [{"name": "rest", "conditions": [], "to": "chatgpt", "catch_all": true, "phase_two": false, "shadowed": false}]}
            ]),
            serde_json::json!([
                {"name": "claude-desktop", "key": "tw-x", "client": "claude-desktop", "disabled": false, "default": false},
                {"name": "cd-2", "key": "tw-y", "client": "claude-desktop@Ubuntu", "route": "codex", "disabled": false, "default": false}
            ]),
        );
        Snapshot {
            overview: serde_json::from_value(json).unwrap(),
            known: serde_json::from_value(serde_json::json!([
                {"id": "glm-4.6", "providers": ["zai", "bigmodel"], "aliases": []},
                {"id": "kimi-k2", "providers": ["moonshot"], "aliases": []},
                {"id": "fast", "providers": ["zai"], "alias": ["glm-4.6"], "aliases": []},
                {"id": "orphan", "providers": [], "aliases": []}
            ]))
            .unwrap(),
        }
    }

    fn pick(listed: &[&str]) -> ModelPick {
        ModelPick {
            written: "claude-sonnet-5".into(),
            listed: listed.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// 候选按网关列出的顺序；别名、没有上游提供的、清单里没有的不算
    #[test]
    fn choices_are_upstream_models_in_the_listed_order() {
        let s = gateway();
        let c = s.choices(
            &["kimi-k2", "fast", "glm-4.6", "orphan", "nope", "kimi-k2"].map(String::from),
        );
        assert_eq!(
            c,
            vec![
                ModelChoice {
                    model: "kimi-k2".into(),
                    providers: vec!["moonshot".into()]
                },
                ModelChoice {
                    model: "glm-4.6".into(),
                    providers: vec!["zai".into(), "bigmodel".into()]
                },
            ]
        );
        assert_eq!(
            pinned(&c[1]),
            vec![pin("zai", "glm-4.6"), pin("bigmodel", "glm-4.6")]
        );
    }

    /// 加在这把密钥所用路由的最前面，条件只有它的密钥，别的规则一条不动
    #[test]
    fn the_rule_goes_first_in_the_route_of_the_key() {
        let s = gateway();
        let v = view(&s, "claude-desktop", Some(&pick(&["glm-4.6", "kimi-k2"])))
            .unwrap()
            .unwrap();
        assert_eq!(
            (v.route.as_str(), v.position, v.key.as_str()),
            ("default", 1, "claude-desktop")
        );
        assert_eq!(v.current, None);
        assert_eq!(v.pick.as_ref().unwrap().choices.len(), 2);

        let c = change(
            &s,
            "Claude Desktop",
            "claude-desktop",
            Some(&pick(&["glm-4.6"])),
            Some("glm-4.6"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(c.route, "default");
        assert_eq!(c.base_version, "v1");
        assert_eq!(c.after.len(), 4);
        assert_eq!(json(&c.after[1..]), json(&c.before));
        assert_eq!(
            serde_json::to_value(&c.after[0]).unwrap(),
            serde_json::json!({
                "name": "Claude Desktop",
                "conditions": [{"field": "client", "values": ["claude-desktop"]}],
                "to": [{"provider": "zai", "model": "glm-4.6"}, {"provider": "bigmodel", "model": "glm-4.6"}]
            })
        );
        // 往返之后别的规则的改写、拒绝原样在，视图里的那几项不写回去
        assert_eq!(
            serde_json::to_value(&c.after[2]).unwrap(),
            serde_json::json!({
                "name": "long",
                "conditions": [{"field": "input_tokens", "values": [">200k"]}],
                "to": "gemini",
                "set": {"model": "gemini-2.5-pro"}
            })
        );
        assert!(is_ours(&c.after[0], "claude-desktop"));

        // 绑了路由的密钥：加在它那条路由里
        let c = change(&s, "x", "cd-2", Some(&pick(&["kimi-k2"])), Some("kimi-k2"))
            .unwrap()
            .unwrap();
        assert_eq!(c.route, "codex");
        assert_eq!(
            c.after[0].to,
            Some(RuleTarget::Models(vec![pin("moonshot", "kimi-k2")]))
        );
    }

    fn with_ours(s: &mut Snapshot, at: usize, to: Vec<PinnedModel>) {
        s.overview.routes[0].rules.insert(
            at,
            view_of(rule(
                RULE_NAME,
                Some("claude-desktop"),
                Some(RuleTarget::Models(to)),
            )),
        );
    }

    /// 再接管一次：已有的那条原地换模型；一样就什么都不用改
    #[test]
    fn adopting_again_changes_the_rule_where_it_is() {
        let mut s = gateway();
        with_ours(&mut s, 1, vec![pin("moonshot", "kimi-k2")]);
        let v = view(&s, "claude-desktop", Some(&pick(&["glm-4.6", "kimi-k2"])))
            .unwrap()
            .unwrap();
        assert_eq!(v.position, 2);
        assert_eq!(v.current, Some(vec![pin("moonshot", "kimi-k2")]));
        let p = pick(&["glm-4.6", "kimi-k2"]);
        assert!(
            change(&s, "x", "claude-desktop", Some(&p), Some("kimi-k2"))
                .unwrap()
                .is_none()
        );
        let c = change(&s, "x", "claude-desktop", Some(&p), Some("glm-4.6"))
            .unwrap()
            .unwrap();
        assert_eq!(c.after.len(), c.before.len());
        assert_eq!(c.after[1].name, RULE_NAME);
        assert_eq!(models_of(&c.after[1]).unwrap()[0], pin("zai", "glm-4.6"));
    }

    /// 网关有它认的模型了（不用选）：之前加的那条删掉；没有就什么都不改
    #[test]
    fn without_a_pick_the_rule_is_taken_out() {
        let s = gateway();
        assert_eq!(view(&s, "claude-desktop", None).unwrap(), None);
        assert!(
            change(&s, "x", "claude-desktop", None, None)
                .unwrap()
                .is_none()
        );

        let mut s = gateway();
        with_ours(&mut s, 0, vec![pin("zai", "glm-4.6")]);
        let v = view(&s, "claude-desktop", None).unwrap().unwrap();
        assert!(v.pick.is_none());
        assert_eq!(v.current, Some(vec![pin("zai", "glm-4.6")]));
        let c = change(&s, "x", "claude-desktop", None, None)
            .unwrap()
            .unwrap();
        assert_eq!(
            json(&c.after),
            json(&rules_of(&gateway().overview.routes[0]))
        );
        assert_eq!(
            removal(&s, "claude-desktop").map(|r| change_json(&r)),
            Some(change_json(&c))
        );
    }

    /// 用户改过的不算我们的：改了名字、条件、改成转发到上游、加了改写或拒绝的都不删；
    /// 只换了指定模型的仍是这条
    #[test]
    fn a_rule_the_user_changed_is_left_alone() {
        let models = || Some(RuleTarget::Models(vec![pin("zai", "glm-4.6")]));
        let key = "claude-desktop";
        assert!(is_ours(&rule(RULE_NAME, Some(key), models()), key));
        assert!(is_ours(
            &rule(
                RULE_NAME,
                Some(key),
                Some(RuleTarget::Models(vec![pin("moonshot", "kimi-k2")]))
            ),
            key
        ));
        assert!(!is_ours(&rule("Desktop → GLM", Some(key), models()), key));
        assert!(!is_ours(&rule(RULE_NAME, Some("other"), models()), key));
        assert!(!is_ours(&rule(RULE_NAME, None, models()), key));
        assert!(!is_ours(
            &rule(RULE_NAME, Some(key), Some(RuleTarget::Name("zai".into()))),
            key
        ));
        assert!(!is_ours(
            &rule(RULE_NAME, Some(key), Some(RuleTarget::Models(vec![]))),
            key
        ));
        let mut more = rule(RULE_NAME, Some(key), models());
        more.conditions.push(ConditionView {
            field: ConditionField::Model,
            values: vec!["claude-*".into()],
        });
        assert!(!is_ours(&more, key));
        let mut set = rule(RULE_NAME, Some(key), models());
        set.set = Some(tw_api::RuleRewrite {
            max_tokens: Some(1000),
            ..Default::default()
        });
        assert!(!is_ours(&set, key));

        // 还原时不删它
        let mut s = gateway();
        s.overview.routes[0].rules.insert(0, view_of(set.clone()));
        assert!(removal(&s, key).is_none());
        // 接管时也不覆盖它：同名，请用户先处理
        let p = pick(&["glm-4.6"]);
        assert_eq!(
            view(&s, key, Some(&p)).unwrap_err().code,
            "adopt.plan.claude_desktop.rule_name_taken"
        );
        assert_eq!(
            change(&s, "x", key, Some(&p), Some("glm-4.6"))
                .unwrap_err()
                .code,
            "adopt.plan.claude_desktop.rule_name_taken"
        );
        // 另一条路由里的同名规则碍不着
        let mut s = gateway();
        s.overview.routes[1].rules.insert(0, view_of(set));
        assert!(
            change(&s, "x", key, Some(&p), Some("glm-4.6"))
                .unwrap()
                .is_some()
        );
    }

    /// 密钥换过路由：两条路由里的都找得到，先删它此刻所用的那条里的
    #[test]
    fn the_rule_is_found_in_another_route_too() {
        let mut s = gateway();
        s.overview.routes[1].rules.insert(
            0,
            view_of(rule(
                RULE_NAME,
                Some("claude-desktop"),
                Some(RuleTarget::Models(vec![pin("zai", "glm-4.6")])),
            )),
        );
        let c = removal(&s, "claude-desktop").unwrap();
        assert_eq!(c.route, "codex");
        assert_eq!(
            json(&c.after),
            json(&[rule("rest", None, Some(RuleTarget::Name("chatgpt".into())))])
        );
        with_ours(&mut s, 0, vec![pin("zai", "glm-4.6")]);
        assert_eq!(removal(&s, "claude-desktop").unwrap().route, "default");
    }

    /// 和确认框里那一份对不上：要选却没选、选的没了、不用选却选了
    #[test]
    fn a_choice_that_no_longer_fits_the_gateway_is_refused() {
        let s = gateway();
        let p = pick(&["glm-4.6"]);
        for (pick, chosen) in [
            (Some(&p), None),
            (Some(&p), Some("kimi-k2")),
            (Some(&p), Some("gone")),
            (None, Some("glm-4.6")),
        ] {
            assert_eq!(
                change(&s, "Claude Desktop", "claude-desktop", pick, chosen)
                    .unwrap_err()
                    .code,
                "adopt.plan.gateway_changed"
            );
        }
        // 一个都没得选：照写兜底的名字，不加规则
        assert!(
            change(&s, "x", "claude-desktop", Some(&pick(&["nope"])), None)
                .unwrap()
                .is_none()
        );
    }

    // ------------------------------------------------------------ 对着一个假的 core

    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// 假 core 手上的配置：`/overview` 和 `/models` 照它答，`PUT /routes/{name}` 照 core 的
    /// 规矩改它（版本不对就 409，`refuse` 时一律拒绝），每一次写都记下来
    struct Core {
        overview: serde_json::Value,
        known: serde_json::Value,
        version: u32,
        writes: Vec<serde_json::Value>,
        refuse: bool,
    }

    const KEY: &str = "abababababababababababababababababababababababababababababababab";

    fn json_of(s: &Snapshot) -> (serde_json::Value, serde_json::Value) {
        (json(&s.overview), json(&s.known))
    }

    /// 握手照真的来（`tw_link`），之后按 HTTP/1.1 一问一答：控制面客户端每次调用新建一条连接
    async fn fake_core(core: Arc<Mutex<Core>>) -> ControlClient {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let key = tw_link::ControlKey::parse(KEY).unwrap();
            let acceptor = tw_link::Acceptor::new(move || Some(key.clone()), "9.9.9");
            while let Ok((s, _)) = l.accept().await {
                let Ok(a) = acceptor.accept(s).await else {
                    continue;
                };
                let core = core.clone();
                tokio::spawn(answer(a.stream, core));
            }
        });
        ControlClient::to(crate::control::Target::Remote(
            crate::connection::connector::RemoteTarget {
                host: "127.0.0.1".into(),
                port,
                key: KEY.into(),
            },
        ))
    }

    async fn answer<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
        mut s: S,
        core: Arc<Mutex<Core>>,
    ) {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        let head_end = loop {
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break i + 4;
            }
            let Ok(n) = s.read(&mut chunk).await else {
                return;
            };
            if n == 0 {
                return;
            }
            buf.extend_from_slice(&chunk[..n]);
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let len = head
            .lines()
            .find_map(|l| {
                let (k, v) = l.split_once(':')?;
                k.eq_ignore_ascii_case("content-length")
                    .then(|| v.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        while buf.len() < head_end + len {
            let Ok(n) = s.read(&mut chunk).await else {
                return;
            };
            if n == 0 {
                return;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        let body: serde_json::Value =
            serde_json::from_slice(&buf[head_end..head_end + len]).unwrap_or_default();
        let mut first = head.lines().next().unwrap_or_default().split(' ');
        let (method, path) = (
            first.next().unwrap_or_default(),
            first.next().unwrap_or_default(),
        );
        let (status, reply) = {
            let mut c = core.lock().unwrap();
            route(&mut c, method, path, body)
        };
        let reply = reply.to_string();
        let text = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
            reply.len()
        );
        let _ = s.write_all(text.as_bytes()).await;
        let _ = s.flush().await;
    }

    fn refused(code: &str, text: &str) -> serde_json::Value {
        serde_json::json!({"code": code, "text": text})
    }

    fn route(
        c: &mut Core,
        method: &str,
        path: &str,
        body: serde_json::Value,
    ) -> (&'static str, serde_json::Value) {
        match (method, path) {
            ("GET", "/overview") => {
                let mut o = c.overview.clone();
                o["config_version"] = serde_json::json!(format!("v{}", c.version));
                ("200 OK", o)
            }
            ("GET", "/models") => ("200 OK", c.known.clone()),
            ("PUT", p) if p.starts_with("/routes/") => {
                let name = &p["/routes/".len()..];
                if c.refuse {
                    return (
                        "400 Bad Request",
                        refused("control.route.duplicate_rule", "refused"),
                    );
                }
                if body["base_version"] != serde_json::json!(format!("v{}", c.version)) {
                    return (
                        "409 Conflict",
                        refused("control.version_conflict", "stale version"),
                    );
                }
                c.writes.push(body.clone());
                let routes = c.overview["routes"].as_array_mut().unwrap();
                let r = routes.iter_mut().find(|r| r["name"] == name).unwrap();
                // 存进去的是 `RuleInput`，读出来的 `RuleView` 多几项
                let mut rules = body["route"]["rules"].clone();
                for x in rules.as_array_mut().unwrap() {
                    let all = x["conditions"].as_array().is_none_or(|c| c.is_empty());
                    x["catch_all"] = serde_json::json!(all);
                    x["phase_two"] = serde_json::json!(false);
                    x["shadowed"] = serde_json::json!(false);
                }
                r["rules"] = rules;
                c.version += 1;
                (
                    "200 OK",
                    serde_json::json!({"version": format!("v{}", c.version)}),
                )
            }
            _ => (
                "404 Not Found",
                refused("control.not_found", "no such endpoint"),
            ),
        }
    }

    fn core() -> Arc<Mutex<Core>> {
        let (overview, known) = json_of(&gateway());
        Arc::new(Mutex::new(Core {
            overview,
            known,
            version: 1,
            writes: Vec::new(),
            refuse: false,
        }))
    }

    fn rules_now(c: &Arc<Mutex<Core>>, route: &str) -> Vec<RuleInput> {
        let c = c.lock().unwrap();
        let r = c.overview["routes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["name"] == route)
            .unwrap();
        serde_json::from_value(r["rules"].clone()).unwrap()
    }

    /// 接管：按 core 此刻的配置算出改动、带着那一版的版本写进去，规则在最前面；还原之后
    /// 删掉它，路由回到原样。写进去的 JSON 就是约定里 `RouteSave` 的样子
    #[tokio::test]
    async fn the_rule_is_written_to_core_and_taken_out_on_restore() {
        let fake = core();
        let control = fake_core(fake.clone()).await;
        let before = rules_now(&fake, "default");

        let s = snapshot(&control).await.unwrap();
        assert_eq!(s.overview.config_version, "v1");
        let c = change(
            &s,
            "Claude Desktop",
            "claude-desktop",
            Some(&pick(&["glm-4.6"])),
            Some("glm-4.6"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(write(&control, &c).await.unwrap(), "v2");
        let sent = fake.lock().unwrap().writes[0].clone();
        assert_eq!(sent["base_version"], "v1");
        assert_eq!(sent["route"]["name"], "default");
        assert_eq!(
            sent["route"]["rules"][0],
            serde_json::json!({
                "name": "Claude Desktop",
                "conditions": [{"field": "client", "values": ["claude-desktop"]}],
                "to": [{"provider": "zai", "model": "glm-4.6"}, {"provider": "bigmodel", "model": "glm-4.6"}]
            })
        );
        assert!(sent.get("keys").is_none(), "不动密钥的路由选择");
        let now = rules_now(&fake, "default");
        assert!(is_ours(&now[0], "claude-desktop"));
        assert_eq!(json(&now[1..]), json(&before));

        // 再看一遍：确认框里给的就是这一条
        let s = snapshot(&control).await.unwrap();
        let v = view(&s, "claude-desktop", None).unwrap().unwrap();
        assert_eq!((v.route.as_str(), v.position), ("default", 1));

        assert_eq!(remove_after_restore(&control, "claude-desktop").await, None);
        assert_eq!(json(&rules_now(&fake, "default")), json(&before));
        // 没有了就不再写
        let n = fake.lock().unwrap().writes.len();
        assert_eq!(remove_after_restore(&control, "claude-desktop").await, None);
        assert_eq!(fake.lock().unwrap().writes.len(), n);
    }

    /// 配置没写成：把规则改回去，按写完之后的那一版
    #[tokio::test]
    async fn a_written_rule_is_taken_back() {
        let fake = core();
        let control = fake_core(fake.clone()).await;
        let before = rules_now(&fake, "default");
        let s = snapshot(&control).await.unwrap();
        let c = change(
            &s,
            "x",
            "claude-desktop",
            Some(&pick(&["kimi-k2"])),
            Some("kimi-k2"),
        )
        .unwrap()
        .unwrap();
        let v = write(&control, &c).await.unwrap();
        revert(&control, &c, &v).await.unwrap();
        assert_eq!(json(&rules_now(&fake, "default")), json(&before));
        // 那之后别人又改过：core 拒绝，不覆盖别人的改动
        let s = snapshot(&control).await.unwrap();
        let c = change(
            &s,
            "x",
            "claude-desktop",
            Some(&pick(&["kimi-k2"])),
            Some("kimi-k2"),
        )
        .unwrap()
        .unwrap();
        let v = write(&control, &c).await.unwrap();
        fake.lock().unwrap().version += 1;
        let e = revert(&control, &c, &v).await.unwrap_err();
        assert_eq!(e.code, "control.version_conflict");
        let m = not_reverted(&c, &gateway_changed("Claude Desktop"), &e);
        assert_eq!(m.code, "adopt.claude_desktop.rule_not_reverted");
        assert_eq!(m.arg("route"), "default");
    }

    /// 还原之后删不成：提醒去路由页删；问不到 core 也提醒
    #[tokio::test]
    async fn a_rule_that_cannot_be_deleted_is_reported() {
        let fake = core();
        let control = fake_core(fake.clone()).await;
        let s = snapshot(&control).await.unwrap();
        let c = change(
            &s,
            "x",
            "claude-desktop",
            Some(&pick(&["glm-4.6"])),
            Some("glm-4.6"),
        )
        .unwrap()
        .unwrap();
        write(&control, &c).await.unwrap();
        fake.lock().unwrap().refuse = true;
        let w = remove_after_restore(&control, "claude-desktop")
            .await
            .unwrap();
        assert_eq!(w.code, "adopt.claude_desktop.rule_left");
        assert_eq!(w.arg("route"), "default");
        assert_eq!(w.arg("rule"), RULE_NAME);

        // 没有为它发过密钥：没什么可删的
        assert_eq!(remove_after_restore(&control, "no-such-client").await, None);

        let gone = ControlClient::to(crate::control::Target::Remote(
            crate::connection::connector::RemoteTarget {
                host: "127.0.0.1".into(),
                port: 9,
                key: KEY.into(),
            },
        ));
        let w = remove_after_restore(&gone, "claude-desktop").await.unwrap();
        assert_eq!(w.code, "adopt.claude_desktop.rule_unchecked");
    }
}
