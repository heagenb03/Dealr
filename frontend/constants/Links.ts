/**
 * Outbound links and the support address, in one place.
 *
 * These live here rather than inline at each call site because the same two URLs
 * were previously duplicated across about.tsx and PaywallModal.tsx, and the legal
 * repo rename (cashcage-legal -> cashcage, 2026-07-25) had to be applied twice.
 * GitHub Pages does not redirect renamed repos, so a missed copy ships a dead
 * Privacy Policy / EULA link. Pinned by constants/__tests__/Links.test.ts.
 *
 * Served from the nested `legal/` git repo (github.com/heagenb03/cashcage), which
 * deploys to GitHub Pages on push to its own main.
 *
 * Note (2026-07-25): these are the `/cashcage/` Pages paths. The old
 * `/cashcage-legal/*` paths are forward-redirect stubs in a separate repo
 * (github.com/heagenb03/cashcage-legal) that keep already-shipped app builds
 * working - do not delete that repo. If these values ever change, App Store
 * Connect's Privacy Policy URL, Support URL, and the two in-description URL
 * lines must change with them.
 */

export const PRIVACY_POLICY_URL =
  'https://heagenb03.github.io/cashcage/privacy-policy.html';

export const TERMS_URL =
  'https://heagenb03.github.io/cashcage/terms-of-service.html';

export const SUPPORT_EMAIL = 'cashcageapp@gmail.com';
