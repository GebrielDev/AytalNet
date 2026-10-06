/**
 * Single-flight access-token refresh.
 *
 * The API issues an access token good for an hour and a refresh token good for
 * seven days, and exposes POST /auth/refresh to trade one for a new pair. The
 * clients stored the refresh token and never used it: on the first 401 the
 * dashboard cleared both and bounced to the login screen, so a dispatcher was
 * signed out every hour on the hour regardless of what they were doing.
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

export interface RefresherOptions {
  /** The stored refresh token, or null when there is none to use. */
  getRefreshToken: () => string | null;
  /** Exchange a refresh token for a new pair. Rejects if it is not accepted. */
  requestNewTokens: (refreshToken: string) => Promise<TokenPair>;
  /** Persist a new pair. */
  saveTokens: (pair: TokenPair) => void;
  /** Drop stored credentials; the session is over. */
  clearTokens: () => void;
}

export interface Refresher {
  /**
   * Resolves with a fresh access token, or null when the session cannot be
   * saved and the caller should send the user to sign in again.
   */
  refresh: () => Promise<string | null>;
}

export const createTokenRefresher = (options: RefresherOptions): Refresher => {
  let inFlight: Promise<string | null> | null = null;

  const refresh = (): Promise<string | null> => {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const refreshToken = options.getRefreshToken();
      if (!refreshToken) {
        options.clearTokens();
        return null;
      }

      try {
        const pair = await options.requestNewTokens(refreshToken);
        options.saveTokens(pair);
        return pair.accessToken;
      } catch {
        // The refresh token is expired, revoked or malformed. Nothing further
        // to try, so clear up rather than leaving a token that cannot work.
        options.clearTokens();
        return null;
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
