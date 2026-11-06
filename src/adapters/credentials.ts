import {
  mkdir,
  lstat,
  readFile,
  writeFile,
  rename,
  chmod,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
export interface Store {
  read<T>(name: string, fallback: T): Promise<T>;
  write<T>(name: string, value: T): Promise<void>;
}
export const Grant = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_at: z.number().finite().optional(),
  developer_token: z.string().optional(),
  login_customer_id: z.string().regex(/^\d+$/).optional(),
});
export type Grant = z.infer<typeof Grant>;
export const Credentials = z
  .object({ meta: Grant.optional(), google: Grant.optional() })
  .strict();
export type Credentials = z.infer<typeof Credentials>;
export async function privateDir(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const st = await lstat(dir);
  if (
    st.isSymbolicLink() ||
    !st.isDirectory() ||
    (typeof process.getuid === "function" && st.uid !== process.getuid())
  )
    throw Error("Unsafe storage directory");
  await chmod(dir, 0o700);
}
export async function safeRead(path: string): Promise<string | undefined> {
  try {
    const st = await lstat(path);
    if (
      st.isSymbolicLink() ||
      !st.isFile() ||
      (typeof process.getuid === "function" && st.uid !== process.getuid()) ||
      (st.mode & 0o077) !== 0
    )
      throw Error("Unsafe storage permissions");
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw Error("Storage unavailable or unsafe");
  }
}
export async function atomicWrite(path: string, value: string) {
  await privateDir(dirname(path));
  await safeRead(path);
  const temp = path + "." + randomBytes(8).toString("hex");
  try {
    await writeFile(temp, value, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch {
    throw Error("Private state could not be saved");
  }
}
export class LocalStore implements Store {
  private queue = Promise.resolve();
  constructor(readonly dir: string) {}
  private path(name: string) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw Error("Invalid store key");
    return join(this.dir, name + ".json");
  }
  async read<T>(name: string, fallback: T): Promise<T> {
    await this.queue;
    const raw = await safeRead(this.path(name));
    if (raw === undefined) return structuredClone(fallback);
    try {
      return JSON.parse(raw);
    } catch {
      throw Error("Stored JSON is invalid");
    }
  }
  async write<T>(name: string, value: T) {
    const path = this.path(name);
    const operation = this.queue.then(() =>
      atomicWrite(path, JSON.stringify(value, null, 2) + "\n"),
    );
    this.queue = operation.catch(() => {});
    await operation;
  }
}
