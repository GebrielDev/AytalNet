import { describe, it, expect, vi } from 'vitest';
import { createTokenRefresher, type TokenPair } from './tokenRefresh';

const pair = (n: number): TokenPair => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
});

const setup = (overrides: Partial<Parameters<typeof createTokenRefresher>[0]> = {}) => {
  const saveTokens = vi.fn();
  const clearTokens = vi.fn();
  const requestNewTokens = vi.fn().mockResolvedValue(pair(1));
  const refresher = createTokenRefresher({
    getRefreshToken: () => 'stored-refresh',
    requestNewTokens,
    saveTokens,
    clearTokens,
    ...overrides,
  });
  return { refresher, saveTokens, clearTokens, requestNewTokens };
};

describe('createTokenRefresher', () => {
  it('exchanges the stored refresh token and saves the new pair', async () => {
    const { refresher, saveTokens, requestNewTokens } = setup();

    await expect(refresher.refresh()).resolves.toBe('access-1');
    expect(requestNewTokens).toHaveBeenCalledWith('stored-refresh');
    expect(saveTokens).toHaveBeenCalledWith(pair(1));
  });

  // Without this, an expired token on a page that fires four requests means
  // four refreshes; each new pair invalidates the one before it, so three of
  // the four retries carry a token the server has already replaced.
  it('performs one refresh for concurrent callers', async () => {
    let resolveRequest: (p: TokenPair) => void = () => {};
    const requestNewTokens = vi.fn(
      () => new Promise<TokenPair>((resolve) => { resolveRequest = resolve; })
    );
    const { refresher } = setup({ requestNewTokens });

    const all = Promise.all([
      refresher.refresh(), refresher.refresh(), refresher.refresh(), refresher.refresh(),
    ]);
    resolveRequest(pair(1));

    expect(await all).toEqual(['access-1', 'access-1', 'access-1', 'access-1']);
    expect(requestNewTokens).toHaveBeenCalledTimes(1);
  });

  it('allows a later refresh after an earlier one settles', async () => {
    const requestNewTokens = vi.fn()
      .mockResolvedValueOnce(pair(1))
      .mockResolvedValueOnce(pair(2));
    const { refresher } = setup({ requestNewTokens });

    await expect(refresher.refresh()).resolves.toBe('access-1');
    await expect(refresher.refresh()).resolves.toBe('access-2');
    expect(requestNewTokens).toHaveBeenCalledTimes(2);
  });

  it('returns null and clears tokens when the refresh token is rejected', async () => {
    const requestNewTokens = vi.fn().mockRejectedValue(new Error('401'));
    const { refresher, clearTokens, saveTokens } = setup({ requestNewTokens });

    await expect(refresher.refresh()).resolves.toBeNull();
    expect(clearTokens).toHaveBeenCalled();
    expect(saveTokens).not.toHaveBeenCalled();
  });

  // A failed refresh must not be cached: the next 401 should get a real
  // attempt, not a replay of the old rejection.
  it('retries after a failure rather than replaying it', async () => {
    const requestNewTokens = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(pair(2));
    const { refresher } = setup({ requestNewTokens });

    await expect(refresher.refresh()).resolves.toBeNull();
    await expect(refresher.refresh()).resolves.toBe('access-2');
    expect(requestNewTokens).toHaveBeenCalledTimes(2);
  });

  it('does not call the endpoint when nothing is stored', async () => {
    const { refresher, clearTokens, requestNewTokens } =
      setup({ getRefreshToken: () => null });

    await expect(refresher.refresh()).resolves.toBeNull();
    expect(requestNewTokens).not.toHaveBeenCalled();
    expect(clearTokens).toHaveBeenCalled();
  });
});
