import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeInvoke } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
}));

import * as AgentApi from "./agent";
import {
  getAsterAgentStatus,
  interruptAgentRuntimeTurn,
  respondAgentRuntimeAction,
  sendAsterMessageStream,
  submitAgentRuntimeTurn,
  updateAgentRuntimeSession,
} from "./agentRuntime";

describe("Agent API 治理护栏", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendAsterMessageStream 应走统一 helper 并透传现役字段", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await sendAsterMessageStream(
      "hello",
      "session-2",
      "event-2",
      "workspace-2",
      [{ data: "base64", media_type: "image/jpeg" }],
      {
        provider_id: "provider-2",
        provider_name: "Provider 2",
        model_name: "model-2",
      },
      "auto",
      true,
      {
        enabled: true,
        fast_mode_enabled: false,
        continuation_length: 256,
        sensitivity: 0.4,
      },
      "system prompt",
      "project-2",
      {
        harness: {
          theme: "social-media",
          gate_key: "write_mode",
        },
      },
    );

    expect(mockSafeInvoke).toHaveBeenCalledWith("aster_agent_chat_stream", {
      request: {
        message: "hello",
        session_id: "session-2",
        event_name: "event-2",
        images: [{ data: "base64", media_type: "image/jpeg" }],
        provider_config: {
          provider_id: "provider-2",
          provider_name: "Provider 2",
          model_name: "model-2",
        },
        project_id: "project-2",
        workspace_id: "workspace-2",
        execution_strategy: "auto",
        web_search: true,
        auto_continue: {
          enabled: true,
          fast_mode_enabled: false,
          continuation_length: 256,
          sensitivity: 0.4,
        },
        system_prompt: "system prompt",
        metadata: {
          harness: {
            theme: "social-media",
            gate_key: "write_mode",
          },
        },
      },
    });
  });

  it("getAsterAgentStatus 应返回现役状态结构", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      initialized: true,
      provider_configured: true,
      provider_name: "Anthropic",
      model_name: "claude-sonnet-4-20250514",
    });

    await expect(getAsterAgentStatus()).resolves.toEqual({
      initialized: true,
      provider_configured: true,
      provider_name: "Anthropic",
      model_name: "claude-sonnet-4-20250514",
    });
  });

  it("submitAgentRuntimeTurn 应走统一 runtime submit 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await submitAgentRuntimeTurn({
      message: "runtime hello",
      session_id: "session-runtime",
      event_name: "event-runtime",
      workspace_id: "workspace-runtime",
      turn_config: {
        execution_strategy: "react",
        provider_config: {
          provider_id: "provider-runtime",
          provider_name: "Provider Runtime",
          model_name: "model-runtime",
        },
        metadata: {
          source: "hook-facade",
        },
      },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_submit_turn", {
      request: {
        message: "runtime hello",
        session_id: "session-runtime",
        event_name: "event-runtime",
        workspace_id: "workspace-runtime",
        turn_config: {
          execution_strategy: "react",
          provider_config: {
            provider_id: "provider-runtime",
            provider_name: "Provider Runtime",
            model_name: "model-runtime",
          },
          metadata: {
            source: "hook-facade",
          },
        },
      },
    });
  });

  it("respondAgentRuntimeAction 应走统一 action 响应命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await respondAgentRuntimeAction({
      session_id: "session-runtime",
      request_id: "req-runtime",
      action_type: "ask_user",
      confirmed: true,
      response: "{\"answer\":\"A\"}",
      user_data: { answer: "A" },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_respond_action", {
      request: {
        session_id: "session-runtime",
        request_id: "req-runtime",
        action_type: "ask_user",
        confirmed: true,
        response: "{\"answer\":\"A\"}",
        user_data: { answer: "A" },
      },
    });
  });

  it("interruptAgentRuntimeTurn 与 updateAgentRuntimeSession 应走统一 runtime 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce(undefined);

    await interruptAgentRuntimeTurn({
      session_id: "session-runtime",
      turn_id: "turn-1",
    });
    await updateAgentRuntimeSession({
      session_id: "session-runtime",
      name: "新标题",
      execution_strategy: "auto",
    });

    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      1,
      "agent_runtime_interrupt_turn",
      {
        request: {
          session_id: "session-runtime",
          turn_id: "turn-1",
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      2,
      "agent_runtime_update_session",
      {
        request: {
          session_id: "session-runtime",
          name: "新标题",
          execution_strategy: "auto",
        },
      },
    );
  });

  it("agent 门面只暴露现役 API", () => {
    expect("sendAsterMessageStream" in AgentApi).toBe(true);
    expect("getAsterAgentStatus" in AgentApi).toBe(true);
    expect("submitAgentRuntimeTurn" in AgentApi).toBe(true);
    expect("respondAgentRuntimeAction" in AgentApi).toBe(true);
    expect("createasterSession" in AgentApi).toBe(false);
    expect("sendAgentMessage" in AgentApi).toBe(false);
    expect("getasterAgentStatus" in AgentApi).toBe(false);
  });
});
