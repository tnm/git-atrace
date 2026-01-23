#!/bin/bash
# Install git-atrace
set -e

REPO="tnm/git-atrace"
INSTALL_DIR="${HOME}/.local/bin"

echo "Installing git-atrace..."

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download scripts
curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/git-atrace" -o "${INSTALL_DIR}/git-atrace"
curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/git-atrace-hook" -o "${INSTALL_DIR}/git-atrace-hook"

# Make executable
chmod +x "${INSTALL_DIR}/git-atrace"
chmod +x "${INSTALL_DIR}/git-atrace-hook"

echo "Installed to ${INSTALL_DIR}"

# Check PATH
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  echo ""
  echo "Add to your shell profile:"
  echo "  export PATH=\"\$PATH:${INSTALL_DIR}\""
else
  echo ""
  echo "Run 'git atrace' to get started."
fi
