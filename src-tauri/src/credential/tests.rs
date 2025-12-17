//! 凭证池属性测试
//!
//! 使用 proptest 进行属性测试

use crate::credential::{
    BalanceStrategy, Credential, CredentialData, CredentialPool, LoadBalancer,
};
use crate::ProviderType;
use proptest::prelude::*;
use std::collections::HashSet;
use std::sync::Arc;

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

/// 生成随机的 CredentialData
fn arb_credential_data() -> impl Strategy<Value = CredentialData> {
    prop_oneof![
        // OAuth 凭证
        ("[a-zA-Z0-9]{10,50}", prop::option::of("[a-zA-Z0-9]{10,50}")).prop_map(
            |(access_token, refresh_token)| {
                CredentialData::OAuth {
                    access_token,
                    refresh_token,
                    expires_at: None,
                }
            }
        ),
        // API Key 凭证
        (
            "[a-zA-Z0-9]{10,50}",
            prop::option::of("https?://[a-z]+\\.[a-z]+")
        )
            .prop_map(|(key, base_url)| { CredentialData::ApiKey { key, base_url } }),
    ]
}

/// 生成随机的 Credential
fn arb_credential() -> impl Strategy<Value = Credential> {
    (
        "[a-zA-Z0-9_-]{1,32}", // id
        arb_provider_type(),
        arb_credential_data(),
    )
        .prop_map(|(id, provider, data)| Credential::new(id, provider, data))
}

/// 生成具有唯一 ID 的凭证列表
fn arb_unique_credentials(max_count: usize) -> impl Strategy<Value = Vec<Credential>> {
    prop::collection::vec(arb_credential(), 1..=max_count).prop_map(|creds| {
        // 确保 ID 唯一
        let mut seen = std::collections::HashSet::new();
        creds
            .into_iter()
            .filter(|c| seen.insert(c.id.clone()))
            .collect()
    })
}

proptest! {
    /// **Feature: enhancement-roadmap, Property 1: 凭证池添加不变性**
    /// *对于任意* 凭证池和有效凭证，添加凭证后池的大小应增加 1，且池中应包含该凭证
    /// **Validates: Requirements 1.1**
    #[test]
    fn prop_pool_add_invariant(
        provider in arb_provider_type(),
        credential in arb_credential()
    ) {
        let pool = CredentialPool::new(provider);
        let initial_size = pool.len();
        let cred_id = credential.id.clone();

        // 添加凭证
        let result = pool.add(credential);
        prop_assert!(result.is_ok(), "添加凭证应该成功");

        // 验证不变性：大小增加 1
        prop_assert_eq!(
            pool.len(),
            initial_size + 1,
            "添加凭证后池大小应增加 1"
        );

        // 验证不变性：池中包含该凭证
        prop_assert!(
            pool.contains(&cred_id),
            "池中应包含刚添加的凭证"
        );
    }

    /// **Feature: enhancement-roadmap, Property 1: 凭证池添加不变性（批量）**
    /// *对于任意* 凭证池和多个有效凭证，添加 N 个凭证后池的大小应增加 N
    /// **Validates: Requirements 1.1**
    #[test]
    fn prop_pool_add_multiple_invariant(
        provider in arb_provider_type(),
        credentials in arb_unique_credentials(10)
    ) {
        let pool = CredentialPool::new(provider);
        let initial_size = pool.len();
        let cred_count = credentials.len();
        let cred_ids: Vec<_> = credentials.iter().map(|c| c.id.clone()).collect();

        // 添加所有凭证
        for cred in credentials {
            let result = pool.add(cred);
            prop_assert!(result.is_ok(), "添加凭证应该成功");
        }

        // 验证不变性：大小增加 N
        prop_assert_eq!(
            pool.len(),
            initial_size + cred_count,
            "添加 {} 个凭证后池大小应增加 {}",
            cred_count,
            cred_count
        );

        // 验证不变性：池中包含所有凭证
        for id in &cred_ids {
            prop_assert!(
                pool.contains(id),
                "池中应包含凭证 {}",
                id
            );
        }
    }
}

proptest! {
    /// **Feature: enhancement-roadmap, Property 2: 凭证移除不变性**
    /// *对于任意* 非空凭证池和池中存在的凭证 ID，移除该凭证后其他凭证应保持不变
    /// **Validates: Requirements 1.3**
    #[test]
    fn prop_pool_remove_invariant(
        provider in arb_provider_type(),
        credentials in arb_unique_credentials(10),
        remove_index in 0usize..10usize
    ) {
        // 确保有足够的凭证
        prop_assume!(!credentials.is_empty());
        let remove_index = remove_index % credentials.len();

        let pool = CredentialPool::new(provider);

        // 添加所有凭证
        let cred_ids: Vec<_> = credentials.iter().map(|c| c.id.clone()).collect();
        for cred in credentials {
            pool.add(cred).unwrap();
        }

        let initial_size = pool.len();
        let id_to_remove = &cred_ids[remove_index];

        // 记录其他凭证的 ID
        let other_ids: Vec<_> = cred_ids
            .iter()
            .filter(|id| *id != id_to_remove)
            .cloned()
            .collect();

        // 移除凭证
        let result = pool.remove(id_to_remove);
        prop_assert!(result.is_ok(), "移除凭证应该成功");

        // 验证不变性：大小减少 1
        prop_assert_eq!(
            pool.len(),
            initial_size - 1,
            "移除凭证后池大小应减少 1"
        );

        // 验证不变性：被移除的凭证不再存在
        prop_assert!(
            !pool.contains(id_to_remove),
            "被移除的凭证不应存在于池中"
        );

        // 验证不变性：其他凭证保持不变
        for id in &other_ids {
            prop_assert!(
                pool.contains(id),
                "其他凭证 {} 应保持不变",
                id
            );
        }
    }

    /// **Feature: enhancement-roadmap, Property 2: 凭证移除不变性（连续移除）**
    /// *对于任意* 凭证池，连续移除所有凭证后池应为空
    /// **Validates: Requirements 1.3**
    #[test]
    fn prop_pool_remove_all_invariant(
        provider in arb_provider_type(),
        credentials in arb_unique_credentials(10)
    ) {
        prop_assume!(!credentials.is_empty());

        let pool = CredentialPool::new(provider);

        // 添加所有凭证
        let cred_ids: Vec<_> = credentials.iter().map(|c| c.id.clone()).collect();
        for cred in credentials {
            pool.add(cred).unwrap();
        }

        // 逐个移除所有凭证
        for id in &cred_ids {
            let result = pool.remove(id);
            prop_assert!(result.is_ok(), "移除凭证 {} 应该成功", id);
        }

        // 验证不变性：池为空
        prop_assert!(pool.is_empty(), "移除所有凭证后池应为空");
        prop_assert_eq!(pool.len(), 0, "移除所有凭证后池大小应为 0");
    }
}

/// 生成具有唯一 ID 且属于同一 Provider 的凭证列表
fn arb_unique_credentials_same_provider(
    provider: ProviderType,
    min_count: usize,
    max_count: usize,
) -> impl Strategy<Value = Vec<Credential>> {
    prop::collection::vec(arb_credential_data(), min_count..=max_count).prop_map(move |data_list| {
        data_list
            .into_iter()
            .enumerate()
            .map(|(i, data)| Credential::new(format!("cred-{}", i), provider, data))
            .collect()
    })
}

proptest! {
    /// **Feature: enhancement-roadmap, Property 3: 轮询均匀性**
    /// *对于任意* 包含 N 个活跃凭证的池，连续 N 次选择应返回 N 个不同的凭证
    /// **Validates: Requirements 1.2 (验收标准 1)**
    #[test]
    fn prop_round_robin_uniformity(
        provider in arb_provider_type(),
        cred_count in 2usize..=10usize
    ) {
        // 创建负载均衡器
        let lb = LoadBalancer::new(BalanceStrategy::RoundRobin);
        let pool = Arc::new(CredentialPool::new(provider));

        // 添加 N 个凭证
        for i in 0..cred_count {
            let cred = Credential::new(
                format!("cred-{}", i),
                provider,
                CredentialData::ApiKey {
                    key: format!("key-{}", i),
                    base_url: None,
                },
            );
            pool.add(cred).unwrap();
        }

        lb.register_pool(pool);

        // 连续选择 N 次
        let mut selected_ids: Vec<String> = Vec::with_capacity(cred_count);
        for _ in 0..cred_count {
            let cred = lb.select(provider).unwrap();
            selected_ids.push(cred.id.clone());
        }

        // 验证：N 次选择应返回 N 个不同的凭证
        let unique_ids: HashSet<_> = selected_ids.iter().collect();
        prop_assert_eq!(
            unique_ids.len(),
            cred_count,
            "连续 {} 次选择应返回 {} 个不同的凭证，但只得到 {} 个不同的凭证: {:?}",
            cred_count,
            cred_count,
            unique_ids.len(),
            selected_ids
        );
    }

    /// **Feature: enhancement-roadmap, Property 3: 轮询均匀性（多轮）**
    /// *对于任意* 包含 N 个活跃凭证的池，连续 2N 次选择应每个凭证被选中 2 次
    /// **Validates: Requirements 1.2 (验收标准 1)**
    #[test]
    fn prop_round_robin_uniformity_multiple_rounds(
        provider in arb_provider_type(),
        cred_count in 2usize..=5usize,
        rounds in 2usize..=4usize
    ) {
        let lb = LoadBalancer::new(BalanceStrategy::RoundRobin);
        let pool = Arc::new(CredentialPool::new(provider));

        // 添加 N 个凭证
        for i in 0..cred_count {
            let cred = Credential::new(
                format!("cred-{}", i),
                provider,
                CredentialData::ApiKey {
                    key: format!("key-{}", i),
                    base_url: None,
                },
            );
            pool.add(cred).unwrap();
        }

        lb.register_pool(pool);

        // 连续选择 N * rounds 次
        let total_selections = cred_count * rounds;
        let mut selection_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

        for _ in 0..total_selections {
            let cred = lb.select(provider).unwrap();
            *selection_counts.entry(cred.id.clone()).or_insert(0) += 1;
        }

        // 验证：每个凭证应被选中 rounds 次
        for (id, count) in &selection_counts {
            prop_assert_eq!(
                *count,
                rounds,
                "凭证 {} 应被选中 {} 次，但实际被选中 {} 次",
                id,
                rounds,
                count
            );
        }

        // 验证：应该有 N 个不同的凭证被选中
        prop_assert_eq!(
            selection_counts.len(),
            cred_count,
            "应有 {} 个不同的凭证被选中，但实际有 {} 个",
            cred_count,
            selection_counts.len()
        );
    }
}

proptest! {
    /// **Feature: enhancement-roadmap, Property 5: 健康状态转换**
    /// *对于任意* 凭证，连续 3 次失败后状态应变为不健康
    /// **Validates: Requirements 1.3 (验收标准 2)**
    #[test]
    fn prop_health_state_transition(
        provider in arb_provider_type(),
        failure_threshold in 1u32..=5u32
    ) {
        use crate::credential::{CredentialStatus, HealthCheckConfig, HealthChecker};
        use std::time::Duration;

        // 创建带自定义阈值的健康检查器
        let config = HealthCheckConfig {
            check_interval: Duration::from_secs(60),
            failure_threshold,
            recovery_threshold: 1,
        };
        let checker = HealthChecker::new(config);
        let pool = CredentialPool::new(provider);

        // 添加凭证
        let cred = Credential::new(
            "test-cred".to_string(),
            provider,
            CredentialData::ApiKey {
                key: "test-key".to_string(),
                base_url: None,
            },
        );
        pool.add(cred).unwrap();

        // 记录 (failure_threshold - 1) 次失败，不应标记为不健康
        for i in 0..(failure_threshold - 1) {
            let marked = checker.record_failure(&pool, "test-cred").unwrap();
            prop_assert!(
                !marked,
                "第 {} 次失败不应标记为不健康（阈值: {}）",
                i + 1,
                failure_threshold
            );

            let cred = pool.get("test-cred").unwrap();
            prop_assert!(
                matches!(cred.status, CredentialStatus::Active),
                "第 {} 次失败后状态应仍为 Active",
                i + 1
            );
        }

        // 第 failure_threshold 次失败应标记为不健康
        let marked = checker.record_failure(&pool, "test-cred").unwrap();
        prop_assert!(
            marked,
            "第 {} 次失败应标记为不健康",
            failure_threshold
        );

        let cred = pool.get("test-cred").unwrap();
        prop_assert!(
            matches!(cred.status, CredentialStatus::Unhealthy { .. }),
            "达到阈值后状态应为 Unhealthy，但实际为 {:?}",
            cred.status
        );

        // 验证连续失败次数
        prop_assert_eq!(
            cred.stats.consecutive_failures,
            failure_threshold,
            "连续失败次数应为 {}",
            failure_threshold
        );
    }

    /// **Feature: enhancement-roadmap, Property 5: 健康状态转换（恢复）**
    /// *对于任意* 不健康的凭证，成功后应恢复为健康状态
    /// **Validates: Requirements 1.3 (验收标准 2)**
    #[test]
    fn prop_health_state_recovery(
        provider in arb_provider_type(),
        latency_ms in 1u64..1000u64
    ) {
        use crate::credential::{CredentialStatus, HealthChecker};

        let checker = HealthChecker::with_defaults();
        let pool = CredentialPool::new(provider);

        // 添加凭证
        let cred = Credential::new(
            "test-cred".to_string(),
            provider,
            CredentialData::ApiKey {
                key: "test-key".to_string(),
                base_url: None,
            },
        );
        pool.add(cred).unwrap();

        // 标记为不健康
        pool.mark_unhealthy("test-cred", "test reason".to_string()).unwrap();

        // 验证状态为不健康
        let cred = pool.get("test-cred").unwrap();
        prop_assert!(
            matches!(cred.status, CredentialStatus::Unhealthy { .. }),
            "凭证应为不健康状态"
        );

        // 记录成功应恢复
        let recovered = checker.record_success(&pool, "test-cred", latency_ms).unwrap();
        prop_assert!(
            recovered,
            "成功后应恢复为健康状态"
        );

        // 验证状态已恢复
        let cred = pool.get("test-cred").unwrap();
        prop_assert!(
            matches!(cred.status, CredentialStatus::Active),
            "恢复后状态应为 Active，但实际为 {:?}",
            cred.status
        );

        // 验证连续失败次数已重置
        prop_assert_eq!(
            cred.stats.consecutive_failures,
            0,
            "恢复后连续失败次数应为 0"
        );
    }

    /// **Feature: enhancement-roadmap, Property 5: 健康状态转换（成功重置失败计数）**
    /// *对于任意* 凭证，成功请求应重置连续失败计数
    /// **Validates: Requirements 1.3 (验收标准 2)**
    #[test]
    fn prop_success_resets_failure_count(
        provider in arb_provider_type(),
        failures_before in 1u32..3u32,
        latency_ms in 1u64..1000u64
    ) {
        use crate::credential::HealthChecker;

        let checker = HealthChecker::with_defaults();
        let pool = CredentialPool::new(provider);

        // 添加凭证
        let cred = Credential::new(
            "test-cred".to_string(),
            provider,
            CredentialData::ApiKey {
                key: "test-key".to_string(),
                base_url: None,
            },
        );
        pool.add(cred).unwrap();

        // 记录一些失败（但不超过阈值）
        for _ in 0..failures_before {
            checker.record_failure(&pool, "test-cred").unwrap();
        }

        // 验证有连续失败
        let cred = pool.get("test-cred").unwrap();
        prop_assert_eq!(
            cred.stats.consecutive_failures,
            failures_before,
            "应有 {} 次连续失败",
            failures_before
        );

        // 记录成功
        checker.record_success(&pool, "test-cred", latency_ms).unwrap();

        // 验证连续失败次数已重置
        let cred = pool.get("test-cred").unwrap();
        prop_assert_eq!(
            cred.stats.consecutive_failures,
            0,
            "成功后连续失败次数应重置为 0"
        );
    }
}

proptest! {
    /// **Feature: enhancement-roadmap, Property 4: 冷却状态转换**
    /// *对于任意* 凭证，当标记为冷却后，在冷却期内不应被选中；冷却期结束后应恢复可选
    /// **Validates: Requirements 1.2 (验收标准 2, 4)**
    #[test]
    fn prop_cooldown_state_transition(
        provider in arb_provider_type(),
        cooldown_index in 0usize..5usize
    ) {
        use chrono::{Duration, Utc};
        use crate::credential::CredentialStatus;

        let lb = LoadBalancer::new(BalanceStrategy::RoundRobin);
        let pool = Arc::new(CredentialPool::new(provider));

        // 添加 5 个凭证
        let cred_count = 5usize;
        for i in 0..cred_count {
            let cred = Credential::new(
                format!("cred-{}", i),
                provider,
                CredentialData::ApiKey {
                    key: format!("key-{}", i),
                    base_url: None,
                },
            );
            pool.add(cred).unwrap();
        }

        lb.register_pool(pool.clone());

        let cooldown_id = format!("cred-{}", cooldown_index);

        // 标记一个凭证为冷却状态（1小时后恢复）
        lb.mark_cooldown(provider, &cooldown_id, Duration::hours(1)).unwrap();

        // 验证：冷却中的凭证不应被选中
        // 连续选择 (N-1) * 2 次，应该不会选中冷却中的凭证
        let selections = (cred_count - 1) * 2;
        for _ in 0..selections {
            let selected = lb.select(provider).unwrap();
            prop_assert_ne!(
                selected.id,
                cooldown_id.clone(),
                "冷却中的凭证 {} 不应被选中",
                &cooldown_id
            );
        }

        // 模拟冷却期结束：直接设置状态为过去的时间
        {
            let mut entry = pool.credentials.get_mut(&cooldown_id).unwrap();
            entry.status = CredentialStatus::Cooldown {
                until: Utc::now() - Duration::seconds(1),
            };
        }

        // 验证：冷却期结束后应恢复可选
        // 连续选择 N 次，应该能选中之前冷却的凭证
        let mut found_recovered = false;
        for _ in 0..cred_count {
            let selected = lb.select(provider).unwrap();
            if selected.id == cooldown_id {
                found_recovered = true;
                break;
            }
        }

        prop_assert!(
            found_recovered,
            "冷却期结束后，凭证 {} 应该能被选中",
            cooldown_id
        );

        // 验证：恢复后的凭证状态应为 Active
        let cred = pool.get(&cooldown_id).unwrap();
        prop_assert!(
            matches!(cred.status, CredentialStatus::Active),
            "冷却期结束后，凭证状态应为 Active，但实际为 {:?}",
            cred.status
        );
    }

    /// **Feature: enhancement-roadmap, Property 4: 冷却状态转换（所有凭证冷却）**
    /// *对于任意* 凭证池，当所有凭证都处于冷却状态时，选择应返回错误
    /// **Validates: Requirements 1.2 (验收标准 3)**
    #[test]
    fn prop_all_cooldown_returns_error(
        provider in arb_provider_type(),
        cred_count in 1usize..=5usize
    ) {
        use chrono::Duration;
        use crate::credential::PoolError;

        let lb = LoadBalancer::new(BalanceStrategy::RoundRobin);
        let pool = Arc::new(CredentialPool::new(provider));

        // 添加凭证
        for i in 0..cred_count {
            let cred = Credential::new(
                format!("cred-{}", i),
                provider,
                CredentialData::ApiKey {
                    key: format!("key-{}", i),
                    base_url: None,
                },
            );
            pool.add(cred).unwrap();
        }

        lb.register_pool(pool);

        // 将所有凭证标记为冷却
        for i in 0..cred_count {
            lb.mark_cooldown(provider, &format!("cred-{}", i), Duration::hours(1))
                .unwrap();
        }

        // 验证：选择应返回 NoAvailableCredential 错误
        let result = lb.select(provider);
        prop_assert!(
            matches!(result, Err(PoolError::NoAvailableCredential)),
            "所有凭证冷却时，选择应返回 NoAvailableCredential 错误，但实际返回 {:?}",
            result
        );

        // 验证：应该能获取最早恢复时间
        let recovery = lb.earliest_recovery(provider);
        prop_assert!(
            recovery.is_some(),
            "所有凭证冷却时，应该能获取最早恢复时间"
        );
    }
}

// ============ 凭证同步服务属性测试 ============

use crate::config::{Config, ConfigManager};
use crate::credential::CredentialSyncService;
use crate::models::provider_pool_model::{
    CredentialData as PoolCredentialData, PoolProviderType, ProviderCredential,
};
use std::sync::RwLock;
use tempfile::TempDir;

/// 创建临时测试环境
fn create_test_env() -> (TempDir, Arc<RwLock<ConfigManager>>) {
    let temp_dir = TempDir::new().expect("创建临时目录失败");
    let config_path = temp_dir.path().join("config.yaml");

    // 创建配置管理器
    let mut config = Config::default();
    config.auth_dir = temp_dir.path().join("auth").to_string_lossy().to_string();

    let mut manager = ConfigManager::new(config_path);
    manager.set_config(config);
    manager.save().expect("保存配置失败");

    (temp_dir, Arc::new(RwLock::new(manager)))
}

/// 生成随机的 PoolProviderType（仅支持同步的类型）
fn arb_sync_provider_type() -> impl Strategy<Value = PoolProviderType> {
    prop_oneof![
        Just(PoolProviderType::Kiro),
        Just(PoolProviderType::Gemini),
        Just(PoolProviderType::Qwen),
        Just(PoolProviderType::OpenAI),
        Just(PoolProviderType::Claude),
    ]
}

/// 生成随机的 API Key 凭证数据
fn arb_api_key_credential() -> impl Strategy<Value = (PoolProviderType, PoolCredentialData)> {
    prop_oneof![
        (
            "[a-zA-Z0-9]{20,50}",
            prop::option::of("https://[a-z]+\\.[a-z]+/v1")
        )
            .prop_map(|(api_key, base_url)| {
                (
                    PoolProviderType::OpenAI,
                    PoolCredentialData::OpenAIKey { api_key, base_url },
                )
            }),
        (
            "[a-zA-Z0-9]{20,50}",
            prop::option::of("https://[a-z]+\\.[a-z]+")
        )
            .prop_map(|(api_key, base_url)| {
                (
                    PoolProviderType::Claude,
                    PoolCredentialData::ClaudeKey { api_key, base_url },
                )
            }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: config-credential-export, Property 1: Credential Sync Round Trip**
    /// *For any* credential added to the credential pool, saving to YAML and then loading
    /// from YAML should produce an equivalent credential configuration.
    /// **Validates: Requirements 1.1, 1.2, 1.5**
    #[test]
    fn prop_credential_sync_round_trip(
        (provider_type, cred_data) in arb_api_key_credential(),
        is_disabled in proptest::bool::ANY
    ) {
        let (_temp_dir, config_manager) = create_test_env();
        let sync_service = CredentialSyncService::new(config_manager.clone());

        // 创建凭证
        let mut credential = ProviderCredential::new(provider_type, cred_data.clone());
        credential.is_disabled = is_disabled;
        let original_uuid = credential.uuid.clone();

        // 添加凭证
        let add_result = sync_service.add_credential(&credential);
        prop_assert!(add_result.is_ok(), "添加凭证应该成功: {:?}", add_result);

        // 从配置加载凭证
        let loaded = sync_service.load_from_config();
        prop_assert!(loaded.is_ok(), "加载凭证应该成功: {:?}", loaded);

        let loaded_creds = loaded.unwrap();

        // 查找对应的凭证
        let found = loaded_creds.iter().find(|c| c.uuid == original_uuid);
        prop_assert!(found.is_some(), "应该能找到添加的凭证");

        let loaded_cred = found.unwrap();

        // 验证凭证属性
        prop_assert_eq!(
            &loaded_cred.uuid,
            &original_uuid,
            "UUID 应该一致"
        );
        prop_assert_eq!(
            loaded_cred.provider_type,
            provider_type,
            "Provider 类型应该一致"
        );
        prop_assert_eq!(
            loaded_cred.is_disabled,
            is_disabled,
            "禁用状态应该一致"
        );

        // 验证凭证数据
        match (&loaded_cred.credential, &cred_data) {
            (
                PoolCredentialData::OpenAIKey { api_key: loaded_key, base_url: loaded_url },
                PoolCredentialData::OpenAIKey { api_key: orig_key, base_url: orig_url },
            ) => {
                prop_assert_eq!(loaded_key, orig_key, "API Key 应该一致");
                prop_assert_eq!(loaded_url, orig_url, "Base URL 应该一致");
            }
            (
                PoolCredentialData::ClaudeKey { api_key: loaded_key, base_url: loaded_url },
                PoolCredentialData::ClaudeKey { api_key: orig_key, base_url: orig_url },
            ) => {
                prop_assert_eq!(loaded_key, orig_key, "API Key 应该一致");
                prop_assert_eq!(loaded_url, orig_url, "Base URL 应该一致");
            }
            _ => {
                prop_assert!(false, "凭证类型不匹配");
            }
        }
    }

    /// **Feature: config-credential-export, Property 1: Credential Sync Round Trip (Multiple)**
    /// *For any* set of credentials, adding them all and then loading should preserve all.
    /// **Validates: Requirements 1.1, 1.2, 1.5**
    #[test]
    fn prop_credential_sync_round_trip_multiple(
        cred_count in 1usize..=5usize
    ) {
        let (_temp_dir, config_manager) = create_test_env();
        let sync_service = CredentialSyncService::new(config_manager.clone());

        // 创建多个凭证
        let mut original_uuids = Vec::new();
        for i in 0..cred_count {
            let cred_data = if i % 2 == 0 {
                PoolCredentialData::OpenAIKey {
                    api_key: format!("sk-test-key-{}", i),
                    base_url: Some("https://api.openai.com/v1".to_string()),
                }
            } else {
                PoolCredentialData::ClaudeKey {
                    api_key: format!("sk-ant-test-key-{}", i),
                    base_url: None,
                }
            };

            let provider_type = if i % 2 == 0 {
                PoolProviderType::OpenAI
            } else {
                PoolProviderType::Claude
            };

            let credential = ProviderCredential::new(provider_type, cred_data);
            original_uuids.push(credential.uuid.clone());

            let add_result = sync_service.add_credential(&credential);
            prop_assert!(add_result.is_ok(), "添加凭证 {} 应该成功", i);
        }

        // 从配置加载凭证
        let loaded = sync_service.load_from_config().unwrap();

        // 验证所有凭证都被加载
        prop_assert_eq!(
            loaded.len(),
            cred_count,
            "加载的凭证数量应该与添加的一致"
        );

        // 验证每个 UUID 都存在
        for uuid in &original_uuids {
            let found = loaded.iter().any(|c| &c.uuid == uuid);
            prop_assert!(found, "应该能找到 UUID 为 {} 的凭证", uuid);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: config-credential-export, Property 9: OAuth Token File Handling**
    /// *For any* OAuth credential, the token file should be stored in auth-dir on add,
    /// included in export bundles, and restored to auth-dir on import.
    /// **Validates: Requirements 2.1, 2.4, 3.3, 4.4**
    #[test]
    fn prop_oauth_token_file_handling(
        token_content in "[a-zA-Z0-9]{50,200}",
        provider_idx in 0usize..3usize
    ) {
        let (temp_dir, config_manager) = create_test_env();
        let sync_service = CredentialSyncService::new(config_manager.clone());

        // 创建源 token 文件
        let source_token_dir = temp_dir.path().join("source_tokens");
        std::fs::create_dir_all(&source_token_dir).expect("创建源目录失败");

        let source_token_path = source_token_dir.join("token.json");
        let token_json = format!(r#"{{"access_token": "{}", "refresh_token": "refresh-{}", "expires_at": "2025-12-31T23:59:59Z"}}"#, token_content, token_content);
        std::fs::write(&source_token_path, &token_json).expect("写入源 token 文件失败");

        // 根据索引选择 provider 类型
        let (provider_type, cred_data) = match provider_idx {
            0 => (
                PoolProviderType::Kiro,
                PoolCredentialData::KiroOAuth {
                    creds_file_path: source_token_path.to_string_lossy().to_string(),
                },
            ),
            1 => (
                PoolProviderType::Gemini,
                PoolCredentialData::GeminiOAuth {
                    creds_file_path: source_token_path.to_string_lossy().to_string(),
                    project_id: None,
                },
            ),
            _ => (
                PoolProviderType::Qwen,
                PoolCredentialData::QwenOAuth {
                    creds_file_path: source_token_path.to_string_lossy().to_string(),
                },
            ),
        };

        // 创建凭证
        let credential = ProviderCredential::new(provider_type, cred_data);
        let original_uuid = credential.uuid.clone();

        // 添加凭证（应该复制 token 文件到 auth_dir）
        let add_result = sync_service.add_credential(&credential);
        prop_assert!(add_result.is_ok(), "添加 OAuth 凭证应该成功: {:?}", add_result);

        // 验证 token 文件已复制到 auth_dir
        let auth_dir = sync_service.get_auth_dir().expect("获取 auth_dir 失败");
        let provider_name = match provider_type {
            PoolProviderType::Kiro => "kiro",
            PoolProviderType::Gemini => "gemini",
            PoolProviderType::Qwen => "qwen",
            _ => "unknown",
        };
        let expected_token_path = auth_dir.join(provider_name).join(format!("{}.json", original_uuid));

        prop_assert!(
            expected_token_path.exists(),
            "Token 文件应该存在于 auth_dir: {:?}",
            expected_token_path
        );

        // 验证 token 文件内容一致
        let copied_content = std::fs::read_to_string(&expected_token_path)
            .expect("读取复制的 token 文件失败");
        prop_assert_eq!(
            copied_content,
            token_json,
            "Token 文件内容应该一致"
        );

        // 从配置加载凭证
        let loaded = sync_service.load_from_config().expect("加载凭证失败");
        let loaded_cred = loaded.iter().find(|c| c.uuid == original_uuid);
        prop_assert!(loaded_cred.is_some(), "应该能找到加载的凭证");

        // 验证加载的凭证指向正确的 token 文件路径
        let loaded_cred = loaded_cred.unwrap();
        let loaded_path = match &loaded_cred.credential {
            PoolCredentialData::KiroOAuth { creds_file_path } => creds_file_path.clone(),
            PoolCredentialData::GeminiOAuth { creds_file_path, .. } => creds_file_path.clone(),
            PoolCredentialData::QwenOAuth { creds_file_path } => creds_file_path.clone(),
            _ => String::new(),
        };

        prop_assert_eq!(
            loaded_path,
            expected_token_path.to_string_lossy().to_string(),
            "加载的凭证应该指向 auth_dir 中的 token 文件"
        );

        // 删除凭证（应该删除 token 文件）
        let remove_result = sync_service.remove_credential(provider_type, &original_uuid);
        prop_assert!(remove_result.is_ok(), "删除凭证应该成功: {:?}", remove_result);

        // 验证 token 文件已被删除
        prop_assert!(
            !expected_token_path.exists(),
            "删除凭证后 token 文件应该被删除"
        );
    }

    /// **Feature: config-credential-export, Property 9: OAuth Token File Update**
    /// *For any* OAuth credential update, the token file should be updated in auth-dir.
    /// **Validates: Requirements 2.1, 2.4**
    #[test]
    fn prop_oauth_token_file_update(
        initial_content in "[a-zA-Z0-9]{50,100}",
        updated_content in "[a-zA-Z0-9]{50,100}"
    ) {
        let (temp_dir, config_manager) = create_test_env();
        let sync_service = CredentialSyncService::new(config_manager.clone());

        // 创建初始 token 文件
        let source_token_dir = temp_dir.path().join("source_tokens");
        std::fs::create_dir_all(&source_token_dir).expect("创建源目录失败");

        let source_token_path = source_token_dir.join("token.json");
        let initial_json = format!(r#"{{"access_token": "{}"}}"#, initial_content);
        std::fs::write(&source_token_path, &initial_json).expect("写入初始 token 文件失败");

        // 创建凭证
        let credential = ProviderCredential::new(
            PoolProviderType::Kiro,
            PoolCredentialData::KiroOAuth {
                creds_file_path: source_token_path.to_string_lossy().to_string(),
            },
        );
        let original_uuid = credential.uuid.clone();

        // 添加凭证
        sync_service.add_credential(&credential).expect("添加凭证失败");

        // 更新源 token 文件内容
        let updated_json = format!(r#"{{"access_token": "{}"}}"#, updated_content);
        std::fs::write(&source_token_path, &updated_json).expect("更新源 token 文件失败");

        // 更新凭证
        let mut updated_credential = credential.clone();
        updated_credential.credential = PoolCredentialData::KiroOAuth {
            creds_file_path: source_token_path.to_string_lossy().to_string(),
        };

        let update_result = sync_service.update_credential(&updated_credential);
        prop_assert!(update_result.is_ok(), "更新凭证应该成功: {:?}", update_result);

        // 验证 auth_dir 中的 token 文件已更新
        let auth_dir = sync_service.get_auth_dir().expect("获取 auth_dir 失败");
        let token_path = auth_dir.join("kiro").join(format!("{}.json", original_uuid));

        let stored_content = std::fs::read_to_string(&token_path)
            .expect("读取存储的 token 文件失败");
        prop_assert_eq!(
            stored_content,
            updated_json,
            "存储的 token 文件内容应该已更新"
        );
    }
}
