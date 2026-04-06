#!/bin/bash
# Voltron Docker launcher — starts Claude Code with full agent autonomy
# Usage: ./scripts/voltron-run.sh
#        ./scripts/voltron-run.sh -p "invoke @agent-scrum-master to plan the backlog"

docker build -t voltron-agent -f Dockerfile.voltron . 2>/dev/null
docker run --rm -it \
  ${CLAUDE_CODE_OAUTH_TOKEN:+-e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN"} \
  ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
  -v "$(pwd):/workspace" \
  -v "$HOME/.claude:/home/voltron/.claude" \
  -v "$HOME/.claude.json:/home/voltron/.claude.json:ro" \
  voltron-agent \
  --dangerously-skip-permissions \
  "$@"
