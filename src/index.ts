#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer as httpServer } from "node:http";
import { execFile } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LocalStore, Credentials } from "./adapters/credentials.js";
import {
  appsFromEnv,
  createGrantRequest,
  exchangeGrant,
} from "./adapters/oauth.js";
import { createServer, PulseService } from "./server.js";
import { syntheticSnapshot } from "./fixtures/generate.js";
import { EncryptedStore } from "./remote/grants.js";
import { createHttpApp } from "./remote/http.js";
import { z } from "zod";
import { OAuthClientInformationFullSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
const args = process.argv.slice(2),
  command = args.find((a) => !a.startsWith("-")) ?? "stdio",
  home = process.env.PULSE_HOME ?? join(homedir(), ".config", "pulse"),
  store = new LocalStore(home),
  demo = args.includes("--demo");
async function login(provider: "meta" | "google") {
  const port = Number(process.env.PULSE_LOGIN_PORT ?? 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid login port");
  const redirect = "http://127.0.0.1:" + port + "/callback",
    apps = appsFromEnv(),
    pending = createGrantRequest(provider, redirect, apps);
  let used = false;
  let finish!: (v: void) => void, fail!: (e: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const server = httpServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1:" + port);
    if (
      req.headers.host !== "127.0.0.1:" + port ||
      u.pathname !== "/callback" ||
      req.method !== "GET"
    ) {
      res.writeHead(404).end();
      return;
    }
    if (
      used ||
      u.searchParams.getAll("state").length !== 1 ||
      u.searchParams.get("state") !== pending.state ||
      u.searchParams.getAll("code").length !== 1
    ) {
      res.writeHead(400).end("Invalid authorization callback");
      return;
    }
    used = true;
    try {
      const grant = await exchangeGrant(
          pending,
          u.searchParams.get("code")!,
          apps,
        ),
        creds = Credentials.parse(await store.read("credentials", {}));
      creds[provider] = grant;
      await store.write("credentials", creds);
      res
        .writeHead(200, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        })
        .end("Account connected. You can close this window.");
      finish();
    } catch {
      res.writeHead(400).end("Authorization failed. Try login again.");
      fail(Error("Platform authorization failed"));
    }
  });
  const timer = setTimeout(() => fail(Error("Login timed out")), 300000);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    console.error("Opening platform authorization. Callback: " + redirect);
    const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "rundll32"
            : "xdg-open",
      openArgs =
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", pending.url]
          : [pending.url];
    execFile(opener, openArgs, (error) => {
      if (error)
        console.error(
          "Open this authorization URL in your own browser: " + pending.url,
        );
    });
    await done;
    console.error(provider + " connected; credentials saved privately.");
  } finally {
    clearTimeout(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
async function main() {
  if (command === "login") {
    const provider = args[args.indexOf("login") + 1];
    if (provider !== "meta" && provider !== "google")
      throw Error("Usage: pulse login meta|google");
    await login(provider);
    return;
  }
  if (command === "serve-http") {
    const key = process.env.PULSE_HOST_KEY;
    if (!key || !/^[a-f0-9]{64}$/i.test(key))
      throw Error("PULSE_HOST_KEY must be 64 hex characters");
    const baseUrl = new URL(
        process.env.PULSE_PUBLIC_URL ?? "http://127.0.0.1:8080",
      ),
      port = Number(process.env.PORT ?? 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw Error("Invalid port");
    const pinned = z
      .array(OAuthClientInformationFullSchema)
      .parse(JSON.parse(process.env.PULSE_CIMD_CLIENTS ?? "[]"));
    for (const c of pinned) {
      if (new URL(c.client_id).protocol !== "https:")
        throw Error("CIMD client ID must be HTTPS");
    }
    const app = createHttpApp({
        baseUrl,
        store: new EncryptedStore(
          process.env.PULSE_STATE_FILE ?? join(home, "remote.enc"),
          Buffer.from(key, "hex"),
        ),
        pinnedClients: pinned,
      }),
      server = app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
        console.error("PULSE Streamable HTTP listening on port " + port),
      );
    for (const sig of ["SIGINT", "SIGTERM"] as const)
      process.once(sig, () => server.close(() => process.exit(0)));
    return;
  }
  const service = new PulseService(
    store,
    demo ? { demo: syntheticSnapshot("stop-loss") } : {},
  );
  if (command === "doctor") {
    const accounts = await service.accounts();
    console.log(
      JSON.stringify({ connected: accounts.length, accounts }, null, 2),
    );
    if (!accounts.length) process.exitCode = 1;
    return;
  }
  if (command === "smoke") {
    const accounts = await service.accounts(),
      index = args.indexOf("--account"),
      account =
        index >= 0 ? args[index + 1] : demo ? accounts[0]?.account : undefined;
    if (!account) throw Error("Specify --account or --demo");
    console.log(JSON.stringify(await service.todaysPlay({ account }), null, 2));
    return;
  }
  if (command !== "stdio")
    throw Error(
      "Usage: pulse [--demo] | login meta|google | doctor | smoke --account ID | serve-http",
    );
  await createServer(service).connect(new StdioServerTransport());
}
main().catch(() => {
  console.error(
    "PULSE could not start or complete the command. Check configuration, credentials, permissions and arguments. No platform changes were made.",
  );
  process.exitCode = 1;
});
