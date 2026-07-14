import { buildShareMessage, SHARE_FOOTER } from '@/utils/shareMessage';
import { GroupedSettlement } from '@/utils/settlementUtils';
import { PreferredPayment } from '@/types/game';

const usd = (n: number) => `$${n.toFixed(2)}`;

function group(
  recipient: string,
  payments: Array<{ from: string; amount: number }>,
): GroupedSettlement {
  return {
    recipient,
    totalAmount: payments.reduce((sum, p) => sum + p.amount, 0),
    payments,
  };
}

function build(
  grouped: GroupedSettlement[],
  payments: Record<string, PreferredPayment> = {},
): string {
  return buildShareMessage({
    gameName: 'Friday Night Poker',
    totalPot: 400,
    grouped,
    paymentByName: new Map(Object.entries(payments)),
    formatAmount: usd,
  });
}

describe('buildShareMessage structure', () => {
  it('renders header, pot, settlements heading, and footer exactly once', () => {
    const msg = build([group('Hana', [{ from: 'Ivan', amount: 25 }])]);
    expect(msg.startsWith('Friday Night Poker\n\nTotal Pot: $400.00\n\nSettlements:\n')).toBe(true);
    expect(msg.endsWith(SHARE_FOOTER)).toBe(true);
    expect(msg.split(SHARE_FOOTER)).toHaveLength(2);
  });

  it('renders the all-balanced line when there are no settlements', () => {
    const msg = build([]);
    expect(msg).toContain('All balanced! No settlements needed.\n');
    expect(msg).not.toContain('•');
  });

  it('uses the caller-supplied formatAmount for pot and payment amounts', () => {
    const msg = buildShareMessage({
      gameName: 'G',
      totalPot: 400,
      grouped: [group('Hana', [{ from: 'Ivan', amount: 25 }])],
      paymentByName: new Map(),
      formatAmount: n => `EUR ${n}`,
    });
    expect(msg).toContain('Total Pot: EUR 400');
    expect(msg).toContain('EUR 25 from Ivan');
  });

  it('joins multiple payments with a comma in insertion order', () => {
    const msg = build([
      group('Alice', [
        { from: 'Bob', amount: 20 },
        { from: 'Carol', amount: 15 },
      ]),
    ]);
    expect(msg).toContain('• Alice: $20.00 from Bob, $15.00 from Carol\n');
  });

  it('renders each recipient on its own bullet line', () => {
    const msg = build([
      group('Alice', [{ from: 'Bob', amount: 20 }]),
      group('Dan', [{ from: 'Erin', amount: 40 }]),
    ]);
    expect(msg).toContain('• Alice: $20.00 from Bob\n');
    expect(msg).toContain('• Dan: $40.00 from Erin\n');
  });
});

describe('payment annotations', () => {
  const pay = (from: string, amount: number) => [{ from, amount }];

  it('renders no annotation when the recipient has no preference', () => {
    const msg = build([group('Hana', pay('Ivan', 25))]);
    expect(msg).toContain('• Hana: $25.00 from Ivan\n');
  });

  it('renders Venmo with a single @ regardless of stored form', () => {
    for (const handle of ['alice-h', '@alice-h']) {
      const msg = build([group('Alice', pay('Bob', 20))], {
        Alice: { method: 'venmo', handle },
      });
      expect(msg).toContain('• Alice (Venmo @alice-h): $20.00 from Bob\n');
    }
  });

  it('renders Cash App with a single $ regardless of stored form', () => {
    for (const handle of ['danno', '$danno']) {
      const msg = build([group('Dan', pay('Erin', 40))], {
        Dan: { method: 'cashapp', handle },
      });
      expect(msg).toContain('• Dan (Cash App $danno): $40.00 from Erin\n');
    }
  });

  it('renders PayPal as paypal.me/user regardless of stored form', () => {
    for (const handle of ['erin', '@erin', 'paypal.me/erin', 'PayPal.Me/erin']) {
      const msg = build([group('Erin', pay('Frank', 30))], {
        Erin: { method: 'paypal', handle },
      });
      expect(msg).toContain('• Erin (PayPal paypal.me/erin): $30.00 from Frank\n');
    }
  });

  it('renders Zelle and Apple Cash handles as stored (trimmed)', () => {
    const msg = build(
      [group('Dan', pay('Erin', 40)), group('Gina', pay('Hal', 10))],
      {
        Dan: { method: 'zelle', handle: ' 555-201-3344 ' },
        Gina: { method: 'applecash', handle: 'gina@mail.com' },
      },
    );
    expect(msg).toContain('• Dan (Zelle 555-201-3344): $40.00 from Erin\n');
    expect(msg).toContain('• Gina (Apple Cash gina@mail.com): $10.00 from Hal\n');
  });

  it('renders the label alone when the handle is empty or whitespace', () => {
    for (const handle of [undefined, '', '   ']) {
      const msg = build([group('Frank', pay('Gina', 10))], {
        Frank: { method: 'venmo', handle },
      });
      expect(msg).toContain('• Frank (Venmo): $10.00 from Gina\n');
    }
  });

  it('renders (Cash) for a cash preference', () => {
    const msg = build([group('Dan', pay('Erin', 40))], {
      Dan: { method: 'cash' },
    });
    expect(msg).toContain('• Dan (Cash): $40.00 from Erin\n');
  });

  it('renders the note for other-with-note and nothing for other-without', () => {
    const withNote = build([group('Ann', pay('Bo', 5))], {
      Ann: { method: 'other', handle: ' check ' },
    });
    expect(withNote).toContain('• Ann (check): $5.00 from Bo\n');

    const withoutNote = build([group('Ann', pay('Bo', 5))], {
      Ann: { method: 'other' },
    });
    expect(withoutNote).toContain('• Ann: $5.00 from Bo\n');
  });
});

describe('buildShareMessage banker mode', () => {
  function buildBanker(
    grouped: GroupedSettlement[],
    payments: Record<string, PreferredPayment> = {},
    bankerName?: string,
  ): string {
    return buildShareMessage({
      gameName: 'Friday Night Poker',
      totalPot: 400,
      grouped,
      paymentByName: new Map(Object.entries(payments)),
      formatAmount: usd,
      mode: 'banker',
      bankerName,
    });
  }

  it('uses a banker payout heading and drops the "from" clause', () => {
    const msg = buildBanker([group('Alice', [{ from: 'Alex', amount: 150 }])], {}, 'Alex');
    expect(msg).toContain('Alex pays out:\n');
    expect(msg).toContain('• Alice: $150.00\n');
    expect(msg).not.toContain(' from ');
    expect(msg).not.toContain('Settlements:');
    expect(msg.endsWith(SHARE_FOOTER)).toBe(true);
  });

  it('renders the payment annotation on the payout line', () => {
    const msg = buildBanker(
      [group('Alice', [{ from: 'Alex', amount: 150 }])],
      { Alice: { method: 'venmo', handle: 'alice-h' } },
      'Alex',
    );
    expect(msg).toContain('• Alice (Venmo @alice-h): $150.00\n');
  });

  it('renders a nothing-to-pay-out line when there are no payouts', () => {
    const msg = buildBanker([], {}, undefined);
    expect(msg).toContain('Payouts:\n');
    expect(msg).toContain('Nothing to pay out.\n');
    expect(msg).not.toContain('•');
  });

  it('falls back to a plain "Payouts:" heading when the banker name is absent', () => {
    const msg = buildBanker([group('Alice', [{ from: 'X', amount: 10 }])], {}, undefined);
    expect(msg).toContain('Payouts:\n');
    expect(msg).not.toContain('pays out:');
  });
});
