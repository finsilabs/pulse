import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createHash, randomBytes } from "node:crypto";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { PulseAuth, digest } from "./auth.js";
import { EncryptedStore, SubjectStore } from "./grants.js";
import { Credentials } from "../adapters/credentials.js";
import {
  createGrantRequest,
  exchangeGrant,
  appsFromEnv,
  type OAuthApps,
  type PendingGrant,
} from "../adapters/oauth.js";
import { PulseService, createServer } from "../server.js";
interface Options {
  baseUrl: URL;
  store: EncryptedStore;
  apps?: OAuthApps;
  pinnedClients?: OAuthClientInformationFull[];
  demo?: boolean;
}
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function cookie(req: Request) {
  const found = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("pulse_consent="));
  return found?.slice("pulse_consent=".length);
}
function scalar(v: unknown) {
  if (typeof v !== "string" || !v || v.length > 4096)
    throw Error("Invalid request");
  return v;
}
export function createHttpApp(options: Options) {
  const { baseUrl, store } = options;
  if (
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash ||
    baseUrl.username ||
    baseUrl.password ||
    (baseUrl.protocol !== "https:" &&
      !(
        baseUrl.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)
      ))
  )
    throw Error("Public URL must be HTTPS origin or loopback");
  const app = express(),
    auth = new PulseAuth(baseUrl, store, options.pinnedClients),
    apps = options.apps ?? appsFromEnv(),
    services = new Map<string, PulseService>();
  app.locals.auth = auth;
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    });
    if (
      req.hostname !== baseUrl.hostname &&
      !(baseUrl.hostname === "[::1]" && req.hostname === "::1")
    )
      return void res.status(403).json({ error: "host_refused" });
    if (req.headers.origin && req.headers.origin !== baseUrl.origin)
      return void res.status(403).json({ error: "origin_refused" });
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(
    mcpAuthRouter({
      provider: auth,
      issuerUrl: baseUrl,
      resourceServerUrl: auth.resource,
      scopesSupported: ["pulse:read"],
      resourceName: "PULSE ad account read access",
    }),
  );
  async function pending(req: Request, ticket: string) {
    const p = await store.get<any>("pending:" + digest(ticket));
    if (
      !p ||
      p.expires < Date.now() ||
      !cookie(req) ||
      digest(cookie(req)!) !== p.cookie_hash
    )
      throw Error("Consent session invalid");
    return p;
  }
  app.get("/consent", async (req, res) => {
    const ticket = scalar(req.query.ticket),
      p = await pending(req, ticket),
      c = await auth.clientsStore.getClient(p.client_id);
    if (!c) throw Error("Unknown client");
    const s = new SubjectStore(store, p.subject),
      grants = Credentials.parse(await s.read("credentials", {}));
    res
      .type("html")
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect PULSE</title><style>body{font:18px/1.5 system-ui;max-width:650px;margin:60px auto;padding:20px}a,button{display:inline-block;margin:10px;padding:12px}button{font:inherit}</style><h1>Connect your ad accounts</h1><p>Client: ' +
          esc(c.client_name ?? c.client_id) +
          "</p><p>PULSE reads your account metrics and suggests budgets. It never changes your ads. Google’s grant is broad; PULSE restricts its implementation to reads. This host stores your grants encrypted.</p><p>" +
          esc(grants.meta ? "Meta connected. " : "") +
          esc(grants.google ? "Google connected." : "") +
          "</p>" +
          (apps.meta_id
            ? '<a href="/upstream/start/meta?ticket=' +
              encodeURIComponent(ticket) +
              '">Connect Meta</a>'
            : "") +
          (apps.google_id
            ? '<a href="/upstream/start/google?ticket=' +
              encodeURIComponent(ticket) +
              '">Connect Google</a>'
            : "") +
          '<form method="post" action="/consent"><input type="hidden" name="ticket" value="' +
          esc(ticket) +
          '"><button name="decision" value="approve">Approve account read access</button><button name="decision" value="deny">Cancel</button></form></html>',
      );
  });
  app.get("/upstream/start/:provider", async (req, res) => {
    const provider = req.params.provider;
    if (provider !== "meta" && provider !== "google")
      throw Error("Unsupported platform");
    const ticket = scalar(req.query.ticket),
      p = await pending(req, ticket),
      grant = createGrantRequest(
        provider,
        new URL("/upstream/callback/" + provider, baseUrl).href,
        apps,
      );
    await store.set("upstream:" + digest(grant.state), {
      ticket,
      grant,
      cookie_hash: p.cookie_hash,
      expires: Date.now() + 600000,
    });
    res.redirect(grant.url);
  });
  app.get("/upstream/callback/:provider", async (req, res) => {
    const state = scalar(req.query.state),
      up = await store.take<{
        ticket: string;
        grant: PendingGrant;
        cookie_hash: string;
        expires: number;
      }>("upstream:" + digest(state));
    if (
      !up ||
      up.expires < Date.now() ||
      up.grant.provider !== req.params.provider ||
      !cookie(req) ||
      digest(cookie(req)!) !== up.cookie_hash
    )
      throw Error("Upstream state invalid");
    const p = await pending(req, up.ticket);
    if (req.query.error) throw Error("Platform authorization declined");
    const grant = await exchangeGrant(up.grant, scalar(req.query.code), apps),
      s = new SubjectStore(store, p.subject),
      creds = Credentials.parse(await s.read("credentials", {}));
    creds[up.grant.provider] = grant;
    await s.write("credentials", creds);
    res.redirect("/consent?ticket=" + encodeURIComponent(up.ticket));
  });
  app.post("/consent", async (req, res) => {
    const ticket = scalar(req.body.ticket),
      p = await pending(req, ticket),
      client = await auth.clientsStore.getClient(p.client_id);
    if (!client) throw Error("Unknown client");
    const target = new URL(p.params.redirectUri);
    if (!client.redirect_uris.includes(target.href))
      throw Error("Redirect changed");
    if (p.params.state) target.searchParams.set("state", p.params.state);
    if (req.body.decision === "deny") {
      target.searchParams.set("error", "access_denied");
    } else if (req.body.decision === "approve") {
      const creds = Credentials.parse(
        await new SubjectStore(store, p.subject).read("credentials", {}),
      );
      if (!creds.meta && !creds.google)
        return void res
          .status(400)
          .send("Connect at least one platform before approving.");
      const consumed = await store.take<any>("pending:" + digest(ticket));
      if (!consumed) throw Error("Consent already consumed");
      const code = await auth.issueCode(
        client,
        {
          ...p.params,
          resource: p.params.resource ? new URL(p.params.resource) : undefined,
        },
        p.subject,
      );
      target.searchParams.set("code", code);
    } else throw Error("Invalid consent decision");
    await store.remove("pending:" + digest(ticket));
    res.clearCookie("pulse_consent", { path: "/" });
    res.redirect(target.href);
  });
  app.all("/mcp", async (req, res) => {
    let subject: string;
    try {
      const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
        req.headers.authorization ?? "",
      );
      if (!match) throw Error();
      const info = await auth.verifyAccessToken(match[1]!);
      if (
        info.resource?.href !== auth.resource.href ||
        !info.scopes.includes("pulse:read") ||
        typeof info.extra?.subject !== "string"
      )
        throw Error();
      subject = info.extra.subject;
    } catch {
      res.set(
        "WWW-Authenticate",
        'Bearer resource_metadata="' +
          new URL("/.well-known/oauth-protected-resource/mcp", baseUrl).href +
          '"',
      );
      return void res.status(401).json({ error: "unauthorized" });
    }
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      return void res.status(405).json({ error: "stateless_post_only" });
    }
    let service = services.get(subject);
    if (!service) {
      if (services.size >= 10000)
        return void res.status(503).json({ error: "capacity" });
      service = new PulseService(new SubjectStore(store, subject));
      services.set(subject, service);
    }
    const server = createServer(service),
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent)
      res
        .status(400)
        .json({
          error: "request_unavailable",
          message:
            "Check request input, consent session and platform configuration.",
        });
  });
  return app;
}
