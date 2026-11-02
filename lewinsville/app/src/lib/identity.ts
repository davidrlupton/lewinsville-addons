// Who is using the app. Behind Cloudflare Access the verified email arrives in a header; on the LAN
// during development DEV_USER_EMAIL stands in. No passwords live here: Access already did the login.
export type Theme = "festival" | "slate";
export type Person = { email: string; name: string; role: "owner" | "household" | "guest"; theme: Theme; wifiOnly: boolean; device?: string };

// PORTAL_PEOPLE: "email=Name:role:theme:wifi_only:device,..." (set from the add-on options; not in the repo). Theme is festival
// or slate; wifi_only true means only from inside the house; device is the HA device_tracker of their phone, if known.
const PEOPLE: Record<string, Omit<Person, "email">> = Object.fromEntries(
  (process.env.PORTAL_PEOPLE ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [email, rest = ""] = s.split("="); const [name, role = "household", theme = "festival", wifi = "", device = ""] = rest.split(":");
    return [email.toLowerCase(), { name: name || email, role: (role as Person["role"]) || "household", theme: (theme === "slate" ? "slate" : "festival") as Theme, wifiOnly: wifi === "true", device: device || undefined }];
  }),
);

export function personFrom(headers: Headers): Person | null {
  const email = (headers.get("cf-access-authenticated-user-email") ?? process.env.DEV_USER_EMAIL ?? "").toLowerCase();
  if (!email) return null;
  const p = PEOPLE[email];
  return p ? { email, ...p } : { email, name: email.split("@")[0], role: "guest", theme: "festival", wifiOnly: false };
}

/** Everyone on the list, owners first. */
export function everyone(): Person[] {
  return Object.entries(PEOPLE).map(([email, p]) => ({ email, ...p })).sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
}

export function greeting(name: string, d = new Date()) {
  const h = d.getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}
