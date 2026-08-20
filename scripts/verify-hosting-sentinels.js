#!/usr/bin/env node
/**
 * Predeploy gate for `firebase deploy` / `firebase deploy --only hosting`.
 *
 * NOTE: `firebase hosting:channel:deploy <channel>` does NOT run predeploy
 * hooks at all (verified against firebase-tools 15.5.1's deploy targets) —
 * this script never runs for a preview-channel deploy, so a channel deploy
 * can still ship unfilled sentinels or a missing claim file with no gate
 * firing. Lower severity (preview URLs, not cashcage-app.web.app), but real;
 * treat it as a manual check before any channel deploy. See Task 8 report.
 *
 * Two things this script guards, both required for real (non-sentinel)
 * universal/app links to work:
 *
 * 1. public/.well-known/apple-app-site-association and assetlinks.json ship
 *    with placeholder sentinels for two values that cannot be derived from
 *    this repo: the Apple Team ID and the Play app-signing SHA-256
 *    fingerprint (see Task 8 report,
 *    .superpowers/sdd/2026-08-19-shared-game-links/task-8-report.md, for
 *    exactly where to obtain each one). A sentinel that ships silently
 *    produces universal/app links that fail on every device with no visible
 *    error, and iOS caches that failure past a fix.
 * 2. Both claim files must actually exist and parse as valid JSON at deploy
 *    time — Firebase Hosting's ignore-glob behavior for `.well-known/` was
 *    checked empirically against the real `glob` dependency firebase-tools
 *    uses and found NOT to exclude these files (see Task 8 report), so this
 *    check exists as a genuine safety net against a file being accidentally
 *    deleted, renamed, or corrupted — not as a workaround for that glob
 *    behavior, which needs none.
 */

const fs = require('fs');
const path = require('path');

const SENTINELS = [
  {
    file: path.join(__dirname, '..', 'public', '.well-known', 'apple-app-site-association'),
    marker: '__APPLE_TEAM_ID__',
    label: 'Apple Team ID',
    source: 'developer.apple.com > Account > Membership, or `npx eas credentials -p ios` (frontend/) on the com.heagenb03.CashCage provisioning profile',
  },
  {
    file: path.join(__dirname, '..', 'public', '.well-known', 'assetlinks.json'),
    marker: '__PLAY_SHA256_FINGERPRINT__',
    label: 'Play app-signing SHA-256 fingerprint',
    source: 'Play Console > your app > Setup > App integrity > App signing key certificate (authoritative — not the EAS/upload keystore value)',
  },
];

let failed = false;

for (const { file, marker, label, source } of SENTINELS) {
  if (!fs.existsSync(file)) {
    console.error(
      `[verify-hosting-sentinels] MISSING FILE: ${file}\n` +
        `  This claim file is required for universal/app links to work at all.`
    );
    failed = true;
    continue;
  }

  const content = fs.readFileSync(file, 'utf8');

  try {
    JSON.parse(content);
  } catch (err) {
    console.error(
      `[verify-hosting-sentinels] INVALID JSON: ${file}\n` + `  Parse error: ${err.message}`
    );
    failed = true;
    continue;
  }

  if (content.includes(marker)) {
    console.error(
      `[verify-hosting-sentinels] BLOCKED: ${file} still contains the placeholder ` +
        `"${marker}" (${label}).\n` +
        `  Get the real value from: ${source}\n` +
        `  Replace it in the file, then re-run the deploy.`
    );
    failed = true;
  }
}

if (failed) {
  console.error('\n[verify-hosting-sentinels] Deploy aborted: see errors above.');
  process.exit(1);
}

console.log('[verify-hosting-sentinels] OK: both claim files exist, parse as JSON, and have no unfilled sentinels.');
