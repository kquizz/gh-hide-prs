// GitHub Hidden-PR Filter
// On the configured repos, point the "Pull requests" tab at a filter that hides
// PRs by label (and optionally drafts), and replace its count badge with the
// accurate filtered count. Settings live in chrome.storage.sync.

(() => {
  'use strict'

  // Repos this extension applies to, as "owner/repo".
  const REPOS = new Set([
    'optimumenergyco/tesla-site',
    'optimumenergyco/core-ui',
  ])

  // Defaults, merged with anything the user has saved via the popup.
  const DEFAULTS = {
    enabled: true,
    hideLabels: ['hidden'],
    hideDrafts: false,
  }

  // Count badge inside the tab. Covers the current Primer React header
  // (CounterLabel) and the classic server-rendered nav (old ids/classes).
  const BADGE_SELECTOR =
    '[class*="CounterLabel"], #pull-requests-repo-tab-count, .Counter'

  let settings = { ...DEFAULTS }

  // Per-page-tab caches. Keyed by the full pulls href so a settings change
  // (new query) naturally triggers a fresh fetch instead of showing stale data.
  const countCache = new Map() // href -> number
  const inFlight = new Set()   // href currently being fetched

  // Native values captured before we touch them, so we can restore on disable.
  const nativeHref = new WeakMap()  // anchor -> original href
  const nativeCount = new WeakMap() // badge  -> original text

  function currentRepo() {
    const parts = location.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const slug = `${parts[0]}/${parts[1]}`
    return REPOS.has(slug) ? { owner: parts[0], repo: parts[1], slug } : null
  }

  // Build the encoded ?q= filter from current settings.
  function buildQuery() {
    const parts = ['is:open', 'is:pr']
    for (const raw of settings.hideLabels) {
      const label = String(raw).trim()
      if (!label) continue
      parts.push(`-label:${/\s/.test(label) ? `"${label}"` : label}`)
    }
    if (settings.hideDrafts) parts.push('draft:false')
    // Encode, then match GitHub's own style of "+" for spaces.
    return 'q=' + encodeURIComponent(parts.join(' ')).replace(/%20/g, '+')
  }

  function pullsHref(owner, repo) {
    return `/${owner}/${repo}/pulls?${buildQuery()}`
  }

  // The repo "Pull requests" tab — NOT the global app-header "/pulls" button.
  // Prefer a repo-scoped pulls link that owns a count badge; fall back to the
  // underline nav item, the classic id, then any repo-scoped pulls link.
  function findPullsTab(owner, repo) {
    const base = `/${owner}/${repo}/pulls`
    const scoped = [...document.querySelectorAll('a')].filter(
      (a) => (a.getAttribute('href') || '').startsWith(base)
    )
    return (
      scoped.find((a) => a.querySelector(BADGE_SELECTOR)) ||
      scoped.find((a) => /UnderlineItem/.test(String(a.className))) ||
      document.querySelector('#pull-requests-tab') ||
      scoped[0] ||
      null
    )
  }

  // Extract the "N Open" count from a fetched pulls page.
  function parseOpenCount(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const anchors = [
      ...doc.querySelectorAll('a[data-ga-click*="Table state, Open"]'),
      ...doc.querySelectorAll('.table-list-header-toggle a'),
      ...doc.querySelectorAll('a'),
    ]
    for (const a of anchors) {
      const text = a.textContent.replace(/\s+/g, ' ').trim()
      const match = text.match(/^([\d,]+)\s+Open$/i)
      if (match) return parseInt(match[1].replace(/,/g, ''), 10)
    }
    return null
  }

  async function fetchCount(href) {
    if (inFlight.has(href)) return
    inFlight.add(href)
    try {
      const res = await fetch(href, {
        credentials: 'same-origin',
        headers: { 'Accept': 'text/html' },
      })
      if (!res.ok) return
      const count = parseOpenCount(await res.text())
      if (count !== null) {
        countCache.set(href, count)
        apply() // re-render badge now that we have the number
      }
    } catch (_e) {
      // Network/parse failure: leave GitHub's own badge untouched.
    } finally {
      inFlight.delete(href)
    }
  }

  function setBadgeText(badge, text) {
    if (badge.textContent.trim() !== text) badge.textContent = text
  }

  function updateBadge(tab, count) {
    const badge = tab.querySelector(BADGE_SELECTOR)
    if (!badge) return
    if (!nativeCount.has(badge)) nativeCount.set(badge, badge.textContent)
    setBadgeText(badge, count.toLocaleString('en-US'))
    const title = String(count)
    if (badge.getAttribute('title') !== title) badge.setAttribute('title', title)
    badge.hidden = false
    badge.removeAttribute('hidden')
  }

  // Put GitHub's own link + count back when the extension is disabled.
  function restore() {
    const repo = currentRepo()
    if (!repo) return
    const tab = findPullsTab(repo.owner, repo.repo)
    if (!tab) return
    if (nativeHref.has(tab)) {
      const href = nativeHref.get(tab)
      if (tab.getAttribute('href') !== href) tab.setAttribute('href', href)
    }
    const badge = tab.querySelector(BADGE_SELECTOR)
    if (badge && nativeCount.has(badge)) setBadgeText(badge, nativeCount.get(badge).trim())
  }

  function apply() {
    const repo = currentRepo()
    if (!repo) return

    if (!settings.enabled) {
      restore()
      return
    }

    const tab = findPullsTab(repo.owner, repo.repo)
    if (!tab) return

    // 1. Rewrite the tab link to the filter (capturing the native href first).
    const href = pullsHref(repo.owner, repo.repo)
    if (!nativeHref.has(tab)) nativeHref.set(tab, tab.getAttribute('href'))
    if (tab.getAttribute('href') !== href) tab.setAttribute('href', href)

    // 2. Update the count badge if we know the real number for this filter.
    const cached = countCache.get(href)
    if (typeof cached === 'number') {
      updateBadge(tab, cached)
    } else {
      fetchCount(href)
    }
  }

  // Re-apply on SPA navigations and React re-renders. Our writes are no-ops when
  // values already match, so re-applying on our own mutations can't loop.
  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      apply()
    })
  }

  function startObserving() {
    const observer = new MutationObserver(schedule)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    for (const evt of ['turbo:load', 'turbo:render', 'pjax:end', 'pageshow']) {
      document.addEventListener(evt, schedule)
    }
  }

  // React to settings changes from the popup without a page reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    for (const key of Object.keys(changes)) {
      if (key in settings) settings[key] = changes[key].newValue
    }
    schedule()
  })

  chrome.storage.sync.get(DEFAULTS, (stored) => {
    settings = { ...DEFAULTS, ...stored }
    startObserving()
    apply()
  })
})()
