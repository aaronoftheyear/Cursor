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
  # Try common locations for node
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
  
  # Check if nvm is available and try to get node from it
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
  # Check for Claude CLI directory
  local claude_dir
  claude_dir="$(dirname "$CLAUDE_SETTINGS")"
  if [[ ! -d "$claude_dir" ]]; then
    die "Claude Code not found ($claude_dir directory missing).
Install Claude Code first: https://claude.ai/code"
  fi

  # Check for hook script
  if [[ ! -f "$HOOK_SCRIPT" ]]; then
    die "Hook script not found: $HOOK_SCRIPT
Make sure you're running from the Dashboard repository."
  fi

  # Check for python3
  if ! command -v python3 &>/dev/null; then
    die "Python 3 not found. Install Python 3 to use this installer."
  fi

  # Check for node
  if ! find_node &>/dev/null; then
    die "Node.js not found. Install Node.js to use Claude Code hooks.
If using nvm, make sure to run 'nvm use' first or set a default version."
  fi
}

check_installed() {
  if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    return 1
  fi
  
  # Check if our hook command is in the settings
  python3 << 'PYTHON_SCRIPT'
import json
import sys

settings_path = sys.argv[1] if len(sys.argv) > 1 else ""
hook_script = sys.argv[2] if len(sys.argv) > 2 else ""

try:
    with open(settings_path) as f:
        data = json.load(f)
except (json.JSONDecodeError, OSError, IOError):
    sys.exit(1)

hooks = data.get("hooks", {})
if not isinstance(hooks, dict):
    sys.exit(1)

# Look for our hook command in any event's hooks list
for event_config in hooks.values():
    if not isinstance(event_config, dict):
        continue
    event_hooks = event_config.get("hooks", [])
    if not isinstance(event_hooks, list):
        continue
    for hook in event_hooks:
        if isinstance(hook, dict):
            cmd = hook.get("command", "")
            if hook_script in cmd:
                sys.exit(0)

sys.exit(1)
PYTHON_SCRIPT "$CLAUDE_SETTINGS" "$HOOK_SCRIPT"
}

install_hooks() {
  local dry_run="${1:-false}"
  
  check_prerequisites
  
  # Create ~/.claude if it doesn't exist
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  
  # Find node path
  local node_path
  node_path="$(find_node)"
  
  # Read existing settings
  local existing="{}"
  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    existing=$(cat "$CLAUDE_SETTINGS" 2>/dev/null) || existing="{}"
  fi
  
  # Merge hooks using Python
  local new_settings
  if ! new_settings=$(python3 - "$existing" "$HOOK_SCRIPT" "$node_path" 2>&1); then
    die "Failed to generate hook configuration: $new_settings"
  fi
  
  if [[ "$dry_run" == "true" ]]; then
    echo "Would write to $CLAUDE_SETTINGS:"
    echo "$new_settings"
    return 0
  fi
  
  # Create backup before writing
  if [[ -f "$CLAUDE_SETTINGS" ]]; then
    local backup_file="$CLAUDE_SETTINGS.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$CLAUDE_SETTINGS" "$backup_file"
    echo "Created backup: $backup_file"
  fi
  
  # Write the new settings
  echo "$new_settings" > "$CLAUDE_SETTINGS"
  
  echo "✓ Installed Claude Code hooks for Dashboard integration"
  echo "  Settings: $CLAUDE_SETTINGS"
  echo "  Hook script: $HOOK_SCRIPT"
  echo "  Node: $node_path"
  echo ""
  echo "The claude-code avatar will now show live status when using Claude Code."
}

# Python script for installing hooks - uses here-doc after function call
run_install_python() {
  python3 << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
hook_script = sys.argv[2]
node_path = sys.argv[3]

# Parse existing settings - abort on error, don't wipe user's settings
try:
    data = json.loads(existing_json) if existing_json.strip() else {}
except json.JSONDecodeError as e:
    print(f"Invalid JSON in settings file: {e}", file=sys.stderr)
    sys.exit(1)

if not isinstance(data, dict):
    print("Settings file is not a JSON object", file=sys.stderr)
    sys.exit(1)

hooks = data.setdefault("hooks", {})

# Define which events to hook
hook_events = [
    "SessionStart",
    "UserPromptSubmit", 
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
]

# Quote the paths to handle spaces
hook_command = f'"{node_path}" "{hook_script}"'

# Claude Code hook structure: {"matcher": "", "hooks": [{"type": "command", "command": "..."}]}
for event in hook_events:
    event_config = hooks.get(event, {})
    if not isinstance(event_config, dict):
        event_config = {}
    
    # Get or create the hooks list
    event_hooks = event_config.get("hooks", [])
    if not isinstance(event_hooks, list):
        event_hooks = []
    
    # Check if our hook already exists (by matching hook_script in command)
    existing_idx = None
    for i, h in enumerate(event_hooks):
        if isinstance(h, dict) and hook_script in h.get("command", ""):
            existing_idx = i
            break
    
    # Create hook entry (no id field - Claude Code doesn't use it)
    hook_entry = {
        "type": "command",
        "command": hook_command,
    }
    
    if existing_idx is not None:
        event_hooks[existing_idx] = hook_entry
    else:
        event_hooks.append(hook_entry)
    
    # Update event config with proper structure
    event_config["hooks"] = event_hooks
    if "matcher" not in event_config:
        event_config["matcher"] = ""
    
    hooks[event] = event_config

print(json.dumps(data, indent=2))
PYTHON_SCRIPT
}

uninstall_hooks() {
  local dry_run="${1:-false}"
  
  if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    echo "No Claude Code settings found. Nothing to uninstall."
    return 0
  fi
  
  # Remove hooks using Python
  local new_settings
  if ! new_settings=$(python3 - "$(cat "$CLAUDE_SETTINGS")" "$HOOK_SCRIPT" << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
hook_script = sys.argv[2]

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

# Remove our hook from each event type
for event, event_config in list(hooks.items()):
    if not isinstance(event_config, dict):
        continue
    
    event_hooks = event_config.get("hooks", [])
    if not isinstance(event_hooks, list):
        continue
    
    # Filter out hooks containing our script path
    event_hooks = [
        h for h in event_hooks
        if not (isinstance(h, dict) and hook_script in h.get("command", ""))
    ]
    
    if event_hooks:
        event_config["hooks"] = event_hooks
    else:
        # Remove the entire event config if no hooks remain
        del hooks[event]

# Remove empty hooks object
if not hooks:
    if "hooks" in data:
        del data["hooks"]

print(json.dumps(data, indent=2))
PYTHON_SCRIPT
); then
    die "Failed to update settings: $new_settings"
  fi

  if [[ "$dry_run" == "true" ]]; then
    echo "Would write to $CLAUDE_SETTINGS:"
    echo "$new_settings"
    return 0
  fi
  
  # Create backup before writing
  local backup_file="$CLAUDE_SETTINGS.backup.$(date +%Y%m%d_%H%M%S)"
  cp "$CLAUDE_SETTINGS" "$backup_file"
  echo "Created backup: $backup_file"
  
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
    # Read existing settings for Python
    existing="{}"
    if [[ -f "$CLAUDE_SETTINGS" ]]; then
      existing=$(cat "$CLAUDE_SETTINGS" 2>/dev/null) || existing="{}"
    fi
    
    check_prerequisites
    node_path="$(find_node)"
    
    # Generate new settings
    new_settings=$(python3 - "$existing" "$HOOK_SCRIPT" "$node_path" << 'PYTHON_SCRIPT'
import json
import sys

existing_json = sys.argv[1]
hook_script = sys.argv[2]
node_path = sys.argv[3]

# Parse existing settings - abort on error, don't wipe user's settings
try:
    data = json.loads(existing_json) if existing_json.strip() else {}
except json.JSONDecodeError as e:
    print(f"PARSE_ERROR: {e}", file=sys.stderr)
    sys.exit(1)

if not isinstance(data, dict):
    print("Settings file is not a JSON object", file=sys.stderr)
    sys.exit(1)

hooks = data.setdefault("hooks", {})

# Define which events to hook
hook_events = [
    "SessionStart",
    "UserPromptSubmit", 
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SessionEnd",
]

# Quote the paths to handle spaces
hook_command = f'"{node_path}" "{hook_script}"'

# Claude Code hook structure: {"matcher": "", "hooks": [{"type": "command", "command": "..."}]}
for event in hook_events:
    event_config = hooks.get(event, {})
    if not isinstance(event_config, dict):
        event_config = {}
    
    # Get or create the hooks list
    event_hooks = event_config.get("hooks", [])
    if not isinstance(event_hooks, list):
        event_hooks = []
    
    # Check if our hook already exists (by matching hook_script in command)
    existing_idx = None
    for i, h in enumerate(event_hooks):
        if isinstance(h, dict) and hook_script in h.get("command", ""):
            existing_idx = i
            break
    
    # Create hook entry (no id field - Claude Code doesn't use it)
    hook_entry = {
        "type": "command",
        "command": hook_command,
    }
    
    if existing_idx is not None:
        event_hooks[existing_idx] = hook_entry
    else:
        event_hooks.append(hook_entry)
    
    # Update event config with proper structure
    event_config["hooks"] = event_hooks
    if "matcher" not in event_config:
        event_config["matcher"] = ""
    
    hooks[event] = event_config

print(json.dumps(data, indent=2))
PYTHON_SCRIPT
) || die "Failed to generate hook configuration. Check that settings.json is valid JSON."

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "Would write to $CLAUDE_SETTINGS:"
      echo "$new_settings"
      exit 0
    fi
    
    # Create backup before writing
    if [[ -f "$CLAUDE_SETTINGS" ]]; then
      backup_file="$CLAUDE_SETTINGS.backup.$(date +%Y%m%d_%H%M%S)"
      cp "$CLAUDE_SETTINGS" "$backup_file"
      echo "Created backup: $backup_file"
    fi
    
    # Write the new settings
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
