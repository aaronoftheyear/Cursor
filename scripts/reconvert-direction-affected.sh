#!/usr/bin/env bash
# Re-convert avatars with direction-dependent size (uniform scale, widest frame → 16px cell).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHEETS="$ROOT/public/assets/sprites/sheets"
OUT="$ROOT/public/assets/sprites"
TMP="$ROOT/.tmp-screenshots/reconvert"
mkdir -p "$TMP"

reconvert_rpg() {
  local sheet="$1" sprite="$2"
  local idle_col="${3:-1}"
  python3 "$ROOT/scripts/convert-rpg-sheet.py" "$SHEETS/$sheet" "$TMP/$sprite" --idle-col "$idle_col"
  python3 "$ROOT/scripts/reorder-strip-frames.py" "$TMP/$sprite" "$OUT/$sprite"
}

reconvert_rpg "cursor-jarvis-v2.png" "jarvis.png"
reconvert_rpg "gemini.png" "gemini.png"
reconvert_rpg "claude-grunt01.png" "claude.png"
reconvert_rpg "claude-cowork.png" "claude_cowork.png"
reconvert_rpg "cluade-code.png" "claude_code.png"

# Bumblebee: Aaron's original frame order 123456789 (no 213 swap).
python3 "$ROOT/scripts/convert-rpg-sheet.py" "$SHEETS/bumblebee.png" "$OUT/bumblebee.png" --idle-col 1

echo "Re-converted direction-affected RPG sprites (Grok/Cursor grunts unchanged)."
