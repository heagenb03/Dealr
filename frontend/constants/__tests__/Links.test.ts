import { PRIVACY_POLICY_URL, TERMS_URL, SUPPORT_EMAIL } from '@/constants/Links';

describe('Links', () => {
  // Regression guard. The legal repo was renamed cashcage-legal -> cashcage on
  // 2026-07-25 and GitHub Pages does NOT redirect renamed repos, so reverting to
  // the old path ships dead Privacy Policy / EULA links. On a subscription paywall
  // that risks App Review rejection (guidelines 3.1.2 / 5.1.1), so pin it exactly.
  it('legal URLs point at the cashcage Pages path', () => {
    expect(PRIVACY_POLICY_URL).toBe(
      'https://heagenb03.github.io/cashcage/privacy-policy.html'
    );
    expect(TERMS_URL).toBe(
      'https://heagenb03.github.io/cashcage/terms-of-service.html'
    );
  });

  it('no legal URL carries the retired cashcage-legal path segment', () => {
    for (const url of [PRIVACY_POLICY_URL, TERMS_URL]) {
      expect(url).not.toContain('cashcage-legal');
      expect(url.startsWith('https://heagenb03.github.io/cashcage/')).toBe(true);
    }
  });

  it('support email is the single shared address', () => {
    expect(SUPPORT_EMAIL).toBe('cashcageapp@gmail.com');
  });
});
