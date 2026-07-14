import {
  HELP_TOPICS,
  ACTIVE_GAME_TOPIC_IDS,
  GUIDE_TOPIC_IDS,
  getSummaryTopicIds,
  getTopicsByIds,
  HelpTopicId,
} from '../helpTopics';

describe('helpTopics', () => {
  it('every subset id references a real topic', () => {
    const known = new Set(HELP_TOPICS.map((t) => t.id));
    const all: HelpTopicId[] = [
      ...ACTIVE_GAME_TOPIC_IDS,
      ...GUIDE_TOPIC_IDS,
      ...getSummaryTopicIds('optimal'),
      ...getSummaryTopicIds('banker'),
    ];
    all.forEach((id) => expect(known.has(id)).toBe(true));
  });

  it('getSummaryTopicIds returns the banker "why" topic in banker mode', () => {
    expect(getSummaryTopicIds('banker')).toEqual([
      'summary-why-banker',
      'rounding',
      'sharing',
    ]);
  });

  it('getSummaryTopicIds returns the direct "why" topic for optimal or undefined', () => {
    const direct = ['summary-why-direct', 'rounding', 'sharing'];
    expect(getSummaryTopicIds('optimal')).toEqual(direct);
    expect(getSummaryTopicIds(undefined)).toEqual(direct);
  });

  it('getTopicsByIds preserves order and drops unknown ids', () => {
    const topics = getTopicsByIds(['rounding', 'nonexistent' as HelpTopicId, 'sharing']);
    expect(topics.map((t) => t.id)).toEqual(['rounding', 'sharing']);
  });

  it('the swipe topic carries the swipe visual marker', () => {
    const swipe = HELP_TOPICS.find((t) => t.id === 'swipe-actions');
    expect(swipe?.visual).toBe('swipe');
  });
});
