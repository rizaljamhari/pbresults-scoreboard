/**
 * "Continue with ChatGPT": OpenAI's sign-in for open-source and locally hosted apps, which lets a ChatGPT Plus or Pro
 * user spend their plan on the theme assistant instead of an API key. OAuth with PKCE and a loopback callback on
 * 127.0.0.1; OpenAI registers the app on first sign-in and returns its client id. No client secret.
 * See https://developers.openai.com/siwc/token-sharing-open-source/sign-in.
 */
import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from "node:crypto";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const REVOKE_URL = `${ISSUER}/api/accounts/oauth/revoke`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
/** Identity, a refresh token, and permission to use the person's ChatGPT plan for requests. */
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
const APP_NAME = "PBResults Scoreboard";
/** How long a started sign-in stays valid. */
const PENDING_TTL_MS = 10 * 60_000;

/** What's saved for a signed-in ChatGPT account. */
export type ChatgptCredentials = {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
  sub: string;
  account: string;
};

export class ChatgptAuthError extends Error {
  constructor(
    readonly kind: "denied" | "expired" | "invalid" | "unreachable" | "signed-out",
    message: string
  ) {
    super(message);
  }
}

type Pending = { verifier: string; nonce: string; redirectUri: string; clientId: string; createdAt: number };

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function postForm(url: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(fields).toString()
    });
  } catch {
    throw new ChatgptAuthError("unreachable", "Couldn't reach ChatGPT. Check the internet connection.");
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : "";
    if (/invalid_grant|token_expired|refresh_token_(expired|invalidated|reused)/.test(code)) {
      throw new ChatgptAuthError("signed-out", "The ChatGPT sign-in has expired. Continue with ChatGPT again in Maintenance → AI assistant.");
    }
    throw new ChatgptAuthError("invalid", `ChatGPT sign-in failed${code ? ` (${code})` : ""}.`);
  }
  return body;
}

let jwksCache: { keys: (JsonWebKey & { kid?: string })[]; fetchedAt: number } | null = null;

async function signingKey(kid: string | undefined): Promise<JsonWebKey> {
  const find = () => jwksCache?.keys.find((key) => !kid || key.kid === kid);
  // Refetch when the key isn't known yet (OpenAI may have rotated it) or the cache is a day old.
  if (!jwksCache || !find() || Date.now() - jwksCache.fetchedAt > 86_400_000) {
    try {
      const response = await fetch(JWKS_URL);
      jwksCache = { keys: ((await response.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys, fetchedAt: Date.now() };
    } catch {
      throw new ChatgptAuthError("unreachable", "Couldn't reach ChatGPT to check the sign-in.");
    }
  }
  const key = find();
  if (!key) throw new ChatgptAuthError("invalid", "ChatGPT's sign-in couldn't be verified.");
  return key;
}

/** Checks the ID token's signature against OpenAI's published keys, then its issuer, audience, expiry and nonce. */
export async function verifyIdToken(idToken: string, expected: { clientId: string; nonce?: string }, now = Date.now()): Promise<Record<string, unknown>> {
  const [headerPart, payloadPart, signaturePart] = idToken.split(".");
  if (!headerPart || !payloadPart || !signaturePart) throw new ChatgptAuthError("invalid", "ChatGPT returned a malformed sign-in.");
  const header = decodeJwtPart(headerPart);
  if (header.alg !== "RS256") throw new ChatgptAuthError("invalid", "ChatGPT's sign-in used an unexpected signature.");
  const key = createPublicKey({ key: await signingKey(typeof header.kid === "string" ? header.kid : undefined), format: "jwk" });
  const valid = verify("RSA-SHA256", Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, "base64url"));
  if (!valid) throw new ChatgptAuthError("invalid", "ChatGPT's sign-in couldn't be verified.");
  const claims = decodeJwtPart(payloadPart);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audience.includes(expected.clientId)) throw new ChatgptAuthError("invalid", "ChatGPT's sign-in was meant for another app.");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - 60_000) throw new ChatgptAuthError("expired", "ChatGPT's sign-in had already expired. Try again.");
  if (expected.nonce !== undefined && claims.nonce !== expected.nonce) throw new ChatgptAuthError("invalid", "ChatGPT's sign-in didn't match this attempt. Try again.");
  return claims;
}

function accountLabel(claims: Record<string, unknown>): string {
  return [claims.email, claims.name, claims.sub].find((value): value is string => typeof value === "string" && value.length > 0) ?? "ChatGPT account";
}

function credentialsFrom(tokens: Record<string, unknown>, clientId: string, previous?: ChatgptCredentials): Omit<ChatgptCredentials, "sub" | "account"> {
  const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : "";
  if (!accessToken) throw new ChatgptAuthError("invalid", "ChatGPT didn't return an access token.");
  return {
    clientId,
    accessToken,
    // Refresh tokens rotate: always keep the newest one.
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : (previous?.refreshToken ?? ""),
    idToken: typeof tokens.id_token === "string" ? tokens.id_token : (previous?.idToken ?? ""),
    expiresAt: Date.now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
    scopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : (previous?.scopes ?? [])
  };
}

/** Sign-ins in progress, keyed by their random state. In memory: a restart simply means signing in again. */
export function createChatgptAuth() {
  const pending = new Map<string, Pending>();

  function prune() {
    const now = Date.now();
    for (const [state, entry] of pending) if (now - entry.createdAt > PENDING_TTL_MS) pending.delete(state);
  }

  return {
    /**
     * Starts a sign-in and returns the ChatGPT URL to open. The callback must be `http://127.0.0.1:<port>/auth/callback`
     * on this computer. A returning account reuses its issued client id and skips the account picker.
     */
    start(params: { port: number; hostId: string; clientId?: string; idTokenHint?: string }): string {
      prune();
      const verifier = base64url(randomBytes(32));
      const state = base64url(randomBytes(24));
      const nonce = base64url(randomBytes(24));
      const redirectUri = `http://127.0.0.1:${params.port}/auth/callback`;
      const clientId = params.clientId ?? "dynamic_agent_client";
      pending.set(state, { verifier, nonce, redirectUri, clientId, createdAt: Date.now() });
      const query = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        resource: CHATGPT_RESOURCE,
        code_challenge: base64url(createHash("sha256").update(verifier).digest()),
        code_challenge_method: "S256",
        state,
        nonce,
        ext_agent_host_id: params.hostId
      });
      // The app name goes only on first registration; a returning account is identified by its last ID token.
      if (clientId === "dynamic_agent_client") query.set("agent_name_hint", APP_NAME);
      if (params.idTokenHint) query.set("id_token_hint", params.idTokenHint);
      return `${AUTHORIZE_URL}?${query.toString()}`;
    },

    /** Finishes a sign-in from the callback's query string. */
    async finish(query: Record<string, string | undefined>): Promise<ChatgptCredentials> {
      prune();
      const entry = query.state ? pending.get(query.state) : undefined;
      if (!entry) throw new ChatgptAuthError("expired", "This sign-in link has expired or was already used. Start again from Maintenance → AI assistant.");
      pending.delete(query.state as string);
      if (query.error) throw new ChatgptAuthError("denied", "ChatGPT sign-in was cancelled.");
      if (!query.code) throw new ChatgptAuthError("invalid", "ChatGPT didn't return a sign-in code.");
      // A first sign-in registers the app and returns its issued client id; use exactly that one from here on.
      const clientId = entry.clientId === "dynamic_agent_client" ? query.client_id : entry.clientId;
      if (!clientId || clientId === "dynamic_agent_client") throw new ChatgptAuthError("invalid", "ChatGPT didn't register the app. Try again.");
      const tokens = await postForm(TOKEN_URL, {
        grant_type: "authorization_code",
        client_id: clientId,
        code: query.code,
        code_verifier: entry.verifier,
        redirect_uri: entry.redirectUri,
        resource: CHATGPT_RESOURCE
      });
      const credentials = credentialsFrom(tokens, clientId);
      if (!credentials.refreshToken || !credentials.idToken) throw new ChatgptAuthError("invalid", "ChatGPT didn't return a complete sign-in.");
      const claims = await verifyIdToken(credentials.idToken, { clientId, nonce: entry.nonce });
      return { ...credentials, sub: String(claims.sub ?? ""), account: accountLabel(claims) };
    },

    /** Swaps the refresh token for a new access token. Throws "signed-out" when the person has to sign in again. */
    async refresh(current: ChatgptCredentials): Promise<ChatgptCredentials> {
      const tokens = await postForm(TOKEN_URL, {
        grant_type: "refresh_token",
        client_id: current.clientId,
        refresh_token: current.refreshToken,
        resource: CHATGPT_RESOURCE
      });
      const next = credentialsFrom(tokens, current.clientId, current);
      if (typeof tokens.id_token === "string") {
        const claims = await verifyIdToken(tokens.id_token, { clientId: current.clientId });
        if (claims.sub !== current.sub) throw new ChatgptAuthError("signed-out", "The ChatGPT account changed. Continue with ChatGPT again.");
      }
      return { ...next, sub: current.sub, account: current.account };
    },

    /** Best effort: tells OpenAI to forget the refresh token. Signing out locally doesn't wait on it. */
    async revoke(current: ChatgptCredentials): Promise<void> {
      await postForm(REVOKE_URL, { client_id: current.clientId, token: current.refreshToken, token_type_hint: "refresh_token" }).catch(() => undefined);
    }
  };
}

export type ChatgptAuth = ReturnType<typeof createChatgptAuth>;

/** A stable id for this installation, sent with every sign-in as OpenAI requires. */
export function newHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}
