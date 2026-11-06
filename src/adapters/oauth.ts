import { randomBytes, createHash } from "node:crypto";
import { jsonRequest, type Fetch } from "./http.js";
import { Grant } from "./credentials.js";
export interface OAuthApps {
  meta_id?: string;
  meta_secret?: string;
  google_id?: string;
  google_secret?: string;
  google_developer_token?: string;
  google_login_customer_id?: string;
}
export interface PendingGrant {
  provider: "meta" | "google";
  state: string;
  verifier?: string;
  redirect_uri: string;
  url: string;
  created_at: number;
}
export function appsFromEnv(): OAuthApps {
  return {
    meta_id: process.env.META_APP_ID,
    meta_secret: process.env.META_APP_SECRET,
    google_id: process.env.GOOGLE_CLIENT_ID,
    google_secret: process.env.GOOGLE_CLIENT_SECRET,
    google_developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    google_login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  };
}
export function createGrantRequest(
  provider: "meta" | "google",
  redirect_uri: string,
  apps: OAuthApps,
): PendingGrant {
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const url = new URL(
    provider === "meta"
      ? "https://www.facebook.com/v23.0/dialog/oauth"
      : "https://accounts.google.com/o/oauth2/v2/auth",
  );
  const id = provider === "meta" ? apps.meta_id : apps.google_id;
  if (!id || (provider === "meta" && !apps.meta_secret))
    throw Error("OAuth app configuration missing");
  url.search = new URLSearchParams({
    client_id: id,
    redirect_uri,
    response_type: "code",
    state,
    scope:
      provider === "meta"
        ? "ads_read"
        : "https://www.googleapis.com/auth/adwords",
    ...(provider === "google"
      ? {
          access_type: "offline",
          prompt: "consent",
          code_challenge_method: "S256",
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
        }
      : {}),
  }).toString();
  return {
    provider,
    state,
    ...(provider === "google" ? { verifier } : {}),
    redirect_uri,
    url: url.href,
    created_at: Date.now(),
  };
}
export async function exchangeGrant(
  p: PendingGrant,
  code: string,
  apps: OAuthApps,
  fetcher: Fetch = fetch,
): Promise<Grant> {
  if (!code || Date.now() - p.created_at > 600000)
    throw Error("OAuth grant expired or invalid");
  const meta = p.provider === "meta",
    url = new URL(
      meta
        ? "https://graph.facebook.com/v23.0/oauth/access_token"
        : "https://oauth2.googleapis.com/token",
    ),
    body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: p.redirect_uri,
      client_id: (meta ? apps.meta_id : apps.google_id) ?? "",
      ...(meta
        ? { client_secret: apps.meta_secret ?? "" }
        : {
            code_verifier: p.verifier ?? "",
            ...(apps.google_secret
              ? { client_secret: apps.google_secret }
              : {}),
          }),
    });
  const r = await jsonRequest(
    fetcher,
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    url.hostname,
  );
  return Grant.parse({
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    ...(r.expires_in
      ? { expires_at: Date.now() + Number(r.expires_in) * 1000 }
      : {}),
    ...(!meta
      ? {
          developer_token: apps.google_developer_token,
          login_customer_id: apps.google_login_customer_id,
        }
      : {}),
  });
}
export async function refreshGoogle(
  grant: Grant,
  apps: OAuthApps,
  fetcher: Fetch = fetch,
): Promise<Grant> {
  if (!grant.refresh_token || !apps.google_id)
    throw Error("Google login required");
  const r = await jsonRequest(
    fetcher,
    new URL("https://oauth2.googleapis.com/token"),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: grant.refresh_token,
        client_id: apps.google_id,
        ...(apps.google_secret ? { client_secret: apps.google_secret } : {}),
      }),
    },
    "oauth2.googleapis.com",
  );
  return Grant.parse({
    ...grant,
    access_token: r.access_token,
    refresh_token: r.refresh_token ?? grant.refresh_token,
    expires_at: Date.now() + Number(r.expires_in ?? 3600) * 1000,
  });
}
