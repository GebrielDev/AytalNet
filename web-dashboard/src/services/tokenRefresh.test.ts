import { describe, it, expect, vi } from 'vitest';
import { createTokenRefresher, type TokenPair } from './tokenRefresh';

const pair = (n: number): TokenPair => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
});

/** Stands in for an axios error carrying a server response. */
const httpError = (status: number) => ({ response: { status } });
/** Stands in for a request that never got a response: offline, DNS, timeout. */
const networkError = () => Object.assign(new Error('Network Error'), { response: undefined });

const setup = (overrides: Partial<Parameters<typeof createTokenRefresher>[0]> = {}) => {
  const saveTokens = vi.fn();
  const clearTokens = vi.fn();
  const requestNewTokens = vi.fn().mockResolvedValue(pair(1));
  const refresher = createTokenRefresher({
    getRefreshToken: () => 'stored-refresh',
    requestNewTokens,
    saveTokens,
    clearTokens,
    isTerminal: (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      return status === 400 || status === 401 || status === 403;
    },
    ...overrides,
  });
  return { refresher, saveTokens, clearTokens, requestNewTokens };
};

describe('createTokenRefresher', () => {
  it('exchanges the stored refresh token and saves the new pair', async () => {
    const { refresher, saveTokens, requestNewTokens } = setup();

    await expect(refresher.refresh()).resolves.toEqual({
      status: 'refreshed', accessToken: 'access-1',
    });
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

    const results = await all;
    expect(results.every((r) => r.status === 'refreshed')).toBe(true);
    expect(requestNewTokens).toHaveBeenCalledTimes(1);
  });

  it('allows a later refresh after an earlier one settles', async () => {
    const requestNewTokens = vi.fn()
      .mockResolvedValueOnce(pair(1))
      .mockResolvedValueOnce(pair(2));
    const { refresher } = setup({ requestNewTokens });

    await refresher.refresh();
    await expect(refresher.refresh()).resolves.toEqual({
      status: 'refreshed', accessToken: 'access-2',
    });
    expect(requestNewTokens).toHaveBeenCalledTimes(2);
  });

  it('reports expiry and clears tokens when the server rejects the refresh token', async () => {
    for (const status of [400, 401, 403]) {
      const requestNewTokens = vi.fn().mockRejectedValue(httpError(status));
      const { refresher, clearTokens, saveTokens } = setup({ requestNewTokens });

      await expect(refresher.refresh()).resolves.toEqual({ status: 'expired' });
      expect(clearTokens).toHaveBeenCalled();
      expect(saveTokens).not.toHaveBeenCalled();
    }
  });

  // A network blip or a 5xx says nothing about the refresh token. Clearing on
  // one turns a recoverable outage into a forced sign-in.
  it.each([
    ['a network error', networkError()],
    ['a 500', httpError(500)],
    ['a 502', httpError(502)],
    ['a 504', httpError(504)],
    ['a 429', httpError(429)],
  ])('keeps credentials on %s', async (_label, error) => {
    const requestNewTokens = vi.fn().mockRejectedValue(error);
    const { refresher, clearTokens } = setup({ requestNewTokens });

    await expect(refresher.refresh()).resolves.toEqual({ status: 'unavailable' });
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('retries after a transient failure rather than replaying it', async () => {
    const requestNewTokens = vi.fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(pair(2));
    const { refresher, clearTokens } = setup({ requestNewTokens });

    await expect(refresher.refresh()).resolves.toEqual({ status: 'unavailable' });
    await expect(refresher.refresh()).resolves.toEqual({
      status: 'refreshed', accessToken: 'access-2',
    });
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('does not call the endpoint when nothing is stored', async () => {
    const { refresher, clearTokens, requestNewTokens } =
      setup({ getRefreshToken: () => null });

    await expect(refresher.refresh()).resolves.toEqual({ status: 'expired' });
    expect(requestNewTokens).not.toHaveBeenCalled();
    expect(clearTokens).toHaveBeenCalled();
  });
});

describe('a session that ends while a refresh is in flight', () => {
  // logout() removes the stored tokens. A refresh that was already in flight
  // would then write the old pair back, and the next reload would sign the
  // user in again - after they explicitly signed out.
  it('does not restore credentials that logout removed', async () => {
    let stored: string | null = 'stored-refresh';
    let resolveRequest: (p: TokenPair) => void = () => {};
    const saveTokens = vi.fn();
    const clearTokens = vi.fn();

    const refresher = createTokenRefresher({
      getRefreshToken: () => stored,
      requestNewTokens: () => new Promise<TokenPair>((r) => { resolveRequest = r; }),
      saveTokens,
      clearTokens,
      isTerminal: () => true,
    });

    const pending = refresher.refresh();
    stored = null;              // logout lands mid-flight
    resolveRequest(pair(1));

    await expect(pending).resolves.toEqual({ status: 'superseded' });
    expect(saveTokens).not.toHaveBeenCalled();
    expect(clearTokens).not.toHaveBeenCalled();
  });

  // Worse than a stale write: the old session's pair would land on top of the
  // account that just signed in, while the UI shows the new one.
  it('does not overwrite a different account that signed in meanwhile', async () => {
    let stored: string | null = 'old-account-refresh';
    let resolveRequest: (p: TokenPair) => void = () => {};
    const saveTokens = vi.fn();

    const refresher = createTokenRefresher({
      getRefreshToken: () => stored,
      requestNewTokens: () => new Promise<TokenPair>((r) => { resolveRequest = r; }),
      saveTokens,
      clearTokens: vi.fn(),
      isTerminal: () => true,
    });

    const pending = refresher.refresh();
    stored = 'new-account-refresh';
    resolveRequest(pair(1));

    await expect(pending).resolves.toEqual({ status: 'superseded' });
    expect(saveTokens).not.toHaveBeenCalled();
    expect(stored).toBe('new-account-refresh');
  });

  it('still saves when the stored token is unchanged', async () => {
    const { refresher, saveTokens } = setup();
    await expect(refresher.refresh()).resolves.toEqual({
      status: 'refreshed', accessToken: 'access-1',
    });
    expect(saveTokens).toHaveBeenCalledWith(pair(1));
  });
});
