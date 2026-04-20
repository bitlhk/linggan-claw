import { SkillsPage } from "@/components/pages/SkillsPage";
import { WeixinPage } from "@/components/pages/WeixinPage";
import { AgentPage } from "@/components/pages/AgentPage";
import { SchedulePage } from "@/components/pages/SchedulePage";
import { SettingsPage } from "@/components/pages/SettingsPage";
import { DocsPage } from "@/components/pages/DocsPage";
import { CollabPage } from "@/components/pages/CollabPage";
import type { PageKey } from "@/components/console/Sidebar";

export function MainPanel({
  activePage,
  settings,
  skills,
  adoptId,
}: {
  activePage: Exclude<PageKey, "chat">;
  settings?: {
    memoryEnabled?: "yes" | "no";
    setMemoryEnabled?: (v: "yes" | "no") => void;
    contextTurns?: number;
    setContextTurns?: (v: number) => void;
    canSave?: boolean;
    saving?: boolean;
    onSave?: () => void;
  };
  adoptId?: string;
  skills?: {
    data?: { shared: any[]; system: any[]; private: any[] } | null;
    canEdit?: boolean;
    pending?: boolean;
    onToggle?: (skillId: string, enable: boolean, source: "shared" | "system") => void;
  };
}) {
  const safeSkills = {
    data: skills?.data ?? { shared: [], system: [], private: [] },
    canEdit: !!skills?.canEdit,
    pending: !!skills?.pending,
    onToggle: skills?.onToggle ?? (() => {}),
    adoptId: adoptId || "",
  };

  const safeSettings = {
    memoryEnabled: settings?.memoryEnabled ?? "yes",
    setMemoryEnabled: settings?.setMemoryEnabled ?? (() => {}),
    contextTurns: settings?.contextTurns ?? 20,
    setContextTurns: settings?.setContextTurns ?? (() => {}),
    canSave: !!settings?.canSave,
    saving: !!settings?.saving,
    onSave: settings?.onSave ?? (() => {}),
  };

  if (activePage === "weixin") return <WeixinPage adoptId={adoptId || ""} />;
  if (activePage === "skills") {
    return <SkillsPage skills={safeSkills.data} canEdit={safeSkills.canEdit} pending={safeSkills.pending} onToggle={safeSkills.onToggle} adoptId={safeSkills.adoptId} />;
  }
  if (activePage === "agent") return <AgentPage adoptId={adoptId || ""} skills={safeSkills.data as any} />;
  if (activePage === "schedule") return <SchedulePage adoptId={adoptId || ""} />;
  if (activePage === "docs") return <DocsPage />;
  if (activePage === "collab") return <CollabPage adoptId={adoptId || ""} />;

  return (
    <SettingsPage
      memoryEnabled={safeSettings.memoryEnabled as "yes" | "no"}
      setMemoryEnabled={safeSettings.setMemoryEnabled as any}
      contextTurns={safeSettings.contextTurns}
      setContextTurns={safeSettings.setContextTurns}
      canSave={safeSettings.canSave}
      saving={safeSettings.saving}
      onSave={safeSettings.onSave}
      adoptId={adoptId}
    />
  );
}
