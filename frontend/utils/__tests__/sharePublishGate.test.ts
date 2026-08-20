import { shouldSendLink } from '@/utils/sharePublishGate';

describe('shouldSendLink', () => {
  it('sends the link when this write acked', () => {
    expect(shouldSendLink({ acked: true, previouslyAcked: undefined })).toBe(true);
  });

  it('sends the link when an earlier write acked, even on a timeout now', () => {
    // The document exists from that earlier ack. A timeout here means the
    // recipient may read a stale snapshot — not a dead link.
    expect(shouldSendLink({ acked: false, previouslyAcked: true })).toBe(true);
  });

  it('withholds the link on a first share that timed out', () => {
    expect(shouldSendLink({ acked: false, previouslyAcked: undefined })).toBe(false);
  });

  it('withholds the link when a first share timed out and the second also timed out', () => {
    // THE REGRESSION. The old code read `raceResult === 'acked' || isRefresh`,
    // and isRefresh was true here because share #1 persisted the minted
    // shareId. A link went out to a document that may never have been written.
    // previouslyAcked is an explicit false, not undefined: share #1 stored it.
    expect(shouldSendLink({ acked: false, previouslyAcked: false })).toBe(false);
  });

  it('sends the link when both this write and an earlier one acked', () => {
    expect(shouldSendLink({ acked: true, previouslyAcked: true })).toBe(true);
  });
});
