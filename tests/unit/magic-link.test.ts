import { describe, expect, it, vi } from 'vitest';
import { magicLinkMessage } from '@/infra/email/templates';

const magicLink = vi.fn(async (_: { email: string; callbackURL: string }) => ({ data: { status: true }, error: null }));
vi.mock('better-auth/react', () => ({ createAuthClient: () => ({ signIn: { magicLink } }) }));

describe('requestMagicLink (client helper)', () => {
  it.each([
    ['/api/payments/pay/abc?x=1', '/api/payments/pay/abc?x=1'],
    [undefined, '/dashboard'],
    ['//evil.example', '/dashboard'],
    ['https://evil.example/', '/dashboard'],
    ['/%2F%2Fevil.example', '/dashboard'],
  ])('sends callbackUrl %s as %s', async (given, sent) => {
    const { requestMagicLink } = await import('@/infra/auth/client');
    magicLink.mockClear();
    await requestMagicLink('casey@example.test', given);
    expect(magicLink).toHaveBeenCalledWith({ email: 'casey@example.test', callbackURL: sent });
  });
});

describe('magic-link email', () => {
  it('says the link works once and when it expires, and contains it', () => {
    const m = magicLinkMessage(
      'casey@example.test',
      'Casey',
      'https://app.test/api/auth/magic-link/verify?token=t',
      10,
    );
    expect(m.template).toBe('auth.magic-link');
    expect(m.text).toContain('https://app.test/api/auth/magic-link/verify?token=t');
    expect(m.text).toMatch(/works once and expires in 10 minutes/);
    expect(m.html).toContain('verify?token=t');
  });
});
