# git-atrace

Capture AI coding sessions and link them to commits and lines.

## Why

When AI tools generate code, we lose context of why and whence that code; and the final 
artifact is often alienated from its inputs.

`git-atrace` captures the coding sessions and links them to the files that were edited.
Sessions are stored locally by default, and can be explicitly shared like any git object.

This tool is small, follows git conventions, and is written in bash. Requires `jq` for viewing sessions.

## How It Works

1. **Capture**: A post-tool hook copies the conversation transcript when you edit files
2. **Store**: Sessions are saved locally in `.git/trace/sessions/` (private by default)
3. **Share**: Explicitly share sessions to a tracked location (syncs with git)
4. **View**: CLI or web UI to browse sessions and see which files they touched

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/tnm/git-atrace/main/install.sh | bash
```

This installs `git-atrace` and `git-atrace-hook` to `~/.local/bin/`.

Or clone manually:

```bash
git clone https://github.com/tnm/git-atrace
cd git-atrace
export PATH="$PATH:$(pwd)"
```

### Claude Code

Install as a plugin from GitHub:

```
/plugin marketplace add tnm/git-atrace
/plugin install git-atrace@git-atrace
```

Or clone and point to it:

```bash
git clone https://github.com/tnm/git-atrace ~/.local/share/git-atrace
claude --plugin-dir ~/.local/share/git-atrace
```

### OpenCode

Copy the hook config to your project or user config:

```bash
cp hooks/opencode/oh-my-opencode.json .opencode/
# Edit paths to point to your git-atrace installation
```

The config includes hooks for both session capture (on file edits) and auto-linking (on git commit).

### Gemini CLI

Copy the hook config:

```bash
cp hooks/gemini/settings.json .gemini/
# Edit paths to point to your git-atrace installation
```

The config includes hooks for both session capture and auto-linking.

### Hook Summary

Each tool needs two hooks:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `git-atrace-hook` | File edits | Captures session transcript |
| `git-atrace-commit-hook` | Git commit | Links session to commit |

Sessions are captured automatically when the AI assistant edits files, and linked to commits when committing from within the AI tool.

## Usage

When `git-atrace` is in your PATH, git picks it up as a subcommand (`git atrace`).

### List sessions

```bash
git atrace
```

Shows recent sessions with timestamps and file counts:

```
Sessions

  3ea80c57  2024-01-23T03:52:52Z  (3 files)  [local]
  a1b2c3d4  2024-01-22T22:30:00Z  (1 files)  [shared]
```

### Show sessions for a file

```bash
git atrace show src/auth.py
```

### View a session

```bash
git atrace view 3ea80c57
```

Shows the full conversation:

```
Session: 3ea80c57-6b85-4ca6-bec1-d6d471d207e2

> Add login with rate limiting

I'll create a login function with rate limiting...
[Edit]

> The SQL looks injectable

You're right, let me fix that with parameterized queries...
[Edit]
```

### List files in a session

```bash
git atrace files 3ea80c57
```

### Share a session

```bash
git atrace share 3ea80c57
```

Copies the session to a tracked location and stages it for commit. Now it syncs with your repo.

By default, sharing goes to `.agents/sessions/` if a `.agents/` directory exists (common with AI tooling). Otherwise, configure a location:

```bash
git config atrace.sharedir .trace/sessions
```

### Delete a session

```bash
git atrace delete 3ea80c57
```

Removes the session (checks local first, then shared).

### Link a session to a commit

```bash
git atrace link 3ea80c57        # links to HEAD
git atrace link 3ea80c57 abc123 # links to specific commit
```

Associates a session with a commit using git notes (`refs/notes/atrace`).

### Show commits with linked sessions

```bash
git atrace log
```

```
Commits with sessions

  7490404  Add test2.c for attribution testing
          ↳ 3ea80c57
```

### Blame with session attribution

```bash
git atrace blame src/auth.py
```

Shows each line with its commit and linked session (if any):

```
Blame: src/auth.py
(commits with linked sessions shown in cyan)

055a2d0 d5eb95cd def login(user, password):
055a2d0 d5eb95cd     # Rate limiting added per review
01d6eb9 05fac6aa     if is_rate_limited(user):
01d6eb9 05fac6aa         raise RateLimitError()
(local)              return check_password(user, password)
```

Uncommitted changes show as `(local)` in yellow.

**Caveats** (same as `git blame`):
- Shows "last touched", not "originally written"
- Reformatting or moving code changes ownership
- Only works for commits linked via `git atrace link`
- **Squash/rebase/amend loses links** - session links are git notes attached to commit SHAs; any operation that rewrites commits (squash, rebase, amend) orphans the links, same as `git blame`

### Auto-link sessions to commits

When using AI coding tools with the hooks installed, sessions are automatically linked to commits. The `git-atrace-commit-hook` detects `git commit` commands and links the current session to HEAD.

This works because Claude Code, OpenCode, and Gemini CLI all pass `session_id` to hooks, so we know exactly which session made the commit.

For manual linking:

```bash
git atrace link <session_id>        # links to HEAD
git atrace link <session_id> abc123 # links to specific commit
```

## Web UI (Demo)

A simple local viewer for browsing sessions. For demo and development purposes only—not production-ready.

```bash
./web/start
```

Opens a viewer at http://localhost:3000 with:
- File browser
- Session list with file counts
- Full conversation viewer

## Storage

**Local** (private, not synced):
```
.git/trace/sessions/
  {session_id}.jsonl    # Full conversation
  {session_id}.files    # Files edited
  {session_id}.timestamp
```

**Shared** (tracked, syncs with git):

Sessions are shared to one of:
- `.agents/sessions/` — if `.agents/` exists (git-atrace won't create directories automatically)
- Custom path via `git config atrace.sharedir <path>`

```
.agents/sessions/       # or your configured path
  {session_id}.jsonl
  {session_id}.files
```

### Session IDs

Each AI coding session has a unique ID (a UUID like `3ea80c57-6b85-4ca6-bec1-d6d471d207e2`). Commands accept the first 8 characters as shorthand:

```bash
git atrace view 3ea80c57    # matches 3ea80c57-6b85-4ca6-...
```

The `.files` list tracks which files were edited during that session. This is how `git atrace show <file>` finds relevant sessions.

## Privacy Model

Nothing leaves your machine unless you explicitly share it:

| Data | Local (default) | Share explicitly |
|------|-----------------|------------------|
| Sessions | `.git/trace/sessions/` | `git atrace share <id>` → configured location |
| Commit links | `refs/notes/atrace` | `git push origin refs/notes/atrace` |

## CI/CD Integration

### Syncing session links

Session links are stored in git notes (`refs/notes/atrace`). To share them across clones:

```bash
# Push notes to remote
git push origin refs/notes/atrace

# Fetch notes from remote
git fetch origin refs/notes/atrace:refs/notes/atrace
```

### GitHub Actions example

To automatically sync session links in CI:

```yaml
# .github/workflows/sync-atrace.yml
name: Sync session links
on: [push]
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: |
          git fetch origin refs/notes/atrace:refs/notes/atrace || true
          git push origin refs/notes/atrace || true
```

### Squash merges

git-atrace follows `git blame` semantics. If your workflow uses squash merges, session links on the original commits will be lost (the commits no longer exist). Any operation that rewrites commits (squash, rebase, amend) loses the original attribution.

Options:

1. **Avoid squash** - use merge commits to preserve history
2. **Re-link after squash** - manually link a session to the squash commit
3. **Accept the tradeoff** - detailed blame attribution may not matter for all projects

## Design Principles

- **Session-centric**: The conversation is the unit, not the commit
- **Local by default**: Sessions are private until explicitly shared
- **AI tool hooks**: Uses AI tool hooks (PostToolUse), not git hooks
- **Simple**: No dependencies beyond bash and jq, rule of least power

## Specification

See [RFC-draft.txt](RFC-draft.txt) for the formal specification.

## License

MIT
