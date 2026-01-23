#!/bin/bash
#
# Run all tests
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "================================"
echo "git-atrace test suite"
echo "================================"
echo ""

"$SCRIPT_DIR/test-hook.sh"
echo ""
"$SCRIPT_DIR/test-cli.sh"
echo ""

echo "================================"
echo "All tests passed!"
echo "================================"
