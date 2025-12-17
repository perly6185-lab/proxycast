//! 处理器模块测试

use super::*;
use crate::router::RoutingRule;
use crate::services::provider_pool_service::ProviderPoolService;
use crate::ProviderType;

#[test]
fn test_request_processor_new() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 验证所有组件都已初始化
    assert!(Arc::strong_count(&processor.router) >= 1);
    assert!(Arc::strong_count(&processor.mapper) >= 1);
    assert!(Arc::strong_count(&processor.injector) >= 1);
    assert!(Arc::strong_count(&processor.retrier) >= 1);
    assert!(Arc::strong_count(&processor.failover) >= 1);
    assert!(Arc::strong_count(&processor.timeout) >= 1);
    assert!(Arc::strong_count(&processor.plugins) >= 1);
    assert!(Arc::strong_count(&processor.stats) >= 1);
    assert!(Arc::strong_count(&processor.tokens) >= 1);
    assert!(Arc::strong_count(&processor.pool_service) >= 1);
}

#[tokio::test]
async fn test_request_processor_components() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 验证路由器可以正常使用
    {
        let router = processor.router.read().await;
        assert!(router.rules().is_empty());
    }

    // 验证映射器可以正常使用
    {
        let mapper = processor.mapper.read().await;
        // resolve 返回原值如果没有别名
        assert_eq!(mapper.resolve("unknown"), "unknown");
    }

    // 验证注入器可以正常使用
    {
        let injector = processor.injector.read().await;
        assert!(injector.rules().is_empty());
    }

    // 验证统计聚合器可以正常使用（使用 parking_lot::RwLock）
    {
        let stats = processor.stats.read();
        assert!(stats.is_empty());
    }

    // 验证 Token 追踪器可以正常使用（使用 parking_lot::RwLock）
    {
        let tokens = processor.tokens.read();
        assert!(tokens.is_empty());
    }
}

// ========== 模型映射测试 (需求 2.1) ==========

#[tokio::test]
async fn test_resolve_model_with_alias() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加别名映射
    {
        let mut mapper = processor.mapper.write().await;
        mapper.add_alias("gpt-4", "claude-sonnet-4-5");
        mapper.add_alias("gpt-3.5-turbo", "claude-3-haiku");
    }

    // 测试别名解析
    let resolved = processor.resolve_model("gpt-4").await;
    assert_eq!(resolved, "claude-sonnet-4-5");

    let resolved = processor.resolve_model("gpt-3.5-turbo").await;
    assert_eq!(resolved, "claude-3-haiku");

    // 非别名应返回原值
    let resolved = processor.resolve_model("claude-sonnet-4-5").await;
    assert_eq!(resolved, "claude-sonnet-4-5");
}

#[tokio::test]
async fn test_resolve_model_for_context() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加别名映射
    {
        let mut mapper = processor.mapper.write().await;
        mapper.add_alias("gpt-4", "claude-sonnet-4-5");
    }

    // 创建请求上下文
    let mut ctx = RequestContext::new("gpt-4".to_string());
    assert_eq!(ctx.original_model, "gpt-4");
    assert_eq!(ctx.resolved_model, "gpt-4"); // 初始时相同

    // 解析模型并更新上下文
    let resolved = processor.resolve_model_for_context(&mut ctx).await;

    assert_eq!(resolved, "claude-sonnet-4-5");
    assert_eq!(ctx.original_model, "gpt-4"); // 原始模型不变
    assert_eq!(ctx.resolved_model, "claude-sonnet-4-5"); // 解析后的模型已更新
}

// ========== 路由测试 (需求 2.2, 2.3) ==========

#[tokio::test]
async fn test_route_model_with_rules() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加路由规则
    {
        let mut router = processor.router.write().await;
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 10));
        router.add_rule(RoutingRule::new("qwen-*", ProviderType::Qwen, 10));
    }

    // 测试路由
    let (provider, is_default) = processor.route_model("gemini-2.5-flash").await;
    assert_eq!(provider, ProviderType::Gemini);
    assert!(!is_default);

    let (provider, is_default) = processor.route_model("qwen-plus").await;
    assert_eq!(provider, ProviderType::Qwen);
    assert!(!is_default);

    // 无匹配规则时使用默认 Provider
    let (provider, is_default) = processor.route_model("claude-sonnet-4-5").await;
    assert_eq!(provider, ProviderType::Kiro);
    assert!(is_default);
}

#[tokio::test]
async fn test_route_for_context() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加路由规则
    {
        let mut router = processor.router.write().await;
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 10));
    }

    // 创建请求上下文
    let mut ctx = RequestContext::new("gemini-2.5-flash".to_string());
    ctx.set_resolved_model("gemini-2.5-flash".to_string());

    // 路由并更新上下文
    let provider = processor.route_for_context(&mut ctx).await;

    assert_eq!(provider, ProviderType::Gemini);
    assert_eq!(ctx.provider, Some(ProviderType::Gemini));
}

#[tokio::test]
async fn test_is_model_excluded() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加排除规则
    {
        let mut router = processor.router.write().await;
        router.add_exclusion(ProviderType::Gemini, "*-preview");
        router.add_exclusion(ProviderType::Gemini, "gemini-2.5-pro");
    }

    // 测试排除检查
    assert!(
        processor
            .is_model_excluded(ProviderType::Gemini, "gemini-2.5-pro-preview")
            .await
    );
    assert!(
        processor
            .is_model_excluded(ProviderType::Gemini, "gemini-2.5-pro")
            .await
    );
    assert!(
        !processor
            .is_model_excluded(ProviderType::Gemini, "gemini-2.5-flash")
            .await
    );
    assert!(
        !processor
            .is_model_excluded(ProviderType::Kiro, "gemini-2.5-pro")
            .await
    );
}

#[tokio::test]
async fn test_resolve_and_route() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加别名映射
    {
        let mut mapper = processor.mapper.write().await;
        mapper.add_alias("gpt-4", "claude-sonnet-4-5");
    }

    // 添加路由规则
    {
        let mut router = processor.router.write().await;
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 10));
    }

    // 测试完整的解析和路由流程
    let mut ctx = RequestContext::new("gpt-4".to_string());
    let provider = processor.resolve_and_route(&mut ctx).await;

    // gpt-4 -> claude-sonnet-4-5 -> Kiro (默认)
    assert_eq!(ctx.original_model, "gpt-4");
    assert_eq!(ctx.resolved_model, "claude-sonnet-4-5");
    assert_eq!(provider, ProviderType::Kiro);
    assert_eq!(ctx.provider, Some(ProviderType::Kiro));

    // 测试 Gemini 模型
    let mut ctx2 = RequestContext::new("gemini-2.5-flash".to_string());
    let provider2 = processor.resolve_and_route(&mut ctx2).await;

    assert_eq!(ctx2.original_model, "gemini-2.5-flash");
    assert_eq!(ctx2.resolved_model, "gemini-2.5-flash");
    assert_eq!(provider2, ProviderType::Gemini);
    assert_eq!(ctx2.provider, Some(ProviderType::Gemini));
}

#[tokio::test]
async fn test_route_with_exclusion() {
    let pool_service = Arc::new(ProviderPoolService::new());
    let processor = RequestProcessor::with_defaults(pool_service);

    // 添加路由规则和排除规则
    {
        let mut router = processor.router.write().await;
        router.add_rule(RoutingRule::new("gemini-*", ProviderType::Gemini, 10));
        router.add_exclusion(ProviderType::Gemini, "*-preview");
    }

    // 正常路由
    let (provider, is_default) = processor.route_model("gemini-2.5-flash").await;
    assert_eq!(provider, ProviderType::Gemini);
    assert!(!is_default);

    // 被排除的模型应使用默认 Provider
    let (provider, is_default) = processor.route_model("gemini-2.5-pro-preview").await;
    assert_eq!(provider, ProviderType::Kiro);
    assert!(is_default);
}

// ========== 属性测试 (Property-Based Tests) ==========

use crate::telemetry::{RequestLog, RequestStatus};
use proptest::prelude::*;

/// 生成随机的 ProviderType
fn arb_provider_type() -> impl Strategy<Value = ProviderType> {
    prop_oneof![
        Just(ProviderType::Kiro),
        Just(ProviderType::Gemini),
        Just(ProviderType::Qwen),
        Just(ProviderType::OpenAI),
        Just(ProviderType::Claude),
    ]
}

/// 生成随机的 RequestStatus
fn arb_request_status() -> impl Strategy<Value = RequestStatus> {
    prop_oneof![
        Just(RequestStatus::Success),
        Just(RequestStatus::Failed),
        Just(RequestStatus::Timeout),
        Just(RequestStatus::Cancelled),
    ]
}

/// 生成随机的模型名称
fn arb_model_name() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("claude-sonnet-4".to_string()),
        Just("claude-opus-4".to_string()),
        Just("gemini-2.5-flash".to_string()),
        Just("gemini-2.5-pro".to_string()),
        Just("qwen3-coder-plus".to_string()),
        Just("gpt-4o".to_string()),
    ]
}

/// 生成随机的请求日志
fn arb_request_log() -> impl Strategy<Value = RequestLog> {
    (
        "[a-zA-Z0-9_-]{8,16}", // id
        arb_provider_type(),
        arb_model_name(),
        any::<bool>(), // is_streaming
        arb_request_status(),
        1u64..10000u64,                   // duration_ms
        prop::option::of(100u16..600u16), // http_status
        prop::option::of(1u32..10000u32), // input_tokens
        prop::option::of(1u32..5000u32),  // output_tokens
    )
        .prop_map(
            |(
                id,
                provider,
                model,
                is_streaming,
                status,
                duration_ms,
                http_status,
                input_tokens,
                output_tokens,
            )| {
                let mut log = RequestLog::new(id, provider, model, is_streaming);

                match status {
                    RequestStatus::Success => {
                        log.mark_success(duration_ms, http_status.unwrap_or(200));
                    }
                    RequestStatus::Failed => {
                        log.mark_failed(duration_ms, http_status, "Test error".to_string());
                    }
                    RequestStatus::Timeout => {
                        log.mark_timeout(duration_ms);
                    }
                    RequestStatus::Cancelled => {
                        log.mark_cancelled(duration_ms);
                    }
                    RequestStatus::Retrying => {
                        // 保持默认状态
                    }
                }

                log.set_tokens(input_tokens, output_tokens);
                log
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: module-integration, Property 1: 请求完成后统计记录**
    /// *对于任意* 成功或失败的请求，请求完成后 StatsAggregator 中应存在对应的记录
    /// **Validates: Requirements 1.3, 4.1**
    #[test]
    fn prop_request_stats_recorded(
        log in arb_request_log()
    ) {
        let pool_service = Arc::new(ProviderPoolService::new());
        let processor = RequestProcessor::with_defaults(pool_service);

        let original_id = log.id.clone();
        let original_provider = log.provider;
        let original_model = log.model.clone();
        let original_status = log.status;

        // 记录请求日志到 StatsAggregator（使用 parking_lot::RwLock）
        {
            let stats = processor.stats.write();
            stats.record(log);
        }

        // 验证：StatsAggregator 中应存在对应的记录
        {
            let stats = processor.stats.read();
            let all_logs = stats.get_all();

            // 查找对应的记录
            let found = all_logs.iter().find(|l| l.id == original_id);
            prop_assert!(
                found.is_some(),
                "请求 {} 完成后应在 StatsAggregator 中存在记录",
                original_id
            );

            // 验证记录内容一致性
            let found_log = found.unwrap();
            prop_assert_eq!(
                found_log.provider,
                original_provider,
                "记录的 Provider 应与原始一致"
            );
            prop_assert_eq!(
                &found_log.model,
                &original_model,
                "记录的模型应与原始一致"
            );
            prop_assert_eq!(
                found_log.status,
                original_status,
                "记录的状态应与原始一致"
            );
        }
    }

    /// **Feature: module-integration, Property 1: 请求完成后统计记录（批量）**
    /// *对于任意* 多个请求，所有请求完成后 StatsAggregator 中应存在所有对应的记录
    /// **Validates: Requirements 1.3, 4.1**
    #[test]
    fn prop_multiple_requests_stats_recorded(
        logs in prop::collection::vec(arb_request_log(), 1..20)
    ) {
        let pool_service = Arc::new(ProviderPoolService::new());
        let processor = RequestProcessor::with_defaults(pool_service);

        // 收集所有日志 ID
        let log_ids: Vec<String> = logs.iter().map(|l| l.id.clone()).collect();
        let expected_count = logs.len();

        // 记录所有请求日志（使用 parking_lot::RwLock）
        {
            let stats = processor.stats.write();
            for log in logs {
                stats.record(log);
            }
        }

        // 验证：所有记录都应存在
        {
            let stats = processor.stats.read();
            let all_logs = stats.get_all();

            // 验证记录数量
            prop_assert_eq!(
                all_logs.len(),
                expected_count,
                "StatsAggregator 中的记录数应等于请求数"
            );

            // 验证每个请求都有对应记录
            for id in &log_ids {
                let found = all_logs.iter().any(|l| &l.id == id);
                prop_assert!(
                    found,
                    "请求 {} 应在 StatsAggregator 中存在记录",
                    id
                );
            }
        }
    }

    /// **Feature: module-integration, Property 1: 请求完成后统计记录（统计准确性）**
    /// *对于任意* 请求集合，统计摘要中的总请求数应等于记录的请求数
    /// **Validates: Requirements 1.3, 4.1**
    #[test]
    fn prop_stats_summary_accuracy(
        logs in prop::collection::vec(arb_request_log(), 1..50)
    ) {
        let pool_service = Arc::new(ProviderPoolService::new());
        let processor = RequestProcessor::with_defaults(pool_service);

        let expected_total = logs.len();
        let expected_success = logs.iter().filter(|l| l.status == RequestStatus::Success).count();
        let expected_failed = logs.iter().filter(|l| l.status == RequestStatus::Failed).count();
        let expected_timeout = logs.iter().filter(|l| l.status == RequestStatus::Timeout).count();

        // 记录所有请求日志（使用 parking_lot::RwLock）
        {
            let stats = processor.stats.write();
            for log in logs {
                stats.record(log);
            }
        }

        // 获取统计摘要
        {
            let stats = processor.stats.read();
            let summary = stats.summary(None);

            // 验证总请求数
            prop_assert_eq!(
                summary.total_requests as usize,
                expected_total,
                "统计的总请求数应等于记录的请求数"
            );

            // 验证成功请求数
            prop_assert_eq!(
                summary.successful_requests as usize,
                expected_success,
                "统计的成功请求数应正确"
            );

            // 验证失败请求数
            prop_assert_eq!(
                summary.failed_requests as usize,
                expected_failed,
                "统计的失败请求数应正确"
            );

            // 验证超时请求数
            prop_assert_eq!(
                summary.timeout_requests as usize,
                expected_timeout,
                "统计的超时请求数应正确"
            );

            // 验证成功率
            if expected_total > 0 {
                let expected_rate = expected_success as f64 / expected_total as f64;
                prop_assert!(
                    (summary.success_rate - expected_rate).abs() < 0.001,
                    "成功率应正确计算"
                );
            }
        }
    }
}

// ========== 凭证失败计数属性测试 ==========

use crate::credential::{Credential, CredentialData, CredentialPool, HealthChecker};

/// 生成随机的凭证 ID
fn arb_credential_id() -> impl Strategy<Value = String> {
    "[a-z0-9]{8,16}".prop_map(|s| s.to_string())
}

/// 生成随机的失败次数
fn arb_failure_count() -> impl Strategy<Value = u32> {
    1u32..10u32
}

/// 创建测试凭证
fn create_test_credential(id: &str) -> Credential {
    Credential::new(
        id.to_string(),
        ProviderType::Kiro,
        CredentialData::ApiKey {
            key: format!("test-key-{}", id),
            base_url: None,
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: module-integration, Property 3: 凭证失败计数更新**
    /// *对于任意* 凭证调用失败，HealthChecker 中该凭证的失败计数应增加 1
    /// **Validates: Requirements 8.2**
    #[test]
    fn prop_credential_failure_count_update(
        credential_id in arb_credential_id(),
        failure_count in arb_failure_count()
    ) {
        // 创建凭证池和健康检查器
        let pool = CredentialPool::new(ProviderType::Kiro);
        let health_checker = HealthChecker::with_defaults();

        // 添加凭证到池中
        let credential = create_test_credential(&credential_id);
        pool.add(credential).unwrap();

        // 获取初始失败计数
        let initial_failures = pool.get(&credential_id)
            .map(|c| c.stats.consecutive_failures)
            .unwrap_or(0);

        // 记录多次失败
        for i in 0..failure_count {
            let _ = health_checker.record_failure(&pool, &credential_id);

            // 验证每次失败后计数增加 1
            let current_failures = pool.get(&credential_id)
                .map(|c| c.stats.consecutive_failures)
                .unwrap_or(0);

            prop_assert_eq!(
                current_failures,
                initial_failures + i + 1,
                "第 {} 次失败后，失败计数应为 {}",
                i + 1,
                initial_failures + i + 1
            );
        }

        // 验证最终失败计数
        let final_failures = pool.get(&credential_id)
            .map(|c| c.stats.consecutive_failures)
            .unwrap_or(0);

        prop_assert_eq!(
            final_failures,
            initial_failures + failure_count,
            "最终失败计数应等于初始计数 + 失败次数"
        );
    }

    /// **Feature: module-integration, Property 3: 凭证失败计数更新（多凭证）**
    /// *对于任意* 多个凭证的失败，每个凭证的失败计数应独立更新
    /// **Validates: Requirements 8.2**
    #[test]
    fn prop_credential_failure_count_independent(
        credential_ids in prop::collection::vec(arb_credential_id(), 2..5),
        failure_counts in prop::collection::vec(arb_failure_count(), 2..5)
    ) {
        // 确保凭证 ID 唯一
        let unique_ids: Vec<String> = credential_ids.into_iter()
            .enumerate()
            .map(|(i, id)| format!("{}-{}", id, i))
            .collect();

        // 创建凭证池和健康检查器
        let pool = CredentialPool::new(ProviderType::Kiro);
        let health_checker = HealthChecker::with_defaults();

        // 添加所有凭证
        for id in &unique_ids {
            let credential = create_test_credential(id);
            pool.add(credential).unwrap();
        }

        // 为每个凭证记录不同次数的失败
        let min_len = unique_ids.len().min(failure_counts.len());
        for i in 0..min_len {
            let id = &unique_ids[i];
            let count = failure_counts[i];

            for _ in 0..count {
                let _ = health_checker.record_failure(&pool, id);
            }
        }

        // 验证每个凭证的失败计数独立
        for i in 0..min_len {
            let id = &unique_ids[i];
            let expected_count = failure_counts[i];

            let actual_count = pool.get(id)
                .map(|c| c.stats.consecutive_failures)
                .unwrap_or(0);

            prop_assert_eq!(
                actual_count,
                expected_count,
                "凭证 {} 的失败计数应为 {}",
                id,
                expected_count
            );
        }
    }

    /// **Feature: module-integration, Property 3: 凭证失败计数更新（成功重置）**
    /// *对于任意* 凭证，成功调用后连续失败计数应重置为 0
    /// **Validates: Requirements 8.2**
    #[test]
    fn prop_credential_failure_count_reset_on_success(
        credential_id in arb_credential_id(),
        failure_count in arb_failure_count(),
        latency_ms in 10u64..1000u64
    ) {
        // 创建凭证池和健康检查器
        let pool = CredentialPool::new(ProviderType::Kiro);
        let health_checker = HealthChecker::with_defaults();

        // 添加凭证
        let credential = create_test_credential(&credential_id);
        pool.add(credential).unwrap();

        // 记录多次失败
        for _ in 0..failure_count {
            let _ = health_checker.record_failure(&pool, &credential_id);
        }

        // 验证失败计数已增加
        let failures_before_success = pool.get(&credential_id)
            .map(|c| c.stats.consecutive_failures)
            .unwrap_or(0);

        prop_assert_eq!(
            failures_before_success,
            failure_count,
            "成功前失败计数应为 {}", failure_count
        );

        // 记录成功
        let _ = health_checker.record_success(&pool, &credential_id, latency_ms);

        // 验证失败计数已重置
        let failures_after_success = pool.get(&credential_id)
            .map(|c| c.stats.consecutive_failures)
            .unwrap_or(0);

        prop_assert_eq!(
            failures_after_success,
            0,
            "成功后连续失败计数应重置为 0"
        );
    }
}

// ========== Token 响应记录一致性属性测试 ==========

use crate::processor::steps::TelemetryStep;
use crate::telemetry::{TokenSource, TokenTracker, TokenUsageRecord};
use parking_lot::RwLock as ParkingLotRwLock;

/// 生成随机的 Token 数量
fn arb_token_count() -> impl Strategy<Value = u32> {
    1u32..10000u32
}

/// 生成随机的 OpenAI 格式响应
fn arb_openai_response() -> impl Strategy<Value = (u32, u32, serde_json::Value)> {
    (arb_token_count(), arb_token_count()).prop_map(|(input, output)| {
        let response = serde_json::json!({
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1234567890,
            "model": "claude-sonnet-4-5",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "Test response"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": input,
                "completion_tokens": output,
                "total_tokens": input + output
            }
        });
        (input, output, response)
    })
}

/// 生成随机的 Anthropic 格式响应
fn arb_anthropic_response() -> impl Strategy<Value = (u32, u32, serde_json::Value)> {
    (arb_token_count(), arb_token_count()).prop_map(|(input, output)| {
        let response = serde_json::json!({
            "id": "msg-test",
            "type": "message",
            "role": "assistant",
            "content": [{
                "type": "text",
                "text": "Test response"
            }],
            "model": "claude-sonnet-4-5",
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": input,
                "output_tokens": output
            }
        });
        (input, output, response)
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: module-integration, Property 2: Token 响应记录一致性**
    /// *对于任意* 包含 Token 使用信息的响应，TokenTracker 中记录的 Token 数应与响应中的值一致
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_token_response_recording_consistency_openai(
        (expected_input, expected_output, response) in arb_openai_response()
    ) {
        // 创建 TelemetryStep 和 TokenTracker
        let stats = Arc::new(ParkingLotRwLock::new(crate::telemetry::StatsAggregator::with_defaults()));
        let tokens = Arc::new(ParkingLotRwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats, tokens.clone());

        // 创建请求上下文
        let ctx = RequestContext::new("claude-sonnet-4-5".to_string());

        // 从响应中提取并记录 Token
        step.record_tokens_from_response(&ctx, &response);

        // 验证：TokenTracker 中记录的 Token 数应与响应中的值一致
        let tokens_guard = tokens.read();
        let all_records = tokens_guard.get_all();

        prop_assert_eq!(
            all_records.len(),
            1,
            "应该有且仅有一条 Token 记录"
        );

        let record = &all_records[0];

        prop_assert_eq!(
            record.input_tokens,
            expected_input,
            "记录的输入 Token 数应与响应中的值一致"
        );

        prop_assert_eq!(
            record.output_tokens,
            expected_output,
            "记录的输出 Token 数应与响应中的值一致"
        );

        prop_assert_eq!(
            record.total_tokens,
            expected_input + expected_output,
            "记录的总 Token 数应等于输入 + 输出"
        );

        prop_assert_eq!(
            record.source,
            TokenSource::Actual,
            "Token 来源应为 Actual"
        );

        prop_assert_eq!(
            record.request_id.as_ref(),
            Some(&ctx.request_id),
            "记录的请求 ID 应与上下文一致"
        );
    }

    /// **Feature: module-integration, Property 2: Token 响应记录一致性（Anthropic 格式）**
    /// *对于任意* 包含 Token 使用信息的 Anthropic 格式响应，TokenTracker 中记录的 Token 数应与响应中的值一致
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_token_response_recording_consistency_anthropic(
        (expected_input, expected_output, response) in arb_anthropic_response()
    ) {
        // 创建 TelemetryStep 和 TokenTracker
        let stats = Arc::new(ParkingLotRwLock::new(crate::telemetry::StatsAggregator::with_defaults()));
        let tokens = Arc::new(ParkingLotRwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats, tokens.clone());

        // 创建请求上下文
        let ctx = RequestContext::new("claude-sonnet-4-5".to_string());

        // 从响应中提取并记录 Token
        step.record_tokens_from_response(&ctx, &response);

        // 验证：TokenTracker 中记录的 Token 数应与响应中的值一致
        let tokens_guard = tokens.read();
        let all_records = tokens_guard.get_all();

        prop_assert_eq!(
            all_records.len(),
            1,
            "应该有且仅有一条 Token 记录"
        );

        let record = &all_records[0];

        prop_assert_eq!(
            record.input_tokens,
            expected_input,
            "记录的输入 Token 数应与响应中的值一致"
        );

        prop_assert_eq!(
            record.output_tokens,
            expected_output,
            "记录的输出 Token 数应与响应中的值一致"
        );

        prop_assert_eq!(
            record.total_tokens,
            expected_input + expected_output,
            "记录的总 Token 数应等于输入 + 输出"
        );

        prop_assert_eq!(
            record.source,
            TokenSource::Actual,
            "Token 来源应为 Actual"
        );
    }

    /// **Feature: module-integration, Property 2: Token 响应记录一致性（批量）**
    /// *对于任意* 多个包含 Token 使用信息的响应，TokenTracker 中应记录所有响应的 Token 数
    /// **Validates: Requirements 4.2**
    #[test]
    fn prop_token_response_recording_consistency_batch(
        responses in prop::collection::vec(arb_openai_response(), 1..20)
    ) {
        // 创建 TelemetryStep 和 TokenTracker
        let stats = Arc::new(ParkingLotRwLock::new(crate::telemetry::StatsAggregator::with_defaults()));
        let tokens = Arc::new(ParkingLotRwLock::new(TokenTracker::with_defaults()));
        let step = TelemetryStep::new(stats, tokens.clone());

        let expected_count = responses.len();
        let mut expected_total_input: u64 = 0;
        let mut expected_total_output: u64 = 0;

        // 记录所有响应的 Token
        for (input, output, response) in &responses {
            let ctx = RequestContext::new("claude-sonnet-4-5".to_string());
            step.record_tokens_from_response(&ctx, response);
            expected_total_input += *input as u64;
            expected_total_output += *output as u64;
        }

        // 验证：TokenTracker 中应记录所有响应的 Token 数
        let tokens_guard = tokens.read();
        let all_records = tokens_guard.get_all();

        prop_assert_eq!(
            all_records.len(),
            expected_count,
            "Token 记录数应等于响应数"
        );

        // 验证总 Token 数
        let actual_total_input: u64 = all_records.iter().map(|r| r.input_tokens as u64).sum();
        let actual_total_output: u64 = all_records.iter().map(|r| r.output_tokens as u64).sum();

        prop_assert_eq!(
            actual_total_input,
            expected_total_input,
            "总输入 Token 数应一致"
        );

        prop_assert_eq!(
            actual_total_output,
            expected_total_output,
            "总输出 Token 数应一致"
        );
    }
}
