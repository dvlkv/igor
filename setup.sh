#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Igor Setup ==="

# 1. Initialize git submodules
echo ""
echo "--- Initializing submodules ---"
git -C "$SCRIPT_DIR" submodule update --init --recursive

# 2. Install mempalace
echo ""
echo "--- Installing mempalace ---"
pip install mempalace

# 3. Initialize mempalace in the project
echo ""
echo "--- Initializing mempalace ---"
mempalace init "$SCRIPT_DIR"

# 4. Register mempalace MCP server for Claude
echo ""
echo "--- Registering mempalace MCP server ---"
claude mcp add mempalace -- python -m mempalace.mcp_server

# 5. Install skills
echo ""
echo "--- Installing skills ---"
"$SCRIPT_DIR/install.sh"

echo ""
echo "=== Setup complete ==="
