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

# 1. Virtual Environment Setup
VENV_DIR=".venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment in $DIR/$VENV_DIR..."
    python3 -m venv "$VENV_DIR"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# 2. Check and install dependencies
# To speed up execution, only run pip install if modules are missing
if ! python3 -c "import instagrapi, playwright, playwright_stealth" &>/dev/null; then
    echo "Dependencies missing. Installing..."
    pip install --upgrade pip
    pip install instagrapi requests playwright playwright-stealth
    # Note: On a new Linux server, you may also need to run:
    # playwright install-deps
    # or install the system dependencies manually.
    playwright install chromium
fi

# 3. Execute python script with flock (file lock) if available
echo "Running find_menu_images.py for @$USERNAME..."

if command -v flock >/dev/null 2>&1; then
    exec flock -n "$LOCKFILE" python3 find_menu_images.py "$USERNAME" "$@"
else
    echo "⚠️ 'flock' command not found. Running without file lock (Recommended on macOS for testing)..."
    exec python3 find_menu_images.py "$USERNAME" "$@"
fi
