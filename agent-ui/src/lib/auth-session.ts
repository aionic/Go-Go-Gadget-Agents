/**
 * Server-side in-memory session store for OAuth tokens.
 * In production, replace with Redis or a database.
 */

interface TokenSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  userName?: string;
  userEmail?: string;
  // Entra `oid` claim from the id_token. Stable per-user-per-tenant
  // identifier — used to attribute feedback. Stored server-side so the
  // browser never sees it directly.
  userOid?: string;
}

const sessions = new Map<string, TokenSession>();

export function getSession(sessionId: string): TokenSession | undefined {
  return sessions.get(sessionId);
}

export function setSession(sessionId: string, session: TokenSession): void {
  sessions.set(sessionId, session);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}
