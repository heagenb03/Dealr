import { PaymentMethod } from '@/types/game';

export interface PaymentMethodMeta {
  key: PaymentMethod;
  label: string;
  deepLinkable: boolean;
  /** false only for Cash — every other method shows a handle input. */
  takesHandle: boolean;
  /** Canonical prefix shown as a fixed, non-editable affix. '' = no affix. */
  affix: string;
  /** Placeholder for the bare handle (symbol lives in `affix`, not here). */
  handlePlaceholder: string;
}

export const PAYMENT_METHODS: PaymentMethodMeta[] = [
  { key: 'cash',      label: 'Cash',       deepLinkable: false, takesHandle: false, affix: '',           handlePlaceholder: '' },
  { key: 'venmo',     label: 'Venmo',      deepLinkable: true,  takesHandle: true,  affix: '@',          handlePlaceholder: 'username' },
  { key: 'cashapp',   label: 'Cash App',   deepLinkable: true,  takesHandle: true,  affix: '$',          handlePlaceholder: 'cashtag' },
  { key: 'paypal',    label: 'PayPal',     deepLinkable: true,  takesHandle: true,  affix: 'paypal.me/', handlePlaceholder: 'username' },
  { key: 'zelle',     label: 'Zelle',      deepLinkable: false, takesHandle: true,  affix: '',           handlePlaceholder: 'email or phone' },
  { key: 'applecash', label: 'Apple Cash', deepLinkable: false, takesHandle: true,  affix: '',           handlePlaceholder: 'email or phone' },
  { key: 'other',     label: 'Other',      deepLinkable: false, takesHandle: true,  affix: '',           handlePlaceholder: 'note' },
];

export function getPaymentMethodMeta(key: PaymentMethod): PaymentMethodMeta {
  return PAYMENT_METHODS.find(m => m.key === key) ?? PAYMENT_METHODS[PAYMENT_METHODS.length - 1];
}
