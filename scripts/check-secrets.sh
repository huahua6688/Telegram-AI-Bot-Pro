#!/usr/bin/env bash
set -euo pipefail

bad_files="$(
  git ls-files \
    | grep -E '(^\.env$|^\.env\.|^data/|\.db$|\.sqlite$|\.sqlite3$|\.db-journal$|\.sqlite-journal$|\.sqlite3-journal$)' \
    | grep -v '^\.env\.example$' || true
)"

if [ -n "$bad_files" ]; then
  echo "❌ Found tracked local secret/data files:"
  echo "$bad_files"
  echo
  echo "Remove them from Git tracking with:"
  echo "git rm --cached <file>"
  exit 1
fi

echo "✅ No forbidden local secret/data files are tracked."
