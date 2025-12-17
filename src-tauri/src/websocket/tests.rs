//! WebSocket 模块测试

use super::*;

#[test]
fn test_ws_connection_new() {
    let conn = WsConnection::new("test-id".to_string(), Some("test-client".to_string()));
    assert_eq!(conn.id, "test-id");
    assert_eq!(conn.client_info, Some("test-client".to_string()));
    assert_eq!(conn.request_count, 0);
    assert_eq!(conn.status, WsConnectionStatus::Connected);
}

#[test]
fn test_ws_connection_increment_request_count() {
    let mut conn = WsConnection::new("test-id".to_string(), None);
    assert_eq!(conn.request_count, 0);
    conn.increment_request_count();
    assert_eq!(conn.request_count, 1);
    conn.increment_request_count();
    assert_eq!(conn.request_count, 2);
}

#[test]
fn test_ws_message_serialization() {
    // Test Ping message
    let ping = WsMessage::Ping { timestamp: 12345 };
    let json = serde_json::to_string(&ping).unwrap();
    assert!(json.contains("\"type\":\"ping\""));
    assert!(json.contains("\"timestamp\":12345"));

    // Test Pong message
    let pong = WsMessage::Pong { timestamp: 12345 };
    let json = serde_json::to_string(&pong).unwrap();
    assert!(json.contains("\"type\":\"pong\""));

    // Test Error message
    let error = WsMessage::Error(WsError::invalid_message("test error"));
    let json = serde_json::to_string(&error).unwrap();
    assert!(json.contains("\"type\":\"error\""));
    assert!(json.contains("\"code\":\"invalid_message\""));
}

#[test]
fn test_ws_message_deserialization() {
    let json = r#"{"type":"ping","timestamp":12345}"#;
    let msg: WsMessage = serde_json::from_str(json).unwrap();
    match msg {
        WsMessage::Ping { timestamp } => assert_eq!(timestamp, 12345),
        _ => panic!("Expected Ping message"),
    }

    let json =
        r#"{"type":"request","request_id":"req-1","endpoint":"chat_completions","payload":{}}"#;
    let msg: WsMessage = serde_json::from_str(json).unwrap();
    match msg {
        WsMessage::Request(req) => {
            assert_eq!(req.request_id, "req-1");
            assert_eq!(req.endpoint, WsEndpoint::ChatCompletions);
        }
        _ => panic!("Expected Request message"),
    }
}

#[test]
fn test_ws_error_constructors() {
    let err = WsError::invalid_message("bad format");
    assert_eq!(err.code, WsErrorCode::InvalidMessage);
    assert_eq!(err.message, "bad format");
    assert!(err.request_id.is_none());

    let err = WsError::invalid_request(Some("req-1".to_string()), "missing field");
    assert_eq!(err.code, WsErrorCode::InvalidRequest);
    assert_eq!(err.request_id, Some("req-1".to_string()));

    let err = WsError::unauthorized("invalid token");
    assert_eq!(err.code, WsErrorCode::Unauthorized);

    let err = WsError::internal(None, "server error");
    assert_eq!(err.code, WsErrorCode::InternalError);

    let err = WsError::upstream(Some("req-2".to_string()), "provider error");
    assert_eq!(err.code, WsErrorCode::UpstreamError);
    assert_eq!(err.request_id, Some("req-2".to_string()));
}

#[test]
fn test_ws_config_defaults() {
    let config = WsConfig::default();
    assert!(config.enabled);
    assert_eq!(config.heartbeat_interval_secs, 30);
    assert_eq!(config.heartbeat_timeout_secs, 60);
    assert_eq!(config.max_connections, 100);
    assert_eq!(config.max_message_size, 16 * 1024 * 1024);
}

#[test]
fn test_ws_stats() {
    let stats = WsStats::new();
    assert_eq!(stats.active_count(), 0);

    stats.on_connect();
    assert_eq!(stats.active_count(), 1);

    stats.on_connect();
    assert_eq!(stats.active_count(), 2);

    stats.on_disconnect();
    assert_eq!(stats.active_count(), 1);

    stats.on_message();
    stats.on_message();
    stats.on_error();

    let snapshot = stats.snapshot();
    assert_eq!(snapshot.total_connections, 2);
    assert_eq!(snapshot.active_connections, 1);
    assert_eq!(snapshot.total_messages, 2);
    assert_eq!(snapshot.total_errors, 1);
}

#[test]
fn test_ws_connection_manager_register() {
    let manager = WsConnectionManager::with_defaults();

    // Register a connection
    manager
        .register("conn-1".to_string(), Some("client-1".to_string()))
        .unwrap();
    assert_eq!(manager.active_count(), 1);

    // Get connection
    let conn = manager.get("conn-1").unwrap();
    assert_eq!(conn.id, "conn-1");
    assert_eq!(conn.client_info, Some("client-1".to_string()));

    // Register another connection
    manager.register("conn-2".to_string(), None).unwrap();
    assert_eq!(manager.active_count(), 2);
}

#[test]
fn test_ws_connection_manager_unregister() {
    let manager = WsConnectionManager::with_defaults();

    manager.register("conn-1".to_string(), None).unwrap();
    assert_eq!(manager.active_count(), 1);

    let removed = manager.unregister("conn-1");
    assert!(removed.is_some());
    assert_eq!(manager.active_count(), 0);

    // Unregister non-existent connection
    let removed = manager.unregister("conn-1");
    assert!(removed.is_none());
}

#[test]
fn test_ws_connection_manager_max_connections() {
    let config = WsConfig {
        max_connections: 2,
        ..Default::default()
    };
    let manager = WsConnectionManager::new(config);

    manager.register("conn-1".to_string(), None).unwrap();
    manager.register("conn-2".to_string(), None).unwrap();

    // Third connection should fail
    let result = manager.register("conn-3".to_string(), None);
    assert!(result.is_err());
}

#[test]
fn test_ws_connection_manager_list_connections() {
    let manager = WsConnectionManager::with_defaults();

    manager.register("conn-1".to_string(), None).unwrap();
    manager.register("conn-2".to_string(), None).unwrap();

    let connections = manager.list_connections();
    assert_eq!(connections.len(), 2);
}

#[test]
fn test_ws_connection_manager_increment_request_count() {
    let manager = WsConnectionManager::with_defaults();

    manager.register("conn-1".to_string(), None).unwrap();

    let conn = manager.get("conn-1").unwrap();
    assert_eq!(conn.request_count, 0);

    manager.increment_request_count("conn-1");

    let conn = manager.get("conn-1").unwrap();
    assert_eq!(conn.request_count, 1);
}

#[test]
fn test_ws_endpoint_serialization() {
    assert_eq!(
        serde_json::to_string(&WsEndpoint::ChatCompletions).unwrap(),
        "\"chat_completions\""
    );
    assert_eq!(
        serde_json::to_string(&WsEndpoint::Messages).unwrap(),
        "\"messages\""
    );
    assert_eq!(
        serde_json::to_string(&WsEndpoint::Models).unwrap(),
        "\"models\""
    );
}

#[test]
fn test_ws_api_request_serialization() {
    let request = WsApiRequest {
        request_id: "req-123".to_string(),
        endpoint: WsEndpoint::ChatCompletions,
        payload: serde_json::json!({"model": "gpt-4", "messages": []}),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("\"request_id\":\"req-123\""));
    assert!(json.contains("\"endpoint\":\"chat_completions\""));

    let parsed: WsApiRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.request_id, "req-123");
    assert_eq!(parsed.endpoint, WsEndpoint::ChatCompletions);
}

#[test]
fn test_ws_stream_chunk_serialization() {
    let chunk = WsStreamChunk {
        request_id: "req-123".to_string(),
        index: 5,
        data: "data: {\"content\": \"hello\"}".to_string(),
    };

    let json = serde_json::to_string(&chunk).unwrap();
    assert!(json.contains("\"request_id\":\"req-123\""));
    assert!(json.contains("\"index\":5"));

    let parsed: WsStreamChunk = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.request_id, "req-123");
    assert_eq!(parsed.index, 5);
}

// ============ Property-Based Tests ============

use proptest::prelude::*;

/// 生成任意的 WsEndpoint
fn arb_endpoint() -> impl Strategy<Value = WsEndpoint> {
    prop_oneof![
        Just(WsEndpoint::ChatCompletions),
        Just(WsEndpoint::Messages),
        Just(WsEndpoint::Models),
    ]
}

/// 生成任意的 WsErrorCode
fn arb_error_code() -> impl Strategy<Value = WsErrorCode> {
    prop_oneof![
        Just(WsErrorCode::InvalidMessage),
        Just(WsErrorCode::InvalidRequest),
        Just(WsErrorCode::Unauthorized),
        Just(WsErrorCode::InternalError),
        Just(WsErrorCode::UpstreamError),
        Just(WsErrorCode::Timeout),
    ]
}

/// 生成任意的 WsApiRequest
fn arb_api_request() -> impl Strategy<Value = WsApiRequest> {
    (
        "[a-zA-Z0-9-]{1,36}", // request_id
        arb_endpoint(),
        prop_oneof![
            Just(serde_json::json!({})),
            Just(serde_json::json!({"model": "test-model"})),
            Just(serde_json::json!({"model": "gpt-4", "messages": []})),
        ],
    )
        .prop_map(|(request_id, endpoint, payload)| WsApiRequest {
            request_id,
            endpoint,
            payload,
        })
}

/// 生成任意的 WsApiResponse
fn arb_api_response() -> impl Strategy<Value = WsApiResponse> {
    (
        "[a-zA-Z0-9-]{1,36}", // request_id
        prop_oneof![
            Just(serde_json::json!({})),
            Just(serde_json::json!({"result": "success"})),
            Just(serde_json::json!({"choices": []})),
        ],
    )
        .prop_map(|(request_id, payload)| WsApiResponse {
            request_id,
            payload,
        })
}

/// 生成任意的 WsStreamChunk
fn arb_stream_chunk() -> impl Strategy<Value = WsStreamChunk> {
    (
        "[a-zA-Z0-9-]{1,36}",  // request_id
        0u32..1000u32,         // index
        "[a-zA-Z0-9 ]{0,100}", // data
    )
        .prop_map(|(request_id, index, data)| WsStreamChunk {
            request_id,
            index,
            data,
        })
}

/// 生成任意的 WsStreamEnd
fn arb_stream_end() -> impl Strategy<Value = WsStreamEnd> {
    (
        "[a-zA-Z0-9-]{1,36}", // request_id
        0u32..1000u32,        // total_chunks
    )
        .prop_map(|(request_id, total_chunks)| WsStreamEnd {
            request_id,
            total_chunks,
        })
}

/// 生成任意的 WsError
fn arb_error() -> impl Strategy<Value = WsError> {
    (
        proptest::option::of("[a-zA-Z0-9-]{1,36}"), // request_id
        arb_error_code(),
        "[a-zA-Z0-9 ]{1,100}", // message
    )
        .prop_map(|(request_id, code, message)| WsError {
            request_id,
            code,
            message,
        })
}

/// 生成任意的 WsMessage
fn arb_message() -> impl Strategy<Value = WsMessage> {
    prop_oneof![
        arb_api_request().prop_map(WsMessage::Request),
        arb_api_response().prop_map(WsMessage::Response),
        arb_stream_chunk().prop_map(WsMessage::StreamChunk),
        arb_stream_end().prop_map(WsMessage::StreamEnd),
        arb_error().prop_map(WsMessage::Error),
        (0i64..i64::MAX).prop_map(|timestamp| WsMessage::Ping { timestamp }),
        (0i64..i64::MAX).prop_map(|timestamp| WsMessage::Pong { timestamp }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: enhancement-roadmap, Property 16: WebSocket 消息往返**
    /// *对于任意* 有效的 API 请求，通过 WebSocket 发送后应能正确解析并返回响应
    /// **Validates: Requirements 6.2 (验收标准 2)**
    #[test]
    fn prop_ws_message_roundtrip(msg in arb_message()) {
        // 序列化消息
        let serialized = serde_json::to_string(&msg).expect("Failed to serialize message");

        // 反序列化消息
        let deserialized: WsMessage = serde_json::from_str(&serialized)
            .expect("Failed to deserialize message");

        // 再次序列化以比较
        let reserialized = serde_json::to_string(&deserialized)
            .expect("Failed to reserialize message");

        // 验证往返一致性
        prop_assert_eq!(serialized, reserialized);
    }

    /// **Feature: enhancement-roadmap, Property 16: WebSocket 消息往返 (Request 特化)**
    /// *对于任意* WsApiRequest，序列化后反序列化应保持所有字段不变
    /// **Validates: Requirements 6.2 (验收标准 2)**
    #[test]
    fn prop_ws_request_roundtrip(request in arb_api_request()) {
        let msg = WsMessage::Request(request.clone());

        // 序列化
        let json = serde_json::to_string(&msg).expect("Failed to serialize");

        // 反序列化
        let parsed: WsMessage = serde_json::from_str(&json).expect("Failed to deserialize");

        // 验证字段
        match parsed {
            WsMessage::Request(parsed_req) => {
                prop_assert_eq!(request.request_id, parsed_req.request_id);
                prop_assert_eq!(request.endpoint, parsed_req.endpoint);
                // payload 比较需要特殊处理，因为 JSON 对象顺序可能不同
                prop_assert_eq!(
                    serde_json::to_string(&request.payload).unwrap(),
                    serde_json::to_string(&parsed_req.payload).unwrap()
                );
            }
            _ => prop_assert!(false, "Expected Request message"),
        }
    }

    /// **Feature: enhancement-roadmap, Property 16: WebSocket 消息往返 (StreamChunk 特化)**
    /// *对于任意* WsStreamChunk，序列化后反序列化应保持所有字段不变
    /// **Validates: Requirements 6.2 (验收标准 2)**
    #[test]
    fn prop_ws_stream_chunk_roundtrip(chunk in arb_stream_chunk()) {
        let msg = WsMessage::StreamChunk(chunk.clone());

        // 序列化
        let json = serde_json::to_string(&msg).expect("Failed to serialize");

        // 反序列化
        let parsed: WsMessage = serde_json::from_str(&json).expect("Failed to deserialize");

        // 验证字段
        match parsed {
            WsMessage::StreamChunk(parsed_chunk) => {
                prop_assert_eq!(chunk.request_id, parsed_chunk.request_id);
                prop_assert_eq!(chunk.index, parsed_chunk.index);
                prop_assert_eq!(chunk.data, parsed_chunk.data);
            }
            _ => prop_assert!(false, "Expected StreamChunk message"),
        }
    }

    /// **Feature: enhancement-roadmap, Property 16: WebSocket 消息往返 (Ping/Pong 特化)**
    /// *对于任意* Ping 消息，序列化后反序列化应保持 timestamp 不变
    /// **Validates: Requirements 6.2 (验收标准 2)**
    #[test]
    fn prop_ws_ping_pong_roundtrip(timestamp in 0i64..i64::MAX) {
        // 测试 Ping
        let ping = WsMessage::Ping { timestamp };
        let ping_json = serde_json::to_string(&ping).expect("Failed to serialize ping");
        let parsed_ping: WsMessage = serde_json::from_str(&ping_json).expect("Failed to deserialize ping");

        match parsed_ping {
            WsMessage::Ping { timestamp: t } => prop_assert_eq!(timestamp, t),
            _ => prop_assert!(false, "Expected Ping message"),
        }

        // 测试 Pong
        let pong = WsMessage::Pong { timestamp };
        let pong_json = serde_json::to_string(&pong).expect("Failed to serialize pong");
        let parsed_pong: WsMessage = serde_json::from_str(&pong_json).expect("Failed to deserialize pong");

        match parsed_pong {
            WsMessage::Pong { timestamp: t } => prop_assert_eq!(timestamp, t),
            _ => prop_assert!(false, "Expected Pong message"),
        }
    }
}

// ============ SSE 到 WebSocket 转换属性测试 ============

use super::stream::StreamForwarder;

/// 生成任意的 SSE 数据内容（非空且不全是空格）
fn arb_sse_data() -> impl Strategy<Value = String> {
    prop_oneof![
        // JSON 对象
        Just(r#"{"content": "hello"}"#.to_string()),
        Just(r#"{"delta": {"content": "world"}}"#.to_string()),
        Just(r#"{"choices": [{"delta": {"content": "test"}}]}"#.to_string()),
        // 简单文本（确保至少有一个非空格字符）
        "[a-zA-Z0-9]{1,50}".prop_map(|s| s),
    ]
}

/// 生成任意的 SSE 行
fn arb_sse_line() -> impl Strategy<Value = String> {
    arb_sse_data().prop_map(|data| format!("data: {}", data))
}

/// 生成任意的 SSE 响应体（多行）
fn arb_sse_body() -> impl Strategy<Value = (Vec<String>, String)> {
    prop::collection::vec(arb_sse_data(), 1..10).prop_map(|data_items| {
        let lines: Vec<String> = data_items.clone();
        let body = data_items
            .iter()
            .map(|d| format!("data: {}\n\n", d))
            .collect::<Vec<_>>()
            .join("");
        (lines, body)
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// **Feature: module-integration, Property 4: SSE 到 WebSocket 转换完整性**
    /// *对于任意* SSE 流式响应，转换为 WebSocket 消息后数据内容应保持不变
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sse_to_ws_conversion_integrity(
        request_id in "[a-zA-Z0-9-]{8,16}",
        (original_data, sse_body) in arb_sse_body()
    ) {
        let forwarder = StreamForwarder::new(request_id.clone());

        // 转换 SSE 响应体为 WebSocket 消息
        let messages = forwarder.process_sse_body(&sse_body);

        // 验证消息数量：应该有 N 个数据块 + 1 个结束消息
        let expected_chunks = original_data.len();
        prop_assert_eq!(
            messages.len(),
            expected_chunks + 1,
            "消息数量应为数据块数 + 1 (结束消息)"
        );

        // 验证每个数据块的内容
        for (i, msg) in messages.iter().take(expected_chunks).enumerate() {
            match msg {
                WsMessage::StreamChunk(chunk) => {
                    // 验证 request_id
                    prop_assert_eq!(
                        &chunk.request_id,
                        &request_id,
                        "StreamChunk 的 request_id 应与原始一致"
                    );

                    // 验证索引
                    prop_assert_eq!(
                        chunk.index as usize,
                        i,
                        "StreamChunk 的索引应正确"
                    );

                    // 验证数据内容
                    prop_assert_eq!(
                        &chunk.data,
                        &original_data[i],
                        "StreamChunk 的数据应与原始 SSE 数据一致"
                    );
                }
                _ => prop_assert!(false, "期望 StreamChunk 消息，但得到其他类型"),
            }
        }

        // 验证结束消息
        match messages.last() {
            Some(WsMessage::StreamEnd(end)) => {
                prop_assert_eq!(
                    &end.request_id,
                    &request_id,
                    "StreamEnd 的 request_id 应与原始一致"
                );
                prop_assert_eq!(
                    end.total_chunks as usize,
                    expected_chunks,
                    "StreamEnd 的 total_chunks 应等于数据块数"
                );
            }
            _ => prop_assert!(false, "最后一条消息应为 StreamEnd"),
        }
    }

    /// **Feature: module-integration, Property 4: SSE 到 WebSocket 转换完整性（单行）**
    /// *对于任意* 单个 SSE 数据行，转换后应保持数据内容不变
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sse_line_conversion_integrity(
        request_id in "[a-zA-Z0-9-]{8,16}",
        data in arb_sse_data(),
        index in 0u32..1000u32
    ) {
        let forwarder = StreamForwarder::new(request_id.clone());
        let sse_line = format!("data: {}", data);

        // 转换单行 SSE
        let result = forwarder.convert_sse_line(&sse_line, index);

        // 验证转换结果
        match result {
            Some(WsMessage::StreamChunk(chunk)) => {
                prop_assert_eq!(
                    &chunk.request_id,
                    &request_id,
                    "request_id 应保持不变"
                );
                prop_assert_eq!(
                    chunk.index,
                    index,
                    "index 应保持不变"
                );
                prop_assert_eq!(
                    &chunk.data,
                    &data,
                    "数据内容应保持不变"
                );
            }
            _ => prop_assert!(false, "应返回 StreamChunk 消息"),
        }
    }

    /// **Feature: module-integration, Property 4: SSE 到 WebSocket 转换完整性（特殊行处理）**
    /// *对于任意* 空行、注释行或 [DONE] 标记，转换应返回 None
    /// **Validates: Requirements 6.3**
    #[test]
    fn prop_sse_special_lines_filtered(
        request_id in "[a-zA-Z0-9-]{8,16}",
        index in 0u32..1000u32
    ) {
        let forwarder = StreamForwarder::new(request_id);

        // 空行应返回 None
        prop_assert!(forwarder.convert_sse_line("", index).is_none());
        prop_assert!(forwarder.convert_sse_line("   ", index).is_none());

        // 注释行应返回 None
        prop_assert!(forwarder.convert_sse_line(": comment", index).is_none());
        prop_assert!(forwarder.convert_sse_line(":ping", index).is_none());

        // [DONE] 标记应返回 None
        prop_assert!(forwarder.convert_sse_line("data: [DONE]", index).is_none());
    }
}
