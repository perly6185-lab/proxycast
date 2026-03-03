//! 网络搜索运行时环境同步服务
//!
//! 将设置页中的网络搜索配置同步为 aster-rust 可读取的环境变量。

use proxycast_core::config::{
    Config, MultiSearchEngineEntryConfig, WebSearchConfig, WebSearchProvider,
};

fn provider_to_env_value(provider: &WebSearchProvider) -> &'static str {
    match provider {
        WebSearchProvider::Tavily => "tavily",
        WebSearchProvider::MultiSearchEngine => "multi_search_engine",
        WebSearchProvider::DuckduckgoInstant => "duckduckgo_instant",
        WebSearchProvider::BingSearchApi => "bing_search_api",
        WebSearchProvider::GoogleCustomSearch => "google_custom_search",
    }
}

fn default_provider_chain() -> Vec<WebSearchProvider> {
    vec![
        WebSearchProvider::Tavily,
        WebSearchProvider::MultiSearchEngine,
        WebSearchProvider::BingSearchApi,
        WebSearchProvider::GoogleCustomSearch,
        WebSearchProvider::DuckduckgoInstant,
    ]
}

fn normalize_text(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn push_provider_unique(target: &mut Vec<WebSearchProvider>, provider: WebSearchProvider) {
    if !target.contains(&provider) {
        target.push(provider);
    }
}

fn resolve_provider_priority(web_search: &WebSearchConfig) -> Vec<WebSearchProvider> {
    let mut resolved = Vec::new();
    push_provider_unique(&mut resolved, web_search.provider.clone());
    for provider in &web_search.provider_priority {
        push_provider_unique(&mut resolved, provider.clone());
    }
    for provider in default_provider_chain() {
        push_provider_unique(&mut resolved, provider);
    }
    resolved
}

fn normalize_engine_entry(entry: &MultiSearchEngineEntryConfig) -> Option<serde_json::Value> {
    let name = entry.name.trim();
    let template = entry.url_template.trim();
    if name.is_empty() || template.is_empty() || !template.contains("{query}") {
        return None;
    }
    Some(serde_json::json!({
        "name": name,
        "url_template": template,
        "enabled": entry.enabled,
    }))
}

fn set_or_clear_env(key: &str, value: Option<String>) {
    if let Some(value) = value {
        std::env::set_var(key, value);
    } else {
        std::env::remove_var(key);
    }
}

pub fn apply_web_search_runtime_env(config: &Config) {
    let web_search = &config.web_search;
    let provider_priority = resolve_provider_priority(web_search);

    std::env::set_var(
        "WEB_SEARCH_PROVIDER",
        provider_to_env_value(&web_search.provider),
    );
    std::env::set_var(
        "WEB_SEARCH_PROVIDER_PRIORITY",
        provider_priority
            .iter()
            .map(provider_to_env_value)
            .collect::<Vec<_>>()
            .join(","),
    );

    set_or_clear_env("TAVILY_API_KEY", normalize_text(&web_search.tavily_api_key));
    set_or_clear_env(
        "BING_SEARCH_API_KEY",
        normalize_text(&web_search.bing_search_api_key),
    );
    set_or_clear_env(
        "GOOGLE_SEARCH_API_KEY",
        normalize_text(&web_search.google_search_api_key),
    );
    set_or_clear_env(
        "GOOGLE_SEARCH_ENGINE_ID",
        normalize_text(&web_search.google_search_engine_id),
    );

    let multi_search_priority = if web_search.multi_search.priority.is_empty() {
        web_search
            .multi_search
            .engines
            .iter()
            .map(|entry| entry.name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>()
    } else {
        web_search
            .multi_search
            .priority
            .iter()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .collect::<Vec<_>>()
    };

    let engines = web_search
        .multi_search
        .engines
        .iter()
        .filter_map(normalize_engine_entry)
        .collect::<Vec<_>>();

    let mse_config = serde_json::json!({
        "priority": multi_search_priority,
        "engines": engines,
        "max_results_per_engine": web_search.multi_search.max_results_per_engine,
        "max_total_results": web_search.multi_search.max_total_results,
        "timeout_ms": web_search.multi_search.timeout_ms,
    });
    set_or_clear_env(
        "MULTI_SEARCH_ENGINE_CONFIG_JSON",
        serde_json::to_string(&mse_config).ok(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxycast_core::config::{MultiSearchConfig, SearchEngine};

    #[test]
    fn should_resolve_provider_priority_with_selected_provider_first() {
        let mut web_search = WebSearchConfig::default();
        web_search.provider = WebSearchProvider::GoogleCustomSearch;
        web_search.provider_priority = vec![
            WebSearchProvider::DuckduckgoInstant,
            WebSearchProvider::Tavily,
        ];

        let priority = resolve_provider_priority(&web_search);
        assert_eq!(
            priority.first(),
            Some(&WebSearchProvider::GoogleCustomSearch)
        );
        assert!(priority.contains(&WebSearchProvider::DuckduckgoInstant));
        assert!(priority.contains(&WebSearchProvider::Tavily));
    }

    #[test]
    fn should_filter_invalid_multi_search_engine_entries() {
        let valid = MultiSearchEngineEntryConfig {
            name: "valid".to_string(),
            url_template: "https://example.com/search?q={query}".to_string(),
            enabled: true,
        };
        let invalid = MultiSearchEngineEntryConfig {
            name: "invalid".to_string(),
            url_template: "https://example.com/search".to_string(),
            enabled: true,
        };

        assert!(normalize_engine_entry(&valid).is_some());
        assert!(normalize_engine_entry(&invalid).is_none());
    }

    #[test]
    fn should_build_multi_search_runtime_json() {
        let mut config = Config::default();
        config.web_search = WebSearchConfig {
            engine: SearchEngine::Google,
            provider: WebSearchProvider::MultiSearchEngine,
            provider_priority: vec![WebSearchProvider::Tavily],
            tavily_api_key: Some("tavily-key".to_string()),
            bing_search_api_key: None,
            google_search_api_key: None,
            google_search_engine_id: None,
            multi_search: MultiSearchConfig::default(),
        };

        apply_web_search_runtime_env(&config);
        let raw = std::env::var("MULTI_SEARCH_ENGINE_CONFIG_JSON").unwrap_or_default();
        assert!(!raw.is_empty());
    }
}
