import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAiSettingsStore } from "./aiSettings";
import { ChatgptAuthError, createChatgptAuth, verifyIdToken } from "./chatgptAuth";
import { aiProviders } from "./providers";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const CLIENT_ID = "oaiapp_test";

function idToken(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const goodClaims = (nonce: string) => ({ iss: "https://auth.openai.com", aud: CLIENT_ID, sub: "user-1", email: "crew@example.com", nonce, exp: Math.floor(Date.now() / 1000) + 600 });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answers the JWKS and token endpoints like OpenAI does; records token requests. */
function mockOpenAi(tokenResponse: (form: URLSearchParams) => Response) {
  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/.well-known/jwks.json")) return json({ keys: [jwk] });
      if (url.endsWith("/oauth/token")) {
        const form = new URLSearchParams(String(init?.body));
        tokenRequests.push(form);
        return tokenResponse(form);
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
  return tokenRequests;
}

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT sign-in", () => {
  let auth: ReturnType<typeof createChatgptAuth>;
  beforeAll(() => {
    auth = createChatgptAuth();
  });

  it("starts a first sign-in with dynamic registration, PKCE and the loopback callback", () => {
    const url = new URL(auth.start({ port: 3000, hostId: "urn:uuid:host" }));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "dynamic_agent_client",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:3000/auth/callback",
      resource: "https://api.openai.com/v1",
      code_challenge_method: "S256",
      ext_agent_host_id: "urn:uuid:host",
      agent_name_hint: "PBResults Scoreboard"
    });
    expect(url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
  });

  it("reuses the issued client id and skips the app name when signing in again", () => {
    const url = new URL(auth.start({ port: 3000, hostId: "urn:uuid:host", clientId: CLIENT_ID, idTokenHint: "old.token.here" }));
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.has("agent_name_hint")).toBe(false);
    expect(url.searchParams.get("id_token_hint")).toBe("old.token.here");
  });

  it("finishes with the issued client id and a verified ID token", async () => {
    const url = new URL(auth.start({ port: 3000, hostId: "urn:uuid:host" }));
    const nonce = url.searchParams.get("nonce")!;
    const requests = mockOpenAi(() =>
      json({ access_token: "access-1", refresh_token: "refresh-1", id_token: idToken(goodClaims(nonce)), expires_in: 3600, scope: "openid email chatgpt.tokens.use.direct" })
    );
    const credentials = await auth.finish({ code: "code-1", state: url.searchParams.get("state")!, client_id: CLIENT_ID });
    expect(credentials).toMatchObject({ clientId: CLIENT_ID, accessToken: "access-1", refreshToken: "refresh-1", sub: "user-1", account: "crew@example.com" });
    expect(Object.fromEntries(requests[0])).toMatchObject({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: "code-1",
      redirect_uri: "http://127.0.0.1:3000/auth/callback",
      resource: "https://api.openai.com/v1"
    });
    expect(requests[0].get("code_verifier")).toBeTruthy();
  });

  it("refuses an unknown or reused state, a cancelled sign-in and a wrong nonce", async () => {
    await expect(auth.finish({ code: "x", state: "never-issued" })).rejects.toMatchObject({ kind: "expired" });

    const cancelled = new URL(auth.start({ port: 3000, hostId: "h" }));
    await expect(auth.finish({ error: "access_denied", state: cancelled.searchParams.get("state")! })).rejects.toMatchObject({ kind: "denied" });

    const url = new URL(auth.start({ port: 3000, hostId: "h" }));
    mockOpenAi(() => json({ access_token: "a", refresh_token: "r", id_token: idToken(goodClaims("someone-else")), expires_in: 3600, scope: "" }));
    const state = url.searchParams.get("state")!;
    await expect(auth.finish({ code: "c", state, client_id: CLIENT_ID })).rejects.toBeInstanceOf(ChatgptAuthError);
    await expect(auth.finish({ code: "c", state, client_id: CLIENT_ID })).rejects.toMatchObject({ kind: "expired" });
  });

  it("rejects ID tokens with a bad signature, issuer or audience", async () => {
    mockOpenAi(() => json({}));
    const token = idToken(goodClaims("n"));
    const [header, payload] = token.split(".");
    await expect(verifyIdToken(`${header}.${payload}.${Buffer.from("forged").toString("base64url")}`, { clientId: CLIENT_ID })).rejects.toThrow("couldn't be verified");
    await expect(verifyIdToken(idToken({ ...goodClaims("n"), aud: "someone-else" }), { clientId: CLIENT_ID })).rejects.toThrow("another app");
    await expect(verifyIdToken(idToken({ ...goodClaims("n"), iss: "https://evil.example" }), { clientId: CLIENT_ID })).rejects.toThrow("another app");
  });
});

describe("ChatGPT plan in the settings store", () => {
  const credentials = (expiresAt: number) => ({
    clientId: CLIENT_ID,
    accessToken: "old-access",
    refreshToken: "old-refresh",
    idToken: "id",
    expiresAt,
    scopes: ["chatgpt.tokens.use.direct"],
    sub: "user-1",
    account: "crew@example.com"
  });

  it("refreshes a token about to expire and keeps the rotated refresh token", async () => {
    const auth = createChatgptAuth();
    const settings = createAiSettingsStore({ memory: true, chatgptAuth: auth });
    settings.saveChatgpt(credentials(Date.now() + 30_000));
    const requests = mockOpenAi(() => json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, scope: "chatgpt.tokens.use.direct" }));
    expect(settings.active()?.id).toBe("chatgpt");
    expect(await settings.active()!.config.accessToken!()).toBe("new-access");
    expect(Object.fromEntries(requests[0])).toMatchObject({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: "old-refresh" });
    expect(await settings.active()!.config.accessToken!()).toBe("new-access");
    expect(requests).toHaveLength(1);
  });

  it("marks the sign-in for renewal when the refresh token is rejected, keeping the registration", async () => {
    const settings = createAiSettingsStore({ memory: true, chatgptAuth: createChatgptAuth() });
    settings.saveChatgpt(credentials(Date.now() - 1000));
    mockOpenAi(() => json({ error: "invalid_grant" }, 400));
    await expect(settings.active()!.config.accessToken!()).rejects.toMatchObject({ kind: "signed-out" });
    const view = settings.view(true).providers.find((provider) => provider.id === "chatgpt")!;
    expect(view).toMatchObject({ configured: false, needsSignInAgain: true });
    expect(settings.chatgptRegistration().clientId).toBe(CLIENT_ID);
  });

  it("signing out keeps the issued client id but forgets the tokens", () => {
    const settings = createAiSettingsStore({ memory: true });
    settings.saveChatgpt(credentials(Date.now() + 3_600_000));
    settings.signOutChatgpt();
    expect(settings.active()).toBeNull();
    expect(settings.chatgptRegistration()).toEqual({ clientId: CLIENT_ID, idTokenHint: undefined });
    expect(JSON.stringify(settings.view(true))).not.toContain("old-access");
  });
});

describe("ChatGPT plan requests", () => {
  function stream(events: unknown[]) {
    const text = events.map((event) => `event: x\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join("");
    return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const input = (fetchImpl: (body: Record<string, unknown>) => Response) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        return fetchImpl(body);
      })
    );
    return {
      bodies,
      run: () =>
        aiProviders.chatgpt.complete({
          config: { model: "gpt-test", accessToken: async () => "token" },
          system: "sys",
          messages: [{ role: "user", text: "hi", images: [{ mediaType: "image/png", data: "AAAA" }] }],
          maxOutputTokens: 100,
          signal: new AbortController().signal
        })
    };
  };

  it("streams the answer with store off, and counts only a completed response", async () => {
    const { bodies, run } = input(() =>
      stream([
        { type: "response.output_text.delta", delta: '{"summary":' },
        { type: "response.output_text.delta", delta: '"ok","ops":[]}' },
        { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } }
      ])
    );
    expect(await run()).toEqual({ text: '{"summary":"ok","ops":[]}', usage: { inputTokens: 10, outputTokens: 5 } });
    expect(bodies[0]).toMatchObject({ model: "gpt-test", store: false, stream: true, instructions: "sys" });
  });

  it("explains a plan limit reached mid-stream", async () => {
    const { run } = input(() => stream([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]));
    await expect(run()).rejects.toMatchObject({ kind: "plan-limit" });
  });

  it("retries without images when the plan refuses them, and flags an ineligible account", async () => {
    let calls = 0;
    const { bodies, run } = input(() => (++calls === 1 ? json({ error: { code: "invalid_value" } }, 400) : stream([{ type: "response.completed", response: { output: [{ content: [{ type: "output_text", text: "x" }] }] } }])));
    expect((await run()).text).toBe("x");
    expect(JSON.stringify(bodies[1])).not.toContain("input_image");

    const ineligible = input(() => json({ error: { code: "subscription_sharing_user_not_eligible" } }, 403));
    await expect(ineligible.run()).rejects.toMatchObject({ kind: "not-eligible" });
  });
});
