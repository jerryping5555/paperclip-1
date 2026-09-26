#!/bin/bash

# Manual push script for the Paperclip repo -> https://github.com/jerryping5555/paperclip
#
# IMPORTANT: `origin` stays pointed at upstream (paperclipai/paperclip) so
# `git pull` keeps bringing official updates. This script pushes through a
# SEPARATE remote named `jerryping`, creating it on first run.
#
# Do NOT run with sudo — git needs the repo owner's credentials.
#
# Usage: ./gitpush_donotrunwithsudo.sh "commit message"
#        (P2 portal GitPush button passes a message automatically)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
cd "$PROJECT_DIR"

BACKUP_REMOTE="jerryping"
DISPLAY_URL="https://github.com/jerryping5555/paperclip"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
BRANCH=$(git branch --show-current)

# --- Guards ---------------------------------------------------------------

# Refuse root: the P2 portal API drops to the repo owner before running this,
# but a manual sudo invocation would create root-owned git objects.
if [ "$(id -u)" -eq 0 ]; then
    echo "❌ Do not run this script as root/sudo. Run it as the repo owner."
    exit 1
fi

# --- Token (optional) ------------------------------------------------------
# GITHUB_TOKEN from a gitignored .env in the repo root, if present. Only this
# variable is read — never export the whole .env (it can hold DATABASE_URL etc).
GITHUB_TOKEN=""
if [ -f .env ]; then
    GITHUB_TOKEN=$(grep -E '^GITHUB_TOKEN=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

if [ -n "$GITHUB_TOKEN" ]; then
    PUSH_URL="https://${GITHUB_TOKEN}@github.com/jerryping5555/paperclip.git"
else
    # No token: plain https, git's own credential store applies.
    PUSH_URL="https://github.com/jerryping5555/paperclip.git"
fi

# --- Remote setup (never touches origin) ------------------------------------

if ! git remote get-url "$BACKUP_REMOTE" >/dev/null 2>&1; then
    echo "➕ Creating remote '$BACKUP_REMOTE' -> $DISPLAY_URL"
    git remote add "$BACKUP_REMOTE" "$PUSH_URL"
else
    # Refresh in case an old token went stale; keeps the URL current.
    git remote set-url "$BACKUP_REMOTE" "$PUSH_URL"
fi

echo ""
echo "🔄 Git Backup Script (Paperclip)"
echo "================================"
echo "Repository: $DISPLAY_URL"
echo "Remote:     $BACKUP_REMOTE (origin stays on upstream paperclipai/paperclip)"
echo "Branch:     $BRANCH"
echo "Time:       $TIMESTAMP"
echo ""

# --- Commit ------------------------------------------------------------------

if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo "✅ No changes to commit."
else
    echo "📝 Changes to be backed up:"
    git status --short
    echo ""

    COMMIT_MSG="${1:-}"
    echo "➕ Adding changes..."
    git add .

    echo "💾 Creating commit..."
    if [ -n "$COMMIT_MSG" ]; then
        git commit -m "Backup: $TIMESTAMP - $COMMIT_MSG" -m "Manual backup via script"
    else
        git commit -m "Backup: $TIMESTAMP" -m "Manual backup via script"
    fi
fi

# --- Push ----------------------------------------------------------------------

echo "🚀 Pushing to $DISPLAY_URL ..."
# No -u on purpose: setting tracking would retarget plain `git pull`/`git push`
# away from origin/master. master keeps tracking upstream; this remote is
# push-only.
git push "$BACKUP_REMOTE" "$BRANCH"

echo ""
echo "✅ Backup completed successfully!"
echo "🔗 View at: $DISPLAY_URL"
echo "ℹ️  origin is untouched — 'git pull' still fetches upstream updates."
