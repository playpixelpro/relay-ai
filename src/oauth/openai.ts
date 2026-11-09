// openai.ts — native OpenAI ChatGPT Plus/Pro OAuth (browser PKCE + device fallback)

import { positiveSecondsToMs, sleepMs, generatePkce, generateOAuthState } from './pkce.js';
import { startCallbackServer, type CallbackServer } from './callback-server.js';
import open from 'open';
import type { OAuthTokenResponse } from './types.js';
import { VERSION } from '../constants.js';
import { postOAuthRefresh } from './refresh-http.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS = 5 * 60 * 1000;

export interface OpenAiIdTokenClaims {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
}

export interface OpenAiDeviceCodeData {
  device_auth_id: string;
  user_code: string;
  interval: string;
  expires_in?: number;
}

export interface OpenAiBrowserAuthParams {
  authUrl: string;
  codeVerifier: string;
  oauthState: string;
  redirectUri: string;
  callbackServer: CallbackServer;
}

/** Build the same localhost browser login used by the official Codex client. */
export async function buildOpenAiBrowserAuthUrl(): Promise<OpenAiBrowserAuthParams> {
  const callbackServer = await startCallbackServer(1455);
  const { verifier, challenge } = await generatePkce();
  const oauthState = generateOAuthState();
  const redirectUri = callbackServer.redirectUri.replace('/callback', '/auth/callback');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthState,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: `relay-ai/${VERSION}`,
  });
  return { authUrl: `${ISSUER}/oauth/authorize?${params}`, codeVerifier: verifier, oauthState, redirectUri, callbackServer };
}

export async function exchangeOpenAiBrowserCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ tokens: OAuthTokenResponse; accountId?: string }> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!response.ok) throw new Error(`OpenAI token exchange failed (${response.status})`);
  const tokens = await response.json() as OAuthTokenResponse;
  return { tokens, accountId: extractOpenAiAccountId(tokens) };
}

export async function runOpenAiBrowserOAuthFlow(): Promise<{ tokens: OAuthTokenResponse; accountId?: string }> {
  const auth = await buildOpenAiBrowserAuthUrl();
  open(auth.authUrl).catch(() => {});
  try {
    const callback = await auth.callbackServer.waitForCallback();
    if (callback.error) throw new Error(`OpenAI authorization failed: ${callback.error}`);
    if (!callback.state || callback.state !== auth.oauthState) throw new Error('OpenAI returned an unexpected OAuth state');
    if (!callback.code) throw new Error('OpenAI did not return an authorization code');
    return await exchangeOpenAiBrowserCode(callback.code, auth.codeVerifier, auth.redirectUri);
  } finally {
    auth.callbackServer.close();
  }
}

export function extractOpenAiAccountId(tokens: OAuthTokenResponse): string | undefined {
  const token = tokens.id_token ?? tokens.access_token;
  if (!token) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as OpenAiIdTokenClaims;
    return claims.chatgpt_account_id
      ?? claims['https://api.openai.com/auth']?.chatgpt_account_id
      ?? claims.organizations?.[0]?.id;
  } catch {
    return undefined;
  }
}

export async function requestOpenAiDeviceCode(): Promise<OpenAiDeviceCodeData> {
  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `relay-ai/${VERSION}`,
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  });
  if (!response.ok) {
    throw new Error('Failed to initiate OpenAI device authorization');
  }
  return response.json() as Promise<OpenAiDeviceCodeData>;
}

export function openAiDeviceCodeUrl(): string {
  return `${ISSUER}/codex/device`;
}

export async function pollOpenAiDeviceCodeToken(
  deviceData: OpenAiDeviceCodeData,
  opts?: { sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<{ tokens: OAuthTokenResponse; accountId?: string }> {
  const sleep = opts?.sleep ?? sleepMs;
  const now = opts?.now ?? (() => Date.now());
  const intervalMs = Math.max(parseInt(deviceData.interval, 10) || 5, 1) * 1000;
  const deadline = now() + positiveSecondsToMs(deviceData.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS);

  while (now() < deadline) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `relay-ai/${VERSION}`,
      },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
    });

    if (response.ok) {
      const data = await response.json() as { authorization_code: string; code_verifier: string };
      const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: data.authorization_code,
          redirect_uri: `${ISSUER}/deviceauth/callback`,
          client_id: CLIENT_ID,
          code_verifier: data.code_verifier,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        throw new Error(`OpenAI token exchange failed (${tokenResponse.status})`);
      }
      const tokens = await tokenResponse.json() as OAuthTokenResponse;
      return { tokens, accountId: extractOpenAiAccountId(tokens) };
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`OpenAI device authorization failed (${response.status})`);
    }

    await sleep(Math.min(intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS, Math.max(0, deadline - now())));
  }
  throw new Error('OpenAI device authorization timed out');
}

export async function refreshOpenAiAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
  return postOAuthRefresh(
    `${ISSUER}/oauth/token`,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
    {
      contentType: 'form',
      errorPrefix: 'OpenAI token refresh failed',
      includeStatus: true,
    },
  );
}

export async function runOpenAiDeviceCodeFlow(
  onDeviceCode: (info: { url: string; userCode: string }) => void,
  opts?: { sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<{ tokens: OAuthTokenResponse; accountId?: string }> {
  const deviceData = await requestOpenAiDeviceCode();
  onDeviceCode({ url: openAiDeviceCodeUrl(), userCode: deviceData.user_code });
  return pollOpenAiDeviceCodeToken(deviceData, opts);
}
