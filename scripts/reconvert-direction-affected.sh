#!/usr/bin/env bash
# Re-convert avatars that had direction-dependent on-screen size (round 10).
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
reconvert_rpg "cursor-grunt02.png" "cursor_grunt02.png"
reconvert_rpg "cursor-grunt01.png" "cursor_grunt01.png"
reconvert_rpg "cluade-code.png" "claude_code.png"

# Grok: keep idle-col 2 pipeline
python3 "$ROOT/scripts/convert-sprite-sheet.py" \
  "$ROOT/public/assets/sprites/originals/grok-v2.png" "$TMP/grok-strip.png" --idle-col 2
python3 "$ROOT/scripts/reorder-strip-frames.py" "$TMP/grok-strip.png" "$OUT/grok.png"

echo "Re-converted direction-affected sprites."
