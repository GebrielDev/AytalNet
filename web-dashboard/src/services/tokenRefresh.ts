/**
 * Single-flight access-token refresh.
 *
 * The API issues an access token good for an hour and a refresh token good for
 * seven days, and exposes POST /auth/refresh to trade one for a new pair. The
 * clients stored the refresh token and never used it: on the first 401 the
 * dashboard cleared both and bounced to the login screen, so a dispatcher was
 * signed out every hour regardless of what they were doing.
 *
 * "Single-flight" matters because the dashboard fires several requests at
 * once. Without it, an expired token means every one of them tries to refresh,
 * and each new pair invalidates the last - the requests race and most lose.
 * Here the first caller performs the refresh and the rest await the same
 * promise.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Why a refresh did not produce a token. The distinction decides whether the
 * session is over:
 *
 * 'refreshed'   - a new access token, carried alongside.
 * 'expired'     - the server rejected the refresh token itself. Nothing to
 *                 retry; the stored credentials are cleared.
 * 'unavailable' - the request never got a verdict: offline, DNS, a 5xx, a
 *                 timeout. The refresh token may be perfectly good, so the
 *                 credentials are KEPT and the caller surfaces an error rather
 *                 than signing the user out over a flaky minute.
 */
export type RefreshResult =
  | { status: 'refreshed'; accessToken: string }
  | { status: 'expired' }
  | { status: 'unavailable' };

export interface RefresherOptions {
  /** The stored refresh token, or null when there is none to use. */
  getRefreshToken: () => string | null;
  /** Exchange a refresh token for a new pair. Rejects if it is not accepted. */
  requestNewTokens: (refreshToken: string) => Promise<TokenPair>;
  /** Persist a new pair. */
  saveTokens: (pair: TokenPair) => void;
  /** Drop stored credentials; the session is over. */
  clearTokens: () => void;
  /**
   * Whether a rejection from requestNewTokens means the refresh token is dead,
   * as opposed to the request never arriving. Only a verdict from the server
   * ends a session.
   */
  isTerminal: (error: unknown) => boolean;
}

export interface Refresher {
  refresh: () => Promise<RefreshResult>;
}

export const createTokenRefresher = (options: RefresherOptions): Refresher => {
  let inFlight: Promise<RefreshResult> | null = null;

  const refresh = (): Promise<RefreshResult> => {
    if (inFlight) return inFlight;

    inFlight = (async (): Promise<RefreshResult> => {
      const refreshToken = options.getRefreshToken();
      if (!refreshToken) {
        options.clearTokens();
        return { status: 'expired' };
      }

      try {
        const pair = await options.requestNewTokens(refreshToken);
        options.saveTokens(pair);
        return { status: 'refreshed', accessToken: pair.accessToken };
      } catch (error) {
        if (!options.isTerminal(error)) {
          // A network blip or a 5xx. Clearing here would turn a recoverable
          // outage into a forced sign-in, discarding a refresh token that is
          // very likely still valid.
          return { status: 'unavailable' };
        }
        options.clearTokens();
        return { status: 'expired' };
      }
    })();

    // Cleared whether it resolved or rejected, so a later 401 can try again
    // rather than replaying this result forever.
    void inFlight.finally(() => {
      inFlight = null;
    });

    return inFlight;
  };

  return { refresh };
};
