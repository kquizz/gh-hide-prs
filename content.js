// GitHub Hidden-PR Filter
// On any GitHub repo, point the "Pull requests" and "Issues" tabs at a filter
// that hides items by label, author, or (PRs only) draft status, and replace
// each count badge with the accurate filtered count plus a shown/hidden
// tooltip. On the Pull requests list, also injects a few hardcoded query
// shortcuts (with live counts) into the left sidebar, alongside GitHub's own
// "Authored by me" / "Assigned to me" links. Settings live in
// chrome.storage.sync.

(() => {
  'use strict'

  // Defaults, merged with anything the user has saved via the popup.
  const DEFAULTS = {
    enabled: true,
    hideLabels: ['hidden'],
    hideDrafts: false,
    hideAuthors: [],
  }

  // Hardcoded PR-tab query shortcuts injected into the Pull requests sidebar.
  // "Normal" reuses the label/author/draft builder below; the rest are fixed
  // search queries. `icon` is shown when the sidebar is collapsed to its
  // icon-only rail, where there's no room for the label text.
  const SIDEBAR_PRESETS = [
    {
      key: 'normal',
      label: 'Normal',
      query: null,
      icon: '<line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/>',
    },
    {
      key: 'needsReview',
      label: 'Needs Review',
      query: 'is:open is:pr -label:hidden label:"🤖 Ready for Human Review" draft:false -author:@me -review:approved -review:changes_requested',
      icon: '<path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5Z"/><circle cx="8" cy="8" r="2"/>',
    },
    {
      key: 'needsWork',
      label: 'Needs Work',
      query: 'is:open is:pr -label:hidden draft:false (label:"🤖 Dev Work Needed" OR review:changes_requested) author:@me',
      icon: '<path stroke-linejoin="round" d="M8 1.5 14.5 13.5h-13Z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11.5" r="0.75" fill="currentColor" stroke="none"/>',
    },
    {
      key: 'needsMerge',
      label: 'Needs Merge',
      query: 'is:open is:pr -label:hidden draft:false review:approved author:@me',
      icon: '<path stroke-linejoin="round" d="M3 8.5 6.5 12 13 4"/>',
    },
  ]

  // Marks sidebar <li>s we injected, so we can find and clear them cleanly.
  const SIDEBAR_MARKER = 'data-ghp-hide-prs'

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

  // Encode a raw search query into a GitHub-style "q=" string (GitHub uses
  // "+" for spaces rather than the default "%20").
  function encodeQuery(query) {
    return 'q=' + encodeURIComponent(query).replace(/%20/g, '+')
  }

  // Build the encoded ?q= filter from current settings for a given tab.
  function buildQuery(tab) {
    const parts = ['is:open', tab.type]
    for (const raw of settings.hideLabels) {
      let label = String(raw).trim()
      if (!label) continue
      // A "!label" entry means "hide items that DON'T have this label" —
      // flip to a positive `label:` filter instead of the usual `-label:`.
      const negate = label.startsWith('!')
      if (negate) label = label.slice(1).trim()
      if (!label) continue
      const quoted = /\s/.test(label) ? `"${label}"` : label
      parts.push(negate ? `label:${quoted}` : `-label:${quoted}`)
    }
    for (const raw of settings.hideAuthors) {
      const author = String(raw).trim().replace(/^@/, '')
      if (author) parts.push(`-author:${author}`)
    }
    if (tab.allowDrafts && settings.hideDrafts) parts.push('draft:false')
    return encodeQuery(parts.join(' '))
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
  // has served this in three different shapes over time: the current Primer
  // "SectionFilterLink" nav (CounterLabel span), the classic server-rendered
  // list (an "N Open" toggle), and the React Issues UI (JSON "issueCount":N).
  function parseOpenCount(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')

    // Strategy 1: newer Primer "SectionFilterLink" nav (Open/Closed tabs),
    // e.g. an "Open" link containing a CounterLabel span rendering "40".
    for (const counter of doc.querySelectorAll('[data-component="CounterLabel"]')) {
      const link = counter.closest('a, button')
      if (!link) continue
      const label = link.textContent.replace(/\s+/g, ' ').trim()
      if (/^open/i.test(label)) {
        const n = parseInt(counter.textContent.replace(/[^\d]/g, ''), 10)
        if (Number.isFinite(n)) return n
      }
    }

    // Strategy 2: classic "N Open" toggle.
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

    // Strategy 3: React Issues UI embeds the search result count. Only trust it
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

  // The left sidebar's "Authored by me" / "Assigned to me" / etc. list —
  // we append our shortcuts to the same <ul>.
  function findSidebarList() {
    const anchor = [...document.querySelectorAll('a')].find((a) => {
      const text = a.textContent.trim()
      return text === 'Authored by me' || text === 'Assigned to me' || text === 'Involves me'
    })
    return anchor ? anchor.closest('ul') : null
  }

  function presetHref(owner, repo, preset) {
    const q = preset.query ? encodeQuery(preset.query) : buildQuery(TABS[0])
    return `/${owner}/${repo}/pulls?${q}`
  }

  function clearSidebar() {
    document.querySelectorAll(`li[${SIDEBAR_MARKER}]`).forEach((li) => li.remove())
  }

  // GitHub marks its collapsed icon-only sidebar rail with
  // data-expanded="false" on the <aside> ancestor. These selectors key off
  // that attribute directly so our items collapse/expand in lockstep with
  // GitHub's own — instantly, via plain CSS, with no JS involved (our
  // MutationObserver doesn't watch attribute changes, so this couldn't
  // otherwise react to the toggle).
  function injectSidebarStyle() {
    if (document.getElementById('ghp-hide-prs-style')) return
    const style = document.createElement('style')
    style.id = 'ghp-hide-prs-style'
    style.textContent = `
      .ghp-sidebar-link:hover { background: var(--bgColor-neutral-muted, rgba(110,118,129,.15)); }
      .ghp-sidebar-link-icon { flex: 0 0 auto; display: none; align-items: center; justify-content: center; }
      /* !important below: the anchor/count base styles are set inline
         (element.style.cssText) in buildSidebarItem, which otherwise always
         wins over an external stylesheet regardless of selector specificity. */
      [data-expanded="false"] .ghp-sidebar-link {
        justify-content: flex-start !important; gap: 6px;
      }
      [data-expanded="false"] .ghp-sidebar-link-icon { display: flex; }
      [data-expanded="false"] .ghp-sidebar-link-text { display: none; }
      /* Collapsed rail: keep the count visible next to the icon instead of
         hiding it — the whole point of these shortcuts is seeing the
         numbers at a glance. */
      [data-expanded="false"] .ghp-sidebar-link-count {
        background: none !important; color: var(--fgColor-muted, inherit) !important;
        min-width: 0 !important; padding: 0 !important; font-size: 13px; line-height: 1;
      }
    `
    document.head.appendChild(style)
  }

  function buildSidebarItem(key, iconPath) {
    const li = document.createElement('li')
    li.setAttribute(SIDEBAR_MARKER, key)

    const a = document.createElement('a')
    a.className = 'ghp-sidebar-link'
    a.style.cssText =
      'display: flex; align-items: center; justify-content: space-between; ' +
      'gap: 8px; padding: 6px 8px; margin: 0 -8px; border-radius: 6px; ' +
      'text-decoration: none; color: inherit; font-size: 14px;'

    const icon = document.createElement('span')
    icon.className = 'ghp-sidebar-link-icon'
    icon.innerHTML =
      `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ` +
      `stroke-width="1.5" stroke-linecap="round">${iconPath}</svg>`

    const text = document.createElement('span')
    text.className = 'ghp-sidebar-link-text'

    const count = document.createElement('span')
    count.className = 'ghp-sidebar-link-count'
    count.style.cssText =
      'background: var(--bgColor-neutral-muted, rgba(110,118,129,.4)); ' +
      'color: var(--fgColor-muted, inherit); border-radius: 999px; ' +
      'padding: 0 8px; font-size: 12px; line-height: 18px; min-width: 20px; text-align: center;'

    a.append(icon, text, count)
    li.appendChild(a)
    return li
  }

  // Reconciles the sidebar shortcut list against SIDEBAR_PRESETS, reusing
  // existing nodes and only touching the DOM when a value actually changed —
  // otherwise our own writes would re-trigger the MutationObserver forever.
  function renderSidebar(owner, repo) {
    if (!settings.enabled) {
      clearSidebar()
      return
    }
    const list = findSidebarList()
    if (!list) {
      clearSidebar()
      return
    }

    injectSidebarStyle()

    for (const preset of SIDEBAR_PRESETS) {
      const href = presetHref(owner, repo, preset)
      let li = list.querySelector(`:scope > li[${SIDEBAR_MARKER}="${preset.key}"]`)
      if (!li) {
        li = buildSidebarItem(preset.key, preset.icon)
        list.appendChild(li)
      }

      const a = li.querySelector('a')
      const text = a.querySelector('.ghp-sidebar-link-text')
      const count = a.querySelector('.ghp-sidebar-link-count')

      if (a.getAttribute('href') !== href) a.setAttribute('href', href)
      if (text.textContent !== preset.label) text.textContent = preset.label

      const cached = countCache.get(href)
      const countText = typeof cached === 'number' ? cached.toLocaleString('en-US') : '…'
      if (count.textContent !== countText) count.textContent = countText
      if (typeof cached !== 'number') fetchCount(href)

      const title = `${preset.label} — ${countText}`
      if (a.getAttribute('title') !== title) a.setAttribute('title', title)
    }
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

    const parts = location.pathname.split('/').filter(Boolean)
    const onPullsList = parts.length === 3 && parts[2] === 'pulls'
    if (onPullsList) renderSidebar(repo.owner, repo.repo)
    else clearSidebar()
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
