# GitHub Hidden-PR Filter

A tiny Chrome (Manifest V3) extension that hides the clutter from draft PRs
you've labeled `hidden`.

On these repos:

- `optimumenergyco/tesla-site`
- `optimumenergyco/core-ui`

it rewrites the repo **Pull requests** tab so that:

1. **The link** points at the `-label:hidden` filter
   (`?q=is:open+is:pr+-label:hidden`) instead of the default open-PR list.
2. **The count badge** shows the accurate hidden-excluded number. It fetches the
   filtered pulls page in the background (same-origin, using your logged-in
   session) and swaps the count in.

Any PR you want out of the way just needs the `hidden` label.

## Install (for teammates)

This isn't on the Chrome Web Store, so it installs "unpacked":

1. Get the code:
   - `git clone https://github.com/kquizz/gh-hide-prs`, **or**
   - Download the ZIP: green **Code** button → **Download ZIP** → unzip.
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `gh-hide-prs` folder.
5. Visit `tesla-site` or `core-ui` on GitHub — the Pull requests tab now
   reflects the hidden-excluded count and link.

### Staying up to date

Unpacked extensions don't auto-update. When there's a new version:

1. `git pull` (or re-download the ZIP).
2. Go to `chrome://extensions` and click the reload ↻ icon on the extension.

## Configuration

Edit `content.js`:

- `REPOS` — the `owner/repo` slugs to apply to.
- `FILTER_QUERY` — the encoded `q=` filter string (spaces as `+`, `:` as `%3A`).

The content script is matched to `https://github.com/optimumenergyco/*` (see
`manifest.json`) and additionally gates in JS to the repos in `REPOS`, so other
org repos are untouched. To cover a repo outside that org:

1. Add its match pattern to `content_scripts[0].matches` in `manifest.json`
   (e.g. `"https://github.com/your-org/*"`).
2. Add its `owner/repo` slug to `REPOS` in `content.js`.
3. Reload the extension.

To hide a different label, change `hidden` in `FILTER_QUERY` — e.g.
`-label:wip` becomes `q=is%3Aopen+is%3Apr+-label%3Awip`.

## How it works

- **Link rewrite** — finds the repo-scoped Pull requests tab (never the global
  app-header `/pulls` button) and sets its `href` to the filtered query.
- **Count** — background-fetches the filtered pulls page (same-origin, your
  session) and reads the "N Open" total, which honors the `-label:hidden`
  qualifier, then writes it into the tab's count badge.
- **Resilience** — supports both the current Primer React header
  (`CounterLabel`) and the classic server-rendered nav. A `MutationObserver`
  re-applies after GitHub's Turbo/PJAX navigations and after React re-renders
  the badge. Writes are no-ops when values already match, so it never loops.
- **Fail-safe** — if the background fetch fails (network or markup change), the
  extension leaves GitHub's own count untouched rather than showing a wrong
  number.

## License

[MIT](LICENSE) © Kevin Quillen. Use it, fork it, tweak it for your own repos.
