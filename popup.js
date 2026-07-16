// Settings popup. Reads/writes chrome.storage.sync; the content script reacts
// to changes live via chrome.storage.onChanged.

const DEFAULTS = {
  enabled: true,
  hideLabels: ['hidden'],
  hideDrafts: false,
  hideAuthors: [],
}

const enabledEl = document.getElementById('enabled')
const hideDraftsEl = document.getElementById('hideDrafts')

let state = { ...DEFAULTS }

function save() {
  chrome.storage.sync.set(state)
}

function renderEnabled() {
  enabledEl.checked = state.enabled
  document.body.classList.toggle('off', !state.enabled)
}

// A reusable chip-list editor bound to one array field in `state`.
function makeListEditor({ key, containerId, inputId, buttonId, emptyText }) {
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
    const value = input.value.trim()
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

enabledEl.addEventListener('change', () => {
  state.enabled = enabledEl.checked
  renderEnabled()
  save()
})

hideDraftsEl.addEventListener('change', () => {
  state.hideDrafts = hideDraftsEl.checked
  save()
})

chrome.storage.sync.get(DEFAULTS, (stored) => {
  state = { ...DEFAULTS, ...stored }
  renderEnabled()
  hideDraftsEl.checked = state.hideDrafts
  labels.render()
  authors.render()
})
