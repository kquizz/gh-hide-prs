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

## Install

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select this folder (`~/Code/gh-hide-prs`).
4. Visit either repo on GitHub — the Pull requests tab now reflects the
   hidden-excluded count and link.

Reload the extension from `chrome://extensions` after editing files.

## Configuration

Edit `content.js`:

- `REPOS` — the `owner/repo` slugs to apply to.
- `FILTER_QUERY` — the encoded `q=` filter string.

The content script is matched to `https://github.com/optimumenergyco/*` (see
`manifest.json`) and additionally gates in JS to the repos in `REPOS`, so other
org repos are untouched. To cover repos outside that org, add their match
pattern to `manifest.json` and their slug to `REPOS`.

## Notes

- If the background fetch fails (network/markup change), the extension leaves
  GitHub's own count badge alone rather than showing a wrong number.
- GitHub navigates via Turbo/PJAX (no full reloads); a `MutationObserver`
  re-applies the rewrite after in-app navigation. Writes are no-ops when values
  already match, so it won't loop.
