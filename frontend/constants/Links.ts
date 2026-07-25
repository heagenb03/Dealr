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
 */

export const PRIVACY_POLICY_URL =
  'https://heagenb03.github.io/cashcage/privacy-policy.html';

export const TERMS_URL =
  'https://heagenb03.github.io/cashcage/terms-of-service.html';

export const SUPPORT_EMAIL = 'cashcageapp@gmail.com';
