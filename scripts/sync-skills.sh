#!/usr/bin/env bash
set -euo pipefail

SHARED_SKILLS_DIR="/root/.openclaw/skills-shared"
WORKSPACE_ROOT="/root/.openclaw"

cd /root/linggan-platform

# 用 node 查数据库
agents=$(node -e '
const mysql = require("mysql2/promise");
(async () => {
  const conn = await mysql.createConnection("mysql://root:REDACTED@REDACTED_HOST:3306/finance_ai");
  const [rows] = await conn.execute("SELECT agentId FROM claw_adoptions WHERE status = \"active\"");
  rows.forEach(r => console.log(r.agentId));
  await conn.end();
})();
')

if [[ -z "$agents" ]]; then
  echo "No active agents found"
  exit 0
fi

echo "Syncing skills for active agents..."
for agent in $agents; do
  userSkillsDir="$WORKSPACE_ROOT/workspace-$agent/skills"
  mkdir -p "$userSkillsDir"
  
  for skill in $SHARED_SKILLS_DIR/*/; do
    skillName=$(basename "$skill")
    ln -sfn "$skill" "$userSkillsDir/$skillName" 2>/dev/null && echo "  [$agent] linked: $skillName" || echo "  [$agent] failed: $skillName"
  done
done

echo "Done!"