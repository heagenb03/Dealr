import { GroupedSettlement } from '@/utils/settlementUtils';
import { PreferredPayment, PaymentMethod } from '@/types/game';
import { getPaymentMethodMeta } from '@/constants/PaymentMethods';

// Single source of truth for the share link (moved from summary.tsx).
export const SHARE_FOOTER = '\n\nSettled with Cash Cage\nhttps://apps.apple.com/app/id6759301097';

/**
 * Footer for a message that carries a link to the game itself. The bare App
 * Store URL drove few installs and left the Pay buttons usable only by the host;
 * a link to the game leads somewhere worth going.
 *
 * SHARE_FOOTER remains the fallback for when the share document could not be
 * written (offline, permission, quota) — a host with no signal must still be
 * able to share.
 */
function footerFor(shareUrl: string | undefined): string {
  return shareUrl ? `\n\nSettled with Cash Cage\n${shareUrl}` : SHARE_FOOTER;
}

/**
 * Display normalization mirroring the URI normalization in paymentLinks.ts:
 * stored "alice-h" and "@alice-h" must render identically.
 */
function formatHandle(method: PaymentMethod, handle: string): string {
  switch (method) {
    case 'venmo':
      return `@${handle.replace(/^@/, '')}`;
    case 'cashapp':
      return `$${handle.replace(/^\$/, '')}`;
    case 'paypal':
      return `paypal.me/${handle.replace(/^@/, '').replace(/^paypal\.me\//i, '')}`;
    default:
      return handle;
  }
}

/**
 * " (Venmo @alice-h)"-style suffix for a recipient line, or '' when there is
 * nothing informative to show. Policy ("label when it informs"): method with
 * empty handle -> label only; cash -> (Cash); other -> note text or nothing.
 */
function formatPaymentAnnotation(payment: PreferredPayment | undefined): string {
  if (!payment) return '';
  const handle = (payment.handle ?? '').trim();

  switch (payment.method) {
    case 'cash':
      return ' (Cash)';
    case 'other':
      return handle ? ` (${handle})` : '';
    default: {
      const label = getPaymentMethodMeta(payment.method).label;
      return handle ? ` (${label} ${formatHandle(payment.method, handle)})` : ` (${label})`;
    }
  }
}

export function buildShareMessage(opts: {
  gameName: string;
  totalPot: number;
  grouped: GroupedSettlement[];
  paymentByName: Map<string, PreferredPayment>;
  formatAmount: (n: number) => string;
  mode?: 'optimal' | 'banker';
  bankerName?: string;
  shareUrl?: string;
}): string {
  const { gameName, totalPot, grouped, paymentByName, formatAmount, mode, bankerName, shareUrl } = opts;

  let message = `${gameName}\n\n`;
  message += `Total Pot: ${formatAmount(totalPot)}\n\n`;

  if (mode === 'banker') {
    // Payer is always the banker, so per-line "from" clauses are noise — drop them.
    message += bankerName ? `${bankerName} pays out:\n` : `Payouts:\n`;
    if (grouped.length === 0) {
      message += `Nothing to pay out.\n`;
    } else {
      grouped.forEach(({ recipient, totalAmount }) => {
        message += `• ${recipient}${formatPaymentAnnotation(paymentByName.get(recipient))}: ${formatAmount(totalAmount)}\n`;
      });
    }
    message += footerFor(shareUrl);
    return message;
  }

  message += `Settlements:\n`;

  if (grouped.length === 0) {
    message += `All balanced! No settlements needed.\n`;
  } else {
    grouped.forEach(({ recipient, payments }) => {
      const details = payments
        .map(({ from, amount }) => `${formatAmount(amount)} from ${from}`)
        .join(', ');
      message += `• ${recipient}${formatPaymentAnnotation(paymentByName.get(recipient))}: ${details}\n`;
    });
  }

  message += footerFor(shareUrl);
  return message;
}
