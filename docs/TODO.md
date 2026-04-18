# 灵虾 TODO（待办池，演示后专项）

## 输入框升级：textarea → 富文本（Tiptap）
- **背景**：当前主聊天 ChatInput 是 plain textarea，@mention 用纯文本 `@用户名` + 父组件 `mentionedUsers` 状态。删除标签时状态不会同步（已用 onSend 里 reconcile 兜底，2026-04-16）。
- **目标**：换成 Tiptap (prosemirror) 或 Lexical，`@用户名` 渲染为不可分割的 chip span，删一次按键删整体；同时为未来 `@文件` / `@技能` / Slash command 打基座。
- **工作量估算**：1-2 周，含 IME/光标/撤销栈/粘贴/emoji 完整测试。
- **触发时机**：演示后（4-20 起），且当输入框需要支持 ≥2 种 mention 类型时一起做。
- **风险**：动 ChatInput hot path，必须有完整 e2e 测试覆盖再 ship。

## 协作 V2 后续整合（演示后）
- 1:1 collab_requests 数据迁移到 lx_coop_sessions（member_count=1）
- CollabDrawer 组件下线（按钮已在 Home.tsx:1212 改为 `right={undefined}`，组件本身保留服务于 collabSuggestion 推荐卡片）
- CollabPage 旧 5 个 tab 彻底删除（当前注释保留在 CollabPage.tsx:231 附近）
- coop 灰度白名单 `[2]` 替换为 env 或 feature_flags 表

## 主聊天 SSE 流式渲染 race condition（2026-04-17 发现）
- **现象**：用户 A 屏幕上出现用户 B 那条消息的字符片段（如龚倩"你有什么技能"回复中混入赵印伟那条"李泓琨"问句的字符），文字交错诡异。
- **根因**：Home.tsx `setLingxiaMsgs((prev) => prev[last].text += delta)` 是按位置写入最后一条 assistant message。当**多个 SSE 流并发**（例如主聊天还在流式中，又触发了第二条；或者主聊天 + CoopChatBox 同时活跃；或 WS+HTTP 双路同时连），两路 delta 字符级交错写到同一条 message text。
- **数据层未污染**：每个用户的 OpenClaw sessionKey 物理隔离正确，server 端 sandbox/工作空间不串；只是浏览器内 React state 显示层 race。
- **修复方向**：(1) 每条 assistant message 生成 streamId/messageId，SSE reader 按 id 写 `prev.find(m => m.id === streamMsgId).text += delta` 而不是 last position；(2) sendLingxiaMessage 开始前必须 abort 上一次的 lingxiaStreamAbortRef.current；(3) 主聊天 ChatPage 和 CoopChatBox 的 lingxiaMsgs / msgs state 物理分离已隔离，但要确认 wsClient 不被多 tab 共享（OpenClawWSClient 单例风险）。
- **工作量**：1-2 天（动 Home.tsx 主聊天 hot path，必须 e2e 测试 WS / HTTP fallback / 中断重发 / 并发场景）。
- **演示前 mitigation**：让演练人 1) 发问等 AI 完整回复再发下一句；2) 不快速连点；3) 不同时开多 chat tab；4) 演示前刷新页面。

## OpenClaw dreaming 已默认关闭（2026-04-17）
- **背景**：OpenClaw 的 dreaming 功能（每天 3am 自动跑 light/REM/deep 总结，写到 memory/*.md）在企业演示场景价值不大，且历史出现过：
  - 自我引用循环（读自己上次产出 → 产出更多 → 雪球，文件涨到 164-394 行，靠 cleanup-dreaming.sh + cron 3:30 兜底）
  - dreaming 内容偶尔通过 SSE 流出现在用户 chat 响应中，跟正常对话字符级交错（典型现象：英文 narrative + 中文回复混合，2026-04-17 14:32 龚倩/user 2 复现）
- **改动**：`/root/.openclaw/openclaw.json` 里 `plugins.entries.memory-core.config.dreaming.enabled` 从 true 改为 false
- **生效**：要 `systemctl restart openclaw-gateway` 才生效（会断 ~30 秒所有 chat）
- **备份**：`/root/.openclaw/openclaw.json.bak-20260417-144140-pre-dreaming-off`
- **保留**：memory-core plugin 本身仍 enabled（memory tool 还能用，只是不再 dreaming）
- **回滚**：恢复备份 + restart gateway
- **cleanup-dreaming.sh + cron 3:30** 暂保留作为防御性清理，演示后视情况下线

## Security middleware 正则过宽审计（2026-04-17 发现）
- **背景**：今天 coop 文件下载报"涉及敏感数据"，root cause 是 security.ts:341 的 XSS 防护 regex `/on\w+\s*=/gi` 误把 `sessionid=` 当成 `onclick=` 拦截。已加 `\b` word boundary 紧急修复。
- **更深层问题**：security.ts 里整套 `xssPatterns` / `sqlInjectionPatterns` 都是 regex，且对所有 query string + path + UA 扫描。除了 `on=` 之外的规则也可能误伤：
  - SQL 注入正则碰上含 SELECT/UPDATE 的合法用户输入（如 "我想 update 一下文档"）
  - XSS `<script` 拦截碰上代码示例
  - 路径遍历 `..` 碰上版本号 `v1.2..3`
- **修复方向**：演示后整套审计：
  1. XSS 规则全部加 word boundary `\b`
  2. 区分 query string 和 body：path/query 用宽松规则（路由参数本来就是规范化的），body 用严格规则
  3. 加白名单（已知安全的路由前缀如 `/api/coop/file?...` 跳过 XSS 检测）
  4. 上更专业的 WAF 中间件（如 helmet + express-rate-limit + 自研规则）替换手写正则
- **工作量**：1 天审计 + 测试
- **风险**：演示前不动；但要预演时主动测试中文文件名、含 `on/select/update` 的输入是否被误拦
