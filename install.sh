#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/skills"

CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
AGENTS_SKILLS_DIR="$HOME/.agents/skills"

if [ ! -d "$SKILLS_DIR" ]; then
  echo "No skills directory found at $SKILLS_DIR"
  exit 1
fi

has_skills=false
for skill_dir in "$SKILLS_DIR"/*/; do
  [ -d "$skill_dir" ] || continue
  has_skills=true

  skill_name="$(basename "$skill_dir")"
  skill_path="$(cd "$skill_dir" && pwd)"

  for target_dir in "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"; do
    mkdir -p "$target_dir"
    link="$target_dir/$skill_name"

    if [ -L "$link" ]; then
      existing="$(readlink "$link")"
      if [ "$existing" = "$skill_path" ]; then
        echo "✓ $link already points to $skill_path"
        continue
      fi
      echo "Updating $link -> $skill_path (was $existing)"
      rm "$link"
    elif [ -e "$link" ]; then
      echo "Skipping $link — already exists and is not a symlink"
      continue
    fi

    ln -s "$skill_path" "$link"
    echo "Linked $link -> $skill_path"
  done
done

if [ "$has_skills" = false ]; then
  echo "No skill directories found in $SKILLS_DIR"
fi
