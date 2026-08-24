import { isScrolledToEnd, SCROLL_END_EPSILON } from '@/utils/scrollFade';

describe('isScrolledToEnd', () => {
  it('is true when the content is shorter than the viewport', () => {
    // The case a scroll handler alone can never report: it only fires on scroll, and content
    // that fits never scrolls. A fade driven by this predicate would otherwise sit permanently
    // over the bottom of a list that has nothing below the fold.
    expect(isScrolledToEnd(0, 400, 250)).toBe(true);
  });

  it('is true when the content exactly fills the viewport', () => {
    expect(isScrolledToEnd(0, 400, 400)).toBe(true);
  });

  it('is false at the top of content that overflows', () => {
    expect(isScrolledToEnd(0, 400, 900)).toBe(false);
  });

  it('is false mid-scroll', () => {
    expect(isScrolledToEnd(200, 400, 900)).toBe(false);
  });

  it('is true at the exact bottom', () => {
    expect(isScrolledToEnd(500, 400, 900)).toBe(true);
  });

  it('is true within the epsilon of the bottom', () => {
    // Sub-pixel layout rounding means scrollY + viewportH lands just short of contentH at a
    // real end-of-list stop. Without the tolerance the fade stays lit at the bottom forever,
    // which reads as "there is more below" when there is not.
    expect(isScrolledToEnd(500 - SCROLL_END_EPSILON, 400, 900)).toBe(true);
  });

  it('is false just outside the epsilon', () => {
    expect(isScrolledToEnd(500 - SCROLL_END_EPSILON - 1, 400, 900)).toBe(false);
  });

  it('is true for a zero-height viewport that has not measured yet', () => {
    // Every shared value starts at 0 before the first layout pass. That has to read as
    // at-end, or the fade flashes on for one frame every time the editor opens.
    expect(isScrolledToEnd(0, 0, 0)).toBe(true);
  });

  it('is false for overscroll above the top', () => {
    // iOS bounce drives contentOffset.y negative; the fade must stay lit.
    expect(isScrolledToEnd(-30, 400, 900)).toBe(false);
  });
});
