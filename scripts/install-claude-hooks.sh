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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOK_SCRIPT="$PROJECT_ROOT/.cursor/hooks/claude-code-hook.cjs"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

# Hook configuration to merge into settings.json
HOOK_ID="dashboard-status"

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

The hook integrates these Claude Code events with the Dashboard:
  SessionStart     → Avatar starts working
  UserPromptSubmit → Avatar is thinking
  PreToolUse       → Avatar activity based on tool (read/edit/run/etc)
  PostToolUse      → Avatar activity update
  Stop             → Avatar goes idle
  SessionEnd       → Session cleanup

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

check_prerequisites() {
  # Check for Claude CLI directory
  if [[ ! -d "$HOME/.claude" ]]; then
    die "Claude Code not found (~/.claude directory missing).
Install Claude Code first: https://claude.ai/code"
  fi

  # Check for hook script
  if [[ ! -f "$HOOK_SCRIPT" ]]; then
    die "Hook script not found: $HOOK_SCRIPT
Make sure you're running from the Dashboard repository."
  fi

  # Check for node
  if ! command -v node &>/dev/null; then
    die "Node.js not found. Install Node.js to use Claude Code hooks."
  fi
}

check_installed() {
  if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    return 1
  fi
  
  # Check if our hook is in the settings
  if python3 -c "
import json
import sys
try:
    with open('$CLAUDE_SETTINGS') as f:
        data = json.load(f)
    hooks = data.get('hooks', {})
    for hook_type in hooks.values():
        if isinstance(hook_type, list):
            for hook in hook_type:
                if isinstance(hook, dict) and hook.get('id') == '$HOOK_ID':
                    sys.exit(0)
    sys.exit(1)
except:
    sys.exit(1)
" 2>/dev/null; then
    return 0
  fi
  return 1
}

install_hooks() {
  local dry_run="${1:-false}"
  
  check_prerequisites
  
  # Create ~/.claude if it doesn't exist
  mkdir -p "$HOME/.claude"
  
  # Read existing settings or start fresh
  local existing="{}"
  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    existing=$(cat "$CLAUDE_SETTINGS" 2>/dev/null || echo "{}")
  fi
  
  # Merge hooks using Python
  local new_settings
  new_settings=$(python3 - "$existing" "$HOOK_SCRIPT" "$HOOK_ID" << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
hook_script = sys.argv[2]
hook_id = sys.argv[3]

try:
    data = json.loads(existing_json)
except json.JSONDecodeError:
    data = {}

if not isinstance(data, dict):
    data = {}

hooks = data.setdefault("hooks", {})

# Define which events to hook
hook_events = [
    "SessionStart",
    "UserPromptSubmit", 
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
    "Notification",
]

# Hook entry template
hook_entry = {
    "id": hook_id,
    "type": "command",
    "command": f"node {hook_script}",
}

# Add hook to each event type
for event in hook_events:
    event_hooks = hooks.setdefault(event, [])
    if not isinstance(event_hooks, list):
        event_hooks = []
        hooks[event] = event_hooks
    
    # Check if our hook already exists
    existing_idx = None
    for i, h in enumerate(event_hooks):
        if isinstance(h, dict) and h.get("id") == hook_id:
            existing_idx = i
            break
    
    if existing_idx is not None:
        event_hooks[existing_idx] = hook_entry
    else:
        event_hooks.append(hook_entry)

print(json.dumps(data, indent=2))
PYTHON_SCRIPT
)

  if [[ "$dry_run" == "true" ]]; then
    echo "Would write to $CLAUDE_SETTINGS:"
    echo "$new_settings"
    return 0
  fi
  
  # Write the new settings
  echo "$new_settings" > "$CLAUDE_SETTINGS"
  
  echo "✓ Installed Claude Code hooks for Dashboard integration"
  echo "  Settings: $CLAUDE_SETTINGS"
  echo "  Hook script: $HOOK_SCRIPT"
  echo ""
  echo "The claude-code avatar will now show live status when using Claude Code."
}

uninstall_hooks() {
  local dry_run="${1:-false}"
  
  if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    echo "No Claude Code settings found. Nothing to uninstall."
    return 0
  fi
  
  # Remove hooks using Python
  local new_settings
  new_settings=$(python3 - "$(cat "$CLAUDE_SETTINGS")" "$HOOK_ID" << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
hook_id = sys.argv[2]

try:
    data = json.loads(existing_json)
except json.JSONDecodeError:
    data = {}

if not isinstance(data, dict):
    print(json.dumps(data, indent=2))
    sys.exit(0)

hooks = data.get("hooks", {})
if not isinstance(hooks, dict):
    print(json.dumps(data, indent=2))
    sys.exit(0)

# Remove our hook from each event type
for event, event_hooks in list(hooks.items()):
    if not isinstance(event_hooks, list):
        continue
    
    hooks[event] = [
        h for h in event_hooks
        if not (isinstance(h, dict) and h.get("id") == hook_id)
    ]
    
    # Remove empty hook lists
    if not hooks[event]:
        del hooks[event]

# Remove empty hooks object
if not hooks:
    del data["hooks"]

print(json.dumps(data, indent=2))
PYTHON_SCRIPT
)

  if [[ "$dry_run" == "true" ]]; then
    echo "Would write to $CLAUDE_SETTINGS:"
    echo "$new_settings"
    return 0
  fi
  
  echo "$new_settings" > "$CLAUDE_SETTINGS"
  
  echo "✓ Removed Claude Code hooks for Dashboard integration"
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
  install)
    install_hooks "$DRY_RUN"
    ;;
  uninstall)
    uninstall_hooks "$DRY_RUN"
    ;;
  check)
    if check_installed; then
      echo "✓ Claude Code hooks are installed"
      exit 0
    else
      echo "✗ Claude Code hooks are not installed"
      exit 1
    fi
    ;;
esac
