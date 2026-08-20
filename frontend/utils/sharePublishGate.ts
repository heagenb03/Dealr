/**
 * Whether a share message may carry the /g/<shareId> link.
 *
 * The rule is "an ack was OBSERVED", not "an id exists". summary.tsx persists
 * game.shareId even when the publish write times out — that is deliberate, and
 * is what stops a late-landing write from orphaning a document. So shareId
 * proves an id was MINTED, never that a document was WRITTEN. Reading it as
 * proof of existence sent a link to a document that may never have landed, and
 * the recipient read "This shared game has expired" for a game the host
 * believed they had published.
 *
 * NAMED RESIDUAL, accepted: `previouslyAcked` means "a write acked at some
 * point", not "the document is there right now". After the day-30 TTL sweep, a
 * re-share that also times out sends a link to a document that is gone — and
 * the recipient then reads "This shared game has expired", which is TRUE. Do
 * not add handling or a test for that case.
 *
 * No react-native import: this must stay unit-testable under jest-expo/node.
 */
export function shouldSendLink(params: {
  acked: boolean;
  previouslyAcked: boolean | undefined;
}): boolean {
  return params.acked || !!params.previouslyAcked;
}
