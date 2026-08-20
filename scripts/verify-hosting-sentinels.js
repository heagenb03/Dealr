#!/usr/bin/env node
/**
 * Predeploy gate for `firebase deploy --only hosting`.
 *
 * public/.well-known/apple-app-site-association and assetlinks.json ship with
 * placeholder sentinels for two values that cannot be derived from this repo:
 * the Apple Team ID and the Play app-signing SHA-256 fingerprint (see Task 8
 * report, .superpowers/sdd/2026-08-19-shared-game-links/task-8-report.md, for
 * exactly where to obtain each one). A sentinel that ships silently produces
 * universal/app links that fail on every device with no visible error, and
 * iOS caches that failure past a fix. This script fails the deploy loudly
 * instead.
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
    console.error(`[verify-hosting-sentinels] MISSING FILE: ${file}`);
    failed = true;
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
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
  console.error('\n[verify-hosting-sentinels] Deploy aborted: one or more unfilled sentinels found.');
  process.exit(1);
}

console.log('[verify-hosting-sentinels] OK: no unfilled sentinels in public/.well-known/*.');
