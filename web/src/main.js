import { codeToHtml } from 'shiki'

// State
let files = []
let sessions = []
let currentFile = null
let currentSession = null

// DOM Elements
const app = {
  fileTree: document.getElementById('file-tree'),
  sessionList: document.getElementById('session-list'),
  emptyState: document.getElementById('empty-state'),
  fileView: document.getElementById('file-view'),
  sessionView: document.getElementById('session-view'),
  diffView: document.getElementById('diff-view'),
  breadcrumb: document.getElementById('breadcrumb'),
  fileMeta: document.getElementById('file-meta'),
  codeContainer: document.getElementById('code-container'),
  diffContainer: document.getElementById('diff-container'),
  diffBreadcrumb: document.getElementById('diff-breadcrumb'),
  sessionIdDisplay: document.getElementById('session-id-display'),
  sessionFiles: document.getElementById('session-files'),
  conversation: document.getElementById('conversation'),
  themeToggle: document.getElementById('theme-toggle'),
  logo: document.getElementById('logo'),
  fileSessionsCount: document.getElementById('file-sessions-count'),
  fileSessionsList: document.getElementById('file-sessions-list'),
}

// Theme
function initTheme() {
  const saved = localStorage.getItem('theme')
  if (saved === 'light') {
    document.documentElement.classList.add('light')
  }
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light')
  localStorage.setItem('theme', isLight ? 'light' : 'dark')
  // Re-render if viewing a file
  if (currentFile) {
    selectFile(currentFile)
  }
}

function getTheme() {
  return document.documentElement.classList.contains('light') ? 'github-light' : 'github-dark'
}

// Get language from filename
function getLang(filename) {
  const ext = filename.split('.').pop().toLowerCase()
  const map = {
    js: 'javascript', mjs: 'javascript', ts: 'typescript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    c: 'c', h: 'c', cpp: 'cpp', java: 'java',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    json: 'json', md: 'markdown', html: 'html', css: 'css',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml'
  }
  return map[ext] || 'text'
}

// Tabs
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
      tab.classList.add('active')
      document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active')
      if (tab.dataset.tab === 'sessions') {
        document.querySelectorAll('.session-item').forEach(i => i.classList.remove('dimmed'))
      }
    })
  })
}

// API
async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function fetchFiles() {
  return fetchJson('/api/files')
}

async function fetchSessions() {
  return fetchJson('/api/sessions')
}

async function fetchFileContent(path) {
  const res = await fetch(`/api/file?file=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.text()
}

async function fetchBlame(path) {
  return fetchJson(`/api/blame?file=${encodeURIComponent(path)}`)
}

async function fetchSession(id) {
  return fetchJson(`/api/session/${id}`)
}

// Build file -> sessions map
function buildFileSessionsMap() {
  const map = {}
  for (const session of sessions) {
    for (const f of session.files) {
      const key = files.find(file =>
        file === f ||
        f.endsWith('/' + file) ||
        file.endsWith('/' + f) ||
        file.split('/').pop() === f.split('/').pop()
      )
      if (key) {
        if (!map[key]) map[key] = []
        map[key].push(session)
      }
    }
  }
  return map
}

// Get sessions for a specific file
function getSessionsForFile(filePath) {
  return sessions.filter(s =>
    s.files.some(f =>
      f === filePath ||
      f.endsWith('/' + filePath) ||
      filePath.endsWith('/' + f) ||
      f.split('/').pop() === filePath.split('/').pop()
    )
  )
}

// Render file tree
function renderFileTree() {
  const fileSessionsMap = buildFileSessionsMap()
  app.fileTree.replaceChildren()

  for (const f of files) {
    const li = document.createElement('li')
    li.className = 'file-item'
    li.dataset.file = f

    const icon = document.createElement('span')
    icon.className = 'icon'
    icon.textContent = '\u25B8'
    li.appendChild(icon)

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = f
    li.appendChild(name)

    const sessionCount = fileSessionsMap[f]?.length || 0
    if (sessionCount > 0) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.dataset.file = f
      badge.textContent = sessionCount
      badge.addEventListener('click', (e) => {
        e.stopPropagation()
        filterSessionsByFile(f)
      })
      li.appendChild(badge)
    }

    li.addEventListener('click', (e) => {
      if (!e.target.classList.contains('badge')) {
        selectFile(f)
      }
    })

    app.fileTree.appendChild(li)
  }
}

// Render session list
function renderSessionList() {
  app.sessionList.replaceChildren()

  if (sessions.length === 0) {
    const li = document.createElement('li')
    li.className = 'loading'
    li.textContent = 'No sessions captured yet'
    app.sessionList.appendChild(li)
    return
  }

  for (const s of sessions) {
    const li = document.createElement('li')
    li.className = 'session-item'
    li.dataset.id = s.id

    const idSpan = document.createElement('span')
    idSpan.className = 'session-id'
    idSpan.textContent = s.id.substring(0, 8)
    li.appendChild(idSpan)

    const info = document.createElement('span')
    info.className = 'session-info'

    const count = document.createElement('span')
    count.className = 'session-files-count'
    count.textContent = `${s.files.length} file${s.files.length !== 1 ? 's' : ''}`
    info.appendChild(count)

    const badge = document.createElement('span')
    badge.className = `session-badge ${s.shared ? 'shared' : ''}`
    badge.textContent = s.shared ? 'shared' : 'local'
    info.appendChild(badge)

    li.appendChild(info)

    li.addEventListener('click', () => {
      app.sessionList.querySelectorAll('.session-item').forEach(i => i.classList.remove('dimmed'))
      selectSession(s.id)
    })

    app.sessionList.appendChild(li)
  }
}

// Filter sessions by file
function filterSessionsByFile(filePath) {
  document.querySelector('[data-tab="sessions"]').click()

  const matchingSessions = sessions.filter(s =>
    s.files.some(f =>
      f === filePath ||
      f.endsWith('/' + filePath) ||
      filePath.endsWith('/' + f) ||
      f.split('/').pop() === filePath.split('/').pop()
    )
  )

  app.sessionList.querySelectorAll('.session-item').forEach(item => {
    const matches = matchingSessions.some(s => s.id === item.dataset.id)
    item.classList.toggle('dimmed', !matches)
  })
}

// Select file
async function selectFile(path) {
  currentFile = path
  currentSession = null

  app.fileTree.querySelectorAll('.file-item').forEach(i =>
    i.classList.toggle('active', i.dataset.file === path)
  )
  app.sessionList.querySelectorAll('.session-item').forEach(i =>
    i.classList.remove('active')
  )

  app.emptyState.hidden = true
  app.sessionView.hidden = true
  app.diffView.hidden = true
  app.fileView.hidden = false

  app.codeContainer.replaceChildren()
  const loadingDiv = document.createElement('div')
  loadingDiv.className = 'loading'
  loadingDiv.textContent = 'Loading...'
  app.codeContainer.appendChild(loadingDiv)

  try {
    // Fetch blame data (includes session attribution per line)
    const blame = await fetchBlame(path)
    const content = blame.lines.map(l => l.content).join('\n')

    const parts = path.split('/')
    const name = parts.pop()
    const dir = parts.join('/')
    app.breadcrumb.replaceChildren()
    if (dir) {
      app.breadcrumb.appendChild(document.createTextNode(dir + '/'))
    }
    const strong = document.createElement('strong')
    strong.textContent = name
    app.breadcrumb.appendChild(strong)
    app.fileMeta.textContent = `${blame.lines.length} lines`

    // Syntax highlight with Shiki
    const html = await codeToHtml(content, {
      lang: getLang(path),
      theme: getTheme()
    })

    // Parse Shiki output and rebuild with line numbers + session info
    const temp = document.createElement('div')
    temp.innerHTML = html
    const pre = temp.querySelector('pre')
    const codeEl = pre?.querySelector('code')

    let codeLines = []
    if (codeEl) {
      const lineSpans = codeEl.querySelectorAll('.line')
      if (lineSpans.length > 0) {
        codeLines = Array.from(lineSpans).map(span => span.outerHTML)
      } else {
        codeLines = codeEl.innerHTML.split('\n')
      }
    }

    const tableRows = codeLines.map((lineHtml, i) => {
      const line = blame.lines[i] || {}
      const uncommittedClass = line.uncommitted ? 'uncommitted' : ''
      const sessionClass = line.session ? 'has-session' : ''
      const sessionAttr = line.session ? `data-session="${line.session}"` : ''
      const commitCell = line.uncommitted
        ? `<td class="line-commit uncommitted-label">(local)</td>`
        : `<td class="line-commit">${line.commit || ''}</td>`
      const sessionCell = line.uncommitted
        ? `<td class="line-session"></td>`
        : line.session
          ? `<td class="line-session" ${sessionAttr} title="Session ${line.session}">${line.session}</td>`
          : `<td class="line-session"></td>`
      return `<tr class="${sessionClass} ${uncommittedClass}" ${sessionAttr}><td class="line-num">${i + 1}</td>${commitCell}${sessionCell}<td class="line-code">${lineHtml}</td></tr>`
    }).join('')

    const preStyle = pre?.getAttribute('style') || ''
    app.codeContainer.innerHTML =
      `<div class="code-wrapper"><table class="code-table" style="${preStyle}"><thead><tr><th class="line-num-header">#</th><th class="line-commit-header">commit</th><th class="line-session-header">session</th><th class="line-code-header">code</th></tr></thead><tbody>${tableRows}</tbody></table></div>`

    // Make session cells clickable
    app.codeContainer.querySelectorAll('.line-session[data-session]').forEach(cell => {
      cell.addEventListener('click', () => {
        const sessionId = cell.dataset.session
        // Find full session ID from our sessions list
        const fullSession = sessions.find(s => s.id.startsWith(sessionId))
        if (fullSession) {
          selectSession(fullSession.id)
        }
      })
    })

    // Show sessions for this file
    const fileSessions = getSessionsForFile(path)
    app.fileSessionsCount.textContent = `${fileSessions.length} session${fileSessions.length !== 1 ? 's' : ''}`

    app.fileSessionsList.replaceChildren()
    if (fileSessions.length === 0) {
      const noSessions = document.createElement('div')
      noSessions.className = 'no-sessions'
      noSessions.textContent = 'No sessions have touched this file'
      app.fileSessionsList.appendChild(noSessions)
    } else {
      for (const s of fileSessions) {
        const card = document.createElement('div')
        card.className = 'session-card'
        card.dataset.id = s.id

        const idSpan = document.createElement('span')
        idSpan.className = 'session-card-id'
        idSpan.textContent = s.id.substring(0, 8)
        card.appendChild(idSpan)

        const meta = document.createElement('span')
        meta.className = 'session-card-meta'
        meta.appendChild(document.createTextNode(`${s.files.length} file${s.files.length !== 1 ? 's' : ''} `))

        const badge = document.createElement('span')
        badge.className = `session-card-badge ${s.shared ? 'shared' : ''}`
        badge.textContent = s.shared ? 'shared' : 'local'
        meta.appendChild(badge)

        card.appendChild(meta)
        card.addEventListener('click', () => selectSession(s.id))
        app.fileSessionsList.appendChild(card)
      }
    }
  } catch (err) {
    console.error('Error loading file:', err)
    showError(app.codeContainer, `Failed to load file: ${err.message}`)
  }
}

// Select session
async function selectSession(id) {
  currentSession = id
  currentFile = null

  app.sessionList.querySelectorAll('.session-item').forEach(i =>
    i.classList.toggle('active', i.dataset.id === id)
  )
  app.fileTree.querySelectorAll('.file-item').forEach(i =>
    i.classList.remove('active')
  )

  app.emptyState.hidden = true
  app.fileView.hidden = true
  app.diffView.hidden = true
  app.sessionView.hidden = false

  app.conversation.replaceChildren()
  const loadingMsg = document.createElement('div')
  loadingMsg.className = 'loading'
  loadingMsg.textContent = 'Loading session...'
  app.conversation.appendChild(loadingMsg)

  try {
    const session = await fetchSession(id)

    if (session.error) {
      showError(app.conversation, session.error)
      return
    }

    app.sessionIdDisplay.textContent = session.id.substring(0, 8)

    app.sessionFiles.replaceChildren()
    const sessionData = sessions.find(s => s.id === session.id)
    if (sessionData?.files.length > 0) {
      for (const f of sessionData.files) {
        const tag = document.createElement('span')
        tag.className = 'file-tag'
        tag.dataset.file = f
        tag.textContent = f.split('/').pop()
        tag.addEventListener('click', () => {
          document.querySelector('[data-tab="files"]').click()
          selectFile(f)
        })
        app.sessionFiles.appendChild(tag)
      }
    }

    app.conversation.replaceChildren()
    for (const msg of session.messages) {
      if (msg.toolUse) {
        const toolDiv = document.createElement('div')
        toolDiv.className = 'tool-use'
        toolDiv.textContent = msg.toolUse.name
        app.conversation.appendChild(toolDiv)
      } else {
        const msgDiv = document.createElement('div')
        msgDiv.className = `message ${msg.type}`

        const role = document.createElement('div')
        role.className = 'message-role'
        role.textContent = msg.type
        msgDiv.appendChild(role)

        const content = document.createElement('div')
        content.className = 'message-content'
        content.textContent = msg.content || ''
        msgDiv.appendChild(content)

        app.conversation.appendChild(msgDiv)
      }
    }
  } catch (err) {
    console.error('Error loading session:', err)
    showError(app.conversation, `Failed to load session: ${err.message}`)
  }
}

// Go home
function goHome() {
  currentFile = null
  currentSession = null

  app.fileTree.querySelectorAll('.file-item').forEach(i => i.classList.remove('active'))
  app.sessionList.querySelectorAll('.session-item').forEach(i => {
    i.classList.remove('active')
    i.classList.remove('dimmed')
  })

  app.fileView.hidden = true
  app.sessionView.hidden = true
  app.diffView.hidden = true
  app.emptyState.hidden = false
}

// Show error in a container
function showError(container, message) {
  container.replaceChildren()
  const div = document.createElement('div')
  div.className = 'error-state'
  div.textContent = message
  container.appendChild(div)
}

// Initialize
async function init() {
  initTheme()
  initTabs()

  app.themeToggle.addEventListener('click', toggleTheme)
  app.logo.addEventListener('click', goHome)

  // Load data
  try {
    const [filesData, sessionsData] = await Promise.all([
      fetchFiles(),
      fetchSessions()
    ])

    files = filesData
    sessions = sessionsData

    renderFileTree()
    renderSessionList()
  } catch (err) {
    console.error('Failed to load data:', err)
    showError(app.fileTree, 'Failed to load files')
    showError(app.sessionList, 'Failed to load sessions')
  }
}

// Start
init()
