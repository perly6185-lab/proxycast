//! 路由规则
//!
//! 提供模型路由规则定义和匹配功能

use crate::ProviderType;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 路由规则 - 定义模型到 Provider 的路由
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoutingRule {
    /// 模型模式（支持通配符）
    pub pattern: String,
    /// 目标 Provider
    pub target_provider: ProviderType,
    /// 优先级（数字越小优先级越高）
    pub priority: i32,
    /// 是否启用
    pub enabled: bool,
}

impl RoutingRule {
    /// 创建新的路由规则
    pub fn new(pattern: &str, target_provider: ProviderType, priority: i32) -> Self {
        Self {
            pattern: pattern.to_string(),
            target_provider,
            priority,
            enabled: true,
        }
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

        let pattern = &self.pattern;

        // 精确匹配
        if !pattern.contains('*') {
            return pattern == model;
        }

        // 通配符匹配
        let parts: Vec<&str> = pattern.split('*').collect();

        match parts.as_slice() {
            // 前缀匹配: `claude-*`
            [prefix, ""] => model.starts_with(prefix),
            // 后缀匹配: `*-preview`
            ["", suffix] => model.ends_with(suffix),
            // 包含匹配: `*flash*`
            ["", middle, ""] => model.contains(middle),
            // 前缀+后缀匹配: `claude-*-preview`
            [prefix, suffix] => model.starts_with(prefix) && model.ends_with(suffix),
            // 其他复杂模式暂不支持
            _ => false,
        }
    }

    /// 检查是否为精确匹配规则
    pub fn is_exact(&self) -> bool {
        !self.pattern.contains('*')
    }
}

/// 路由规则比较器 - 用于排序
impl Ord for RoutingRule {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // 首先按精确匹配优先
        match (self.is_exact(), other.is_exact()) {
            (true, false) => return std::cmp::Ordering::Less,
            (false, true) => return std::cmp::Ordering::Greater,
            _ => {}
        }
        // 然后按优先级排序
        self.priority.cmp(&other.priority)
    }
}

impl PartialOrd for RoutingRule {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Eq for RoutingRule {}

/// 路由结果
#[derive(Debug, Clone)]
pub struct RouteResult {
    /// 目标 Provider
    pub provider: ProviderType,
    /// 匹配的规则（如果有）
    pub matched_rule: Option<RoutingRule>,
    /// 是否使用默认 Provider
    pub is_default: bool,
}

/// 路由器 - 根据模型名路由到 Provider
#[derive(Debug, Clone)]
pub struct Router {
    /// 路由规则列表（已排序）
    rules: Vec<RoutingRule>,
    /// 默认 Provider
    default_provider: ProviderType,
    /// 排除列表：Provider -> 排除的模型模式列表
    exclusions: HashMap<ProviderType, Vec<String>>,
}

impl Router {
    /// 创建新的路由器
    pub fn new(default_provider: ProviderType) -> Self {
        Self {
            rules: Vec::new(),
            default_provider,
            exclusions: HashMap::new(),
        }
    }

    /// 从规则列表创建路由器
    pub fn with_rules(default_provider: ProviderType, mut rules: Vec<RoutingRule>) -> Self {
        // 按优先级排序规则
        rules.sort();
        Self {
            rules,
            default_provider,
            exclusions: HashMap::new(),
        }
    }

    /// 添加路由规则
    pub fn add_rule(&mut self, rule: RoutingRule) {
        self.rules.push(rule);
        // 重新排序
        self.rules.sort();
    }

    /// 移除路由规则
    pub fn remove_rule(&mut self, pattern: &str) -> Option<RoutingRule> {
        if let Some(pos) = self.rules.iter().position(|r| r.pattern == pattern) {
            Some(self.rules.remove(pos))
        } else {
            None
        }
    }

    /// 获取所有规则
    pub fn rules(&self) -> &[RoutingRule] {
        &self.rules
    }

    /// 设置默认 Provider
    pub fn set_default_provider(&mut self, provider: ProviderType) {
        self.default_provider = provider;
    }

    /// 获取默认 Provider
    pub fn default_provider(&self) -> ProviderType {
        self.default_provider
    }

    /// 清空所有路由规则
    pub fn clear_rules(&mut self) {
        self.rules.clear();
    }

    /// 清空所有排除规则
    pub fn clear_exclusions(&mut self) {
        self.exclusions.clear();
    }

    /// 添加排除模式
    pub fn add_exclusion(&mut self, provider: ProviderType, pattern: &str) {
        self.exclusions
            .entry(provider)
            .or_default()
            .push(pattern.to_string());
    }

    /// 移除排除模式
    pub fn remove_exclusion(&mut self, provider: ProviderType, pattern: &str) -> bool {
        if let Some(patterns) = self.exclusions.get_mut(&provider) {
            if let Some(pos) = patterns.iter().position(|p| p == pattern) {
                patterns.remove(pos);
                return true;
            }
        }
        false
    }

    /// 获取 Provider 的排除列表
    pub fn exclusions(&self, provider: ProviderType) -> Option<&Vec<String>> {
        self.exclusions.get(&provider)
    }

    /// 检查模型是否被排除
    ///
    /// 支持与路由规则相同的通配符模式
    pub fn is_excluded(&self, provider: ProviderType, model: &str) -> bool {
        if let Some(patterns) = self.exclusions.get(&provider) {
            for pattern in patterns {
                if Self::pattern_matches(pattern, model) {
                    return true;
                }
            }
        }
        false
    }

    /// 路由请求到 Provider
    ///
    /// 按以下优先级匹配：
    /// 1. 精确匹配规则优先于通配符规则
    /// 2. 同类型规则按 priority 数值排序（数字越小优先级越高）
    /// 3. 如果没有匹配的规则，使用默认 Provider
    /// 4. 如果匹配的 Provider 排除了该模型，继续尝试下一个规则
    pub fn route(&self, model: &str) -> RouteResult {
        // 遍历已排序的规则
        for rule in &self.rules {
            if rule.matches(model) {
                // 检查是否被排除
                if !self.is_excluded(rule.target_provider, model) {
                    return RouteResult {
                        provider: rule.target_provider,
                        matched_rule: Some(rule.clone()),
                        is_default: false,
                    };
                }
            }
        }

        // 没有匹配的规则，使用默认 Provider
        RouteResult {
            provider: self.default_provider,
            matched_rule: None,
            is_default: true,
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
        // 精确匹配
        if !pattern.contains('*') {
            return pattern == model;
        }

        // 通配符匹配
        let parts: Vec<&str> = pattern.split('*').collect();

        match parts.as_slice() {
            // 前缀匹配: `claude-*`
            [prefix, ""] => model.starts_with(prefix),
            // 后缀匹配: `*-preview`
            ["", suffix] => model.ends_with(suffix),
            // 包含匹配: `*flash*`
            ["", middle, ""] => model.contains(middle),
            // 前缀+后缀匹配: `claude-*-preview`
            [prefix, suffix] => model.starts_with(prefix) && model.ends_with(suffix),
            // 其他复杂模式暂不支持
            _ => false,
        }
    }
}

impl Default for Router {
    fn default() -> Self {
        Self::new(ProviderType::Kiro)
    }
}

#[cfg(test)]
mod rule_tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        let rule = RoutingRule::new("claude-sonnet-4-5", ProviderType::Kiro, 10);

        assert!(rule.matches("claude-sonnet-4-5"));
        assert!(!rule.matches("claude-sonnet-4-5-20250514"));
        assert!(!rule.matches("claude-opus"));
    }

    #[test]
    fn test_prefix_match() {
        let rule = RoutingRule::new("claude-*", ProviderType::Kiro, 20);

        assert!(rule.matches("claude-sonnet-4-5"));
        assert!(rule.matches("claude-opus"));
        assert!(!rule.matches("gemini-2.5-flash"));
    }

    #[test]
    fn test_suffix_match() {
        let rule = RoutingRule::new("*-preview", ProviderType::Gemini, 20);

        assert!(rule.matches("gemini-2.5-pro-preview"));
        assert!(rule.matches("claude-preview"));
        assert!(!rule.matches("gemini-2.5-flash"));
    }

    #[test]
    fn test_contains_match() {
        let rule = RoutingRule::new("*flash*", ProviderType::Gemini, 20);

        assert!(rule.matches("gemini-2.5-flash"));
        assert!(rule.matches("gemini-flash-preview"));
        assert!(!rule.matches("gemini-2.5-pro"));
    }

    #[test]
    fn test_prefix_suffix_match() {
        let rule = RoutingRule::new("claude-*-preview", ProviderType::Kiro, 20);

        assert!(rule.matches("claude-sonnet-preview"));
        assert!(rule.matches("claude-opus-preview"));
        assert!(!rule.matches("claude-sonnet"));
        assert!(!rule.matches("gemini-preview"));
    }

    #[test]
    fn test_disabled_rule() {
        let mut rule = RoutingRule::new("claude-*", ProviderType::Kiro, 20);
        rule.enabled = false;

        assert!(!rule.matches("claude-sonnet-4-5"));
    }

    #[test]
    fn test_rule_ordering() {
        let exact = RoutingRule::new("claude-sonnet-4-5", ProviderType::Kiro, 20);
        let wildcard = RoutingRule::new("claude-*", ProviderType::Kiro, 10);

        // 精确匹配应优先于通配符，即使通配符优先级数字更小
        assert!(exact < wildcard);
    }

    #[test]
    fn test_same_type_ordering() {
        let rule1 = RoutingRule::new("claude-*", ProviderType::Kiro, 10);
        let rule2 = RoutingRule::new("gemini-*", ProviderType::Gemini, 20);

        // 同为通配符时，按优先级排序
        assert!(rule1 < rule2);
    }
}

#[cfg(test)]
mod router_tests {
    use super::*;

    #[test]
    fn test_new_router() {
        let router = Router::new(ProviderType::Kiro);
        assert_eq!(router.default_provider(), ProviderType::Kiro);
        assert!(router.rules().is_empty());
    }

    #[test]
    fn test_add_rule() {
        let mut router = Router::new(ProviderType::Kiro);
        router.add_rule(RoutingRule::new("claude-*", ProviderType::Kiro, 10));
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 20));

        assert_eq!(router.rules().len(), 2);
    }

    #[test]
    fn test_route_exact_match() {
        let mut router = Router::new(ProviderType::Kiro);
        router.add_rule(RoutingRule::new(
            "claude-sonnet-4-5",
            ProviderType::Kiro,
            10,
        ));
        router.add_rule(RoutingRule::new(
            "gemini-2.5-flash",
            ProviderType::Gemini,
            10,
        ));

        let result = router.route("claude-sonnet-4-5");
        assert_eq!(result.provider, ProviderType::Kiro);
        assert!(!result.is_default);

        let result = router.route("gemini-2.5-flash");
        assert_eq!(result.provider, ProviderType::Gemini);
        assert!(!result.is_default);
    }

    #[test]
    fn test_route_wildcard_match() {
        let mut router = Router::new(ProviderType::Kiro);
        router.add_rule(RoutingRule::new("claude-*", ProviderType::Kiro, 10));
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 10));

        let result = router.route("claude-opus");
        assert_eq!(result.provider, ProviderType::Kiro);

        let result = router.route("gemini-2.5-pro");
        assert_eq!(result.provider, ProviderType::Gemini);
    }

    #[test]
    fn test_route_default_provider() {
        let router = Router::new(ProviderType::Qwen);

        let result = router.route("unknown-model");
        assert_eq!(result.provider, ProviderType::Qwen);
        assert!(result.is_default);
    }

    #[test]
    fn test_exact_rule_priority_over_wildcard() {
        let mut router = Router::new(ProviderType::Kiro);
        // 添加通配符规则（优先级数字更小）
        router.add_rule(RoutingRule::new("claude-*", ProviderType::Gemini, 1));
        // 添加精确匹配规则（优先级数字更大）
        router.add_rule(RoutingRule::new(
            "claude-sonnet-4-5",
            ProviderType::Kiro,
            100,
        ));

        // 精确匹配应优先于通配符，即使通配符优先级数字更小
        let result = router.route("claude-sonnet-4-5");
        assert_eq!(result.provider, ProviderType::Kiro);
        assert!(result.matched_rule.as_ref().unwrap().is_exact());
    }

    #[test]
    fn test_exclusion() {
        let mut router = Router::new(ProviderType::Kiro);
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 10));
        router.add_exclusion(ProviderType::Gemini, "*-preview");

        // 被排除的模型应使用默认 Provider
        let result = router.route("gemini-2.5-pro-preview");
        assert_eq!(result.provider, ProviderType::Kiro);
        assert!(result.is_default);

        // 未被排除的模型应正常路由
        let result = router.route("gemini-2.5-flash");
        assert_eq!(result.provider, ProviderType::Gemini);
        assert!(!result.is_default);
    }

    #[test]
    fn test_is_excluded() {
        let mut router = Router::new(ProviderType::Kiro);
        router.add_exclusion(ProviderType::Gemini, "*-preview");
        router.add_exclusion(ProviderType::Gemini, "gemini-2.5-pro");

        assert!(router.is_excluded(ProviderType::Gemini, "gemini-2.5-pro-preview"));
        assert!(router.is_excluded(ProviderType::Gemini, "gemini-2.5-pro"));
        assert!(!router.is_excluded(ProviderType::Gemini, "gemini-2.5-flash"));
        assert!(!router.is_excluded(ProviderType::Kiro, "gemini-2.5-pro-preview"));
    }

    #[test]
    fn test_remove_rule() {
        let mut router = Router::new(ProviderType::Kiro);
        router.add_rule(RoutingRule::new("claude-*", ProviderType::Kiro, 10));

        let removed = router.remove_rule("claude-*");
        assert!(removed.is_some());
        assert!(router.rules().is_empty());

        let removed = router.remove_rule("nonexistent");
        assert!(removed.is_none());
    }
}
