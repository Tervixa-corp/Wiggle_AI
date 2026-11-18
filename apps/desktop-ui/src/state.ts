export type Connection = {
  configured: boolean;
  model: string;
  provider: string;
  providerId: string | null;
};
export type Preferences = {
  theme: "dark" | "light";
  compact: boolean;
  enterSends: boolean;
  saveSessions: boolean;
  instructions: string;
};
export type Skill = { id: string; name: string; text: string };
export const defaults: Preferences = {
  theme: "dark",
  compact: false,
  enterSends: true,
  saveSessions: true,
  instructions: "",
};
export function load<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, value: unknown) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be blocked or full. */
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, options);
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The local gateway is unavailable. Build the app and run npm start on your computer.",
    );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "The request did not succeed.",
    );
  return value as T;
}
export const post = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
export const starter: Skill = {
  id: "wiggle-review",
  name: "Review changes",
  text: "Review the supplied change for correctness, security and missing tests. Prioritize actionable defects, cite file locations when known, and distinguish uncertainty from confirmed problems.",
};
