#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

chmod +x .githooks/pre-commit .githooks/pre-push .githooks/commit-msg

git config core.hooksPath .githooks

echo "Git hooks installed at .githooks"
