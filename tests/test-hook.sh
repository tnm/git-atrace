#!/bin/bash
#
# Tests for git-atrace-hook
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
HOOK="$ROOT_DIR/git-atrace-hook"

# Create temp directory
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

cd "$TMPDIR"
git init --quiet

# Test 1: Hook creates session directory
echo "Test 1: Hook creates session directory..."
echo '{"session_id": "test-123", "transcript_path": "/dev/null", "tool_name": "Edit", "tool_input": {"file_path": "/tmp/test.txt"}}' | "$HOOK"
if [ -d ".git/trace/sessions" ]; then
    echo "  PASS"
else
    echo "  FAIL: .git/trace/sessions not created"
    exit 1
fi

# Test 2: Hook creates files list
echo "Test 2: Hook creates files list..."
if [ -f ".git/trace/sessions/test-123.files" ]; then
    if grep -q "/tmp/test.txt" ".git/trace/sessions/test-123.files"; then
        echo "  PASS"
    else
        echo "  FAIL: file path not in .files"
        exit 1
    fi
else
    echo "  FAIL: .files not created"
    exit 1
fi

# Test 3: Hook creates timestamp
echo "Test 3: Hook creates timestamp..."
if [ -f ".git/trace/sessions/test-123.timestamp" ]; then
    echo "  PASS"
else
    echo "  FAIL: .timestamp not created"
    exit 1
fi

# Test 4: Hook ignores non-Edit/Write tools
echo "Test 4: Hook ignores non-Edit/Write tools..."
echo '{"session_id": "test-456", "transcript_path": "/dev/null", "tool_name": "Read", "tool_input": {"file_path": "/tmp/other.txt"}}' | "$HOOK"
if [ ! -f ".git/trace/sessions/test-456.files" ]; then
    echo "  PASS"
else
    echo "  FAIL: should not create files for Read tool"
    exit 1
fi

# Test 5: Hook handles missing session_id
echo "Test 5: Hook handles missing session_id..."
echo '{"tool_name": "Edit", "tool_input": {"file_path": "/tmp/test.txt"}}' | "$HOOK"
echo "  PASS (no crash)"

# Test 6: Hook handles empty input
echo "Test 6: Hook handles empty input..."
echo '' | "$HOOK" || true
echo "  PASS (no crash)"

# Test 7: Hook appends to existing files list
echo "Test 7: Hook appends to existing files list..."
echo '{"session_id": "test-123", "transcript_path": "/dev/null", "tool_name": "Edit", "tool_input": {"file_path": "/tmp/another.txt"}}' | "$HOOK"
if [ "$(wc -l < .git/trace/sessions/test-123.files)" -eq 2 ]; then
    echo "  PASS"
else
    echo "  FAIL: should have 2 files"
    exit 1
fi

# Test 8: Hook doesn't duplicate files
echo "Test 8: Hook doesn't duplicate files..."
echo '{"session_id": "test-123", "transcript_path": "/dev/null", "tool_name": "Edit", "tool_input": {"file_path": "/tmp/test.txt"}}' | "$HOOK"
if [ "$(wc -l < .git/trace/sessions/test-123.files)" -eq 2 ]; then
    echo "  PASS"
else
    echo "  FAIL: should still have 2 files (no duplicates)"
    exit 1
fi

# Test 9: Hook stores repo-relative paths
echo "Test 9: Hook stores repo-relative paths..."
mkdir -p src
echo '{"session_id": "test-rel", "transcript_path": "/dev/null", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/src/main.py"}}' | "$HOOK"
if grep -qx "src/main.py" ".git/trace/sessions/test-rel.files"; then
    echo "  PASS"
else
    echo "  FAIL: path should be relative (src/main.py), got:"
    cat .git/trace/sessions/test-rel.files
    exit 1
fi

echo ""
echo "All hook tests passed!"
