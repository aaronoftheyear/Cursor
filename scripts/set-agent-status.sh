#!/usr/bin/env bash
#
# Set external agent status for the AI Agent Dashboard.
# Usage: ./scripts/set-agent-status.sh <agent-id> <status> [detail]
#
# Arguments:
#   agent-id  - The agent identifier (e.g. grokbot, gemini, apple-intelligence)
#   status    - One of: idle, working, thinking, busy
#   detail    - Optional short description (e.g. "Researching Twitter trends")
#
# Examples:
#   ./scripts/set-agent-status.sh grokbot working "Searching Twitter"
#   ./scripts/set-agent-status.sh grokbot idle
#   ./scripts/set-agent-status.sh grokbot thinking "Processing query..."
#
# The status persists until overwritten or it expires (2 minutes of no updates
# causes automatic fallback to idle).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STATUS_FILE="$PROJECT_ROOT/.dashboard/external-agents.json"

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <agent-id> <status> [detail]" >&2
  echo "  status: idle | working | thinking | busy" >&2
  exit 1
fi

AGENT_ID="$1"
STATUS="$2"
DETAIL="${3:-}"

# Validate status
case "$STATUS" in
  idle|working|thinking|busy) ;;
  *)
    echo "Error: status must be one of: idle, working, thinking, busy" >&2
    exit 1
    ;;
esac

# Ensure directory exists
mkdir -p "$(dirname "$STATUS_FILE")"

# Get current timestamp in ISO format
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Read existing file or start fresh
if [[ -f "$STATUS_FILE" ]]; then
  EXISTING=$(cat "$STATUS_FILE")
else
  EXISTING='{"agents":{}}'
fi

# Use Python to merge JSON (available on macOS)
python3 - "$EXISTING" "$AGENT_ID" "$STATUS" "$DETAIL" "$TIMESTAMP" "$STATUS_FILE" << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
agent_id = sys.argv[2]
status = sys.argv[3]
detail = sys.argv[4]
timestamp = sys.argv[5]
output_file = sys.argv[6]

try:
    data = json.loads(existing_json)
except json.JSONDecodeError:
    data = {"agents": {}}

if "agents" not in data:
    data["agents"] = {}

data["agents"][agent_id] = {
    "status": status,
    "detail": detail if detail else None,
    "source": "external",
    "updatedAt": timestamp
}

with open(output_file, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

print(f"✓ Set {agent_id} to {status}" + (f": {detail}" if detail else ""))
PYTHON_SCRIPT
