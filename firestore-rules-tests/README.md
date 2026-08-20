# Firestore rules tests

Emulator-backed tests for `../firestore.rules`. **Not part of the frontend jest
suite** — the frontend's 788/53 count must stay unambiguous, so these are counted
separately.

## Prerequisites

- **Java 21+.** firebase-tools 15.5.1 hard-rejects anything older with
  `firebase-tools no longer supports Java version before 21` — Java 17 is NOT
  enough even though the emulator itself only needs a JVM. If `java -version`
  on your default PATH reports < 21 but a JDK 21 is installed elsewhere,
  prepend it for this command, e.g. (bash):
  `export PATH="/path/to/jdk-21/bin:$PATH"`
- `firebase-tools` on PATH (`firebase --version`)

## Run

```bash
cd firestore-rules-tests
npm install
npm test
```

`npm test` boots the Firestore emulator, runs jest against it, and tears the
emulator down. No project data is touched — the emulator is entirely local.

## What is covered

`/sharedGames/{shareId}`:

- **list denied** to everyone, including the owner and unauthenticated callers
  — the single most important rule in the feature.
- **get allowed** to anyone holding the id, signed in or not — the URL is the
  credential.
- **create** requires sign-in, `ownerUid == request.auth.uid`, a
  well-formed/sized snapshot, an `expiresAt` inside the 31-day bound, and a
  document id matching `^[A-Za-z0-9]{20}$` (Firestore auto-ID shape). Tested:
  too-short id rejected, id with a disallowed character rejected, valid
  20-char id accepted. A doc missing `snapshot` or `expiresAt` is rejected.
- **update** is owner-only, cannot reassign `ownerUid`, and re-runs the same
  size/format checks as create (a deliberate strengthening over spec §4, which
  drops the size caps on update).
- **delete** is owner-only. No UI calls delete today; the rule ships anyway
  because it costs nothing and the tests assert it.
