/**
 * Pure entitlement derivations extracted from AuthContext so they can be tested
 * without mounting the provider.
 */

/**
 * True when the user is not currently a paid subscriber but has purchased before.
 *
 * `proSince` is the discriminator: written once, never cleared, and set on both
 * the purchase and the restore path. Distinguishes a churned subscriber from a
 * user whose free trial simply ran out — those need different copy.
 */
export function deriveLapsed(paidPro: boolean, proSince: Date | null | undefined): boolean {
  return !paidPro && !!proSince;
}
