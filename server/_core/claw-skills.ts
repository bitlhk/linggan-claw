import express from "express";
import { createHash } from "crypto";
import { execSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync, readdirSync } from "fs";
import {
  APP_ROOT,
  requireClawOwner,
  resolveRuntimeAgentId,
  bumpSessionEpoch,
  clearAgentSessionsCache,
  sanitizeRelPath,
} from "./helpers";

export function registerSkillRoutes(app: express.Express) {
  app.post("/api/claw/skill-package/upload", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      const contentBase64 = String(body.contentBase64 || "").trim();

      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      if (!filename.toLowerCase().endsWith(".zip")) {
        res.status(400).json({ error: "only .zip allowed" });
        return;
      }
      if (!contentBase64) {
        res.status(400).json({ error: "contentBase64 required" });
        return;
      }

      const fileBuf = Buffer.from(contentBase64, "base64");
      const MAX_BYTES = 10 * 1024 * 1024;
      if (fileBuf.length <= 0 || fileBuf.length > MAX_BYTES) {
        res.status(400).json({ error: "file too large (max 10MB)" });
        return;
      }

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const qDir = `${APP_ROOT}/data/skill-packages/${adoptId}`;
      mkdirSync(qDir, { recursive: true });
      const ts = Date.now();
      const zipPath = `${qDir}/${ts}-${safeName}`;
      writeFileSync(zipPath, fileBuf);

      const sha256 = createHash("sha256").update(fileBuf).digest("hex");

      // ── Zip 安全扫描：纯 Node.js，不依赖 Python ──
      let result: { ok: boolean; errors: string[]; manifest: any; md_meta: { title: string; description: string } } = {
        ok: true, errors: [], manifest: {}, md_meta: { title: "", description: "" }
      };
      try {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();
        if (entries.length > 300) {
          result.ok = false; result.errors.push("too many entries");
        } else {
          for (const e of entries) {
            if (!sanitizeRelPath(e.entryName)) {
              result.ok = false; result.errors.push("path traversal"); break;
            }
          }
        }
        if (result.ok) {
          const mdEntry = entries.find((e: any) => e.entryName.toLowerCase().endsWith("skill.md"));
          if (mdEntry) {
            const txt = mdEntry.getData().toString("utf-8").slice(0, 8000);
            const mdLines = txt.split(/\r?\n/);
            let mi = 0;
            if (mdLines[0]?.trim() === "---") {
              mi = 1;
              while (mi < mdLines.length && mdLines[mi]?.trim() !== "---") mi++;
              if (mi < mdLines.length) mi++;
            }
            for (let j = mi; j < mdLines.length; j++) {
              const t = mdLines[j].trim();
              if (t.startsWith("#")) { result.md_meta.title = t.replace(/^#+\s*/, "").trim(); break; }
            }
            for (let j = mi; j < mdLines.length; j++) {
              const t = mdLines[j].trim();
              if (t && !t.startsWith("#") && !t.startsWith("---")) {
                result.md_meta.description = t.slice(0, 180); break;
              }
            }
          }
          const mfEntry = entries.find((e: any) => e.entryName.endsWith("manifest.json") || e.entryName.endsWith("skill.json"));
          if (mfEntry) {
            try { result.manifest = JSON.parse(mfEntry.getData().toString("utf-8")); } catch {}
          }
        }
      } catch (scanErr: any) {
        result.ok = false; result.errors.push(String(scanErr?.message || scanErr));
      }

      if (!result.ok) {
        res.status(400).json({ error: "invalid skill package", details: result.errors || [] });
        return;
      }

      // 写入 index.json
      const idxPathUpload = `${APP_ROOT}/data/skill-packages/index.json`;
      let idxRows: any[] = [];
      if (existsSync(idxPathUpload)) {
        const rawIdx = String(readFileSync(idxPathUpload, "utf-8") || "[]");
        try { idxRows = JSON.parse(rawIdx); } catch { idxRows = []; }
      }
      const mdMeta = result.md_meta || {};
      const displayName = String((result.manifest?.name || result.manifest?.title) || mdMeta.title || safeName.replace(/\.zip$/i, ""));
      const displayDescription = String(result.manifest?.description || mdMeta.description || "");
      idxRows.push({
        adoptId, filename: safeName, path: zipPath, sha256, size: fileBuf.length,
        manifest: result.manifest || {}, mdMeta,
        displayName, displayDescription,
        createdAt: new Date().toISOString()
      });
      writeFileSync(idxPathUpload, JSON.stringify(idxRows, null, 2), "utf-8");

      bumpSessionEpoch(adoptId);
      res.json({ ok: true, file: { filename: safeName, sha256, size: fileBuf.length }, manifest: result.manifest || {} });
    } catch (e) {
      console.error("[skill-package upload] failed", e);
      res.status(500).json({ error: "skill package upload failed" });
    }
  });

  app.get("/api/claw/skill-package/mine", async (req, res) => {
    try {
      const adoptId = String(req.query.adoptId || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;
      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let rows: any[] = [];
      if (existsSync(idxPath)) {
        const raw = String(readFileSync(idxPath, "utf-8") || "[]").trim();
        if (raw) rows = JSON.parse(raw);
      }
      rows = (Array.isArray(rows) ? rows : []).filter((x: any) => String(x?.adoptId||"") === adoptId);
      res.json({ items: rows });
    } catch (e) {
      console.error("[skill-package mine] failed", e);
      res.status(500).json({ error: "list mine packages failed" });
    }
  });

  app.post("/api/claw/skill-package/delete", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      const skillId = String(body.skillId || "").trim();
      const sha256 = String(body.sha256 || "").trim();
      if (!adoptId) {
        res.status(400).json({ error: "adoptId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let rows: any[] = [];
      if (existsSync(idxPath)) {
        const raw = String(readFileSync(idxPath, "utf-8") || "[]");
        try { rows = JSON.parse(raw); } catch { rows = []; }
      }

      const found = rows.find((x: any) =>
        String(x?.adoptId || "") === adoptId && (
          (filename && String(x?.filename || "") === filename) ||
          (skillId && String(x?.installedSkillId || "") === skillId) ||
          (sha256 && String(x?.sha256 || "") === sha256)
        )
      );

      if (!found) {
        res.status(404).json({ error: "package not found" });
        return;
      }

      const nextRows = rows.filter((x: any) => !(x === found));
      writeFileSync(idxPath, JSON.stringify(nextRows, null, 2), "utf-8");

      const path = String(found?.path || "").trim();
      if (path && existsSync(path)) rmSync(path, { force: true });

      // best-effort clean installed dir
      const sid = String(found?.installedSkillId || "").trim();
      if (sid) {
        const remoteHome = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
        const { getClawByAdoptId } = await import("../db");
        const claw = await getClawByAdoptId(adoptId).catch(() => null);
        if (claw?.agentId) {
          // runtimeAgentId 优先：与 chat-stream / install 保持一致
          const trialAgentId = `trial_${adoptId}`;
          const trialAgentDir = `${remoteHome}/.openclaw/agents/${trialAgentId}`;
          const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : claw.agentId;
          const skillsBase = `${remoteHome}/.openclaw/workspace-${runtimeAgentId}/skills`;

          // 1) 精确匹配
          const dir = `${skillsBase}/${sid}`;
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
          } else if (existsSync(skillsBase)) {
            // 2) fallback：查找包含 installedSkillId 关键词的子目录（防止命名漂移）
            try {
              const { readdirSync } = await import("fs");
              const candidates = readdirSync(skillsBase).filter(d => d.includes(sid) || sid.includes(d));
              for (const c of candidates) {
                const cDir = `${skillsBase}/${c}`;
                rmSync(cDir, { recursive: true, force: true });
              }
            } catch {}
          }
        }
      }

      // 清除 agent sessions 缓存，让下次对话自动感知技能变更
      if (sid) {
        const remoteHomeD = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
        const trialAgentIdD = `trial_${adoptId}`;
        const trialAgentDirD = `${remoteHomeD}/.openclaw/agents/${trialAgentIdD}`;
        const runtimeAgentIdD = existsSync(trialAgentDirD) ? trialAgentIdD : String(claw?.agentId || "");
        if (runtimeAgentIdD) clearAgentSessionsCache(runtimeAgentIdD, remoteHomeD);
      }
      bumpSessionEpoch(adoptId);
      res.json({ ok: true });
    } catch (e) {
      console.error("[skill-package delete] failed", e);
      res.status(500).json({ error: "delete package failed" });
    }
  });

  app.get("/api/claw/shared-packages", async (_req, res) => {
    try {
      const regPath = `${APP_ROOT}/data/shared-skill-registry.json`;
      let rows: any[] = [];
      if (existsSync(regPath)) {
        const raw = String(readFileSync(regPath, "utf-8") || "[]").trim();
        if (raw) rows = JSON.parse(raw);
      }
      res.json({ items: Array.isArray(rows) ? rows : [] });
    } catch (e) {
      console.error("[shared-packages] list failed", e);
      res.status(500).json({ error: "list shared packages failed" });
    }
  });

  app.post("/api/claw/skill-package/install", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      if (!adoptId || !filename) {
        res.status(400).json({ error: "adoptId and filename required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let rows: any[] = [];
      if (existsSync(idxPath)) {
        const raw = String(readFileSync(idxPath, "utf-8") || "[]");
        try { rows = JSON.parse(raw); } catch { rows = []; }
      }
      const found = rows.find((x: any) => String(x?.adoptId||"")===adoptId && String(x?.filename||"")===filename);
      if (!found) {
        res.status(404).json({ error: "package not found" });
        return;
      }
      const zipPath = String(found?.path || "").trim();
      if (!zipPath || !existsSync(zipPath)) {
        res.status(404).json({ error: "package file missing" });
        return;
      }


      const remoteHome = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
      // runtimeAgentId: prefer trial_{adoptId} if it exists, else fall back to db agentId
      const trialAgentIdInst = `trial_${adoptId}`;
      const trialAgentDirInst = `${remoteHome}/.openclaw/agents/${trialAgentIdInst}`;
      const runtimeAgentId = existsSync(trialAgentDirInst) ? trialAgentIdInst : String(claw.agentId || "");

      // skillId = zip 包内顶层目录名（原样，不做二次加工）
      // fallback：文件名去掉时间戳前缀和 .zip
      const py_probe = `import zipfile, json, re
with zipfile.ZipFile(${JSON.stringify(zipPath)}, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 tops=list({n.split('/')[0] for n in names if '/' in n})
 # 如果 zip 里有且只有一个顶层目录，用它作为 skillId
 if len(tops)==1:
  sid=tops[0].lower().strip()
 else:
  # fallback: filename 去掉时间戳(纯数字前缀)和 .zip
  raw=${JSON.stringify(filename.replace(/\.zip$/i, ""))}
  sid=re.sub(r'^[0-9]+-','',raw).lower()
 # 只保留合法字符
 sid=re.sub(r'[^a-z0-9-]+','-',sid).strip('-')[:48] or 'uploaded-skill'
 print(json.dumps({'skillId':sid}))`;
      const pyProbePath = `/tmp/claw_probe_${Date.now()}.py`;
      writeFileSync(pyProbePath, py_probe, "utf-8");
      let probeRaw = "";
      try {
        probeRaw = execSync(`python3 ${pyProbePath}`, { encoding: "utf-8", timeout: 5000 });
      } finally {
        try { rmSync(pyProbePath, { force: true }); } catch {}
      }
      const skillId: string = JSON.parse(probeRaw.trim())?.skillId || "uploaded-skill";

      const skillDir = `${remoteHome}/.openclaw/workspace-${claw.agentId}/skills/${skillId}`;

      const py = `import zipfile, os, json
zip_path=${JSON.stringify(zipPath)}
dst=${JSON.stringify(skillDir)}
os.makedirs(dst, exist_ok=True)
with zipfile.ZipFile(zip_path, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 for n in names:
  if n.startswith('/') or '..' in n:
   raise Exception('path traversal')
 prefix=''
 top={n.split('/')[0] for n in names if '/' in n}
 if len(top)==1:
  only=list(top)[0]
  if all(n.startswith(only + '/') for n in names):
   prefix=only + '/'
 for n in names:
  m=n[len(prefix):] if prefix and n.startswith(prefix) else n
  if not m:
   continue
  out=os.path.join(dst,m)
  os.makedirs(os.path.dirname(out), exist_ok=True)
  with z.open(n) as src, open(out,'wb') as fw:
   fw.write(src.read())
print(json.dumps({'ok':True}))`;
      const pyInstallPath = `/tmp/claw_install_${Date.now()}.py`;
      writeFileSync(pyInstallPath, py, "utf-8");
      try {
        execSync(`python3 ${pyInstallPath}`, { encoding: "utf-8", timeout: 12000 });
      } finally {
        try { rmSync(pyInstallPath, { force: true }); } catch {}
      }

      // 确保 SKILL.md 存在（zip 里已有则已解压；兜底写一个轻量版）
      const skillMdPath = `${skillDir}/SKILL.md`;
      if (!existsSync(skillMdPath)) {
        const title = String(found?.displayName || found?.manifest?.name || skillId).trim();
        let desc = String(found?.displayDescription || found?.manifest?.description || "uploaded skill").replace(/\s+/g, " ").trim().slice(0, 180);
        writeFileSync(skillMdPath,
          `---\nname: ${skillId}\ndescription: "${desc.replace(/"/g, "'")}"\n---\n\n# ${title}\n\n${desc}\n`,
          "utf-8"
        );
      }

      // 更新索引记录
      rows = rows.map((r: any) => {
        if (String(r?.adoptId||"")===adoptId && String(r?.filename||"")===filename) {
          return { ...r, installedSkillId: skillId, installedAt: new Date().toISOString() };
        }
        return r;
      });
      writeFileSync(idxPath, JSON.stringify(rows, null, 2), "utf-8");

      // 清除 agent sessions 缓存，让下次对话自动用新 session（含新技能快照）
      clearAgentSessionsCache(runtimeAgentId, remoteHome);
      bumpSessionEpoch(adoptId);

      res.json({ ok: true, skillId, path: skillDir });
    } catch (e) {
      console.error("[skill-package install] failed", e);
      res.status(500).json({ error: "install package failed" });
    }
  });

  app.post("/api/claw/skill-package/publish", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const filename = String(body.filename || "").trim();
      const title = String(body.title || filename || "").trim();
      const desc = String(body.description || "").trim();
      const homepage = String(body.homepage || "").trim();
      if (!adoptId || !filename) {
        res.status(400).json({ error: "adoptId and filename required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let idx: any[] = [];
      if (existsSync(idxPath)) {
        const raw = String(readFileSync(idxPath, "utf-8") || "[]");
        try { idx = JSON.parse(raw); } catch { idx = []; }
      }
      const found = idx.find((x: any) => String(x?.adoptId||"")===adoptId && String(x?.filename||"")===filename);
      if (!found) {
        res.status(404).json({ error: "package not found" });
        return;
      }

      const regPath = `${APP_ROOT}/data/shared-skill-registry.json`;
      let rows: any[] = [];
      if (existsSync(regPath)) {
        const raw = String(readFileSync(regPath, "utf-8") || "[]");
        try { rows = JSON.parse(raw); } catch { rows = []; }
      }

      const id = `shared-${found.sha256?.slice(0,10) || Date.now()}`;
      const row = {
        id,
        title: title || filename,
        description: desc || found?.manifest?.description || "",
        homepage,
        filename,
        fromAdoptId: adoptId,
        version: found?.manifest?.version || "0.1.0",
        manifest: found?.manifest || {},
        createdAt: new Date().toISOString(),
      };
      rows = rows.filter((r: any) => r.id !== id);
      rows.push(row);
      mkdirSync(`${APP_ROOT}/data`, { recursive: true });
      writeFileSync(regPath, JSON.stringify(rows, null, 2), 'utf-8');

      res.json({ ok: true, item: row });
    } catch (e) {
      console.error("[shared-packages] publish failed", e);
      res.status(500).json({ error: "publish shared package failed" });
    }
  });

  // ── 技能市场：从市场安装技能到个人空间 ──────────────────────────
  app.post("/api/claw/skill-market/install", async (req, res) => {
    try {
      const body = (req.body || {}) as any;
      const adoptId = String(body.adoptId || "").trim();
      const marketItemId = String(body.marketItemId || "").trim();
      if (!adoptId || !marketItemId) {
        res.status(400).json({ error: "adoptId and marketItemId required" });
        return;
      }
      const claw = await requireClawOwner(req, res, adoptId);
      if (!claw) return;

      // 1. find market item from registry
      const regPath = `${APP_ROOT}/data/shared-skill-registry.json`;
      let registry: any[] = [];
      if (existsSync(regPath)) {
        try { registry = JSON.parse(String(readFileSync(regPath, "utf-8") || "[]")); } catch { registry = []; }
      }
      const marketItem = registry.find((r: any) => String(r?.id || "") === marketItemId);
      if (!marketItem) {
        res.status(404).json({ error: "market item not found" });
        return;
      }

      // 2. find source package zip from publisher
      const idxPath = `${APP_ROOT}/data/skill-packages/index.json`;
      let allPkgs: any[] = [];
      if (existsSync(idxPath)) {
        try { allPkgs = JSON.parse(String(readFileSync(idxPath, "utf-8") || "[]")); } catch { allPkgs = []; }
      }
      const srcPkg = allPkgs.find((x: any) =>
        String(x?.adoptId || "") === String(marketItem.fromAdoptId || "") &&
        String(x?.filename || "") === String(marketItem.filename || "")
      );
      if (!srcPkg || !srcPkg.path || !existsSync(srcPkg.path)) {
        res.status(404).json({ error: "source package file not found" });
        return;
      }

      // 3. copy zip to current user's package dir
      const userPkgDir = `${APP_ROOT}/data/skill-packages/${adoptId}`;
      mkdirSync(userPkgDir, { recursive: true });
      const srcFilename = String(marketItem.filename || "market-skill.zip");
      const newFilename = `${Date.now()}-${srcFilename}`;
      const dstZipPath = `${userPkgDir}/${newFilename}`;
      copyFileSync(srcPkg.path, dstZipPath);

      // 4. probe skillId + unzip to workspace (same as install API)
      const remoteHome = process.env.CLAW_REMOTE_OPENCLAW_HOME || "/root";
      const trialAgentId = `trial_${adoptId}`;
      const trialAgentDir = `${remoteHome}/.openclaw/agents/${trialAgentId}`;
      const runtimeAgentId = existsSync(trialAgentDir) ? trialAgentId : String(claw.agentId || "");

      const pyProbe = `import zipfile, json, re
with zipfile.ZipFile(${JSON.stringify(dstZipPath)}, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 tops=list({n.split('/')[0] for n in names if '/' in n})
 if len(tops)==1:
  sid=tops[0].lower().strip()
 else:
  raw=${JSON.stringify(srcFilename.replace(/\.zip$/i, ""))}
  sid=re.sub(r'^[0-9]+-','',raw).lower()
 sid=re.sub(r'[^a-z0-9-]+','-',sid).strip('-')[:48] or 'market-skill'
 print(json.dumps({'skillId':sid}))`;
      const pyProbePath = `/tmp/claw_mkt_probe_${Date.now()}.py`;
      writeFileSync(pyProbePath, pyProbe, "utf-8");
      let probeRaw = "";
      try {
        probeRaw = execSync(`python3 ${pyProbePath}`, { encoding: "utf-8", timeout: 5000 });
      } finally {
        try { rmSync(pyProbePath, { force: true }); } catch {}
      }
      const skillId: string = JSON.parse(probeRaw.trim())?.skillId || "market-skill";

      const skillDir = `${remoteHome}/.openclaw/workspace-${runtimeAgentId}/skills/${skillId}`;
      const pyInstall = `import zipfile, os, json
zip_path=${JSON.stringify(dstZipPath)}
dst=${JSON.stringify(skillDir)}
os.makedirs(dst, exist_ok=True)
with zipfile.ZipFile(zip_path, 'r') as z:
 names=[n for n in z.namelist() if n and not n.endswith('/')]
 for n in names:
  if n.startswith('/') or '..' in n:
   raise Exception('path traversal')
 prefix=''
 top={n.split('/')[0] for n in names if '/' in n}
 if len(top)==1:
  only=list(top)[0]
  if all(n.startswith(only + '/') for n in names):
   prefix=only + '/'
 for n in names:
  m=n[len(prefix):] if prefix and n.startswith(prefix) else n
  if not m:
   continue
  out=os.path.join(dst,m)
  os.makedirs(os.path.dirname(out), exist_ok=True)
  with z.open(n) as src, open(out,'wb') as fw:
   fw.write(src.read())
print(json.dumps({'ok':True}))`;
      const pyInstallPath = `/tmp/claw_mkt_install_${Date.now()}.py`;
      writeFileSync(pyInstallPath, pyInstall, "utf-8");
      try {
        execSync(`python3 ${pyInstallPath}`, { encoding: "utf-8", timeout: 12000 });
      } finally {
        try { rmSync(pyInstallPath, { force: true }); } catch {}
      }

      // ensure SKILL.md exists
      const skillMdPath = `${skillDir}/SKILL.md`;
      if (!existsSync(skillMdPath)) {
        const title = String(marketItem.title || skillId).trim();
        const desc = String(marketItem.description || "from skill market").replace(/\s+/g, " ").trim().slice(0, 180);
        writeFileSync(skillMdPath,
          `---\nname: ${skillId}\ndescription: "${desc.replace(/"/g, "'")}"\n---\n\n# ${title}\n\n${desc}\n`,
          "utf-8"
        );
      }

      // 5. register in package index
      const newEntry = {
        adoptId,
        filename: newFilename,
        path: dstZipPath,
        sha256: srcPkg.sha256 || "",
        size: srcPkg.size || 0,
        manifest: srcPkg.manifest || {},
        mdMeta: srcPkg.mdMeta || {},
        displayName: marketItem.title || srcPkg.displayName || srcFilename,
        displayDescription: marketItem.description || srcPkg.displayDescription || "",
        createdAt: new Date().toISOString(),
        installedSkillId: skillId,
        installedAt: new Date().toISOString(),
        fromMarket: marketItemId,
      };
      allPkgs.push(newEntry);
      writeFileSync(idxPath, JSON.stringify(allPkgs, null, 2), "utf-8");

      // 6. update market install count
      const updatedRegistry = registry.map((r: any) => {
        if (String(r?.id || "") === marketItemId) {
          return { ...r, installCount: (r.installCount || 0) + 1 };
        }
        return r;
      });
      writeFileSync(regPath, JSON.stringify(updatedRegistry, null, 2), "utf-8");

      // 7. clear cache + bump epoch
      clearAgentSessionsCache(runtimeAgentId, remoteHome);
      bumpSessionEpoch(adoptId);

      res.json({ ok: true, skillId, marketItemId, path: skillDir });
    } catch (e) {
      console.error("[skill-market install] failed", e);
      res.status(500).json({ error: "install from market failed" });
    }
  });
}
