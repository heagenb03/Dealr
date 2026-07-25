# legal-redirect-stubs

Four static HTML pages that forward-redirect to the live Cash Cage legal site at
`https://heagenb03.github.io/cashcage/`.

These are pushed to `github.com/heagenb03/cashcage-legal` - a stub-only repo, NOT the
content repo (the content repo, and its legal pages, live in the nested `legal/` git
repo at `github.com/heagenb03/cashcage`).

## Why this exists

GitHub Pages does not redirect renamed repos. When `cashcage-legal` was renamed to
`cashcage`, every already-shipped app build with the old `/cashcage-legal/*` URL
compiled in would otherwise start hitting a hard 404. Standing up a new, separate
`cashcage-legal` repo that serves nothing but these forward-redirect stubs keeps those
old links resolving without ever touching the content repo again.

## Files

Each of the 4 stubs here corresponds to a real page in the content repo:

- `index.html` -> `https://heagenb03.github.io/cashcage/`
- `privacy-policy.html` -> `https://heagenb03.github.io/cashcage/privacy-policy.html`
- `terms-of-service.html` -> `https://heagenb03.github.io/cashcage/terms-of-service.html`
- `account-deletion.html` -> `https://heagenb03.github.io/cashcage/account-deletion.html`

Do not delete the `cashcage-legal` repo these are pushed to, and do not rename the
content repo again - either would re-break every installed 2.0.0 copy of the app.
