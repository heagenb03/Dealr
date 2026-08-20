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
 * 1. public/.well-known/apple-app-site-association ships with a placeholder
 *    sentinel for the one value that cannot be derived from this repo: the
 *    Apple Team ID (see Task 8 report,
 *    .superpowers/sdd/2026-08-19-shared-game-links/task-8-report.md, for
 *    exactly where to obtain it). A sentinel that ships silently produces
 *    universal links that fail on every device with no visible error, and iOS
 *    caches that failure past a fix. The Android counterpart, assetlinks.json,
 *    was DELETED 2026-08-20 -- Cash Cage has no Play listing, so its
 *    fingerprint sentinel was unfillable and blocked every deploy. See the
 *    restore notes on the SENTINELS array below.
 * 2. The claim file must actually exist and parse as valid JSON at deploy
 *    time — Firebase Hosting's ignore-glob behavior for `.well-known/` was
 *    checked empirically against the real `glob` dependency firebase-tools
 *    uses and found NOT to exclude this file (see Task 8 report), so this
 *    check exists as a genuine safety net against it being accidentally
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
  // NO ANDROID ENTRY, DELIBERATELY. Cash Cage has never been published on Google
  // Play (confirmed 2026-08-20), so no Play app-signing certificate exists and
  // __PLAY_SHA256_FINGERPRINT__ could never be filled from any source -- it
  // blocked `firebase deploy --only hosting` outright, and this script fails on
  // MISSING FILE too, so deleting public/.well-known/assetlinks.json without
  // also deleting this entry would just swap one blocked deploy for another.
  //
  // TO RESTORE WHEN ANDROID SHIPS -- all three, or App Links die silently:
  //   1. Recreate public/.well-known/assetlinks.json (see git history:
  //      `git log --diff-filter=D -- public/.well-known/assetlinks.json`).
  //   2. Fill sha256_cert_fingerprints from Play Console > Setup > App
  //      integrity > App signing key certificate. That is authoritative -- NOT
  //      the EAS/upload keystore value; Google re-signs uploads with its own key
  //      and App Links verify against that signature.
  //   3. Re-add the entry here so the deploy gate covers it again.
  // frontend/app.json still carries the matching android.intentFilters with
  // autoVerify:true. Inert today (no Android build ships), but the FIRST Android
  // build must not go out before step 2 lands, or devices cache the verification
  // failure the same way iOS caches a missing AASA.
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

console.log('[verify-hosting-sentinels] OK: the claim file exists, parses as JSON, and has no unfilled sentinels.');
