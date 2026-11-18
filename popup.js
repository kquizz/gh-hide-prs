// Settings popup. Reads/writes chrome.storage.sync; the content script reacts
// to changes live via chrome.storage.onChanged.

const DEFAULTS = {
  enabled: true,
  hideLabels: ['hidden'],
  hideDrafts: false,
  hideAuthors: [],
  hideDiffComments: true,
  repos: ['optimumenergyco/tesla-site', 'optimumenergyco/core-ui'],
}

const enabledEl = document.getElementById('enabled')
const hideDraftsEl = document.getElementById('hideDrafts')
const hideDiffCommentsEl = document.getElementById('hideDiffComments')

let state = { ...DEFAULTS }

function save() {
  chrome.storage.sync.set(state)
}

function renderEnabled() {
  enabledEl.checked = state.enabled
  document.body.classList.toggle('off', !state.enabled)
}

// A reusable chip-list editor bound to one array field in `state`.
function makeListEditor({ key, containerId, inputId, buttonId, emptyText, normalize }) {
  const container = document.getElementById(containerId)
  const input = document.getElementById(inputId)
  const button = document.getElementById(buttonId)

  function render() {
    container.textContent = ''
    if (state[key].length === 0) {
      const empty = document.createElement('span')
      empty.className = 'empty'
      empty.textContent = emptyText
      container.appendChild(empty)
      return
    }
    for (const value of state[key]) {
      const chip = document.createElement('span')
      chip.className = 'chip'
      const text = document.createElement('span')
      text.textContent = value
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = '×'
      remove.title = `Remove "${value}"`
      remove.addEventListener('click', () => {
        state[key] = state[key].filter((v) => v !== value)
        render()
        save()
      })
      chip.append(text, remove)
      container.appendChild(chip)
    }
  }

  function add() {
    const value = normalize ? normalize(input.value) : input.value.trim()
    input.value = ''
    input.focus()
    if (!value) return
    if (state[key].some((v) => v.toLowerCase() === value.toLowerCase())) return
    state[key] = [...state[key], value]
    render()
    save()
  }

  button.addEventListener('click', add)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add()
  })

  return { render }
}

const labels = makeListEditor({
  key: 'hideLabels',
  containerId: 'labels',
  inputId: 'labelInput',
  buttonId: 'addLabel',
  emptyText: 'No labels — nothing is hidden by label.',
})

const authors = makeListEditor({
  key: 'hideAuthors',
  containerId: 'authors',
  inputId: 'authorInput',
  buttonId: 'addAuthor',
  emptyText: 'No authors — nothing is hidden by author.',
})

// Accept a pasted GitHub URL (https://github.com/owner/repo/pulls) and reduce
// it to owner/repo; anything else is just trimmed.
function normalizeRepo(raw) {
  const value = raw.trim()
  const m = value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)/i)
  return m ? `${m[1]}/${m[2].replace(/\.git$/i, '')}` : value
}

const repos = makeListEditor({
  key: 'repos',
  containerId: 'repos',
  inputId: 'repoInput',
  buttonId: 'addRepo',
  emptyText: 'No repos — active on every repo.',
  normalize: normalizeRepo,
})

enabledEl.addEventListener('change', () => {
  state.enabled = enabledEl.checked
  renderEnabled()
  save()
})

hideDraftsEl.addEventListener('change', () => {
  state.hideDrafts = hideDraftsEl.checked
  save()
})

hideDiffCommentsEl.addEventListener('change', () => {
  state.hideDiffComments = hideDiffCommentsEl.checked
  save()
})

chrome.storage.sync.get(DEFAULTS, (stored) => {
  state = { ...DEFAULTS, ...stored }
  renderEnabled()
  hideDraftsEl.checked = state.hideDrafts
  hideDiffCommentsEl.checked = state.hideDiffComments
  labels.render()
  authors.render()
  repos.render()
})
