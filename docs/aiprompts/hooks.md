# React Hooks

## 概述

自定义 Hooks 封装业务逻辑；新代码应优先通过 `src/lib/api/*` 网关与后端通信，而不是直接在 Hook 中散落 `invoke`。

## 目录结构

```
src/hooks/
├── index.ts                # 导出入口
├── useUnifiedChat.ts       # 统一对话 Hook（新）
├── useProviderPool.ts      # 凭证池管理
├── useOAuthCredentials.ts  # OAuth 凭证
├── useFlowEvents.ts        # 流量事件
├── useMcpServers.ts        # MCP 服务器
├── useDeepLink.ts          # Deep Link 处理
└── useSound.ts             # 音效管理
```

## 治理约束

- 新的前端能力优先落在 `src/lib/api/*`，再由 Hook 或组件消费。
- 历史 `useTauri.ts` 兼容聚合层已删除，不要重新引入新的“大一统 API Hook”。
- 旧聊天链路优先迁移到 `@/hooks/useUnifiedChat`，不要继续扩散 `useChat` / compat Hook。

## 核心 Hooks

### useUnifiedChat（统一对话）

统一的对话 Hook，支持三种模式：Agent、General、Creator。

```typescript
import { useUnifiedChat } from "@/hooks/useUnifiedChat";

// Agent 模式 - 支持工具调用
const { messages, sendMessage, stopGeneration } = useUnifiedChat({
  mode: "agent",
  providerType: "claude",
  model: "claude-sonnet-4-20250514",
});

// Creator 模式 - 支持画布输出
const creatorChat = useUnifiedChat({
  mode: "creator",
  systemPrompt: "你是内容创作助手...",
  harnessConfig: {
    theme: "social-media",
    artifactMode: "version-chain",
  },
  onHarnessEvent: (event) => {
    /* 接收阶段推进、产物创建等语义事件 */
  },
  onArtifactUpdate: (artifact) => {
    /* 接收产物快照 */
  },
  onCanvasUpdate: (path, content) => {
    /* 更新画布 */
  },
  onWriteFile: (content, fileName) => {
    /* 文件写入 */
  },
});

// General 模式 - 纯文本对话
const generalChat = useUnifiedChat({ mode: "general" });
```

**返回值**：

- `session` - 当前会话
- `messages` - 消息列表
- `isLoading` / `isSending` - 状态
- `createSession()` / `loadSession()` / `deleteSession()` - 会话管理
- `sendMessage()` / `stopGeneration()` - 消息操作
- `configureProvider()` - Provider 配置

**补充说明**：

- Creator 模式现在支持 `harnessConfig`、`onHarnessEvent`、`onArtifactUpdate`
- 社媒内容推荐把 `<write_file>` 结果投影为“版本链产物”，而不是只按文件名覆盖

**相关文件**：

- 类型定义：`src/types/chat.ts`
- API 封装：`src/lib/api/unified-chat.ts`
- 架构文档：`docs/prd/chat-architecture-redesign.md`

### useProviderPool

```typescript
export function useProviderPool() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const list = await invoke<Credential[]>("list_credentials");
    setCredentials(list);
    setLoading(false);
  };

  const addCredential = async (provider: string, path: string) => {
    await invoke("add_credential", { provider, filePath: path });
    await refresh();
  };

  const removeCredential = async (id: string) => {
    await invoke("remove_credential", { id });
    await refresh();
  };

  useEffect(() => {
    refresh();
  }, []);

  return { credentials, loading, addCredential, removeCredential, refresh };
}
```

### useFlowEvents

```typescript
export function useFlowEvents() {
  const [records, setRecords] = useState<FlowRecord[]>([]);

  useEffect(() => {
    const unlisten = listen<FlowEvent>("flow-event", (event) => {
      setRecords((prev) => [event.payload.data, ...prev].slice(0, 100));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return { records };
}
```

### useDeepLink

```typescript
export function useDeepLink() {
  useEffect(() => {
    const unlisten = listen<string>("deep-link", async (event) => {
      const url = new URL(event.payload);

      if (url.pathname === "/oauth/callback") {
        await handleOAuthCallback(url.searchParams);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
```

## Hook 规范

### 命名约定

- 以 `use` 开头
- 描述功能: `useProviderPool`, `useFlowEvents`

### 返回值

```typescript
// 返回对象，包含状态和操作
return {
  // 状态
  data,
  loading,
  error,

  // 操作
  refresh,
  add,
  remove,
};
```

## 相关文档

- [components.md](components.md) - 组件系统
- [commands.md](commands.md) - Tauri 命令
