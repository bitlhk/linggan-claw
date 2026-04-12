import { useEffect, useMemo, useState } from "react";
import { PageContainer } from "@/components/console/PageContainer";
import { FilesPanel } from "@/components/pages/agent/FilesPanel";
import { OverviewPanel } from "@/components/pages/agent/OverviewPanel";
import { SkillsPanel } from "@/components/pages/agent/SkillsPanel";
import { ToolsPanel } from "@/components/pages/agent/ToolsPanel";
import type { AgentPanel, CoreFileMeta, EffectiveResp, ToolPolicy } from "@/components/pages/agent/types";

const PANELS: { id: AgentPanel; label: string }[] = [
  { id: "overview", label: "概览" },
  { id: "files", label: "文件" },
  { id: "tools", label: "工具" },
  { id: "skills", label: "技能" },
];

function getInitialPanel(): AgentPanel {
  if (typeof window === "undefined") return "overview";
  const q = new URLSearchParams(window.location.search).get("agentPanel");
  if (q === "overview" || q === "files" || q === "tools" || q === "skills") return q;
  const saved = localStorage.getItem("agent.activePanel") as AgentPanel | null;
  if (saved && ["overview", "files", "tools", "skills"].includes(saved)) return saved;
  return "overview";
}

function setPanelInUrl(panel: AgentPanel) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("agentPanel", panel);
  window.history.replaceState({}, "", url.toString());
  localStorage.setItem("agent.activePanel", panel);
}

export function AgentPage({ adoptId, skills }: { adoptId: string; skills?: { shared?: any[]; system?: any[]; private?: any[] } }) {
  const [activePanel, setActivePanel] = useState<AgentPanel>(getInitialPanel());
  const [policy, setPolicy] = useState<ToolPolicy | null>(null);
  const [effective, setEffective] = useState<EffectiveResp | null>(null);
  const [coreFiles, setCoreFiles] = useState<CoreFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [fileName, setFileName] = useState("MEMORY.md");
  const [fileContent, setFileContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fileEtag, setFileEtag] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileFilter, setFileFilter] = useState("");

  const sharedSkills = skills?.shared || [];
  const systemSkills = skills?.system || [];
  const privateSkills = skills?.private || [];

  const load = async () => {
    if (!adoptId) return;
    setLoading(true);
    setError("");
    try {
      const [p, e, cf] = await Promise.all([
        fetch(`/api/claw/tools/policy?adoptId=${encodeURIComponent(adoptId)}`),
        fetch(`/api/claw/tools/effective?adoptId=${encodeURIComponent(adoptId)}`),
        fetch(`/api/claw/core-files?adoptId=${encodeURIComponent(adoptId)}`),
      ]);
      if (!p.ok) throw new Error(`policy ${p.status}`);
      if (!e.ok) throw new Error(`effective ${e.status}`);
      if (!cf.ok) throw new Error(`core-files ${cf.status}`);
      setPolicy(await p.json());
      setEffective(await e.json());
      const cfd = await cf.json();
      setCoreFiles(cfd?.files || []);
    } catch (err: any) {
      setError(err?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [adoptId]);
  useEffect(() => { setPanelInUrl(activePanel); }, [activePanel]);

  const loadCoreFile = async (name: string) => {
    if (!adoptId) return;
    setFileLoading(true);
    try {
      const r = await fetch(`/api/claw/core-files/read?adoptId=${encodeURIComponent(adoptId)}&name=${encodeURIComponent(name)}`);
      if (!r.ok) throw new Error(`read ${r.status}`);
      const d = await r.json();
      setFileName(name);
      setFileContent(d?.content || "");
      setSavedContent(d?.content || "");
      setFileEtag(d?.etag || "");
    } catch (e: any) {
      setError(e?.message || "读取文件失败");
    } finally {
      setFileLoading(false);
    }
  };

  const saveCoreFile = async () => {
    if (!adoptId || !fileName) return;
    setFileSaving(true);
    try {
      // memory_write: 走受控 Memory Write API（白名单+限额+审计），而非任意 core-files/save
      const target = fileName === "MEMORY.md"
        ? "MEMORY.md"
        : fileName.match(/^memory\/(\d{4}-\d{2}-\d{2})\.md$/)
        ? `memory:${fileName.match(/^memory\/(\d{4}-\d{2}-\d{2})\.md$/)![1]}`
        : `notes:${fileName.replace(/^notes\//, "")}`;

      const r = await fetch(`/api/claw/memory/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptId, target, mode: "replace", content: fileContent, etag: fileEtag }),
      });
      if (r.status === 409) throw new Error("文件已被更新，请刷新后重试");
      if (r.status === 429) { const d = await r.json(); throw new Error(`写入限制：${d?.error || "rate_limited"}`); }
      if (r.status === 413) { const d = await r.json(); throw new Error(`内容过大：${d?.error || "file_too_large"}`); }
      if (r.status === 400) { const d = await r.json(); throw new Error(`路径不允许：${d?.error || "path_not_allowed"}`); }
      if (!r.ok) throw new Error(`保存失败 (${r.status})`);
      const d = await r.json();
      setFileEtag(d?.etag || "");
      setSavedContent(fileContent);
      await load();
    } catch (e: any) {
      setError(e?.message || "保存失败");
    } finally {
      setFileSaving(false);
    }
  };

  const flatTools = useMemo(() => (effective?.groups || []).flatMap((g) => g.tools), [effective]);
  const enabledTools = flatTools.filter((t) => t.runtimeAvailable).length;
  const dirty = fileContent !== savedContent;

  return (
    <PageContainer title="代理">
      <div className="console-tabs">
        {PANELS.map((p) => (
          <button
            key={p.id}
            onClick={() => setActivePanel(p.id)}
            className={`console-tab ${activePanel === p.id ? "active" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <div className="settings-card text-xs" style={{ color: "#ef4444" }}>{error}</div>}

      {activePanel === "overview" && (
        <OverviewPanel
          adoptId={adoptId}
          effective={effective}
          policy={policy}
          coreFiles={coreFiles}
          sharedSkills={sharedSkills}
          systemSkills={systemSkills}
          privateSkills={privateSkills}
          visibleTools={flatTools.length}
          runnableTools={enabledTools}
        />
      )}

      {activePanel === "files" && (
        <FilesPanel
          coreFiles={coreFiles}
          fileFilter={fileFilter}
          setFileFilter={setFileFilter}
          load={load}
          fileName={fileName}
          loadCoreFile={loadCoreFile}
          fileContent={fileContent}
          setFileContent={setFileContent}
          saveCoreFile={saveCoreFile}
          fileSaving={fileSaving}
          fileLoading={fileLoading}
          dirty={dirty}
          resetLocal={() => setFileContent(savedContent)}
        />
      )}

      {activePanel === "tools" && (
        <ToolsPanel effective={effective} policy={policy} enabledTools={enabledTools} totalTools={flatTools.length} />
      )}

      {activePanel === "skills" && (
        <SkillsPanel sharedSkills={sharedSkills} systemSkills={systemSkills} privateSkills={privateSkills} />
      )}
    </PageContainer>
  );
}
