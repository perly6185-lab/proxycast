//! 参数注入类型定义
//!
//! 定义注入规则、注入模式和注入器

use serde::{Deserialize, Serialize};

/// 注入模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum InjectionMode {
    /// 合并模式：不覆盖已有参数
    #[default]
    Merge,
    /// 覆盖模式：覆盖已有参数
    Override,
}

/// 注入规则
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InjectionRule {
    /// 规则 ID
    pub id: String,
    /// 模型匹配模式（支持通配符）
    pub pattern: String,
    /// 要注入的参数
    pub parameters: serde_json::Value,
    /// 注入模式
    #[serde(default)]
    pub mode: InjectionMode,
    /// 优先级（数字越小优先级越高）
    #[serde(default = "default_priority")]
    pub priority: i32,
    /// 是否启用
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_priority() -> i32 {
    100
}

fn default_enabled() -> bool {
    true
}

impl InjectionRule {
    /// 创建新的注入规则
    pub fn new(id: &str, pattern: &str, parameters: serde_json::Value) -> Self {
        Self {
            id: id.to_string(),
            pattern: pattern.to_string(),
            parameters,
            mode: InjectionMode::Merge,
            priority: default_priority(),
            enabled: true,
        }
    }

    /// 设置注入模式
    pub fn with_mode(mut self, mode: InjectionMode) -> Self {
        self.mode = mode;
        self
    }

    /// 设置优先级
    pub fn with_priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    /// 检查模型是否匹配此规则
    ///
    /// 支持的通配符模式：
    /// - 精确匹配: `claude-sonnet-4-5`
    /// - 前缀匹配: `claude-*`
    /// - 后缀匹配: `*-preview`
    /// - 包含匹配: `*flash*`
    pub fn matches(&self, model: &str) -> bool {
        if !self.enabled {
            return false;
        }
        pattern_matches(&self.pattern, model)
    }

    /// 检查是否为精确匹配规则
    pub fn is_exact(&self) -> bool {
        !self.pattern.contains('*')
    }
}

/// 规则排序：精确匹配优先，然后按优先级
impl Ord for InjectionRule {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match (self.is_exact(), other.is_exact()) {
            (true, false) => return std::cmp::Ordering::Less,
            (false, true) => return std::cmp::Ordering::Greater,
            _ => {}
        }
        self.priority.cmp(&other.priority)
    }
}

impl PartialOrd for InjectionRule {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Eq for InjectionRule {}

/// 注入结果
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InjectionResult {
    /// 应用的规则 ID 列表
    pub applied_rules: Vec<String>,
    /// 注入的参数名列表
    pub injected_params: Vec<String>,
}

impl InjectionResult {
    /// 创建空的注入结果
    pub fn new() -> Self {
        Self::default()
    }

    /// 检查是否有注入
    pub fn has_injections(&self) -> bool {
        !self.injected_params.is_empty()
    }
}

/// 注入配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct InjectionConfig {
    /// 是否启用注入
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// 注入规则列表
    #[serde(default)]
    pub rules: Vec<InjectionRule>,
}

/// 参数注入器
#[derive(Debug, Clone, Default)]
pub struct Injector {
    /// 注入规则列表（已排序）
    rules: Vec<InjectionRule>,
}

impl Injector {
    /// 创建新的注入器
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    /// 从规则列表创建注入器
    pub fn with_rules(mut rules: Vec<InjectionRule>) -> Self {
        rules.sort();
        Self { rules }
    }

    /// 添加规则
    pub fn add_rule(&mut self, rule: InjectionRule) {
        self.rules.push(rule);
        self.rules.sort();
    }

    /// 移除规则
    pub fn remove_rule(&mut self, id: &str) -> Option<InjectionRule> {
        if let Some(pos) = self.rules.iter().position(|r| r.id == id) {
            Some(self.rules.remove(pos))
        } else {
            None
        }
    }

    /// 获取所有规则
    pub fn rules(&self) -> &[InjectionRule] {
        &self.rules
    }

    /// 获取匹配的规则
    pub fn matching_rules(&self, model: &str) -> Vec<&InjectionRule> {
        self.rules.iter().filter(|r| r.matches(model)).collect()
    }

    /// 清空所有规则
    pub fn clear(&mut self) {
        self.rules.clear();
    }

    /// 注入参数到请求
    ///
    /// 按规则优先级顺序应用注入：
    /// - Merge 模式：不覆盖已有参数
    /// - Override 模式：覆盖已有参数
    pub fn inject(&self, model: &str, payload: &mut serde_json::Value) -> InjectionResult {
        let mut result = InjectionResult::new();

        // 确保 payload 是对象
        let obj = match payload.as_object_mut() {
            Some(obj) => obj,
            None => return result,
        };

        // 按优先级顺序应用匹配的规则
        for rule in self.matching_rules(model) {
            let params = match rule.parameters.as_object() {
                Some(params) => params,
                None => continue,
            };

            let mut rule_applied = false;

            for (key, value) in params {
                let should_inject = match rule.mode {
                    InjectionMode::Merge => !obj.contains_key(key),
                    InjectionMode::Override => true,
                };

                if should_inject {
                    obj.insert(key.clone(), value.clone());
                    if !result.injected_params.contains(key) {
                        result.injected_params.push(key.clone());
                    }
                    rule_applied = true;
                }
            }

            if rule_applied {
                result.applied_rules.push(rule.id.clone());
            }
        }

        result
    }
}

/// 检查模式是否匹配模型名
///
/// 支持的通配符模式：
/// - 精确匹配: `claude-sonnet-4-5`
/// - 前缀匹配: `claude-*`
/// - 后缀匹配: `*-preview`
/// - 包含匹配: `*flash*`
fn pattern_matches(pattern: &str, model: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == model;
    }

    let parts: Vec<&str> = pattern.split('*').collect();

    match parts.as_slice() {
        [prefix, ""] => model.starts_with(prefix),
        ["", suffix] => model.ends_with(suffix),
        ["", middle, ""] => model.contains(middle),
        [prefix, suffix] => model.starts_with(prefix) && model.ends_with(suffix),
        _ => false,
    }
}
