/**
 * Measures the serialized Firestore size of a worst-case game document against
 * the hard 1 MiB per-document limit, to pick a players-per-game cap that the
 * storage layer can actually hold.
 *
 * Sizing follows Firestore's documented rules:
 *   string    -> UTF-8 byte length + 1
 *   integer   -> 8      double -> 8      timestamp -> 8      boolean -> 1
 *   array     -> sum of its value sizes (no per-element overhead)
 *   map       -> sum of (key size + value size)
 *   document  -> document name size + sum of (field name + value) + 32
 *   doc name  -> sum over path segments of (UTF-8 bytes + 1), + 16
 *
 * Firestore's docs describe an embedded map as sized "the same way as document
 * size", which is ambiguous about the +32. We report both readings and drive
 * the recommendation off the conservative one (+32 per map).
 */

const LIMIT = 1048576; // 1 MiB, Firestore's hard per-document ceiling

const b = (s) => Buffer.byteLength(s, 'utf8');
const str = (s) => b(s) + 1;
const NUM = 8;
const TS = 8;
const BOOL = 1;

/** Field name + value, summed over a plain object. `mapOverhead` adds the disputed +32. */
function mapSize(entries, mapOverhead) {
  return entries.reduce((sum, [k, v]) => sum + str(k) + v, 0) + mapOverhead;
}

function docNameSize(uid, gameId) {
  return ['users', uid, 'games', gameId].reduce((s, seg) => s + b(seg) + 1, 0) + 16;
}

// --- Worst-case field widths -------------------------------------------------
// Deliberately pessimistic: every optional field present, long names, long
// payment handles. A real doc is smaller.
const W = {
  gameId: b('game_1754300000000_abc123xyz'),          // gameService.ts:252 shape
  playerId: b('player_1754300000000_abc123xyz'),      // gameService.ts:117 shape
  txnId: b('txn_1754300000000_abc123xyz'),            // gameService.ts:70 shape
  playerName: 24,                                      // long real name
  gameName: 40,
  paymentMethod: b('applecash'),                       // longest PaymentMethod
  paymentHandle: 20,
  savedPlayerId: b('sp_1754300000000_abc123xyz'),
  uid: 28,                                             // Firebase uid
};

function playerSize(mapOverhead) {
  return mapSize(
    [
      ['id', W.playerId + 1],
      ['name', W.playerName + 1],
      ['completedAt', TS],
      [
        'preferredPayment',
        mapSize([['method', W.paymentMethod + 1], ['handle', W.paymentHandle + 1]], mapOverhead),
      ],
      ['savedPlayerId', W.savedPlayerId + 1],
    ],
    mapOverhead,
  );
}

function txnSize(mapOverhead) {
  return mapSize(
    [
      ['id', W.txnId + 1],
      ['playerId', W.playerId + 1],
      ['type', b('cashout') + 1],
      ['amount', NUM],
      ['timestamp', TS],
    ],
    mapOverhead,
  );
}

/**
 * Full game doc. `cachedSettlements` and `transactionHash` are intentionally
 * absent: saveGameToFirestore (firebaseService.ts:399) destructures them out
 * before the write, so they never occupy remote bytes.
 */
function gameDocSize(nPlayers, txPerPlayer, mapOverhead) {
  const nTx = nPlayers * txPerPlayer;
  const scalars = [
    ['id', W.gameId + 1],
    ['name', W.gameName + 1],
    ['date', TS],
    ['status', b('completed') + 1],
    ['createdAt', TS],
    ['syncedAt', TS],
    ['currency', b('USD') + 1],
    ['cashUnit', NUM],
    ['imbalanceTolerance', NUM],
    ['settlementMode', b('optimal') + 1],
    ['bankerPlayerId', W.playerId + 1],
    ['statsCounted', BOOL],
    ['defaultBuyIn', NUM],
    ['players', nPlayers * playerSize(mapOverhead)],
    ['transactions', nTx * txnSize(mapOverhead)],
  ];
  return docNameSize('u'.repeat(W.uid), 'g'.repeat(W.gameId)) + mapSize(scalars, 0) + 32;
}

const TX_PER_PLAYER = Number(process.argv[2] ?? 6);
const SIZES = (process.argv[3] ?? '20,30,40,50,60,80,100,150,200').split(',').map(Number);

console.log(`Firestore game-doc size vs the 1 MiB limit  (${TX_PER_PLAYER} transactions/player)`);
console.log(`per-player: ${playerSize(32)} B   per-transaction: ${txnSize(32)} B   (conservative sizing)\n`);
console.log('   N     txns    conservative        lenient     % of 1MiB (cons.)');

for (const n of SIZES) {
  const cons = gameDocSize(n, TX_PER_PLAYER, 32);
  const len = gameDocSize(n, TX_PER_PLAYER, 0);
  const pct = ((cons / LIMIT) * 100).toFixed(2);
  const flag = cons > LIMIT ? '  <-- OVER LIMIT' : '';
  console.log(
    `${String(n).padStart(4)}  ${String(n * TX_PER_PLAYER).padStart(6)}  ` +
      `${String(cons).padStart(9)} B  ${String(len).padStart(9)} B  ${pct.padStart(9)}%${flag}`,
  );
}

// Largest N that stays under the limit, conservatively sized.
let maxN = 0;
for (let n = 1; n <= 5000; n++) {
  if (gameDocSize(n, TX_PER_PLAYER, 32) <= LIMIT) maxN = n;
  else break;
}
console.log(`\nMax players under 1 MiB at ${TX_PER_PLAYER} tx/player (conservative): ${maxN}`);
console.log(`10x safety margin (doc <= 100 KiB): ${(() => {
  let m = 0;
  for (let n = 1; n <= 5000; n++) {
    if (gameDocSize(n, TX_PER_PLAYER, 32) <= LIMIT / 10) m = n;
    else break;
  }
  return m;
})()} players`);
