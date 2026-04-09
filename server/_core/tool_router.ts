/**
 * tool_router.ts — 平台工具代理层 v2
 *
 * 架构：LLM tool_call → toolNameMap → policyCheck → execute → normalizeResult
 *
 * v2 改进：
 *  1. 完整审计闭环：每个字段可举证"是否走 sandbox"
 *  2. 审计落库：ToolExecutionAudit 写入数据库
 *  3. PolicyDenyReason 枚举：拒绝原因标准化
 *  4. 参数 schema 校验：sandbox_exec 严格入参校验
 *  5. 策略配置中心：BLOCKED_PATTERNS / ALLOWED_COMMANDS 集中管理
 *  6. RoutedToolResult 结构：全路径结构化返回
 */

// ─────────────────────────────────────────────────────────────────────────────
// External deps
// ─────────────────────────────────────────────────────────────────────────────
import { sandboxExec } from "./sandbox";
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, readdirSync } from "fs";
import os from "os";

// ─────────────────────────────────────────────────────────────────────────────
// 6. 结果结构（先定义类型，让其他层引用一致）─────────────────────────────────

export type PolicyDenyReason =
  | "profile_denied"
  | "starter_denied"
  | "tool_not_found"
  | "command_not_allowed"
  | "blocked_pattern"
  | "timeout_exceeded"
  | "output_limit_exceeded"
  | "invalid_arguments"
  | "too_many_args"
  | "args_type_invalid"
  | "cwd_not_allowed"
  | "unknown_error";

export type ExecutorName = "sandbox" | "native" | "none";

export type ErrorType =
  | "policy_denied"
  | "timeout"
  | "execution_error"
  | "invalid_arguments"
  | "unknown_error";

export interface RoutedToolResult {
  auditId: string;
  toolCallId: string;
  toolName: string;
  executor: ExecutorName;
  // 成功与否
  ok: boolean;
  exitCode?: number;
  // 输出
  output: string;
  truncated: boolean;
  // 错误分类
  errorType?: ErrorType;
  policyDenyReason?: PolicyDenyReason;
  // 元信息
  // suppressedOriginalResult: true=代理层拦截替换, false=透传原始
  suppressedOriginalResult: boolean;
  /** 沙箱产出的文件，已移至 workspace，可供下载 */
  outputFiles?: Array<{ name: string; size: number; workspacePath: string }>;
  meta: {
    durationMs?: number;
    stdoutBytes?: number;
    stderrBytes?: number;
    originalToolName?: string;
    routedToolName?: string;
    policyDecision?: "allow" | "deny" | "rewrite";
    deniedReason?: string;   // 用户可读
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 策略配置中心（集中管理，不要散在逻辑里）─────────────────────────────────

export interface ToolPolicyConfig {
  sandboxExec: {
    allowedCommands: string[];
    blockedPatterns: Array<{ pat: RegExp; reason: string }>;
    timeoutMs: number;
    outputLimitBytes: number;
    maxArgs: number;
    allowedCwd: string[];   // 白名单目录，empty = 全部禁用
    envKeyPattern: RegExp; // 允许的环境变量 key 格式
  };
}

export const TOOL_POLICY: ToolPolicyConfig = {
  sandboxExec: {
    // 允许的基础命令（精确匹配）
    allowedCommands: [
      "ls", "cat", "grep", "find", "echo", "pwd", "mkdir", "touch",
      "cp", "mv", "head", "tail", "sort", "uniq", "wc", "awk", "sed",
      "python3", "pip3", "node", "npm", "pnpm", "git",
      "zip", "unzip", "tar", "gzip", "gunzip",
      "ps", "kill", "killall", "pgrep", "pkill",
      "df", "du", "free", "uptime",
      "whoami", "id", "hostname", "uname", "date",
      "base64", "md5sum", "sha256sum", "sha1sum",
      "jq", "xxd", "hexdump",
      "curl", "wget",
    ],

    // 黑名单模式（正则）
    blockedPatterns: [
      { pat: /\bsudo\b/,                              reason: "sudo not allowed" },
      { pat: /\bsu\b\s/,                              reason: "su not allowed" },
      { pat: /\bchmod\b.*[+]s/,                      reason: "setuid bit not allowed" },
      { pat: /\/proc\/sysrq/,                         reason: "sysrq not allowed" },
      { pat: /\/dev\/sd/,                             reason: "block device not allowed" },
      { pat: /\bdd\b.*\/dev\//,                       reason: "dd to device not allowed" },
      { pat: /\bnsenter\b/,                          reason: "nsenter not allowed" },
      { pat: /\bunshare\b/,                           reason: "unshare not allowed" },
      { pat: /\bmount\b/,                            reason: "mount not allowed" },
      { pat: /\bnohup\b.*&\s*$/,                      reason: "background daemon not allowed" },
      { pat: /\bcurl\b.*--output\b|\bwget\b.*-O\s/, reason: "file download not allowed" },
      { pat: /\brm\b.*-rf\s+\/(?!tmp)/,             reason: "recursive root delete not allowed" },
      { pat: /;\s*rm\s+/,                             reason: "chain rm not allowed" },
      { pat: /\|\s*rm\s+/,                            reason: "pipe rm not allowed" },
      { pat: /\bsh\b.*-i\b/,                          reason: "interactive shell not allowed" },
      { pat: /\bpython3?\b.*-m\s+pip\b/,              reason: "pip install not allowed" },
      // 防止内联代码执行绕过 allowedCommands 白名单
      { pat: /\bpython3?\b.*-[cC]\b/,               reason: "python inline exec not allowed" },
      { pat: /\bpython\b.*-[cC]\b/,                 reason: "python inline exec not allowed" },
      { pat: /\bnode\b.*-[eE]\b/,                   reason: "node inline eval not allowed" },
      { pat: /\bnode\b.*--eval\b/,                  reason: "node inline eval not allowed" },
      { pat: /\bnpm\b.*(install|i)\b/,              reason: "npm install not allowed in sandbox" },
      { pat: /\bpnpm\b.*(install|add)\b/,           reason: "pnpm install not allowed in sandbox" },

      // – 承感路径 + 信桿接钠信桿 –––––––––––––––––
      { pat: /\/etc\/(shadow|passwd|sudoers|ssh\/|ssl\/private)/, reason: "sensitive system file not allowed" },
      { pat: /\.(bash_history|zsh_history|ash_history)/, reason: "shell history not allowed" },
      { pat: /\.(bashrc|bash_profile|zshrc|profile|bash_logout)/, reason: "shell rc config not allowed" },
      { pat: /\/\.openclaw\//, reason: "openclaw config not allowed" },
      { pat: /\/\.config\//, reason: "user config dir not allowed" },
      { pat: /\/\.ssh\//, reason: "ssh keys not allowed" },
      { pat: /\/proc\/[0-9]+\/environ/, reason: "process environ not allowed" },
      { pat: /\/proc\/[0-9]+\/cmdline/, reason: "process cmdline not allowed" },
      { pat: /[.]env([.]local|[.]prod|[.]development|[.]staging)?\b/, reason: ".env file not allowed" },
      { pat: /\bfind\b.*\/(etc|root|home|proc|sys)\b/, reason: "find in sensitive dirs not allowed" },
      { pat: /\bhostname\b/, reason: "hostname command not allowed" },
    ],

    timeoutMs:         30_000,
    outputLimitBytes:  64 * 1024,  // 64KB
    maxArgs:           20,
    // cwd 白名单（empty = 完全禁用 cwd）
    allowedCwd:       [],
    // 环境变量 key 格式（防止 KEY=value 注入）
    envKeyPattern:    /^[A-Z_][A-Z0-9_]{0,30}$/,
  },
};

// 用户可读的拒绝原因映射（用于 SSE 返回）
const POLICY_DENY_USER_READABLE: Partial<Record<PolicyDenyReason, string>> = {
  profile_denied:      "当前权限级别不允许执行该工具",
  starter_denied:      "exec 工具仅对 plus 及以上用户开放",
  tool_not_found:      "工具不存在或未启用",
  command_not_allowed: "命令不在允许列表中，请联系管理员",
  blocked_pattern:     "命令包含敏感操作，被安全策略拦截",
  timeout_exceeded:    "执行超时，请减少操作复杂度",
  output_limit_exceeded: "输出过长，已截断",
  invalid_arguments:   "参数格式不符合安全要求",
  too_many_args:       "参数过多，请简化",
  args_type_invalid:   "参数类型错误",
  cwd_not_allowed:     "工作目录不在允许范围内",
  unknown_error:       "未知错误，请稍后重试",
};

// ─────────────────────────────────────────────────────────────────────────────
// 工具名映射（1 层）───────────────────────────────────────────────────────────

const TOOL_NAME_MAP: Record<string, string> = {
  exec:     "sandbox_exec",
  process:  "sandbox_exec",
};

export function resolveToolHandler(name: string): string {
  return TOOL_NAME_MAP[name] ?? "denied";
}

// ─────────────────────────────────────────────────────────────────────────────
// 审计 ID 生成─────────────────────────────────────────────────────────────────

function newAuditId(): string {
  return `aud_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 日志辅助─────────────────────────────────────────────────────────────────────

const APP_ROOT_TR = process.env.APP_ROOT || "/root/linggan-platform";
const LOG_DIR = `${APP_ROOT_TR}/logs`;

function ensureLogDir() {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function auditLog(entry: Record<string, unknown>) {
  ensureLogDir();
  const line = JSON.stringify(entry);
  try { appendFileSync(`${LOG_DIR}/tool-router.log`, line + "\n", "utf8"); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 参数 schema 校验──────────────────────────────────────────────────────────

export interface SandboxExecInput {
  cmd?:     string | null;
  args?:    string[] | null;
  cwd?:     string | null;
  timeoutMs?: number | null;
  env?:     Record<string, string> | null;
}

export function validateSandboxExecInput(argsStr: string): {
  ok: boolean;
  input?: SandboxExecInput;
  denyReason?: PolicyDenyReason;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(argsStr);
  } catch {
    return { ok: false, denyReason: "invalid_arguments" };
  }

  // 支持两种格式：
  //   1. 字符串 = 命令本身
  //   2. 对象 = { cmd, args, cwd, timeoutMs, env }
  if (typeof raw === "string") {
    const cmd = (raw as string).trim();
    if (!cmd) return { ok: false, denyReason: "invalid_arguments" };
    return { ok: true, input: { cmd, args: null, cwd: null, timeoutMs: null, env: null } };
  }

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, denyReason: "invalid_arguments" };
  }

  const obj = raw as Record<string, unknown>;

  // cmd: 必须是非空字符串
  const cmdRaw = obj.cmd ?? obj.command ?? obj.code ?? obj._;
  const cmd = typeof cmdRaw === "string" ? cmdRaw.trim() : null;
  if (!cmd) return { ok: false, denyReason: "invalid_arguments" };

  // args: 必须是字符串数组，最多 maxArgs 个
  const argsRaw = obj.args ?? obj._args;
  let args: string[] | null = null;
  if (Array.isArray(argsRaw)) {
    if (argsRaw.length > TOOL_POLICY.sandboxExec.maxArgs) {
      return { ok: false, denyReason: "too_many_args" };
    }
    if (!argsRaw.every(a => typeof a === "string")) {
      return { ok: false, denyReason: "args_type_invalid" };
    }
    args = argsRaw as string[];
  } else if (argsRaw !== undefined && argsRaw !== null) {
    return { ok: false, denyReason: "args_type_invalid" };
  }

  // cwd: 必须是允许的目录或空
  const cwd = typeof obj.cwd === "string" ? obj.cwd.trim() : null;
  if (cwd) {
    const allowed = TOOL_POLICY.sandboxExec.allowedCwd;
    if (allowed.length > 0 && !allowed.some(prefix => cwd.startsWith(prefix))) {
      return { ok: false, denyReason: "cwd_not_allowed" };
    }
    if (cwd === "/" || cwd === "/root" || cwd.startsWith("/root")) {
      return { ok: false, denyReason: "cwd_not_allowed" };
    }
  }

  // timeoutMs: 可选，范围校验
  let timeoutMs: number | null = null;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || obj.timeoutMs <= 0 || obj.timeoutMs > 120_000) {
      return { ok: false, denyReason: "invalid_arguments" };
    }
    timeoutMs = obj.timeoutMs;
  }

  // env: 可选，key 格式校验
  let env: Record<string, string> | null = null;
  if (obj.env !== undefined && obj.env !== null && typeof obj.env === "object") {
    const pattern = TOOL_POLICY.sandboxExec.envKeyPattern;
    env = {};
    for (const [k, v] of Object.entries(obj.env as Record<string, unknown>)) {
      if (!pattern.test(k) || typeof v !== "string") {
        return { ok: false, denyReason: "invalid_arguments" };
      }
      env[k] = v;
    }
  }

  return {
    ok: true,
    input: { cmd, args, cwd, timeoutMs, env },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 策略校验（PolicyDenyReason 枚举）────────────────────────────────────────

export interface PolicyCheckResult {
  allowed: boolean;
  denyReason?: PolicyDenyReason;
  toolHandler?: string;
  denyReasonReadable?: string;
  policyDecision?: "allow" | "deny" | "rewrite";
}

export function policyCheck(
  permissionProfile: "starter" | "plus" | "internal",
  toolName: string,
  input: SandboxExecInput,
): PolicyCheckResult {
  // 1. 工具名路由
  const handler = resolveToolHandler(toolName);
  if (handler === "denied") {
    return {
      allowed: false,
      denyReason: "tool_not_found",
      denyReasonReadable: POLICY_DENY_USER_READABLE["tool_not_found"],
      policyDecision: "deny",
    };
  }

  // 2. profile 权限
  if (permissionProfile === "starter") {
    return {
      allowed: false,
      denyReason: "starter_denied",
      denyReasonReadable: POLICY_DENY_USER_READABLE["starter_denied"],
      policyDecision: "deny",
    };
  }

  // 3. plus 永远走 sandbox，不走 native
  if (permissionProfile === "plus" && handler === "native_exec") {
    return {
      allowed: false,
      denyReason: "profile_denied",
      denyReasonReadable: "plus 用户必须使用沙箱执行",
      policyDecision: "deny",
    };
  }

  // 4. sandbox_exec 命令校验
  if (handler === "sandbox_exec" && input.cmd) {
    const { blockedPatterns, allowedCommands } = TOOL_POLICY.sandboxExec;

    // 4a. 黑名单检查
    for (const { pat, reason } of blockedPatterns) {
      if (pat.test(input.cmd)) {
        return {
          allowed: false,
          denyReason: "blocked_pattern",
          denyReasonReadable: `命令包含敏感操作（${reason}），被安全策略拦截`,
          policyDecision: "deny",
        };
      }
    }

    // 4b. 白名单检查（精确匹配主命令）
    const mainCmd = input.cmd.split(/\s+/)[0].replace(/^.*\//, "");
    if (!allowedCommands.includes(mainCmd)) {
      return {
        allowed: false,
        denyReason: "command_not_allowed",
        denyReasonReadable: `命令 '${mainCmd}' 不在允许列表中，如有需要请联系管理员`,
        policyDecision: "deny",
      };
    }
  }

  return {
    allowed: true,
    toolHandler: handler,
    policyDecision: "allow",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 审计落库──────────────────────────────────────────────────────────────────

// ToolExecutionAudit 表字段
export interface ToolExecutionAuditRecord {
  auditId:           string;
  requestId?:        string;   // adoptId
  userId?:           number;
  agentId?:          string;
  profile:           "starter" | "plus" | "internal";
  toolCallId:        string;
  originalToolName:  string;
  routedToolName:    string;
  command?:          string;
  args?:             string[];
  cwd?:              string;
  timeoutMs?:        number;
  policyDecision:    "allow" | "deny" | "rewrite";
  denyReason?:       string;
  deniedReason?:     string;
  executor:          ExecutorName;
  exitCode?:         number;
  stdoutBytes?:      number;
  stderrBytes?:      number;
  truncated?:        boolean;
  durationMs?:       number;
  createdAt:         number;
}

// 审计记录缓存（按 adoptId 分组，批量写入）
const auditBuffer: ToolExecutionAuditRecord[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 5000;
const MAX_BUFFER_SIZE = 50;

async function flushAuditBuffer() {
  if (auditBuffer.length === 0) return;
  const records = auditBuffer.splice(0, auditBuffer.length);
  try {
    const { getDb } = await import("../db");
    const db = getDb();
    if (!db) return;
    const sql = `
      INSERT INTO tool_execution_audit (
        audit_id, request_id, user_id, agent_id, profile, tool_call_id,
        original_tool_name, routed_tool_name, command, args, cwd, timeout_ms,
        policy_decision, deny_reason, denied_reason, executor,
        exit_code, stdout_bytes, stderr_bytes, truncated, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE audit_id = audit_id
    `;
    const stmt = db.prepare(sql);
    for (const r of records) {
      try {
        stmt.run(
          r.auditId, r.requestId, r.userId ?? null, r.agentId ?? null,
          r.profile, r.toolCallId, r.originalToolName, r.routedToolName,
          r.command ?? null, r.args ? JSON.stringify(r.args) : null,
          r.cwd ?? null, r.timeoutMs ?? null,
          r.policyDecision, r.denyReason ?? null, r.deniedReason ?? null,
          r.executor, r.exitCode ?? null, r.stdoutBytes ?? null,
          r.stderrBytes ?? null, r.truncated ? 1 : 0, r.durationMs ?? null, r.createdAt,
        );
      } catch { /* log and skip individual bad rows */ }
    }
    auditLog({ event: "audit_flush", count: records.length });
  } catch (err) {
    auditLog({ event: "audit_flush_error", error: String(err), count: records.length });
  }
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushAuditBuffer();
  }, FLUSH_INTERVAL_MS);
}

function enqueueAudit(record: ToolExecutionAuditRecord) {
  auditBuffer.push(record);
  if (auditBuffer.length >= MAX_BUFFER_SIZE) {
    flushAuditBuffer();
  } else {
    scheduleFlush();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 主路由入口───────────────────────────────────────────────────────────────────

export interface ToolContext {
  adoptId:  string;
  agentId:  string;
  userId:   number;
  permissionProfile: "starter" | "plus" | "internal";
  sessionKey: string;
  /** 子虾 workspace 目录（用于存放沙箱导出文件） */
  workspaceDir?: string;
  /** 进度/状态事件发送函数（可选，SSE 可用时传入） */
  sendEvent?: (event: string, data: object) => void;
}

export interface ToolCallRequest {
  id:        string;
  name:     string;
  arguments: string;
}

/**
 * routeTool — 统一工具代理入口
 *
 * 返回 RoutedToolResult，结构化，可举证，可扩展
 */
export async function routeTool(
  ctx: ToolContext,
  req: ToolCallRequest,
): Promise<RoutedToolResult> {
  const auditId = newAuditId();
  const startMs = Date.now();
  const originalToolName = req.name;

  // ── Step 0: 解析参数 ───────────────────────────────────────────────────
  const validation = validateSandboxExecInput(req.arguments);
  const input = validation.ok ? validation.input! : { cmd: null, args: null, cwd: null, timeoutMs: null, env: null };

  // ── Step 1: 策略校验 ───────────────────────────────────────────────────
  const policy = policyCheck(ctx.permissionProfile, req.name, input);

  const routedToolName = policy.allowed
    ? (policy.toolHandler ?? "none")
    : "none";

  // ── Step 2: 拒绝时快速返回 ─────────────────────────────────────────────
  if (!policy.allowed) {
    const deniedReason = POLICY_DENY_USER_READABLE[policy.denyReason!] ?? "权限不足";
    const result: RoutedToolResult = {
      auditId,
      toolCallId: req.id,
      toolName: req.name,
      executor: "none",
      ok: false,
      output: `[权限拒绝] ${deniedReason}`,
      truncated: false,
      errorType: "policy_denied",
      policyDenyReason: policy.denyReason,
      suppressedOriginalResult: true,
      meta: {
        originalToolName,
        routedToolName,
        policyDecision: "deny",
        deniedReason,
        durationMs: Date.now() - startMs,
      },
    };

    enqueueAudit({
      auditId, requestId: ctx.adoptId, userId: ctx.userId, agentId: ctx.agentId,
      profile: ctx.permissionProfile, toolCallId: req.id,
      originalToolName, routedToolName,
      command: input.cmd ?? undefined,
      args: input.args ?? undefined,
      cwd: input.cwd ?? undefined,
      timeoutMs: TOOL_POLICY.sandboxExec.timeoutMs,
      policyDecision: "deny",
      denyReason: policy.denyReason,
      deniedReason,
      executor: "none",
      createdAt: Date.now(),
    });

    auditLog({
      event: "tool_denied",
      auditId,
      adoptId: ctx.adoptId,
      originalToolName,
      routedToolName,
      denyReason: policy.denyReason,
    });

    return result;
  }

  // ── Step 3: 执行 ────────────────────────────────────────────────────────
  let exitCode: number | undefined;
  let stdout: string | undefined;
  let stderr: string | undefined;
  let truncated = false;
  let errorType: ErrorType | undefined;

  let outputFiles: Array<{ name: string; size: number; workspacePath: string }> | undefined;
  if (routedToolName === "sandbox_exec") {
    const timeoutMs = input.timeoutMs ?? TOOL_POLICY.sandboxExec.timeoutMs;
    // 为本次执行创建临时 output 目录（挂载为容器内 /output）
    let tmpOutputDir: string | null = null;
    try { tmpOutputDir = mkdtempSync("/tmp/sb-output-"); } catch {}
    try {
      const raw = await sandboxExec({
        adoptId: ctx.adoptId,
        command: input.cmd!,
        timeoutMs,
        env: input.env ?? undefined,
        outputDir: tmpOutputDir ?? undefined,
        // 进度回调：检测 stderr 中的 {"__type":"progress",...} 并发送 SSE 事件
        onProgress: (line: string) => {
          try {
            const p = JSON.parse(line);
            if (p?.__type === "progress" && ctx.sendEvent) {
              ctx.sendEvent("agent_status", {
                kind: "progress",
                tool: originalToolName,
                step: typeof p.step === "number" ? p.step : null,
                total: typeof p.total === "number" ? p.total : null,
                label: typeof p.label === "string" ? p.label : null,
              });
            }
          } catch {}
        },
      });
      exitCode = raw.exitCode;
      stdout = raw.stdout;
      stderr = raw.stderr;
      truncated = raw.truncated;

      // 将沙箱产出文件移至子虾 workspace sandbox-files/ 目录
      if (raw.outputFiles && raw.outputFiles.length > 0 && tmpOutputDir) {
        const workspaceDir = ctx.workspaceDir;
        if (workspaceDir) {
          const filesDir = `${workspaceDir}/sandbox-files`;
          try {
            mkdirSync(filesDir, { recursive: true });
            outputFiles = [];
            for (const f of raw.outputFiles) {
              const src = `${tmpOutputDir}/${f.name}`;
              const dest = `${filesDir}/${f.name}`;
              try {
                renameSync(src, dest);
                outputFiles.push({ name: f.name, size: f.size, workspacePath: dest });
              } catch {}
            }
          } catch {}
        }
      }
    } catch (err: any) {
      errorType = "execution_error";
      stdout = `[sandbox_exec error] ${err?.message ?? String(err)}`;
      exitCode = 1;
    } finally {
      // 清理临时 output 目录残留
      if (tmpOutputDir) {
        try {
          for (const f of readdirSync(tmpOutputDir)) {
            try { require("fs").unlinkSync(`${tmpOutputDir}/${f}`); } catch {}
          }
          require("fs").rmdirSync(tmpOutputDir);
        } catch {}
      }
    }
  } else {
    // 不应该走到这里（policy 已拦掉）
    errorType = "unknown_error";
    stdout = `[unsupported handler] ${routedToolName}`;
    exitCode = 1;
  }

  const durationMs = Date.now() - startMs;
  const output = buildOutput(stdout ?? "", stderr, exitCode, truncated);

  // ── Step 4: 结果标准化 + 落库 ───────────────────────────────────────────
  enqueueAudit({
    auditId, requestId: ctx.adoptId, userId: ctx.userId, agentId: ctx.agentId,
    profile: ctx.permissionProfile, toolCallId: req.id,
    originalToolName, routedToolName,
    command: input.cmd ?? undefined,
    args: input.args ?? undefined,
    cwd: input.cwd ?? undefined,
    timeoutMs: input.timeoutMs ?? TOOL_POLICY.sandboxExec.timeoutMs,
    policyDecision: "allow",
    executor: routedToolName as ExecutorName,
    exitCode,
    stdoutBytes: (stdout ?? "").length,
    stderrBytes: (stderr ?? "").length,
    truncated,
    durationMs,
    createdAt: Date.now(),
  });

  auditLog({
    event: "tool_executed",
    auditId,
    adoptId: ctx.adoptId,
    originalToolName,
    routedToolName,
    executor: routedToolName,
    exitCode,
    truncated,
    durationMs,
  });

  return {
    auditId,
    toolCallId: req.id,
    toolName: req.name,
    executor: routedToolName as ExecutorName,
    ok: (exitCode ?? 1) === 0 && !errorType,
    exitCode,
    output,
    truncated,
    errorType,
    outputFiles,
    suppressedOriginalResult: true,
    meta: {
      originalToolName,
      routedToolName,
      policyDecision: "allow",
      deniedReason: undefined,
      durationMs,
      stdoutBytes: (stdout ?? "").length,
      stderrBytes: (stderr ?? "").length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具函数─────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// 工具函数

function buildOutput(stdout: string, stderr: string | undefined, exitCode: number | undefined, truncated: boolean): string {
  let out = "";
  if (exitCode !== 0 && exitCode !== undefined && stderr) {
    out = `[exit ${exitCode}]\n${stdout || stderr}`;
  } else if (stdout) {
    out = stdout;
  } else if (stderr) {
    out = stderr;
  } else {
    out = "(no output)";
  }
  if (truncated) {
    out += "\n[输出已截断]";
  }
  return out;
}

// 进程退出前刷文件缓冲
process.on("exit", () => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  if (auditBuffer.length > 0) {
    try {
      ensureLogDir();
      const lines = auditBuffer.splice(0).map(r => JSON.stringify(r)).join("\n");
      appendFileSync(LOG_DIR + "/tool-router-final.log", lines + "\n", "utf8");
    } catch {}
  }
});
