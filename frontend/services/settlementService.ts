import {
  PlayerBalance,
  Settlement,
  SettlementRequestSettings,
  SettlementResult,
  Validation,
} from '@/types/game';
import { roundBalancesToUnit, roundToUnit } from '@/utils/roundingUtils';

const DEFAULT_TIMEOUT_MS = 10000;
const SETTLEMENT_ENDPOINT_PATH = '/settlements/optimal';

export interface SettlementOptions {
  /** Optional fully qualified endpoint overriding the default base + path. */
  endpoint?: string;
  /** Milliseconds to wait before aborting the server request. */
  timeoutMs?: number;
  /** Forces the calculation to stay on-device even if a server endpoint exists. */
  forceLocal?: boolean;
  /** Lets callers pass their own AbortSignal (used for screen unmounts). */
  signal?: AbortSignal;
  /** Extra tuning flags forwarded to the backend solver. */
  settings?: SettlementRequestSettings;
}

interface SettlementApiResponse {
  settlements: Settlement[];
  algorithm?: string;
  generatedAt?: string;
  requestId?: string;
  warnings?: string[];
}

export function calculateOptimalSettlements(balances: PlayerBalance[]): Settlement[] {
  const settlements: Settlement[] = [];
  
  const debtorsDict = balances.filter(b => b.netBalance < 0)
    .map(b => ({ name: b.playerName, amount: Math.abs(b.netBalance) }))
    .sort((a, b) => b.amount - a.amount);

  const creditorsDict = balances.filter(b => b.netBalance > 0)
    .map(b => ({ name: b.playerName, amount: b.netBalance }))
    .sort((a, b) => b.amount - a.amount);

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtorsDict.length && creditorIndex < creditorsDict.length) {
    const debtor = debtorsDict[debtorIndex];
    const creditor = creditorsDict[creditorIndex];

    const settlementAmount = Math.min(debtor.amount, creditor.amount);
    
    settlements.push({
      from: debtor.name,
      to: creditor.name,
      amount: parseFloat(settlementAmount.toFixed(2))
    });
    
    debtor.amount -= settlementAmount;
    creditor.amount -= settlementAmount;
    
    if (debtor.amount === 0) {
      debtorIndex++;
    }
    if (creditor.amount === 0) {
      creditorIndex++;
    }
  }
  
  return settlements;
}

const LOCAL_ALGORITHM_ID = 'client-greedy-v1';
const DEFAULT_SERVER_ALGORITHM_ID = 'server-milp-v1';
const LOCAL_BANKER_ALGORITHM_ID = 'client-banker-v1';

function createLocalSettlementResult(
  balances: PlayerBalance[],
  reason?: string,
  cashRoundingUnit?: number,
): SettlementResult {
  const prepared =
    typeof cashRoundingUnit === 'number' && cashRoundingUnit > 0
      ? roundBalancesToUnit(balances, cashRoundingUnit)
      : balances;
  return {
    settlements: calculateOptimalSettlements(prepared),
    algorithm: LOCAL_ALGORITHM_ID,
    source: 'client',
    generatedAt: new Date().toISOString(),
    error: reason,
  };
}

/**
 * Casino / "the bank" settlement for a home game where buy-ins are handed to the
 * banker live and the banker holds the pot. At the end the banker pays each player
 * their full cash-out (stack value) — NOT their net: a player who finished down
 * still redeems whatever chips they have left. Losers are never chased at the end;
 * their buy-ins are already in the pot. Computed on-device only.
 *   for each non-banker with cash-out > 0:  { from: banker, to: player, amount: cashout }
 */
export function calculateBankerSettlements(
  balances: PlayerBalance[],
  banker: { id: string; name: string },
  cashRoundingUnit?: number,
): SettlementResult {
  const unit =
    typeof cashRoundingUnit === 'number' && cashRoundingUnit > 0 ? cashRoundingUnit : 0;

  const settlements: Settlement[] = [];
  for (const b of balances) {
    if (b.playerId === banker.id) continue;
    const cashout = parseFloat(roundToUnit(b.totalCashouts, unit).toFixed(2));
    if (cashout > 0) {
      settlements.push({ from: banker.name, to: b.playerName, amount: cashout });
    }
  }

  return {
    settlements,
    algorithm: LOCAL_BANKER_ALGORITHM_ID,
    source: 'client',
    generatedAt: new Date().toISOString(),
  };
}

function resolveEndpoint(customEndpoint?: string): string | undefined {
  if (customEndpoint) {
    return customEndpoint;
  }

  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl.replace(/\/$/, '')}${SETTLEMENT_ENDPOINT_PATH}`;
}

function sanitizeSettings(
  settings?: SettlementRequestSettings
): SettlementRequestSettings | undefined {
  if (!settings) {
    return undefined;
  }

  const entries = Object.entries(settings).filter(([, value]) =>
    typeof value === 'number' && Number.isFinite(value)
  );

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries) as SettlementRequestSettings;
}

function normalizeSettlements(raw: Settlement[]): Settlement[] {
  return raw
    .filter(
      (item): item is Settlement =>
        Boolean(item) &&
        typeof item.from === 'string' &&
        typeof item.to === 'string' &&
        (typeof item.amount === 'number' || typeof item.amount === 'string')
    )
    .map(item => ({
      from: item.from,
      to: item.to,
      amount: Number(item.amount),
    }))
    .filter(item => Number.isFinite(item.amount));
}

function toSerializableBalances(balances: PlayerBalance[]): PlayerBalance[] {
  return balances.map(balance => ({
    ...balance,
    totalBuyins: Number(balance.totalBuyins),
    totalCashouts: Number(balance.totalCashouts),
    netBalance: Number(balance.netBalance),
  }));
}

/**
 * Server-first settlement resolver (POST /settlements/optimal):
 * Request body → { balances: PlayerBalance[], settings?: SettlementRequestSettings }
 * Response body → { settlements: Settlement[], algorithm?: string, generatedAt?: string, requestId?: string, warnings?: string[] }
 * Falls back to the local greedy solver whenever the remote endpoint is unavailable.
 */
export async function getSettlements(
  balances: PlayerBalance[],
  options: SettlementOptions = {}
): Promise<SettlementResult> {
  const fallbackReason = options.forceLocal ? 'force-local' : undefined;

  if (options.forceLocal || balances.length === 0) {
    return createLocalSettlementResult(balances, fallbackReason, options.settings?.cashRoundingUnit);
  }

  const endpoint = resolveEndpoint(options.endpoint);
  if (!endpoint) {
    return createLocalSettlementResult(balances, 'missing-endpoint', options.settings?.cashRoundingUnit);
  }

  const controller = options.signal ? null : new AbortController();
  const signal = options.signal ?? controller?.signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        balances: toSerializableBalances(balances),
        settings: sanitizeSettings(options.settings),
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    const payload = (await response.json()) as SettlementApiResponse;

    if (!Array.isArray(payload.settlements) || payload.settlements.length === 0) {
      throw new Error('Invalid settlement payload received');
    }

    const normalized = normalizeSettlements(payload.settlements);
    if (normalized.length === 0) {
      throw new Error('No valid settlements returned from server');
    }

    return {
      settlements: normalized,
      algorithm: payload.algorithm ?? DEFAULT_SERVER_ALGORITHM_ID,
      source: 'server',
      generatedAt: payload.generatedAt ?? new Date().toISOString(),
      serverRequestId: payload.requestId,
      warnings: payload.warnings,
    } satisfies SettlementResult;
  } catch (error) {
    console.warn('[settlements] Falling back to local solver:', error);
    const message = error instanceof Error ? error.message : 'unknown-error';
    return createLocalSettlementResult(balances, message, options.settings?.cashRoundingUnit);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function validateSettlements(
  balances: PlayerBalance[],
  formatMoney: (n: number) => string = (n) => `$${n.toFixed(2)}`,
  bankerPlayerId?: string,
): Validation {
  const tolerance = 2.50;
  const validation : Validation = {
    isValid: false,
    errors: [],
    warnings: [],
    totalBuyins: 0,
    totalCashouts: 0,
    netDifference: 0
  };

  const playersWithNoActivity = balances.filter(
    b => b.totalBuyins === 0 && b.totalCashouts === 0 && b.playerId !== bankerPlayerId
  );
  if (!Array.isArray(balances) || balances.length === 0) {
    validation.errors.push('No player balances available for validation.');
    return validation;
  } else if (playersWithNoActivity.length > 0) {
    validation.errors.push(`Players with no activity: ${playersWithNoActivity.map(p => p.playerName).join(', ')}.
    \n Consider removing them from the game.`);
    return validation;
  }

  validation.totalBuyins = balances.reduce((sum, b) => sum + b.totalBuyins, 0);
  validation.totalCashouts = balances.reduce((sum, b) => sum + b.totalCashouts, 0);
  validation.netDifference = Math.abs(validation.totalBuyins - validation.totalCashouts);

  if (validation.netDifference > tolerance) {
    validation.warnings.push(
      `Total buy-ins of ${formatMoney(validation.totalBuyins)} with total cash outs of ${formatMoney(validation.totalCashouts)}. A ${formatMoney(validation.netDifference)} difference.
      Double check transactions and chip-counts.
      \n If you proceed, settlement algorithm may have poor results.`
    );
  }

  if (validation.errors.length === 0) {
    validation.isValid = true;
  }

  return validation;
}
