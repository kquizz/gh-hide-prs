// Settings popup. Reads/writes chrome.storage.sync; the content script reacts
// to changes live via chrome.storage.onChanged.

const DEFAULTS = {
  enabled: true,
  hideLabels: ['hidden'],
  hideDrafts: false,
}

const enabledEl = document.getElementById('enabled')
const hideDraftsEl = document.getElementById('hideDrafts')
const labelsEl = document.getElementById('labels')
const labelInput = document.getElementById('labelInput')
const addLabelBtn = document.getElementById('addLabel')

let state = { ...DEFAULTS }

function save() {
  chrome.storage.sync.set(state)
}

function renderEnabled() {
  enabledEl.checked = state.enabled
  document.body.classList.toggle('off', !state.enabled)
}

function renderLabels() {
  labelsEl.textContent = ''
  if (state.hideLabels.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'empty'
    empty.textContent = 'No labels — nothing is hidden by label.'
    labelsEl.appendChild(empty)
    return
  }
  for (const label of state.hideLabels) {
    const chip = document.createElement('span')
    chip.className = 'chip'
    const text = document.createElement('span')
    text.textContent = label
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '×'
    remove.title = `Remove "${label}"`
    remove.addEventListener('click', () => {
      state.hideLabels = state.hideLabels.filter((l) => l !== label)
      renderLabels()
      save()
    })
    chip.append(text, remove)
    labelsEl.appendChild(chip)
  }
}

function addLabel() {
  const value = labelInput.value.trim()
  labelInput.value = ''
  labelInput.focus()
  if (!value) return
  if (state.hideLabels.some((l) => l.toLowerCase() === value.toLowerCase())) return
  state.hideLabels = [...state.hideLabels, value]
  renderLabels()
  save()
}

enabledEl.addEventListener('change', () => {
  state.enabled = enabledEl.checked
  renderEnabled()
  save()
})

hideDraftsEl.addEventListener('change', () => {
  state.hideDrafts = hideDraftsEl.checked
  save()
})

addLabelBtn.addEventListener('click', addLabel)
labelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addLabel()
})

chrome.storage.sync.get(DEFAULTS, (stored) => {
  state = { ...DEFAULTS, ...stored }
  renderEnabled()
  hideDraftsEl.checked = state.hideDrafts
  renderLabels()
})
