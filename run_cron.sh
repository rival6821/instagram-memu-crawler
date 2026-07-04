#!/bin/bash

# Exit on error
set -e

# Get script directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

# Lock file to prevent duplicate execution
LOCKFILE="/tmp/find_menu_images.lock"

# Check username argument
if [ -z "$1" ]; then
    echo "Usage: $0 <instagram_username> [additional_python_args...]"
    exit 1
fi

USERNAME=$1
shift # Shift arguments so $@ contains only additional python arguments

# 1. Node.js Environment Setup and Dependency Check
if [ ! -d "node_modules" ]; then
    echo "node_modules missing. Installing dependencies..."
    npm install
    # Note: On a new Linux server, you may also need to run:
    # npx playwright install-deps
    # or install the system dependencies manually.
    npx playwright install chromium
fi

# 2. Execute node script with flock (file lock) if available
echo "Running find_menu_images.js for @$USERNAME..."

if command -v flock >/dev/null 2>&1; then
    exec flock -n "$LOCKFILE" node find_menu_images.js "$USERNAME" "$@"
else
    echo "⚠️ 'flock' command not found. Running without file lock (Recommended on macOS for testing)..."
    exec node find_menu_images.js "$USERNAME" "$@"
fi
