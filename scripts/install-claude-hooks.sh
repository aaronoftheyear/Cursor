#!/usr/bin/env bash
#
# Install Claude Code hooks for AI Agent Dashboard integration.
#
# This script configures Claude Code to send status updates to the Dashboard
# by merging hook configuration into ~/.claude/settings.json.
#
# Usage:
#   ./scripts/install-claude-hooks.sh [options]
#
# Options:
#   --uninstall    Remove the dashboard hooks from Claude Code settings
#   --check        Check if hooks are installed (exit 0 if yes, 1 if no)
#   --dry-run      Show what would be done without making changes
#   -h, --help     Show this help message
#
# The hook script forwards Claude Code events to the Dashboard's status
# pipeline, enabling real-time activity updates for the claude-code avatar.
#
# Note: Hooks fire in both the Claude Code CLI and the Claude Desktop app
# (only cloud sessions skip ~/.claude/settings.json).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOK_SCRIPT="$PROJECT_ROOT/.cursor/hooks/claude-code-hook.cjs"
CLAUDE_SETTINGS="${CLAUDE_SETTINGS_PATH:-$HOME/.claude/settings.json}"

# Marker to identify our hook group
HOOK_MARKER="dashboard-status-hook"

show_help() {
  cat << 'EOF'
Install Claude Code hooks for AI Agent Dashboard integration.

This script configures Claude Code to send status updates to the Dashboard
by adding hook configuration to ~/.claude/settings.json.

Usage:
  ./scripts/install-claude-hooks.sh [options]

Options:
  --uninstall    Remove the dashboard hooks from Claude Code settings
  --check        Check if hooks are installed (exit 0 if yes, 1 if no)
  --dry-run      Show what would be done without making changes
  -h, --help     Show this help message

Requirements:
  - Claude Code CLI must be installed (~/.claude must exist)
  - Node.js must be installed (for running the hook script)
  - Python 3 must be installed (for JSON manipulation)

The hook integrates these Claude Code events with the Dashboard:
  SessionStart     → Avatar starts working
  UserPromptSubmit → Avatar is thinking
  PreToolUse       → Avatar activity based on tool (read/edit/run/etc)
  PostToolUse      → Avatar activity update
  Stop             → Avatar goes idle
  SessionEnd       → Session cleanup

Note: Hooks fire in both the Claude Code CLI and the Claude Desktop app.

Examples:
  # Install hooks
  ./scripts/install-claude-hooks.sh

  # Check if installed
  ./scripts/install-claude-hooks.sh --check && echo "Installed"

  # Preview changes
  ./scripts/install-claude-hooks.sh --dry-run

  # Remove hooks
  ./scripts/install-claude-hooks.sh --uninstall
EOF
}

die() {
  echo "Error: $1" >&2
  exit 1
}

# Find node executable robustly (handles nvm, fnm, volta, etc.)
find_node() {
  local node_paths=(
    "$(command -v node 2>/dev/null || true)"
    "$HOME/.nvm/current/bin/node"
    "$HOME/.fnm/current/bin/node"
    "$HOME/.volta/bin/node"
    "/usr/local/bin/node"
    "/opt/homebrew/bin/node"
  )
  
  for node_path in "${node_paths[@]}"; do
    if [[ -n "$node_path" && -x "$node_path" ]]; then
      echo "$node_path"
      return 0
    fi
  done
  
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh" 2>/dev/null
    local nvm_node
    nvm_node="$(command -v node 2>/dev/null || true)"
    if [[ -n "$nvm_node" && -x "$nvm_node" ]]; then
      echo "$nvm_node"
      return 0
    fi
  fi
  
  return 1
}

check_prerequisites() {
  local claude_dir
  claude_dir="$(dirname "$CLAUDE_SETTINGS")"
  if [[ ! -d "$claude_dir" ]]; then
    die "Claude Code not found ($claude_dir directory missing).
Install Claude Code first: https://claude.ai/code"
  fi

  if [[ ! -f "$HOOK_SCRIPT" ]]; then
    die "Hook script not found: $HOOK_SCRIPT
Make sure you're running from the Dashboard repository."
  fi

  if ! command -v python3 &>/dev/null; then
    die "Python 3 not found. Install Python 3 to use this installer."
  fi

  if ! find_node &>/dev/null; then
    die "Node.js not found. Install Node.js to use Claude Code hooks.
If using nvm, make sure to run 'nvm use' first or set a default version."
  fi
}

# Generate unique backup filename
make_backup_name() {
  local base="$1"
  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)_$$_${RANDOM}"
  echo "${base}.backup.${timestamp}"
}

# Parse arguments
DRY_RUN=false
ACTION="install"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall)
      ACTION="uninstall"
      shift
      ;;
    --check)
      ACTION="check"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
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

# Execute action
case "$ACTION" in
  check)
    if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
      echo "✗ Claude Code hooks are not installed"
      exit 1
    fi
    
    # Check if our hook is installed
    python3 - "$CLAUDE_SETTINGS" "$HOOK_SCRIPT" << 'PYTHON_CHECK'
import json
import sys

settings_path = sys.argv[1]
hook_script = sys.argv[2]

try:
    with open(settings_path) as f:
        data = json.load(f)
except (json.JSONDecodeError, OSError, IOError):
    sys.exit(1)

hooks = data.get("hooks", {})
if not isinstance(hooks, dict):
    sys.exit(1)

# Claude Code hooks are lists of groups: "Event": [ {matcher, hooks}, {matcher, hooks}, ... ]
for event_groups in hooks.values():
    if not isinstance(event_groups, list):
        continue
    for group in event_groups:
        if not isinstance(group, dict):
            continue
        group_hooks = group.get("hooks", [])
        if not isinstance(group_hooks, list):
            continue
        for hook in group_hooks:
            if isinstance(hook, dict) and hook_script in hook.get("command", ""):
                print("found")
                sys.exit(0)

sys.exit(1)
PYTHON_CHECK

    if [[ $? -eq 0 ]]; then
      echo "✓ Claude Code hooks are installed"
      exit 0
    else
      echo "✗ Claude Code hooks are not installed"
      exit 1
    fi
    ;;
    
  install)
    existing="{}"
    if [[ -f "$CLAUDE_SETTINGS" ]]; then
      existing=$(cat "$CLAUDE_SETTINGS" 2>/dev/null) || existing="{}"
    fi
    
    check_prerequisites
    node_path="$(find_node)"
    
    new_settings=$(python3 - "$existing" "$HOOK_SCRIPT" "$node_path" "$HOOK_MARKER" << 'PYTHON_INSTALL'
import json
import sys

existing_json = sys.argv[1]
hook_script = sys.argv[2]
node_path = sys.argv[3]
hook_marker = sys.argv[4]

try:
    data = json.loads(existing_json) if existing_json.strip() else {}
except json.JSONDecodeError as e:
    print(f"PARSE_ERROR: {e}", file=sys.stderr)
    sys.exit(1)

if not isinstance(data, dict):
    print("Settings file is not a JSON object", file=sys.stderr)
    sys.exit(1)

hooks = data.setdefault("hooks", {})

hook_events = [
    "SessionStart",
    "UserPromptSubmit", 
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
]

hook_command = f'"{node_path}" "{hook_script}"'

# Our hook group structure
our_group = {
    "matcher": "",
    "hooks": [
        {
            "type": "command",
            "command": hook_command,
        }
    ],
    "_dashboard_marker": hook_marker,
}

# Claude Code format: "Event": [ {matcher, hooks}, {matcher, hooks}, ... ]
for event in hook_events:
    event_groups = hooks.get(event, [])
    
    # Convert old format (single object) to list if needed
    if isinstance(event_groups, dict):
        event_groups = [event_groups]
    elif not isinstance(event_groups, list):
        event_groups = []
    
    # Find and remove any existing dashboard hook group
    event_groups = [
        g for g in event_groups
        if not (isinstance(g, dict) and (
            g.get("_dashboard_marker") == hook_marker or
            any(hook_script in h.get("command", "") for h in g.get("hooks", []) if isinstance(h, dict))
        ))
    ]
    
    # Append our group
    event_groups.append(our_group.copy())
    
    hooks[event] = event_groups

print(json.dumps(data, indent=2))
PYTHON_INSTALL
) || die "Failed to generate hook configuration. Check that settings.json is valid JSON."

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "Would write to $CLAUDE_SETTINGS:"
      echo "$new_settings"
      exit 0
    fi
    
    if [[ -f "$CLAUDE_SETTINGS" ]]; then
      backup_file="$(make_backup_name "$CLAUDE_SETTINGS")"
      cp "$CLAUDE_SETTINGS" "$backup_file"
      echo "Created backup: $backup_file"
    fi
    
    mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
    echo "$new_settings" > "$CLAUDE_SETTINGS"
    
    echo "✓ Installed Claude Code hooks for Dashboard integration"
    echo "  Settings: $CLAUDE_SETTINGS"
    echo "  Hook script: $HOOK_SCRIPT"
    echo "  Node: $node_path"
    echo ""
    echo "The claude-code avatar will now show live status when using Claude Code."
    ;;
    
  uninstall)
    if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
      echo "No Claude Code settings found. Nothing to uninstall."
      exit 0
    fi
    
    new_settings=$(python3 - "$(cat "$CLAUDE_SETTINGS")" "$HOOK_SCRIPT" "$HOOK_MARKER" << 'PYTHON_UNINSTALL'
import json
import sys

existing_json = sys.argv[1]
hook_script = sys.argv[2]
hook_marker = sys.argv[3]

try:
    data = json.loads(existing_json)
except json.JSONDecodeError as e:
    print(f"Invalid JSON in settings file: {e}", file=sys.stderr)
    sys.exit(1)

if not isinstance(data, dict):
    print(json.dumps(data, indent=2))
    sys.exit(0)

hooks = data.get("hooks", {})
if not isinstance(hooks, dict):
    print(json.dumps(data, indent=2))
    sys.exit(0)

# Remove our hook group from each event, preserving other groups
for event in list(hooks.keys()):
    event_groups = hooks[event]
    
    if not isinstance(event_groups, list):
        continue
    
    # Filter out our groups
    filtered = [
        g for g in event_groups
        if not (isinstance(g, dict) and (
            g.get("_dashboard_marker") == hook_marker or
            any(hook_script in h.get("command", "") for h in g.get("hooks", []) if isinstance(h, dict))
        ))
    ]
    
    if filtered:
        hooks[event] = filtered
    else:
        del hooks[event]

# Remove empty hooks object
if not hooks and "hooks" in data:
    del data["hooks"]

print(json.dumps(data, indent=2))
PYTHON_UNINSTALL
) || die "Failed to update settings"

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "Would write to $CLAUDE_SETTINGS:"
      echo "$new_settings"
      exit 0
    fi
    
    backup_file="$(make_backup_name "$CLAUDE_SETTINGS")"
    cp "$CLAUDE_SETTINGS" "$backup_file"
    echo "Created backup: $backup_file"
    
    echo "$new_settings" > "$CLAUDE_SETTINGS"
    
    echo "✓ Removed Claude Code hooks for Dashboard integration"
    ;;
esac
