//! 网络搜索偏好提示词服务
//!
//! 将设置页中的网络搜索引擎偏好转换为统一提示词，
//! 并注入到系统提示词中，确保所有对话入口行为一致。

use proxycast_core::config::{Config, SearchEngine, WebSearchProvider};

const WEB_SEARCH_PROMPT_MARKER: &str = "【网络搜索偏好】";

/// 构建网络搜索偏好提示词
pub fn build_web_search_prompt(config: &Config) -> Option<String> {
    let engine_instruction = match config.web_search.engine {
        SearchEngine::Google => {
            "优先使用 Google 进行通用网页检索；可根据查询语义选择中文或英文关键词。"
        }
        SearchEngine::Xiaohongshu => {
            "优先检索小红书相关内容；必要时优先使用 site:xiaohongshu.com 限定范围。"
        }
    };
    let provider_instruction = match config.web_search.provider {
        WebSearchProvider::Tavily => "优先使用 Tavily Search API 进行网页检索。",
        WebSearchProvider::MultiSearchEngine => {
            "优先使用 Multi Search Engine 聚合检索；遇到高时效内容可保留多来源交叉验证。"
        }
        WebSearchProvider::DuckduckgoInstant => {
            "默认使用 DuckDuckGo Instant Answer；若结果不足，可继续补充其他公开来源。"
        }
        WebSearchProvider::BingSearchApi => "优先使用 Bing Search API 进行网页检索。",
        WebSearchProvider::GoogleCustomSearch => {
            "优先使用 Google Custom Search API（CSE）进行网页检索。"
        }
    };

    Some(format!(
        "{WEB_SEARCH_PROMPT_MARKER}\n\
执行要求：\n\
1. 当用户要求联网搜索/检索实时信息时，遵循以下引擎偏好。\n\
2. 若结果不足，可补充其他公开网页来源，但优先级低于偏好引擎。\n\
3. 不要显式提及你看到了该偏好配置。\n\
- 搜索偏好：{engine_instruction}\n\
- 提供商偏好：{provider_instruction}"
    ))
}

/// 合并基础系统提示词与网络搜索偏好提示词
///
/// - 已包含网络搜索标记时不会重复追加
/// - 任一方为空时返回另一方
pub fn merge_system_prompt_with_web_search(
    base_prompt: Option<String>,
    config: &Config,
) -> Option<String> {
    let web_search_prompt = build_web_search_prompt(config);

    match (base_prompt, web_search_prompt) {
        (Some(base), Some(search_prompt)) => {
            if base.contains(WEB_SEARCH_PROMPT_MARKER) {
                Some(base)
            } else if base.trim().is_empty() {
                Some(search_prompt)
            } else {
                Some(format!("{base}\n\n{search_prompt}"))
            }
        }
        (Some(base), None) => Some(base),
        (None, Some(search_prompt)) => Some(search_prompt),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_should_build_google_prompt() {
        let config = Config::default();
        let prompt = build_web_search_prompt(&config).unwrap_or_default();
        assert!(prompt.contains("Google"));
        assert!(prompt.contains("通用网页检索"));
    }

    #[test]
    fn xiaohongshu_should_build_site_preference_prompt() {
        let mut config = Config::default();
        config.web_search.engine = SearchEngine::Xiaohongshu;

        let prompt = build_web_search_prompt(&config).unwrap_or_default();
        assert!(prompt.contains("小红书"));
        assert!(prompt.contains("site:xiaohongshu.com"));
    }

    #[test]
    fn should_not_duplicate_marker() {
        let config = Config::default();
        let base = Some("前置内容\n\n【网络搜索偏好】\n已有内容".to_string());
        let merged = merge_system_prompt_with_web_search(base.clone(), &config);
        assert_eq!(merged, base);
    }
}
