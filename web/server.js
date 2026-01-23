import { createServer } from "http";
import { readFile, readdir, stat, access } from "fs/promises";
import { createReadStream } from "fs";
import { spawn } from "child_process";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const REPO_ROOT = process.env.REPO_ROOT || join(__dirname, "..");
const STATIC_DIR = process.env.NODE_ENV === 'development'
  ? join(__dirname, "public")  // Legacy fallback
  : join(__dirname, "dist");   // Vite build output
const LOCAL_SESSIONS = join(REPO_ROOT, ".git", "trace", "sessions");

// Security: sanitize user-provided paths to prevent traversal
function sanitizePath(userPath, baseDir) {
  // Normalize and resolve the path
  const resolved = join(baseDir, userPath);
  // Ensure it stays within baseDir
  if (!resolved.startsWith(baseDir + "/") && resolved !== baseDir) {
    return null;
  }
  return resolved;
}

// Security: validate session ID format (UUID or UUID prefix)
function isValidSessionId(id) {
  return /^[a-f0-9-]{1,36}$/i.test(id);
}

// Get shared sessions path (mirrors git-atrace logic)
async function getSharedSessionsPath() {
  // Check git config first
  try {
    const result = await new Promise((resolve) => {
      const proc = spawn("git", ["config", "atrace.sharedir"], { cwd: REPO_ROOT });
      let stdout = "";
      proc.stdout.on("data", (data) => stdout += data);
      proc.on("close", (code) => resolve(code === 0 ? stdout.trim() : null));
    });
    if (result) {
      return result.startsWith("/") ? result : join(REPO_ROOT, result);
    }
  } catch {}

  // Check if .agents/ exists
  if (await dirExists(join(REPO_ROOT, ".agents"))) {
    return join(REPO_ROOT, ".agents", "sessions");
  }

  // No shared sessions configured
  return null;
}

// Get list of files in repo
async function getFiles(dir, base = "") {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith(".") || name === "node_modules" || name === "web") continue;

    const path = join(dir, name);
    const relPath = base ? `${base}/${name}` : name;

    if (entry.isDirectory()) {
      files.push(...await getFiles(path, relPath));
    } else if (/\.(c|h|ts|js|md|py|json|sh)$/.test(name) || /^git-/.test(name)) {
      files.push(relPath);
    }
  }
  return files.sort();
}

// Get sessions that touched a file (via git-atrace show)
async function getSessionsForFileFromCLI(file) {
  return new Promise(async (resolve) => {
    const gitAtrace = join(REPO_ROOT, "git-atrace");
    const proc = spawn(gitAtrace, ["show", file], { cwd: REPO_ROOT });

    let stdout = "";
    proc.stdout.on("data", (data) => stdout += data);

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      // Parse output: session lines look like "  <id>  <timestamp>  [local|shared]"
      const sessions = [];
      for (const line of stdout.split("\n")) {
        const match = line.match(/^\s+([a-f0-9]+)\s+(\S+)\s+\[(local|shared)\]/);
        if (match) {
          sessions.push({ id: match[1], timestamp: match[2], shared: match[3] === "shared" });
        }
      }
      resolve(sessions);
    });
  });
}

// Get blame with session attribution
async function getBlame(file) {
  return new Promise((resolve) => {
    const filePath = join(REPO_ROOT, file);

    // First get all commits that touched this file and their session notes
    const commitSessions = new Map();
    const gitLog = spawn("git", ["log", "--format=%H", "--", file], { cwd: REPO_ROOT });

    let logOutput = "";
    gitLog.stdout.on("data", (data) => logOutput += data);

    gitLog.on("close", async () => {
      const commits = logOutput.trim().split("\n").filter(Boolean);

      // Look up session notes for each commit
      for (const commit of commits) {
        try {
          const note = await new Promise((res) => {
            const proc = spawn("git", ["notes", "--ref=refs/notes/atrace", "show", commit], { cwd: REPO_ROOT });
            let out = "";
            proc.stdout.on("data", (d) => out += d);
            proc.on("close", (code) => res(code === 0 ? out.trim().split("\n")[0] : null));
          });
          if (note) {
            commitSessions.set(commit, note);
          }
        } catch {}
      }

      // Now run git blame
      const blame = spawn("git", ["blame", "--porcelain", file], { cwd: REPO_ROOT });
      let blameOutput = "";
      blame.stdout.on("data", (data) => blameOutput += data);

      blame.on("close", (code) => {
        if (code !== 0) {
          resolve({ lines: [], error: "Failed to run git blame" });
          return;
        }

        const lines = [];
        let currentCommit = null;

        for (const line of blameOutput.split("\n")) {
          if (/^[0-9a-f]{40}/.test(line)) {
            currentCommit = line.substring(0, 40);
          } else if (line.startsWith("\t")) {
            const content = line.substring(1);
            // Detect uncommitted changes (all zeros)
            const isUncommitted = currentCommit && /^0+$/.test(currentCommit);
            const session = isUncommitted ? null : (commitSessions.get(currentCommit) || null);
            lines.push({
              commit: isUncommitted ? "(local)" : (currentCommit ? currentCommit.substring(0, 7) : null),
              session: session ? session.substring(0, 8) : null,
              uncommitted: isUncommitted,
              content
            });
          }
        }

        resolve({ lines });
      });
    });
  });
}

// Get content type
function getContentType(path) {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain";
}

// Check if directory exists
async function dirExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// List all sessions (local + shared)
async function getSessions() {
  const sessions = [];

  // Local sessions
  if (await dirExists(LOCAL_SESSIONS)) {
    const files = await readdir(LOCAL_SESSIONS);
    for (const file of files) {
      if (!file.endsWith(".timestamp")) continue;
      const id = basename(file, ".timestamp");
      const timestamp = await readFile(join(LOCAL_SESSIONS, file), "utf-8");
      const filesPath = join(LOCAL_SESSIONS, `${id}.files`);
      let touchedFiles = [];
      try {
        const content = await readFile(filesPath, "utf-8");
        touchedFiles = content.trim().split("\n").filter(Boolean);
      } catch {}
      sessions.push({ id, timestamp: timestamp.trim(), files: touchedFiles, shared: false });
    }
  }

  // Shared sessions (if configured)
  const sharedPath = await getSharedSessionsPath();
  if (sharedPath && await dirExists(sharedPath)) {
    const files = await readdir(sharedPath);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const id = basename(file, ".jsonl");
      // Skip if already in local
      if (sessions.find(s => s.id === id)) continue;
      const filesPath = join(sharedPath, `${id}.files`);
      let touchedFiles = [];
      try {
        const content = await readFile(filesPath, "utf-8");
        touchedFiles = content.trim().split("\n").filter(Boolean);
      } catch {}
      sessions.push({ id, timestamp: "", files: touchedFiles, shared: true });
    }
  }

  return sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// Get session conversation
async function getSessionConversation(sessionId) {
  // Find session file
  let sessionPath = null;
  const localPath = join(LOCAL_SESSIONS, `${sessionId}.jsonl`);
  const sharedDir = await getSharedSessionsPath();

  try {
    await access(localPath);
    sessionPath = localPath;
  } catch {
    if (sharedDir) {
      const sharedPath = join(sharedDir, `${sessionId}.jsonl`);
      try {
        await access(sharedPath);
        sessionPath = sharedPath;
      } catch {}
    }

    if (!sessionPath) {
      // Try partial match in local
      if (await dirExists(LOCAL_SESSIONS)) {
        const files = await readdir(LOCAL_SESSIONS);
        const match = files.find(f => f.startsWith(sessionId) && f.endsWith(".jsonl"));
        if (match) sessionPath = join(LOCAL_SESSIONS, match);
      }
      // Try partial match in shared
      if (!sessionPath && sharedDir && await dirExists(sharedDir)) {
        const files = await readdir(sharedDir);
        const match = files.find(f => f.startsWith(sessionId) && f.endsWith(".jsonl"));
        if (match) sessionPath = join(sharedDir, match);
      }
    }
  }

  if (!sessionPath) return null;

  // Parse JSONL and extract conversation
  const messages = [];
  const rl = createInterface({
    input: createReadStream(sessionPath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "user" || entry.type === "assistant") {
        const msg = { type: entry.type, timestamp: entry.timestamp };

        if (entry.type === "user") {
          if (typeof entry.message?.content === "string") {
            msg.content = entry.message.content;
          } else if (typeof entry.message === "string") {
            msg.content = entry.message;
          }
        } else if (entry.type === "assistant") {
          if (Array.isArray(entry.message?.content)) {
            for (const block of entry.message.content) {
              if (block.type === "text") {
                msg.content = block.text;
                break;
              } else if (block.type === "tool_use") {
                msg.toolUse = { name: block.name };
              }
            }
          }
        }

        if (msg.content || msg.toolUse) {
          messages.push(msg);
        }
      }
    } catch {}
  }

  return { id: basename(sessionPath, ".jsonl"), messages };
}

// Get sessions that touched a file
async function getSessionsForFile(filePath) {
  const sessions = await getSessions();
  return sessions.filter(s =>
    s.files.some(f => f === filePath || f.endsWith(filePath) || filePath.endsWith(f))
  );
}

// Handle requests
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    // API: list files
    if (url.pathname === "/api/files") {
      const files = await getFiles(REPO_ROOT);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(files));
      return;
    }

    // API: get sessions for a specific file (via CLI)
    if (url.pathname === "/api/file-sessions") {
      const file = url.searchParams.get("file");
      if (!file) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing file param" }));
        return;
      }
      const safePath = sanitizePath(file, REPO_ROOT);
      if (!safePath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid file path" }));
        return;
      }
      const sessions = await getSessionsForFileFromCLI(file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return;
    }

    // API: get file content
    if (url.pathname === "/api/file") {
      const file = url.searchParams.get("file");
      if (!file) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing file param" }));
        return;
      }
      const safePath = sanitizePath(file, REPO_ROOT);
      if (!safePath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid file path" }));
        return;
      }
      try {
        const content = await readFile(safePath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      }
      return;
    }

    // API: get blame with session attribution
    if (url.pathname === "/api/blame") {
      const file = url.searchParams.get("file");
      if (!file) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing file param" }));
        return;
      }
      const safePath = sanitizePath(file, REPO_ROOT);
      if (!safePath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid file path" }));
        return;
      }
      const blame = await getBlame(file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(blame));
      return;
    }

    // API: list sessions
    if (url.pathname === "/api/sessions") {
      const file = url.searchParams.get("file");
      let sessions;
      if (file) {
        sessions = await getSessionsForFile(file);
      } else {
        sessions = await getSessions();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sessions));
      return;
    }

    // API: get session conversation
    if (url.pathname.startsWith("/api/session/")) {
      const sessionId = url.pathname.replace("/api/session/", "");
      if (!isValidSessionId(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid session ID" }));
        return;
      }
      const session = await getSessionConversation(sessionId);
      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(session));
      return;
    }

    // Static files
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = sanitizePath(filePath, STATIC_DIR);
    if (!safePath) {
      res.writeHead(400);
      res.end("Invalid path");
      return;
    }

    try {
      const content = await readFile(safePath);
      res.writeHead(200, { "Content-Type": getContentType(safePath) });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  } catch (err) {
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`
┌─────────────────────────────────────┐
│  git-atrace viewer                  │
│  http://localhost:${PORT}              │
└─────────────────────────────────────┘
`);
});
