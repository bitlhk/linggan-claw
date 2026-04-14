# 灵虾智能体架构图

> 最后更新: 2026-04-14 v2 (增加记忆体系 + A2A 演进分析)

## 全局视图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         用户浏览器                                       │
│  React SPA (client/src)                                                 │
│  ├─ 主聊天窗口  → WebSocket /api/claw/ws (默认)                          │
│  │               → HTTP SSE /api/claw/chat-stream (降级)                 │
│  ├─ 业务 Agent  → HTTP SSE /api/claw/business-chat-stream               │
│  └─ 技能市场    → /api/trpc                                             │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    123 服务器 (华为云)                                    │
│                    linggan-claw (:5180)                                  │
│                                                                         │
│  ┌─────────────────────────── 平台层 ──────────────────────────────┐   │
│  │                                                                  │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │   │
│  │  │ Intent      │  │ Agent Router │  │ Memory Extractor      │  │   │
│  │  │ Engine      │  │ (claw-biz.ts)│  │ (Hermes 式策展记忆)    │  │   │
│  │  │ 意图识别     │  │ 4 种协议分发  │  │ DeepSeek 后台提取     │  │   │
│  │  └──────┬──────┘  └──────┬───────┘  │ → workspace .md 文件  │  │   │
│  │         │                │          └───────────┬───────────┘  │   │
│  │         │                │                      │              │   │
│  │  ┌──────┴──────┐  ┌─────┴──────┐  ┌────────────┴──────────┐  │   │
│  │  │ TIL 租户    │  │ Response   │  │ Memory Store          │  │   │
│  │  │ 隔离层      │  │ Accumulator│  │ 读写 OpenClaw workspace│  │   │
│  │  │ per-user    │  │ SSE 缓冲   │  │ /memory/user-prefs.md │  │   │
│  │  └─────────────┘  └────────────┘  └───────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────── 协议适配层 ─────────────────────────────────────┐   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │   │
│  │  │OpenClaw │  │ Hermes   │  │hi-agent  │  │ TradingAgents │  │   │
│  │  │ 协议    │  │ 协议     │  │ 协议     │  │ 协议          │  │   │
│  │  └────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬────────┘  │   │
│  └───────┼────────────┼─────────────┼────────────────┼───────────┘   │
│          ▼            │             │                │                │
│  ┌──────────────┐     │             │                │                │
│  │ OpenClaw GW  │     │             │                │                │
│  │ :18789       │     │             │                │                │
│  └──────────────┘     │             │                │                │
│          ┌────────────┘             │                │                │
│          │ SSH 隧道 :8642           │                │                │
└──────────┼──────────────────────────┼────────────────┼────────────────┘
           ▼                          ▼                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AWS 服务器                                       │
│                                                                      │
│  ┌─────────────────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐│
│  │ Hermes Gateway      │  │skillchat │  │ Trading   │  │OpenClaw ││
│  │ :8642               │  │ :8080    │  │ Agents    │  │GW :19789││
│  │ 5 个业务 agent       │  │          │  │ :8189     │  │Node     ││
│  │ 自带记忆(MEMORY.md)  │  │          │  │           │  │:19800   ││
│  └─────────────────────┘  └──────────┘  └───────────┘  └─────────┘│
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ lingxia-mcp-server.ts (反向 MCP: agent → 平台能力)              ││
│  │ create_scheduled_task / send_notification / get_user_channels    ││
│  └─────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

## 三层记忆体系

```
┌─────────────────────────────────────────────────────────────────────┐
│                    记忆体系（三层互补）                                │
│                                                                     │
│  Layer 1: OpenClaw 内置记忆                                         │
│  ├─ session-memory hook: 会话结束时保存对话摘要                       │
│  ├─ memory-core 插件: SQLite FTS 索引 + 向量搜索                    │
│  ├─ dreaming: 凌晨 3am 记忆整理（需 cleanup 脚本防垃圾累积）          │
│  ├─ 存储: workspace/memory/*.md + MEMORY.md                        │
│  ├─ 范围: 主聊天 per-user 隔离                                      │
│  └─ 特点: 深度、自动、黑盒                                          │
│                                                                     │
│  Layer 2: Hermes 内置记忆                                           │
│  ├─ background review: 每 10 轮后台 LLM 提取                       │
│  ├─ flush_memories: 上下文压缩前紧急保存                              │
│  ├─ 存储: ~/.hermes/memories/MEMORY.md + USER.md                    │
│  ├─ 范围: task-hermes 及 4 个金融 skill agent                       │
│  └─ 特点: 策展式、主动提取偏好、有字符上限                             │
│                                                                     │
│  Layer 3: 灵虾平台记忆 (新增)                                       │
│  ├─ Hermes 式 background review (复用 Hermes prompt + tool schema)  │
│  ├─ 触发: 每 3 轮对话，fire-and-forget                              │
│  ├─ 提取: DeepSeek Chat (成本 ~0.15 RMB/天)                        │
│  ├─ 存储: OpenClaw workspace/memory/user-preferences.md             │
│  ├─ 范围: 所有路径（WS + HTTP SSE + 业务 Agent）                    │
│  ├─ 接入: claw-ws-proxy.ts + claw-chat.ts + claw-business.ts       │
│  └─ 特点: 跨 agent、写入 OpenClaw 索引、用户可见                     │
│                                                                     │
│  协作关系:                                                           │
│  - OpenClaw 记对话细节 + 操作记录 (深度)                              │
│  - Hermes 记 agent 级经验 + 工具用法 (per-agent)                     │
│  - 灵虾记跨 agent 用户偏好，写入 OpenClaw workspace 被自动索引        │
│  - 三层存储位置不同，不冲突                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## 智能体注册表 (business_agents)

| agent_id | 名称 | 协议 | 目标地址 | 后端服务 |
|----------|------|------|----------|----------|
| task-hermes | 灵枢 共享智脑 | Hermes | :8642 | Hermes Gateway |
| task-credit-risk | 灵犀 智贷决策 | Hermes | :8642 | Hermes + credit-risk skill |
| task-bond | 灵犀 债券投研 | Hermes | :8642 | Hermes + bond skill |
| task-my-wealth | 灵犀 个人理财 | Hermes | :8642 | Hermes + wealth skill |
| task-claim-ev | 灵犀 EV理赔 | Hermes | :8642 | Hermes + ev-claim skill |
| task-trace | 灵枢 深度求索 | hi-agent | :8080 | skillchat |
| task-evolve | 灵枢 技能工坊 | OpenClaw | :19900 | ? |
| task-stock | 灵犀 股票分析 | OpenClaw | :8188 | ? |
| task-trading | 灵犀 智能交易 | TradingAgents | :8189 | trading-server.py |
| task-ppt | 灵匠 幻灯片PPT | OpenClaw(远端) | :19789 | openclaw-gateway |
| task-code | 灵匠 代码助手 | OpenClaw(远端) | :19800 | server.mjs |
| task-slides | 灵匠 幻灯片HTML | OpenClaw(远端) | :19800 | server.mjs |

## 调用协议详解

### 协议 A: OpenClaw Gateway (OpenAI 兼容 + 扩展 header)

```
POST /v1/chat/completions
Headers:
  Authorization: Bearer <CLAW_GATEWAY_TOKEN>
  x-openclaw-agent-id: <per-tenant-agent-id>
  x-openclaw-session-key: <TIL 脱敏后的 sessionKey>
  x-openclaw-model: <可选>
Body: { model: "openclaw", stream: true, messages: [...] }
Response: SSE (OpenAI chat completion chunk 格式)
```

用于: 主聊天(:18789), task-ppt/task-code/task-slides(远端 :19789/:19800)

### 协议 B: Hermes Agent API (结构化生命周期事件)

```
Step 1: POST /v1/runs
  Body: { input: "消息", session_id: "<sessionKey>" }
  Response: { run_id: "..." }

Step 2: GET /v1/runs/{run_id}/events
  Response: SSE
    message.delta / tool.started / tool.completed / run.completed
```

用于: task-hermes, task-credit-risk, task-bond, task-my-wealth, task-claim-ev

### 协议 C: hi-agent (POST + 轮询)

```
POST /runs → GET /runs/{id} (poll)
```

用于: task-trace

### 协议 D: TradingAgents (自定义流式)

```
POST /analyze → SSE (多阶段)
```

用于: task-trading

## A2A 协议演进分析

### 现状评估 (2026-04)

A2A (Google Agent-to-Agent Protocol, 2025-04 发布):
- 状态: 开放规范，有 GitHub repo + Python/JS SDK，非正式标准
- 采纳: Google/Salesforce/LangChain/CrewAI 宣布支持，无大规模生产部署
- 协议: HTTP + JSON-RPC 2.0, Agent Card 发现, Task 生命周期, SSE 流式

### 灵虾现有协议 vs A2A 映射

```
灵虾现有                          A2A 对应概念
────────                          ──────────
business_agents 表                Agent Card (/.well-known/agent.json)
/api/claw/business-chat-stream    tasks/send
SSE 事件流                        tasks/sendSubscribe
session_id / sessionKey           Task ID + 状态机
tool.started / tool.completed     Task Artifact streaming
```

### 建议: 内部 Adapter 先行，A2A 观望

```
Phase 1 (现在): 定义 AgentAdapter 接口，把 4 种协议各包一个 adapter
  → claw-business.ts 从 118KB if-else 变成 adapter.dispatch()
  → 不依赖 A2A，纯内部重构

Phase 2 (Q3 2026): A2A 成熟后，adapter 接口对齐 A2A
  → Agent Card 替代 business_agents 表
  → tasks/send 替代各种自定义 HTTP 调用

跳过条件: 如果 agent 始终只在内部，不需要第三方互联互通，
          自定义 adapter 比 A2A 更简单可控
```

### MCP vs A2A 定位

```
MCP:  agent ← 工具/上下文 (垂直: 给 agent 加能力)
      灵虾已有: lingxia-mcp-server.ts

A2A:  agent ↔ agent (水平: agent 之间通信)
      灵虾需要: 替代当前 4 种异构协议

两者互补，不竞争。灵虾向上是 A2A (调度 agent)，向下是 MCP (暴露平台工具)。
```

## 部署者视角: 最小到完整

| 层级 | 需要部署 | 可用能力 |
|------|----------|----------|
| L0 平台壳 | MySQL + Node + linggan-claw | 注册/登录/admin UI |
| L1 基础聊天 | + OpenClaw + LLM API Key | 通用对话、文件处理 |
| L2 金融技能 | + Hermes Agent + skills 包 | 信用/债券/理财/理赔 |
| L3 完整版 | + TradingAgents + skillchat | 全部 agent |

每层的 agent 在 business_agents 表中 enabled=1 即可激活,
apiUrl 指向实际部署地址。
