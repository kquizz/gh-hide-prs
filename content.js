// GitHub Hidden-PR Filter
// On any GitHub repo, point the "Pull requests" and "Issues" tabs at a filter
// that hides items by label, author, or (PRs only) draft status, and replace
// each count badge with the accurate filtered count plus a shown/hidden
// tooltip. Settings live in chrome.storage.sync.

(() => {
  'use strict'

  // Defaults, merged with anything the user has saved via the popup.
  const DEFAULTS = {
    enabled: true,
    hideLabels: ['hidden'],
    hideDrafts: false,
    hideAuthors: [],
  }

  // The two repo nav tabs we rewrite. `is:pr`/`is:issue` scope the count query;
  // drafts only exist for PRs.
  const TABS = [
    { seg: 'pulls', type: 'is:pr', allowDrafts: true },
    { seg: 'issues', type: 'is:issue', allowDrafts: false },
  ]

  // First path segments that are never an "owner" — cheap guard so the script
  // does nothing on the dashboard, settings, global lists, etc. (Correctness
  // doesn't depend on this list; missing entries just fall through to the
  // repo-nav check below.)
  const RESERVED = new Set([
    'settings', 'notifications', 'pulls', 'issues', 'marketplace', 'explore',
    'topics', 'sponsors', 'new', 'login', 'logout', 'join', 'orgs',
    'organizations', 'dashboard', 'search', 'codespaces', 'apps', 'about',
    'pricing', 'features', 'collections', 'trending', 'account', 'watching',
  ])

  // Count badge inside a tab. Covers the current Primer React header
  // (CounterLabel) and the classic server-rendered nav (repo-tab-count ids).
  const BADGE_SELECTOR =
    '[class*="CounterLabel"], [id$="repo-tab-count"], .Counter'

  let settings = { ...DEFAULTS }

  // Per-page-tab caches. Keyed by the full href so a settings change (new query)
  // naturally triggers a fresh fetch instead of showing stale data.
  const countCache = new Map() // href -> number
  const inFlight = new Set()   // href currently being fetched

  // Native values captured before we touch them, so we can restore on disable.
  const nativeHref = new WeakMap()  // anchor -> original href
  const nativeBadge = new WeakMap() // badge  -> { text, title }

  function currentRepo() {
    const parts = location.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    if (RESERVED.has(parts[0].toLowerCase())) return null
    return { owner: parts[0], repo: parts[1] }
  }

  // Build the encoded ?q= filter from current settings for a given tab.
  function buildQuery(tab) {
    const parts = ['is:open', tab.type]
    for (const raw of settings.hideLabels) {
      const label = String(raw).trim()
      if (label) parts.push(`-label:${/\s/.test(label) ? `"${label}"` : label}`)
    }
    for (const raw of settings.hideAuthors) {
      const author = String(raw).trim().replace(/^@/, '')
      if (author) parts.push(`-author:${author}`)
    }
    if (tab.allowDrafts && settings.hideDrafts) parts.push('draft:false')
    // Encode, then match GitHub's own style of "+" for spaces.
    return 'q=' + encodeURIComponent(parts.join(' ')).replace(/%20/g, '+')
  }

  function tabHref(owner, repo, tab) {
    return `/${owner}/${repo}/${tab.seg}?${buildQuery(tab)}`
  }

  // The repo-scoped nav tab for `seg` — NOT the global app-header button.
  // Prefer a scoped link that owns a count badge; fall back to the underline
  // nav item, then any scoped link.
  function findTab(owner, repo, seg) {
    const base = `/${owner}/${repo}/${seg}`
    const scoped = [...document.querySelectorAll('a')].filter(
      (a) => (a.getAttribute('href') || '').startsWith(base)
    )
    return (
      scoped.find((a) => a.querySelector(BADGE_SELECTOR)) ||
      scoped.find((a) => /UnderlineItem/.test(String(a.className))) ||
      scoped[0] ||
      null
    )
  }

  // Extract the filtered open count from a fetched pulls/issues page. GitHub
  // serves two shapes: the classic server-rendered list (an "N Open" toggle)
  // and the newer React Issues UI (count embedded as JSON "issueCount":N).
  function parseOpenCount(html) {
    // Strategy 1: classic "N Open" toggle.
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

    // Strategy 2: React Issues UI embeds the search result count. Only trust it
    // when every occurrence agrees, so we never guess between ambiguous values.
    const distinct = [
      ...new Set(
        [...html.matchAll(/"issueCount":\s*(\d+)/g)].map((m) => parseInt(m[1], 10))
      ),
    ]
    if (distinct.length === 1) return distinct[0]

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

  function updateBadge(tab, filtered) {
    const badge = tab.querySelector(BADGE_SELECTOR)
    if (!badge) return
    if (!nativeBadge.has(badge)) {
      nativeBadge.set(badge, {
        text: badge.textContent,
        title: badge.getAttribute('title'),
      })
    }

    setBadgeText(badge, filtered.toLocaleString('en-US'))

    // Tooltip: how many were hidden, derived from the native (unfiltered) total.
    const total = parseInt(String(nativeBadge.get(badge).text).replace(/[^\d]/g, ''), 10)
    const title =
      Number.isFinite(total) && total >= filtered
        ? `${filtered.toLocaleString('en-US')} shown · ` +
          `${(total - filtered).toLocaleString('en-US')} hidden`
        : `${filtered.toLocaleString('en-US')} shown`
    if (badge.getAttribute('title') !== title) badge.setAttribute('title', title)

    badge.hidden = false
    badge.removeAttribute('hidden')
  }

  // Put GitHub's own link + count back when the extension is disabled.
  function restoreTab(tab) {
    if (nativeHref.has(tab)) {
      const href = nativeHref.get(tab)
      if (tab.getAttribute('href') !== href) tab.setAttribute('href', href)
    }
    const badge = tab.querySelector(BADGE_SELECTOR)
    if (badge && nativeBadge.has(badge)) {
      const orig = nativeBadge.get(badge)
      setBadgeText(badge, String(orig.text).trim())
      if (orig.title == null) badge.removeAttribute('title')
      else badge.setAttribute('title', orig.title)
    }
  }

  function applyTab(owner, repo, tab, el) {
    const href = tabHref(owner, repo, tab)
    if (!nativeHref.has(el)) nativeHref.set(el, el.getAttribute('href'))
    if (el.getAttribute('href') !== href) el.setAttribute('href', href)

    const cached = countCache.get(href)
    if (typeof cached === 'number') updateBadge(el, cached)
    else fetchCount(href)
  }

  function apply() {
    const repo = currentRepo()
    if (!repo) return

    for (const tab of TABS) {
      const el = findTab(repo.owner, repo.repo, tab.seg)
      if (!el) continue
      if (settings.enabled) applyTab(repo.owner, repo.repo, tab, el)
      else restoreTab(el)
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
