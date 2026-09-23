// GitHub Hidden-PR Filter — comment-only diff lines
// On a PR's "Files changed" tab, hide added/removed lines whose only content
// is a code comment, so real code changes stand out. Each affected file gets a
// "N comment lines hidden" chip in its header to reveal them again. Works on
// both the React diff view (/changes) and the classic one (/files). Controlled
// by the `enabled` and `hideDiffComments` settings in chrome.storage.sync.

(() => {
  'use strict'

  const DEFAULTS = { enabled: true, hideDiffComments: true }

  // Row / file-container attributes we set. CSS keys off them, so revealing a
  // file is just flipping one attribute.
  const HIDDEN_ROW = 'data-ghp-comment-row'
  const SHOW_FILE = 'data-ghp-show-comments'
  const CHIP = 'data-ghp-comment-chip'

  // Line-comment prefixes by file extension (or bare filename). C-style
  // languages also get /* */ block lines via BLOCK below.
  const HASH = ['#']
  const SLASH = ['//']
  const LANGS = {
    rb: HASH, rake: HASH, gemspec: HASH, ru: HASH, py: HASH, sh: HASH, bash: HASH,
    zsh: HASH, fish: HASH, yml: HASH, yaml: HASH, toml: HASH, r: HASH, pl: HASH,
    pm: HASH, tf: HASH, hcl: HASH, ex: HASH, exs: HASH, cr: HASH, coffee: HASH,
    conf: HASH, cfg: HASH, env: HASH, gitignore: HASH, dockerignore: HASH,
    gemfile: HASH, rakefile: HASH, dockerfile: HASH, makefile: HASH, procfile: HASH,
    brewfile: HASH, podfile: HASH, mk: HASH,
    js: SLASH, jsx: SLASH, mjs: SLASH, cjs: SLASH, ts: SLASH, tsx: SLASH,
    mts: SLASH, cts: SLASH, c: SLASH, h: SLASH, cc: SLASH, cpp: SLASH, hpp: SLASH,
    cs: SLASH, java: SLASH, kt: SLASH, kts: SLASH, go: SLASH, rs: SLASH,
    swift: SLASH, scala: SLASH, dart: SLASH, groovy: SLASH, gradle: SLASH,
    proto: SLASH, scss: SLASH, less: SLASH, jsonc: SLASH, json5: SLASH,
    php: ['//', '#'], css: [],
    sql: ['--'], lua: ['--'], hs: ['--'], elm: ['--'],
    clj: [';'], cljs: [';'], el: [';'], lisp: [';'], ini: [';', '#'],
    erl: ['%'], tex: ['%'], vim: ['"'],
    html: ['<!--'], htm: ['<!--'], xml: ['<!--'], svg: ['<!--'], vue: ['<!--', '//'],
    svelte: ['<!--', '//'], erb: ['<%#', '<!--'], haml: ['-#', '/'], slim: ['/'],
  }
  const BLOCK_LANGS = new Set([
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'c', 'h', 'cc', 'cpp',
    'hpp', 'cs', 'java', 'kt', 'kts', 'go', 'rs', 'swift', 'scala', 'dart',
    'groovy', 'gradle', 'proto', 'scss', 'less', 'css', 'php', 'jsonc', 'json5',
    'vue', 'svelte', 'sql',
  ])
  // A /* */ block line: opener, closer, or a " * continued" line. `*` must be
  // followed by whitespace, `/`, or end of line so `*ptr = x` isn't a match.
  const BLOCK_RE = /^(\/\*|\*\/|\*(\s|\/|$))/

  let settings = { ...DEFAULTS }

  function langKey(path) {
    const name = path.split('/').pop().toLowerCase()
    if (name.startsWith('.env')) return 'env'
    // `.env.local`, `.gitignore`, `Dockerfile`, `foo.html.erb` → last segment.
    const parts = name.replace(/^\./, '').split('.')
    const ext = parts.length > 1 ? parts.pop() : parts[0]
    return (LANGS[ext] || BLOCK_LANGS.has(ext)) ? ext : null
  }

  function isComment(text, ext) {
    const line = text.trim()
    if (!line) return false
    if ((LANGS[ext] || []).some((p) => line.startsWith(p))) return true
    return BLOCK_LANGS.has(ext) && BLOCK_RE.test(line)
  }

  // --- DOM adapters -------------------------------------------------------
  // Each returns { container, header, path, rows } per rendered file, where a
  // row is { tr, cells: [{ kind: 'add'|'del'|'ctx'|'empty', text }] }.

  function reactFiles() {
    return [...document.querySelectorAll('table[aria-label^="Diff for:"]')].map((table) => {
      const container = table.closest('[id^="diff-"]') || table.parentElement
      const rows = [...table.querySelectorAll('tr.diff-line-row')].map((tr) => ({
        tr,
        cells: [...tr.querySelectorAll('td.diff-text-cell')].map((td) => {
          const code = td.querySelector('code.diff-text')
          const inner = td.querySelector('.diff-text-inner')
          const text = inner ? inner.textContent : ''
          if (!code) return { kind: 'empty', text }
          if (code.classList.contains('addition')) return { kind: 'add', text }
          if (code.classList.contains('deletion')) return { kind: 'del', text }
          return { kind: text.trim() ? 'ctx' : 'empty', text }
        }),
      }))
      return {
        container,
        header: container.querySelector('[data-diff-header-wrapper]'),
        path: table.getAttribute('aria-label').replace(/^Diff for:\s*/, ''),
        rows,
      }
    })
  }

  function classicFiles() {
    return [...document.querySelectorAll('.file[data-tagsearch-path], .file:has(.file-header[data-path])')].map((file) => {
      const rows = [...file.querySelectorAll('table.diff-table tr')]
        .filter((tr) => tr.querySelector('td.blob-code'))
        .map((tr) => ({
          tr,
          cells: [...tr.querySelectorAll('td.blob-code')].map((td) => {
            const inner = td.querySelector('.blob-code-inner')
            const text = inner ? inner.textContent : ''
            if (td.classList.contains('blob-code-addition')) return { kind: 'add', text }
            if (td.classList.contains('blob-code-deletion')) return { kind: 'del', text }
            if (td.classList.contains('blob-code-hunk')) return { kind: 'ctx', text: '@@' }
            return { kind: text.trim() ? 'ctx' : 'empty', text }
          }),
        }))
      return {
        container: file,
        header: file.querySelector('.file-header'),
        path: file.dataset.tagsearchPath || file.querySelector('.file-header').dataset.path,
        rows,
      }
    })
  }

  // --- Classification -----------------------------------------------------

  // Classify each row: 'comment' (only comment changes), 'blank' (only blank
  // changes), or null (has code or context). Blank changed lines are hidden
  // only when they sit in a run of changed rows that is comments-and-blanks
  // throughout, so a blank line added next to real code stays visible.
  function rowsToHide(rows, ext) {
    const kinds = rows.map(({ cells }) => {
      const changed = cells.filter((c) => c.kind === 'add' || c.kind === 'del')
      if (!changed.length || cells.some((c) => c.kind === 'ctx')) return null
      if (changed.every((c) => !c.text.trim())) return 'blank'
      return changed.every((c) => !c.text.trim() || isComment(c.text, ext)) ? 'comment' : 'code'
    })

    const hide = new Set()
    let run = []
    const flush = () => {
      if (run.length && !run.some((i) => kinds[i] === 'code') && run.some((i) => kinds[i] === 'comment')) {
        run.forEach((i) => hide.add(rows[i].tr))
      } else {
        run.filter((i) => kinds[i] === 'comment').forEach((i) => hide.add(rows[i].tr))
      }
      run = []
    }
    kinds.forEach((k, i) => (k ? run.push(i) : flush()))
    flush()
    return hide
  }

  // --- Rendering ----------------------------------------------------------

  function renderChip(file, count) {
    let chip = file.header && file.header.querySelector(`[${CHIP}]`)
    if (!count) {
      chip?.remove()
      return
    }
    if (!file.header) return
    if (!chip) {
      chip = document.createElement('button')
      chip.type = 'button'
      chip.setAttribute(CHIP, '')
      chip.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const container = chip.closest('[id^="diff-"], .file')
        container?.toggleAttribute(SHOW_FILE)
        apply()
      })
      // React header: sit at the start of the right-hand stats area; classic
      // header: before the file actions. Fall back to the end of the header.
      const slot =
        file.header.querySelector('.flex-justify-end.flex-1') ||
        file.header.querySelector('.file-actions')
      slot ? slot.prepend(chip) : file.header.append(chip)
    }
    const shown = file.container.hasAttribute(SHOW_FILE)
    const noun = count === 1 ? 'line' : 'lines'
    const label = shown ? `Hide ${count} comment ${noun}` : `${count} comment ${noun} hidden · show`
    if (chip.textContent !== label) chip.textContent = label
  }

  function clearAll() {
    document.querySelectorAll(`[${HIDDEN_ROW}]`).forEach((el) => el.removeAttribute(HIDDEN_ROW))
    document.querySelectorAll(`[${CHIP}]`).forEach((el) => el.remove())
  }

  function onDiffPage() {
    return /^\/[^/]+\/[^/]+\/(pull\/\d+\/(files|changes)|compare\/|commit\/)/.test(location.pathname)
  }

  function apply() {
    if (!settings.enabled || !settings.hideDiffComments || !onDiffPage()) {
      clearAll()
      return
    }
    for (const file of [...reactFiles(), ...classicFiles()]) {
      const ext = langKey(file.path || '')
      const hide = ext ? rowsToHide(file.rows, ext) : new Set()
      for (const { tr } of file.rows) {
        const want = hide.has(tr)
        if (want !== tr.hasAttribute(HIDDEN_ROW)) tr.toggleAttribute(HIDDEN_ROW, want)
      }
      renderChip(file, hide.size)
    }
  }

  function injectStyle() {
    if (document.getElementById('ghp-diff-comments-style')) return
    const style = document.createElement('style')
    style.id = 'ghp-diff-comments-style'
    style.textContent = `
      tr[${HIDDEN_ROW}] { display: none; }
      [${SHOW_FILE}] tr[${HIDDEN_ROW}] { display: table-row; opacity: 0.55; }
      [${CHIP}] {
        flex-shrink: 0; margin-right: 8px; padding: 1px 8px;
        font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer;
        color: var(--fgColor-muted, #656d76);
        background: var(--bgColor-neutral-muted, #afb8c133);
        border: 1px solid var(--borderColor-default, #d0d7de);
        border-radius: 999px;
      }
      [${CHIP}]:hover { color: var(--fgColor-default, #1f2328); }
    `
    ;(document.head || document.documentElement).appendChild(style)
  }

  // Coalesce bursts of mutations (lazy-loaded diffs, React re-renders) into
  // one pass per frame. Only childList is observed, so our own attribute
  // writes never retrigger it; chip inserts do once, and that pass is a no-op.
  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      apply()
    })
  }

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored }
    injectStyle()
    apply()
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true })
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key]
    }
    apply()
  })
})()
