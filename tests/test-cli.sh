#!/bin/bash
#
# Tests for git-atrace CLI
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CLI="$ROOT_DIR/git-atrace"
HOOK="$ROOT_DIR/git-atrace-hook"

# Create temp directory
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

cd "$TMPDIR"
git init --quiet

# Create a mock transcript file
TRANSCRIPT="$TMPDIR/transcript.jsonl"
cat > "$TRANSCRIPT" << 'EOF'
{"type": "user", "timestamp": "2024-01-01T00:00:00Z", "message": {"content": "Add a hello function"}}
{"type": "assistant", "timestamp": "2024-01-01T00:00:01Z", "message": {"content": [{"type": "text", "text": "I'll create a hello function for you."}]}}
{"type": "assistant", "timestamp": "2024-01-01T00:00:02Z", "message": {"content": [{"type": "tool_use", "name": "Edit", "id": "123"}]}}
{"type": "user", "timestamp": "2024-01-01T00:00:03Z", "message": {"content": "Make it say goodbye instead"}}
{"type": "assistant", "timestamp": "2024-01-01T00:00:04Z", "message": {"content": [{"type": "text", "text": "Sure, I'll change it to goodbye."}]}}
EOF

# Create a session via hook
echo '{"session_id": "cli-test-session", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/test.py"}}' | "$HOOK"

# Test 1: CLI list shows sessions
echo "Test 1: CLI list shows sessions..."
OUTPUT=$("$CLI" 2>&1)
if echo "$OUTPUT" | grep -q "cli-test"; then
    echo "  PASS"
else
    echo "  FAIL: session not listed"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 2: CLI show finds session by file
echo "Test 2: CLI show finds session by file..."
OUTPUT=$("$CLI" show "$TMPDIR/test.py" 2>&1)
if echo "$OUTPUT" | grep -q "cli-test"; then
    echo "  PASS"
else
    echo "  FAIL: session not found for file"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 3: CLI view shows conversation
echo "Test 3: CLI view shows conversation..."
OUTPUT=$("$CLI" view cli-test 2>&1)
if echo "$OUTPUT" | grep -q "Add a hello function"; then
    echo "  PASS"
else
    echo "  FAIL: user message not shown"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 4: CLI view shows assistant response
echo "Test 4: CLI view shows assistant response..."
if echo "$OUTPUT" | grep -q "I'll create a hello function"; then
    echo "  PASS"
else
    echo "  FAIL: assistant response not shown"
    exit 1
fi

# Test 5: CLI view shows tool use
echo "Test 5: CLI view shows tool use..."
if echo "$OUTPUT" | grep -q "Edit"; then
    echo "  PASS"
else
    echo "  FAIL: tool use not shown"
    exit 1
fi

# Test 6: CLI share fails when not configured
echo "Test 6: CLI share fails when not configured..."
OUTPUT=$("$CLI" share cli-test 2>&1) || true
if echo "$OUTPUT" | grep -q "No share directory configured"; then
    echo "  PASS"
else
    echo "  FAIL: should report no share directory configured"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 6b: CLI share works with git config
echo "Test 6b: CLI share works with git config..."
git config atrace.sharedir ".trace/sessions"
"$CLI" share cli-test >/dev/null 2>&1
if [ -f ".trace/sessions/cli-test-session.jsonl" ]; then
    echo "  PASS"
else
    echo "  FAIL: session not copied to configured sharedir"
    exit 1
fi
git config --unset atrace.sharedir
rm -rf .trace

# Test 7: CLI handles unknown session
echo "Test 7: CLI handles unknown session..."
OUTPUT=$("$CLI" view nonexistent 2>&1) || true
if echo "$OUTPUT" | grep -qi "not found"; then
    echo "  PASS"
else
    echo "  FAIL: should report session not found"
    exit 1
fi

# Test 8: CLI handles no sessions
echo "Test 8: CLI handles no sessions..."
rm -rf .git/trace/sessions/*
OUTPUT=$("$CLI" 2>&1)
if echo "$OUTPUT" | grep -qi "no sessions\|Sessions"; then
    echo "  PASS"
else
    echo "  FAIL: should handle empty sessions"
    exit 1
fi

# Test 9: CLI fails outside git repo
echo "Test 9: CLI fails outside git repo..."
OUTSIDE_DIR=$(mktemp -d)
OUTPUT=$(cd "$OUTSIDE_DIR" && "$CLI" 2>&1) || true
rm -rf "$OUTSIDE_DIR"
if echo "$OUTPUT" | grep -qi "not in a git"; then
    echo "  PASS"
else
    echo "  FAIL: should report not in git repo"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Recreate session for remaining tests
echo '{"session_id": "cli-test-session", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/test.py"}}' | "$HOOK"

# Test 10: CLI files lists session files
echo "Test 10: CLI files lists session files..."
OUTPUT=$("$CLI" files cli-test 2>&1)
if echo "$OUTPUT" | grep -q "test.py"; then
    echo "  PASS"
else
    echo "  FAIL: files command should list test.py"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 11: CLI delete removes session
echo "Test 11: CLI delete removes session..."
echo '{"session_id": "delete-me", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/delete.py"}}' | "$HOOK"
"$CLI" delete delete-me >/dev/null 2>&1
if [ ! -f ".git/trace/sessions/delete-me.jsonl" ]; then
    echo "  PASS"
else
    echo "  FAIL: session should be deleted"
    exit 1
fi

# Test 12: CLI help shows usage
echo "Test 12: CLI help shows usage..."
OUTPUT=$("$CLI" help 2>&1)
if echo "$OUTPUT" | grep -q "git atrace" && echo "$OUTPUT" | grep -q "link"; then
    echo "  PASS"
else
    echo "  FAIL: help should show commands"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 13: CLI link associates session with commit
echo "Test 13: CLI link associates session with commit..."
git config user.email "test@test.com"
git config user.name "Test"
echo "test" > test.txt
git add test.txt
git commit -m "test commit" --quiet
"$CLI" link cli-test HEAD >/dev/null 2>&1
NOTE=$(git notes --ref=refs/notes/atrace show HEAD 2>/dev/null) || NOTE=""
if echo "$NOTE" | grep -q "cli-test-session"; then
    echo "  PASS"
else
    echo "  FAIL: session should be linked to commit"
    echo "  Note: $NOTE"
    exit 1
fi

# Test 14: CLI log shows linked commits
echo "Test 14: CLI log shows linked commits..."
OUTPUT=$("$CLI" log 2>&1)
if echo "$OUTPUT" | grep -q "cli-test" && echo "$OUTPUT" | grep -q "test commit"; then
    echo "  PASS"
else
    echo "  FAIL: log should show linked commit"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 15: CLI view handles malformed JSONL gracefully
echo "Test 15: CLI view handles malformed JSONL..."
mkdir -p .git/trace/sessions
echo 'not valid json' > .git/trace/sessions/malformed-session.jsonl
echo "$(date -Iseconds)" > .git/trace/sessions/malformed-session.timestamp
OUTPUT=$("$CLI" view malformed 2>&1) || true
if echo "$OUTPUT" | grep -qi "error\|no conversation"; then
    echo "  PASS"
else
    echo "  FAIL: should handle malformed JSONL"
    echo "  Output: $OUTPUT"
    exit 1
fi
rm -f .git/trace/sessions/malformed-session.*

# Test 16: CLI handles partial session data (missing .files)
echo "Test 16: CLI handles session with missing .files..."
mkdir -p .git/trace/sessions
cat > .git/trace/sessions/partial-session.jsonl << 'PARTIAL_EOF'
{"type": "user", "timestamp": "2024-01-01T00:00:00Z", "message": {"content": "Test"}}
{"type": "assistant", "timestamp": "2024-01-01T00:00:01Z", "message": {"content": [{"type": "text", "text": "Response"}]}}
PARTIAL_EOF
echo "$(date -Iseconds)" > .git/trace/sessions/partial-session.timestamp
# No .files created - should still list and view
OUTPUT=$("$CLI" 2>&1)
if echo "$OUTPUT" | grep -q "partial-"; then
    echo "  PASS"
else
    echo "  FAIL: should list session without .files"
    echo "  Output: $OUTPUT"
    exit 1
fi
rm -f .git/trace/sessions/partial-session.*

# Test 17: CLI share reports already-shared session
echo "Test 17: CLI share reports already-shared session..."
# Set up sharing config and share a session first
git config atrace.sharedir ".trace/sessions"
# Recreate session for this test
echo '{"session_id": "share-test-session", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/share.py"}}' | "$HOOK"
"$CLI" share share-test >/dev/null 2>&1
# Remove local copy so only shared remains
rm -f .git/trace/sessions/share-test-session.*
OUTPUT=$("$CLI" share share-test 2>&1) || true
if echo "$OUTPUT" | grep -qi "already shared"; then
    echo "  PASS"
else
    echo "  FAIL: should report session already shared"
    echo "  Output: $OUTPUT"
    exit 1
fi
git config --unset atrace.sharedir
rm -rf .trace

# Test 18: CLI handles empty session content
echo "Test 18: CLI view handles empty session content..."
mkdir -p .git/trace/sessions
cat > .git/trace/sessions/empty-session.jsonl << 'EMPTY_EOF'
{"type": "system", "timestamp": "2024-01-01T00:00:00Z", "message": "init"}
EMPTY_EOF
echo "$(date -Iseconds)" > .git/trace/sessions/empty-session.timestamp
OUTPUT=$("$CLI" view empty-se 2>&1)
if echo "$OUTPUT" | grep -qi "no conversation content"; then
    echo "  PASS"
else
    echo "  FAIL: should report no conversation content"
    echo "  Output: $OUTPUT"
    exit 1
fi
rm -f .git/trace/sessions/empty-session.*

# Test 19: CLI show handles symlinked directories
echo "Test 19: CLI show handles symlinked directories..."
mkdir -p "$TMPDIR/real_src"
ln -s "$TMPDIR/real_src" "$TMPDIR/src_link"
echo '{"session_id": "symlink-test", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/real_src/module.py"}}' | "$HOOK"
# Query via symlink path should still find session
OUTPUT=$("$CLI" show "$TMPDIR/src_link/module.py" 2>&1)
if echo "$OUTPUT" | grep -q "symlink-"; then
    echo "  PASS"
else
    echo "  FAIL: should find session via symlinked path"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 20: CLI files handles session with no files
echo "Test 20: CLI files handles session with no files..."
mkdir -p .git/trace/sessions
echo '{}' > .git/trace/sessions/nofiles-session.jsonl
echo "$(date -Iseconds)" > .git/trace/sessions/nofiles-session.timestamp
touch .git/trace/sessions/nofiles-session.files
OUTPUT=$("$CLI" files nofiles 2>&1)
if echo "$OUTPUT" | grep -q "nofiles"; then
    echo "  PASS"
else
    echo "  FAIL: should handle empty files list"
    echo "  Output: $OUTPUT"
    exit 1
fi
rm -f .git/trace/sessions/nofiles-session.*

# Test 21: CLI share works with .agents/ directory
echo "Test 21: CLI share works with .agents/ directory..."
mkdir -p .agents
echo '{"session_id": "agents-test-session", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/agents.py"}}' | "$HOOK"
"$CLI" share agents-test >/dev/null 2>&1
if [ -f ".agents/sessions/agents-test-session.jsonl" ]; then
    echo "  PASS"
else
    echo "  FAIL: session not copied to .agents/sessions/"
    ls -la .agents/ 2>/dev/null || echo "  .agents/ not found"
    exit 1
fi
rm -rf .agents

# Test 22: git config takes precedence over .agents/
echo "Test 22: git config takes precedence over .agents/..."
mkdir -p .agents
git config atrace.sharedir "custom/shared"
echo '{"session_id": "config-test-session", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/config.py"}}' | "$HOOK"
"$CLI" share config-test >/dev/null 2>&1
if [ -f "custom/shared/config-test-session.jsonl" ]; then
    echo "  PASS"
else
    echo "  FAIL: session should go to configured path, not .agents/"
    exit 1
fi
git config --unset atrace.sharedir
rm -rf .agents custom

# Test 23: CLI blame shows session attribution
echo "Test 23: CLI blame shows session attribution..."
# Create a file, commit it, and link to a session
echo "test content" > blame-test.txt
git add blame-test.txt
git commit -m "Add blame test file" >/dev/null 2>&1
COMMIT_SHA=$(git rev-parse HEAD)
echo '{"type":"user","message":{"content":"test"}}' > .git/trace/sessions/blame-session.jsonl
echo "$(date -Iseconds)" > .git/trace/sessions/blame-session.timestamp
"$CLI" link blame-session "$COMMIT_SHA" >/dev/null 2>&1
OUTPUT=$("$CLI" blame blame-test.txt 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
if echo "$OUTPUT" | grep -q "blame-se"; then
    echo "  PASS"
else
    echo "  FAIL: blame should show linked session"
    echo "  Output: $OUTPUT"
    exit 1
fi
git reset --hard HEAD~1 >/dev/null 2>&1
git notes --ref=refs/notes/atrace remove "$COMMIT_SHA" 2>/dev/null || true

# Test 24: CLI export produces valid Agent Trace JSON
echo "Test 24: CLI export produces valid Agent Trace JSON..."
echo '{"session_id": "export-test-session", "transcript_path": "'"$TRANSCRIPT"'", "tool_name": "Edit", "tool_input": {"file_path": "'"$TMPDIR"'/export.py"}}' | "$HOOK"
echo "def hello(): pass" > "$TMPDIR/export.py"
OUTPUT=$("$CLI" export export-test 2>&1)
# Check required fields exist
if echo "$OUTPUT" | jq -e '.version and .id and .timestamp and .files' >/dev/null 2>&1; then
    echo "  PASS"
else
    echo "  FAIL: export should produce valid Agent Trace JSON with required fields"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 25: CLI export includes correct file paths
echo "Test 25: CLI export includes correct file paths..."
if echo "$OUTPUT" | jq -e '.files[0].path' | grep -q "export.py"; then
    echo "  PASS"
else
    echo "  FAIL: export should include file paths"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 26: CLI export includes ranges with start_line and end_line
echo "Test 26: CLI export includes ranges with line numbers..."
if echo "$OUTPUT" | jq -e '.files[0].conversations[0].ranges[0].start_line' >/dev/null 2>&1; then
    echo "  PASS"
else
    echo "  FAIL: export should include ranges with line numbers"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 27: CLI export includes vcs info
echo "Test 27: CLI export includes vcs info..."
if echo "$OUTPUT" | jq -e '.vcs.type == "git" and .vcs.revision' >/dev/null 2>&1; then
    echo "  PASS"
else
    echo "  FAIL: export should include vcs info"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 28: CLI import creates session from Agent Trace file
echo "Test 28: CLI import creates session from Agent Trace file..."
IMPORT_FILE="$TMPDIR/import-test.json"
cat > "$IMPORT_FILE" << 'IMPORT_EOF'
{
  "version": "0.1",
  "id": "imported-session-12345",
  "timestamp": "2024-01-15T10:30:00Z",
  "files": [
    {
      "path": "src/main.py",
      "conversations": [{
        "ranges": [{"start_line": 1, "end_line": 50}]
      }]
    }
  ],
  "vcs": {
    "type": "git",
    "revision": "abcd1234"
  }
}
IMPORT_EOF
"$CLI" import "$IMPORT_FILE" >/dev/null 2>&1
if [ -f ".git/trace/sessions/imported-session-12345.jsonl" ]; then
    echo "  PASS"
else
    echo "  FAIL: import should create session files"
    exit 1
fi

# Test 29: CLI import creates .files manifest
echo "Test 29: CLI import creates .files manifest..."
if [ -f ".git/trace/sessions/imported-session-12345.files" ] && grep -q "src/main.py" ".git/trace/sessions/imported-session-12345.files"; then
    echo "  PASS"
else
    echo "  FAIL: import should create .files manifest with paths"
    exit 1
fi

# Test 30: CLI import creates .timestamp
echo "Test 30: CLI import creates .timestamp..."
if [ -f ".git/trace/sessions/imported-session-12345.timestamp" ] && grep -q "2024-01-15" ".git/trace/sessions/imported-session-12345.timestamp"; then
    echo "  PASS"
else
    echo "  FAIL: import should create .timestamp with correct time"
    exit 1
fi

# Test 31: Imported session appears in list
echo "Test 31: Imported session appears in list..."
OUTPUT=$("$CLI" 2>&1)
if echo "$OUTPUT" | grep -q "imported"; then
    echo "  PASS"
else
    echo "  FAIL: imported session should appear in list"
    echo "  Output: $OUTPUT"
    exit 1
fi

# Test 32: CLI export handles missing session
echo "Test 32: CLI export handles missing session..."
OUTPUT=$("$CLI" export nonexistent-session 2>&1) || true
if echo "$OUTPUT" | grep -qi "not found"; then
    echo "  PASS"
else
    echo "  FAIL: export should report session not found"
    exit 1
fi

# Test 33: CLI import handles invalid file
echo "Test 33: CLI import handles invalid file..."
echo "not valid json" > "$TMPDIR/invalid.json"
OUTPUT=$("$CLI" import "$TMPDIR/invalid.json" 2>&1) || true
if echo "$OUTPUT" | grep -qi "invalid\|error"; then
    echo "  PASS"
else
    echo "  FAIL: import should reject invalid JSON"
    exit 1
fi

# Test 34: CLI import handles missing id field
echo "Test 34: CLI import handles missing id field..."
echo '{"version": "0.1", "files": []}' > "$TMPDIR/noid.json"
OUTPUT=$("$CLI" import "$TMPDIR/noid.json" 2>&1) || true
if echo "$OUTPUT" | grep -qi "missing\|invalid"; then
    echo "  PASS"
else
    echo "  FAIL: import should reject file without id"
    exit 1
fi

# Cleanup import test files
rm -f .git/trace/sessions/imported-session-12345.*

echo ""
echo "All CLI tests passed!"
