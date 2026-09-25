#!/usr/bin/env bash
#
# Set external agent status for the AI Agent Dashboard.
# Uses the same activity vocabulary as Cursor hooks so agents walk to matching action spots.
#
# Usage: ./scripts/set-agent-status.sh <agent-id> <status> [options]
#
# Arguments:
#   agent-id    The agent identifier (e.g. metabee, grokbot, gemini, apple-intelligence)
#   status      One of: idle, working, busy
#
# Options:
#   -a, --activity <activity>   Activity type (required when status is working/busy)
#   -d, --depth <depth>         Activity depth: brief (stay at desk) or deep (walk to spot)
#   -m, --message <text>        Detail message shown in sidebar
#   -t, --ttl <duration>        Time-to-live before auto-expiring to idle (default: 2m, max: 2h)
#                               Formats: 120 (seconds), 5m (minutes), 1h (hours)
#   --waiting-on <bc-id|name>   Cloud agent ID (bc-...) or name to wait on.
#                               Status auto-clears when that cloud agent finishes.
#                               Implies activity='waiting' if not set.
#   -h, --help                  Show this help message
#
# Activities (same as Cursor hooks):
#   planning      Planning, architecting, designing (walks to planning board when deep)
#   thinking      Thinking, reasoning, processing
#   reading       Reading files, documentation
#   editing       Editing files, coding
#   running       Running shell commands, executing tasks
#   researching   Web research, searching online (walks to research spot when deep)
#   github        GitHub operations, git push/pull/fetch/clone, gh CLI
#   waiting       Waiting for another agent or process
#
# Depth:
#   brief       Stay at computer/desk (default)
#   deep        Walk to activity-specific spot (planning board, bookshelf, etc.)
#
# Examples:
#   # Grok is reading documentation (stays at computer)
#   ./scripts/set-agent-status.sh grokbot working -a reading -m "Reading docs"
#
#   # Grok is researching online (walks to research spot)
#   ./scripts/set-agent-status.sh grokbot working -a researching -d deep -m "Searching Twitter"
#
#   # Grok is using GitHub (walks to GitHub spot)
#   ./scripts/set-agent-status.sh grokbot working -a github -d deep -m "Pushing changes"
#
#   # Metabee is waiting on a cloud agent (with 1 hour TTL)
#   ./scripts/set-agent-status.sh metabee working -a waiting --waiting-on "bc-abc123" -t 1h -m "Waiting on cloud agent"
#
#   # Metabee is waiting (auto-clears when cloud agent "Connect Claude Code" finishes)
#   ./scripts/set-agent-status.sh metabee working --waiting-on "Connect Claude Code" -t 1h
#
#   # Grok is idle
#   ./scripts/set-agent-status.sh grokbot idle
#
# The status persists until overwritten or it expires (2 minutes of no updates
# causes automatic fallback to idle, or custom TTL if specified).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
STATUS_FILE="$PROJECT_ROOT/.dashboard/external-agents.json"

# Valid values (must match src/liveStatus.ts)
VALID_STATUSES="idle working busy"
VALID_ACTIVITIES="planning thinking reading editing running researching github waiting"
VALID_DEPTHS="brief deep"

# TTL defaults and limits
DEFAULT_TTL_SECONDS=120  # 2 minutes
MAX_TTL_SECONDS=7200     # 2 hours

# Parse duration string to seconds (e.g., 120, 5m, 1h, 2h30m)
parse_duration() {
  local input="$1"
  local total=0
  
  # Pure number = seconds
  if [[ "$input" =~ ^[0-9]+$ ]]; then
    echo "$input"
    return 0
  fi
  
  # Parse hours (h), minutes (m), seconds (s)
  local remaining="$input"
  
  # Extract hours
  if [[ "$remaining" =~ ([0-9]+)h ]]; then
    total=$((total + ${BASH_REMATCH[1]} * 3600))
    remaining="${remaining//${BASH_REMATCH[0]}/}"
  fi
  
  # Extract minutes
  if [[ "$remaining" =~ ([0-9]+)m ]]; then
    total=$((total + ${BASH_REMATCH[1]} * 60))
    remaining="${remaining//${BASH_REMATCH[0]}/}"
  fi
  
  # Extract seconds
  if [[ "$remaining" =~ ([0-9]+)s ]]; then
    total=$((total + ${BASH_REMATCH[1]}))
    remaining="${remaining//${BASH_REMATCH[0]}/}"
  fi
  
  # Check for leftover invalid characters
  remaining="${remaining//[[:space:]]/}"
  if [[ -n "$remaining" ]]; then
    echo "0"  # Invalid format
    return 1
  fi
  
  echo "$total"
  return 0
}

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
  -t, --ttl <duration>        Time-to-live before auto-expiring to idle
                              Default: 2m, Max: 2h
                              Formats: 120 (seconds), 5m, 1h, 2h30m
  --waiting-on <bc-id|name>   Cloud agent ID (bc-...) or name to wait on.
                              Status auto-clears when that agent finishes.
                              Implies activity='waiting' if not set.
  -h, --help                  Show this help message

Activities (same as Cursor hooks, mapped to action spots):
  planning      Planning, architecting, designing
                → brief: stays at computer
                → deep: walks to planning board / whiteboard

  thinking      Thinking, reasoning, processing
                → brief: stays at computer
                → deep: walks to thinking spot

  reading       Reading files, documentation
                → brief: stays at computer
                → deep: walks to bookshelf / research area

  editing       Editing files, coding
                → always stays at computer

  running       Running shell commands, executing tasks
                → always stays at computer

  researching   Web research, searching online (web fetch/search)
                → brief: stays at computer
                → deep: walks to research TV / research spot

  github        GitHub operations (gh CLI, git push/pull/fetch/clone)
                → brief: stays at computer
                → deep: walks to GitHub spot

  waiting       Waiting for another agent or process
                → always stays at computer

Depth:
  brief       Stay at computer/desk (default)
  deep        Walk to activity-specific spot (planning board, bookshelf, etc.)

Examples:
  # Grok is reading files (stays at computer)
  ./scripts/set-agent-status.sh grokbot working -a reading -m "Reading documentation"

  # Grok is researching online (walks to research spot)
  ./scripts/set-agent-status.sh grokbot working -a researching -d deep -m "Searching Twitter trends"

  # Grok is deeply thinking (walks to thinking spot)
  ./scripts/set-agent-status.sh grokbot working -a thinking -d deep

  # Grok is running a command
  ./scripts/set-agent-status.sh grokbot working -a running -m "Fetching API data"

  # Grok is using GitHub (walks to GitHub spot)
  ./scripts/set-agent-status.sh grokbot working -a github -d deep -m "Pushing to repo"

  # Grok is planning something
  ./scripts/set-agent-status.sh grokbot working -a planning -d deep -m "Designing workflow"

  # Metabee is waiting on a cloud agent (with 1 hour TTL)
  ./scripts/set-agent-status.sh metabee working -a waiting --waiting-on "bc-abc123" -t 1h -m "Waiting on FRIDAY"

  # Metabee waiting (auto-clears when cloud agent "Connect Claude Code" finishes)
  ./scripts/set-agent-status.sh metabee working --waiting-on "Connect Claude Code" -t 1h

  # Custom TTL of 30 minutes
  ./scripts/set-agent-status.sh grokbot working -a running -t 30m -m "Running long process"

  # Grok is idle
  ./scripts/set-agent-status.sh grokbot idle

Note: Status expires after TTL (default 2 minutes, max 2 hours). When --waiting-on
      is set, status also auto-clears when the referenced cloud agent finishes.
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
TTL_SECONDS=""
WAITING_ON=""

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
    -t|--ttl)
      [[ $# -lt 2 ]] && die "--ttl requires an argument"
      TTL_SECONDS=$(parse_duration "$2")
      if [[ "$TTL_SECONDS" == "0" && "$2" != "0" ]]; then
        die "Invalid TTL format: $2 (use seconds, 5m, 1h, or 2h30m)"
      fi
      if [[ "$TTL_SECONDS" -gt "$MAX_TTL_SECONDS" ]]; then
        die "TTL exceeds maximum of 2 hours (7200 seconds): $2"
      fi
      shift 2
      ;;
    --waiting-on)
      [[ $# -lt 2 ]] && die "--waiting-on requires an argument"
      WAITING_ON="$2"
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

# If --waiting-on is set, default activity to 'waiting' and status to 'working'
if [[ -n "$WAITING_ON" ]]; then
  if [[ -z "$ACTIVITY" ]]; then
    ACTIVITY="waiting"
  fi
  if [[ "$STATUS" == "idle" ]]; then
    STATUS="working"
  fi
fi

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

# Set default TTL if not specified
if [[ -z "$TTL_SECONDS" ]]; then
  TTL_SECONDS="$DEFAULT_TTL_SECONDS"
fi

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
python3 - "$EXISTING" "$AGENT_ID" "$STATUS" "$ACTIVITY" "$DEPTH" "$MESSAGE" "$TIMESTAMP" "$STATUS_FILE" "$TTL_SECONDS" "$WAITING_ON" << 'PYTHON_SCRIPT'
import json
import sys
from datetime import datetime, timezone, timedelta

existing_json = sys.argv[1]
agent_id = sys.argv[2]
status = sys.argv[3]
activity = sys.argv[4] if sys.argv[4] else None
depth = sys.argv[5]
message = sys.argv[6] if sys.argv[6] else None
timestamp = sys.argv[7]
output_file = sys.argv[8]
ttl_seconds = int(sys.argv[9]) if sys.argv[9] else 120
waiting_on = sys.argv[10] if len(sys.argv) > 10 and sys.argv[10] else None

try:
    data = json.loads(existing_json)
except json.JSONDecodeError:
    data = {"agents": {}}

if "agents" not in data:
    data["agents"] = {}

# Calculate expiry time
now = datetime.now(timezone.utc)
expires_at = now + timedelta(seconds=ttl_seconds)

entry = {
    "status": status,
    "source": "external",
    "updatedAt": timestamp,
    "ttlSeconds": ttl_seconds,
    "expiresAt": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ")
}

if message:
    entry["detail"] = message

if activity:
    entry["activity"] = activity
    entry["activityDepth"] = depth

if waiting_on:
    entry["waitingOn"] = waiting_on

data["agents"][agent_id] = entry

with open(output_file, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")

# Build output message
parts = [f"✓ Set {agent_id} to {status}"]
if activity:
    parts.append(f"({activity}, {depth})")
if waiting_on:
    parts.append(f"[waiting on: {waiting_on}]")
if ttl_seconds != 120:
    parts.append(f"[TTL: {ttl_seconds}s]")
if message:
    parts.append(f": {message}")
print(" ".join(parts))
PYTHON_SCRIPT
