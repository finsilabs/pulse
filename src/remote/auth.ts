import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTokenError,
  InvalidTargetError,
  InvalidClientMetadataError,
  InvalidRequestError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { EncryptedStore } from "./grants.js";
const random = () => randomBytes(32).toString("base64url"),
  digest = (s: string) => createHash("sha256").update(s).digest("hex");
interface Code {
  client_id: string;
  subject: string;
  params: AuthorizationParams;
  expires: number;
}
interface Access {
  client_id: string;
  subject: string;
  scopes: string[];
  resource: string;
  expires: number;
  family: string;
}
function validateRedirects(uris: string[]) {
  for (const value of uris) {
    const u = new URL(value);
    if (
      u.hash ||
      u.username ||
      u.password ||
      (u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
        ))
    )
      throw new InvalidClientMetadataError(
        "HTTPS or loopback redirect required",
      );
  }
  if (!uris.length) throw new InvalidClientMetadataError("Redirect required");
}
export class PulseAuth implements OAuthServerProvider {
  readonly resource: URL;
  readonly skipLocalPkceValidation = true; // Validation occurs atomically when consuming a code below.
  readonly clientsStore;
  constructor(
    readonly baseUrl: URL,
    readonly store: EncryptedStore,
    private readonly pinned: OAuthClientInformationFull[] = [],
  ) {
    this.resource = new URL("/mcp", baseUrl);
    for (const client of pinned) {
      const id = new URL(client.client_id);
      if (id.protocol !== "https:" || id.username || id.password || id.hash)
        throw new InvalidClientMetadataError("Invalid metadata document ID");
      validateRedirects(client.redirect_uris);
    }
    this.clientsStore = {
      getClient: async (id: string) =>
        pinned.find((c) => c.client_id === id) ??
        (await store.get<OAuthClientInformationFull>("client:" + id)),
      registerClient: async (
        client: Omit<
          OAuthClientInformationFull,
          "client_id" | "client_id_issued_at"
        >,
      ) => {
        if ((await store.keys("client:")).length >= 10000)
          throw new InvalidClientMetadataError("Registration limit reached");
        validateRedirects(client.redirect_uris);
        const c = {
          ...client,
          client_id: random(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await store.set("client:" + c.client_id, c);
        return c;
      },
    };
  }
  isPinnedClient(id: string): boolean {
    return this.pinned.some((client) => client.client_id === id);
  }
  private validate(client: OAuthClientInformationFull, p: AuthorizationParams) {
    if (
      !client.redirect_uris.includes(p.redirectUri) ||
      !p.codeChallenge ||
      !/^[-_A-Za-z0-9]{43}$/.test(p.codeChallenge)
    )
      throw new InvalidRequestError("Invalid authorization parameters");
    if (p.resource && p.resource.href !== this.resource.href)
      throw new InvalidTargetError("Wrong resource");
    if (p.scopes?.some((s) => s !== "pulse:read"))
      throw new InvalidScopeError("Unknown scope");
  }
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    this.validate(client, params);
    const ticket = random(),
      cookie = random();
    await this.store.set("pending:" + digest(ticket), {
      client_id: client.client_id,
      params: { ...params, resource: params.resource?.href },
      cookie_hash: digest(cookie),
      subject: random(),
      expires: Date.now() + 600000,
    });
    res.cookie("pulse_consent", cookie, {
      httpOnly: true,
      secure: this.baseUrl.protocol === "https:",
      sameSite: "lax",
      maxAge: 600000,
      path: "/",
    });
    res.redirect("/consent?ticket=" + encodeURIComponent(ticket));
  }
  async issueCode(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    subject: string,
  ) {
    this.validate(client, params);
    const code = random();
    await this.store.set("code:" + digest(code), {
      client_id: client.client_id,
      subject,
      params: { ...params, resource: params.resource?.href },
      expires: Date.now() + 300000,
    });
    return code;
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    const c = await this.store.get<Code>("code:" + digest(code));
    if (!c || c.expires < Date.now() || c.client_id !== client.client_id)
      throw new InvalidGrantError("Code invalid");
    return c.params.codeChallenge;
  }
  private async tokens(
    clientId: string,
    subject: string,
    scopes = ["pulse:read"],
    family = random(),
  ): Promise<OAuthTokens> {
    const access = random(),
      refresh = random(),
      value: Access = {
        client_id: clientId,
        subject,
        scopes,
        resource: this.resource.href,
        expires: Date.now() + 3600000,
        family,
      };
    await this.store.set("access:" + digest(access), value);
    await this.store.set("refresh:" + digest(refresh), {
      ...value,
      expires: Date.now() + 30 * 86400000,
    });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope: scopes.join(" "),
    };
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    const c = await this.store.take<Code>("code:" + digest(code));
    if (
      !c ||
      c.expires < Date.now() ||
      c.client_id !== client.client_id ||
      redirectUri !== c.params.redirectUri ||
      !verifier ||
      !/^[-._~A-Za-z0-9]{43,128}$/.test(verifier)
    )
      throw new InvalidGrantError("Code invalid");
    const calculated = createHash("sha256")
      .update(verifier)
      .digest("base64url");
    if (
      calculated.length !== c.params.codeChallenge.length ||
      !timingSafeEqual(
        Buffer.from(calculated),
        Buffer.from(c.params.codeChallenge),
      )
    )
      throw new InvalidGrantError("PKCE invalid");
    if (resource && resource.href !== this.resource.href)
      throw new InvalidTargetError("Wrong resource");
    return this.tokens(
      client.client_id,
      c.subject,
      c.params.scopes?.length ? c.params.scopes : ["pulse:read"],
    );
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    token: string,
    scopes?: string[],
    resource?: URL,
  ) {
    const t = await this.store.take<Access>("refresh:" + digest(token));
    if (
      !t ||
      t.client_id !== client.client_id ||
      t.expires < Date.now() ||
      (await this.store.get("revoked:" + t.family))
    )
      throw new InvalidGrantError("Refresh invalid");
    if (resource && resource.href !== t.resource)
      throw new InvalidTargetError("Wrong resource");
    if (scopes?.some((s) => !t.scopes.includes(s)))
      throw new InvalidScopeError("Scope escalation refused");
    return this.tokens(
      client.client_id,
      t.subject,
      scopes ?? t.scopes,
      t.family,
    );
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const t = await this.store.get<Access>("access:" + digest(token));
    if (
      !t ||
      t.expires < Date.now() ||
      t.resource !== this.resource.href ||
      (await this.store.get("revoked:" + t.family))
    )
      throw new InvalidTokenError("Access token invalid");
    return {
      token,
      clientId: t.client_id,
      scopes: t.scopes,
      expiresAt: Math.floor(t.expires / 1000),
      resource: this.resource,
      extra: { subject: t.subject },
    };
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    req: OAuthTokenRevocationRequest,
  ) {
    for (const type of ["access:", "refresh:"]) {
      const t = await this.store.get<Access>(type + digest(req.token));
      if (t?.client_id === client.client_id)
        await this.store.set("revoked:" + t.family, {
          expires: Date.now() + 31 * 86400000,
        });
    }
  }
}
export { digest };
