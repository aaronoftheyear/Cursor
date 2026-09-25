#!/usr/bin/env bash
#
# Set external agent status for the AI Agent Dashboard.
# Uses the same activity vocabulary as Cursor hooks so agents walk to matching action spots.
#
# Usage: ./scripts/set-agent-status.sh <agent-id> <status> [options]
#
# Arguments:
#   agent-id    The agent identifier (e.g. grokbot, gemini, apple-intelligence)
#   status      One of: idle, working, busy
#
# Options:
#   -a, --activity <activity>   Activity type (required when status is working/busy)
#   -d, --depth <depth>         Activity depth: brief (stay at desk) or deep (walk to spot)
#   -m, --message <text>        Detail message shown in sidebar
#   -h, --help                  Show this help message
#
# Activities (same as Cursor hooks):
#   planning    Planning, architecting, designing (walks to planning board when deep)
#   thinking    Thinking, reasoning, processing
#   reading     Reading files, documentation, research (walks to bookshelf when deep)
#   editing     Editing files, coding
#   running     Running shell commands, executing tasks
#
# Depth:
#   brief       Stay at computer/desk (default)
#   deep        Walk to activity-specific spot (planning board, bookshelf, etc.)
#
# Examples:
#   # Grok is researching Twitter (stays at computer)
#   ./scripts/set-agent-status.sh grokbot working -a reading -m "Searching Twitter trends"
#
#   # Grok is deeply thinking (walks to thinking spot)
#   ./scripts/set-agent-status.sh grokbot working -a thinking -d deep
#
#   # Grok is running a command
#   ./scripts/set-agent-status.sh grokbot working -a running -m "Fetching API data"
#
#   # Grok is idle
#   ./scripts/set-agent-status.sh grokbot idle
#
# The status persists until overwritten or it expires (2 minutes of no updates
# causes automatic fallback to idle).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STATUS_FILE="$PROJECT_ROOT/.dashboard/external-agents.json"

# Valid values (must match src/liveStatus.ts)
VALID_STATUSES="idle working busy"
VALID_ACTIVITIES="planning thinking reading editing running"
VALID_DEPTHS="brief deep"

show_help() {
  cat << 'EOF'
Set external agent status for the AI Agent Dashboard.
Uses the same activity vocabulary as Cursor hooks so agents walk to matching action spots.

Usage: ./scripts/set-agent-status.sh <agent-id> <status> [options]

Arguments:
  agent-id    The agent identifier (e.g. grokbot, gemini, apple-intelligence)
  status      One of: idle, working, busy

Options:
  -a, --activity <activity>   Activity type (required when status is working/busy)
  -d, --depth <depth>         Activity depth: brief or deep (default: brief)
  -m, --message <text>        Detail message shown in sidebar
  -h, --help                  Show this help message

Activities (same as Cursor hooks, mapped to action spots):
  planning    Planning, architecting, designing
              → brief: stays at computer
              → deep: walks to planning board / whiteboard

  thinking    Thinking, reasoning, processing
              → brief: stays at computer
              → deep: walks to thinking spot

  reading     Reading files, documentation, research
              → brief: stays at computer
              → deep: walks to bookshelf / research area

  editing     Editing files, coding
              → always stays at computer

  running     Running shell commands, executing tasks
              → always stays at computer

Depth:
  brief       Stay at computer/desk (default)
  deep        Walk to activity-specific spot (planning board, bookshelf, etc.)

Examples:
  # Grok is researching Twitter (stays at computer)
  ./scripts/set-agent-status.sh grokbot working -a reading -m "Searching Twitter trends"

  # Grok is deeply thinking (walks to thinking spot)
  ./scripts/set-agent-status.sh grokbot working -a thinking -d deep

  # Grok is running a command
  ./scripts/set-agent-status.sh grokbot working -a running -m "Fetching API data"

  # Grok is planning something
  ./scripts/set-agent-status.sh grokbot working -a planning -d deep -m "Designing workflow"

  # Grok is idle
  ./scripts/set-agent-status.sh grokbot idle

Note: Status expires after 2 minutes of no updates (falls back to idle).
EOF
}

die() {
  echo "Error: $1" >&2
  echo "Run with --help for usage." >&2
  exit 1
}

validate_in_list() {
  local value="$1"
  local list="$2"
  local name="$3"
  for valid in $list; do
    if [[ "$value" == "$valid" ]]; then
      return 0
    fi
  done
  die "$name must be one of: $list (got: $value)"
}

# Parse arguments
if [[ $# -lt 1 ]]; then
  show_help
  exit 0
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  show_help
  exit 0
fi

if [[ $# -lt 2 ]]; then
  die "Missing required arguments: agent-id and status"
fi

AGENT_ID="$1"
STATUS="$2"
shift 2

ACTIVITY=""
DEPTH="brief"
MESSAGE=""

# Parse options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--activity)
      [[ $# -lt 2 ]] && die "--activity requires an argument"
      ACTIVITY="$2"
      shift 2
      ;;
    -d|--depth)
      [[ $# -lt 2 ]] && die "--depth requires an argument"
      DEPTH="$2"
      shift 2
      ;;
    -m|--message)
      [[ $# -lt 2 ]] && die "--message requires an argument"
      MESSAGE="$2"
      shift 2
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

# Validate status
validate_in_list "$STATUS" "$VALID_STATUSES" "status"

# Validate activity (required for working/busy)
if [[ "$STATUS" == "working" || "$STATUS" == "busy" ]]; then
  if [[ -z "$ACTIVITY" ]]; then
    echo "Error: Activity is required when status is working/busy. Use -a <activity>" >&2
    echo "Allowed activities: $VALID_ACTIVITIES" >&2
    exit 1
  fi
  validate_in_list "$ACTIVITY" "$VALID_ACTIVITIES" "activity"
fi

# Validate depth
validate_in_list "$DEPTH" "$VALID_DEPTHS" "depth"

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
python3 - "$EXISTING" "$AGENT_ID" "$STATUS" "$ACTIVITY" "$DEPTH" "$MESSAGE" "$TIMESTAMP" "$STATUS_FILE" << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
agent_id = sys.argv[2]
status = sys.argv[3]
activity = sys.argv[4] if sys.argv[4] else None
depth = sys.argv[5]
message = sys.argv[6] if sys.argv[6] else None
timestamp = sys.argv[7]
output_file = sys.argv[8]

try:
    data = json.loads(existing_json)
except json.JSONDecodeError:
    data = {"agents": {}}

if "agents" not in data:
    data["agents"] = {}

entry = {
    "status": status,
    "source": "external",
    "updatedAt": timestamp
}

if message:
    entry["detail"] = message

if activity:
    entry["activity"] = activity
    entry["activityDepth"] = depth

data["agents"][agent_id] = entry

with open(output_file, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

# Build output message
parts = [f"✓ Set {agent_id} to {status}"]
if activity:
    parts.append(f"({activity}, {depth})")
if message:
    parts.append(f": {message}")
print(" ".join(parts))
PYTHON_SCRIPT
