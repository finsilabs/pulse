import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { safeRead, atomicWrite, type Store } from "../adapters/credentials.js";
export class EncryptedStore {
  private queue = Promise.resolve();
  private state: Record<string, unknown> | undefined;
  constructor(
    private path: string,
    private key: Buffer,
  ) {
    if (key.length !== 32) throw Error("Host key must contain 32 bytes");
  }
  private async load() {
    if (this.state) return this.state;
    const raw = await safeRead(this.path);
    if (raw === undefined) return (this.state = {});
    try {
      const blob = JSON.parse(raw);
      if (blob.v !== 1) throw Error();
      const d = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(blob.iv, "base64"),
      );
      d.setAAD(Buffer.from("pulse-grants-v1"));
      d.setAuthTag(Buffer.from(blob.tag, "base64"));
      this.state = JSON.parse(
        Buffer.concat([
          d.update(Buffer.from(blob.data, "base64")),
          d.final(),
        ]).toString(),
      );
      return this.state!;
    } catch {
      throw Error("Encrypted state cannot be read");
    }
  }
  private async save() {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from("pulse-grants-v1"));
    const data = Buffer.concat([
      c.update(JSON.stringify(this.state), "utf8"),
      c.final(),
    ]);
    await atomicWrite(
      this.path,
      JSON.stringify({
        v: 1,
        iv: iv.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
        data: data.toString("base64"),
      }),
    );
  }
  private async transaction<T>(
    fn: (s: Record<string, unknown>) => T,
    write: boolean,
  ): Promise<T> {
    let result!: T;
    const op = this.queue.then(async () => {
      const state = await this.load();
      result = fn(state);
      if (write) await this.save();
    });
    this.queue = op.catch(() => {});
    await op;
    return structuredClone(result);
  }
  async get<T = any>(key: string): Promise<T | undefined> {
    return this.transaction((s) => s[key] as T | undefined, false);
  }
  async set(key: string, value: unknown) {
    await this.transaction((s) => {
      for (const [k, v] of Object.entries(s)) {
        if (
          v &&
          typeof v === "object" &&
          "expires" in v &&
          typeof v.expires === "number" &&
          v.expires < Date.now()
        )
          delete s[k];
      }
      s[key] = structuredClone(value);
    }, true);
  }
  async take<T = any>(key: string): Promise<T | undefined> {
    return this.transaction((s) => {
      const value = s[key] as T | undefined;
      delete s[key];
      return value;
    }, true);
  }
  async remove(key: string) {
    await this.take(key);
  }
  async keys(prefix: string) {
    return this.transaction(
      (s) => Object.keys(s).filter((k) => k.startsWith(prefix)),
      false,
    );
  }
}
export class SubjectStore implements Store {
  constructor(
    private store: EncryptedStore,
    private subject: string,
  ) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(subject)) throw Error("Invalid subject");
  }
  private key(name: string) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw Error("Invalid store key");
    return "subject:" + this.subject + ":" + name;
  }
  async read<T>(name: string, fallback: T): Promise<T> {
    return (
      (await this.store.get<T>(this.key(name))) ?? structuredClone(fallback)
    );
  }
  async write<T>(name: string, value: T) {
    await this.store.set(this.key(name), value);
  }
}
