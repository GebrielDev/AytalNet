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
 * 'superseded'  - the session this was refreshing is no longer the stored one:
 *                 a logout, or another account signing in, landed while the
 *                 exchange was in flight. Nothing is written and nothing is
 *                 cleared; the result simply belongs to a session that is over.
 */
export type RefreshResult =
  | { status: 'refreshed'; accessToken: string }
  | { status: 'expired' }
  | { status: 'unavailable' }
  | { status: 'superseded' };

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
  /**
   * A counter that logout increments SYNCHRONOUSLY, before it awaits anything.
   *
   * Comparing stored tokens is not enough on its own. Where reading storage is
   * async - AsyncStorage in the driver app - the read can resolve with the old
   * token, logout can run while the refresher is between that resolution and
   * its write, and the comparison then passes against a value that is already
   * gone. The write restores both credentials after the user signed out.
   *
   * A number read synchronously either side of the exchange cannot be
   * interleaved with in that way.
   */
  sessionGeneration: () => number;
}

export interface Refresher {
  refresh: () => Promise<RefreshResult>;
}

export const createTokenRefresher = (options: RefresherOptions): Refresher => {
  let inFlight: Promise<RefreshResult> | null = null;

  const refresh = (): Promise<RefreshResult> => {
    if (inFlight) return inFlight;

    // Read before anything is awaited, so logout cannot slip in first.
    const generation = options.sessionGeneration();

    inFlight = (async (): Promise<RefreshResult> => {
      const refreshToken = options.getRefreshToken();
      if (!refreshToken) {
        options.clearTokens();
        return { status: 'expired' };
      }

      try {
        const pair = await options.requestNewTokens(refreshToken);

        // A refresh takes a round trip, and anything can happen during it.
        // If logout cleared the credentials, writing this pair would put the
        // old session back and a reload would sign the user in again; if a
        // different account signed in, writing it would overwrite their
        // credentials while the UI showed them as the current user.
        // Order matters, and it is the whole point. The stored token is read
        // FIRST and the generation checked LAST, so that nothing can run
        // between the generation check and the write. With the generation on
        // the left of a `||`, it is evaluated before the token read - and
        // where that read is awaited (the driver app), logout lands inside the
        // await, after the check has already passed.
        const stored = options.getRefreshToken();
        if (stored !== refreshToken || options.sessionGeneration() !== generation) {
          return { status: 'superseded' };
        }

        options.saveTokens(pair);
        return { status: 'refreshed', accessToken: pair.accessToken };
      } catch (error) {
        if (!options.isTerminal(error)) {
          // A network blip or a 5xx. Clearing here would turn a recoverable
          // outage into a forced sign-in, discarding a refresh token that is
          // very likely still valid.
          return { status: 'unavailable' };
        }

        // The same check as the success path, and for the same reason. A
        // rejection says the token THIS call exchanged is dead - it says
        // nothing about whoever is signed in now. Clearing unconditionally
        // would sign out an account that logged in while this was in flight,
        // on the strength of the previous session's 401.
        // Same ordering as the save path above, for the same reason.
        const stored = options.getRefreshToken();
        if (stored !== refreshToken || options.sessionGeneration() !== generation) {
          return { status: 'superseded' };
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
