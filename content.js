// GitHub Hidden-PR Filter
// On the configured repos, point the "Pull requests" tab at the -label:hidden
// filter and replace its count badge with the accurate hidden-excluded count.

(() => {
  'use strict'

  // Repos this extension applies to, as "owner/repo".
  const REPOS = new Set([
    'optimumenergyco/tesla-site',
    'optimumenergyco/core-ui',
  ])

  // The saved filter. Encoded to match GitHub's own ?q= links (spaces -> +).
  const FILTER_QUERY = 'q=is%3Aopen+is%3Apr+-label%3Ahidden'

  // Count badge inside the tab. Covers the current Primer React header
  // (CounterLabel) and the classic server-rendered nav (old ids/classes).
  const BADGE_SELECTOR =
    '[class*="CounterLabel"], #pull-requests-repo-tab-count, .Counter'

  // Cache the fetched count per repo for this page-tab's lifetime so SPA
  // (Turbo/PJAX) navigations don't re-fetch on every DOM mutation.
  const countCache = new Map() // "owner/repo" -> number | null
  const inFlight = new Set()   // "owner/repo" currently being fetched

  function currentRepo() {
    const parts = location.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const slug = `${parts[0]}/${parts[1]}`
    return REPOS.has(slug) ? { owner: parts[0], repo: parts[1], slug } : null
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

  function pullsHref(owner, repo) {
    return `/${owner}/${repo}/pulls?${FILTER_QUERY}`
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

  async function fetchCount(owner, repo, slug) {
    if (inFlight.has(slug)) return
    inFlight.add(slug)
    try {
      const res = await fetch(pullsHref(owner, repo), {
        credentials: 'same-origin',
        headers: { 'Accept': 'text/html' },
      })
      if (!res.ok) return
      const count = parseOpenCount(await res.text())
      if (count !== null) {
        countCache.set(slug, count)
        apply() // re-render badge now that we have the number
      }
    } catch (_e) {
      // Network/parse failure: leave GitHub's own badge untouched.
    } finally {
      inFlight.delete(slug)
    }
  }

  function updateBadge(tab, count) {
    const badge = tab.querySelector(BADGE_SELECTOR)
    if (!badge) return
    const text = count.toLocaleString('en-US')
    if (badge.textContent.trim() !== text) badge.textContent = text
    const title = String(count)
    if (badge.getAttribute('title') !== title) badge.setAttribute('title', title)
    badge.hidden = false
    badge.removeAttribute('hidden')
  }

  function apply() {
    const repo = currentRepo()
    if (!repo) return

    const tab = findPullsTab(repo.owner, repo.repo)
    if (!tab) return

    // 1. Rewrite the tab link to the hidden-excluded filter.
    const href = pullsHref(repo.owner, repo.repo)
    if (tab.getAttribute('href') !== href) tab.setAttribute('href', href)

    // 2. Update the count badge if we know the real number.
    const cached = countCache.get(repo.slug)
    if (typeof cached === 'number') {
      updateBadge(tab, cached)
    } else {
      fetchCount(repo.owner, repo.repo, repo.slug)
    }
  }

  // Re-apply on SPA navigations. Our own writes are no-ops when values already
  // match, so this observer won't loop.
  let scheduled = false
  function schedule() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      apply()
    })
  }

  // Watch text changes too: GitHub's React header re-renders the count badge,
  // which would otherwise revert our value. Our writes are no-ops when already
  // correct, so re-applying on our own mutations can't loop.
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // Turbo/PJAX events fire on GitHub navigations; clear stale count on URL change.
  let lastPath = location.pathname
  for (const evt of ['turbo:load', 'turbo:render', 'pjax:end', 'pageshow']) {
    document.addEventListener(evt, () => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname
      }
      schedule()
    })
  }

  apply()
})()
