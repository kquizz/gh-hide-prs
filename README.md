# GitHub Hidden-PR Filter

A tiny Chrome (Manifest V3) extension that de-clutters GitHub's **Pull requests**
and **Issues** tabs by hiding items you don't want to see — by label, author, or
draft status.

Works on **any GitHub repo**. For each tab it:

1. **Rewrites the link** so clicking the tab lands on the filtered view
   (e.g. `?q=is:open+is:pr+-label:hidden`) instead of the default list.
2. **Fixes the count badge** to the accurate filtered number. It fetches the
   filtered list in the background (same-origin, using your logged-in session)
   and swaps the count in.
3. **Adds a tooltip** — hover the badge to see `N shown · M hidden`.

Anything you want out of the way just needs one of your configured labels
(default: `hidden`), a matching author, or draft status.

## Settings

Click the extension's toolbar icon for a popup where you can:

- **Enabled** — turn the whole thing on/off. Disabling instantly restores
  GitHub's native link and count (no page reload needed).
- **Hide draft PRs** — also exclude drafts (adds `draft:false`; PRs only).
- **Hide items with these labels** — add/remove any labels to exclude. Defaults
  to `hidden`; add as many as you like (labels with spaces are fine).
- **Hide items from these authors** — add/remove GitHub usernames to exclude.
  Empty by default.

Settings save automatically and sync across your Chrome profiles via
`chrome.storage.sync`.

## Install (for teammates)

This isn't on the Chrome Web Store, so it installs "unpacked":

1. Get the code:
   - `git clone https://github.com/kquizz/gh-hide-prs`, **or**
   - Download the ZIP: green **Code** button → **Download ZIP** → unzip.
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `gh-hide-prs` folder.
5. Open any GitHub repo — the Pull requests and Issues tabs now reflect your
   filters.

### Staying up to date

Unpacked extensions don't auto-update. When there's a new version:

1. `git pull` (or re-download the ZIP).
2. Go to `chrome://extensions` and click the reload ↻ icon on the extension.

## How it works

- **Repo detection** — the content script runs on `github.com/*` and acts only
  when it finds the repo-scoped Pull requests / Issues nav tabs. Non-repo pages
  (dashboard, settings, global lists) are left alone.
- **Link rewrite** — finds the repo-scoped tab (never the global app-header
  button) and sets its `href` to the filtered query.
- **Count** — background-fetches the filtered list and reads the total, which
  honors every qualifier. It handles both the classic server-rendered list
  (an "N Open" toggle) and the newer React Issues UI (count embedded as JSON).
- **Tooltip** — compares the filtered count against GitHub's native total to
  show how many were hidden.
- **Resilience** — supports both the Primer React header (`CounterLabel`) and
  the classic nav. A `MutationObserver` re-applies after Turbo/PJAX navigations
  and React re-renders. Writes are no-ops when values already match, so it
  never loops.
- **Fail-safe** — if the background fetch fails (network or markup change), the
  extension leaves GitHub's own count untouched rather than showing a wrong
  number.

## License

[MIT](LICENSE) © Kevin Quillen. Use it, fork it, tweak it for your own repos.
