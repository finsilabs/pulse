export type Fetch = typeof fetch;
export async function jsonRequest(
  fetcher: Fetch,
  url: URL,
  init: RequestInit,
  host: string,
): Promise<any> {
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.username ||
    url.password
  )
    throw Error("Upstream URL refused");
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw Error("Ad platform read unavailable");
  }
  if (!response.ok)
    throw Error("Ad platform read refused (HTTP " + response.status + ")");
  try {
    return await response.json();
  } catch {
    throw Error("Invalid upstream JSON");
  }
}
export function number(value: unknown, optional = false): number {
  if (optional && value === undefined) return 0;
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "") ||
    value === null
  )
    throw Error("Unavailable upstream number");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw Error("Invalid upstream number");
  return n;
}
