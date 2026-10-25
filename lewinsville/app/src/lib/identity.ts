// Who is using the app. Behind Cloudflare Access the verified email arrives in a header; on the LAN
// during development DEV_USER_EMAIL stands in. No passwords live here: Access already did the login.
export type Person = { email: string; name: string; role: "owner" | "household" | "guest" };

// PORTAL_PEOPLE: "email=Name:role,email=Name:role" (set from the add-on options; not in the repo).
const PEOPLE: Record<string, Omit<Person, "email">> = Object.fromEntries(
  (process.env.PORTAL_PEOPLE ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [email, rest = ""] = s.split("="); const [name, role = "household"] = rest.split(":");
    return [email.toLowerCase(), { name: name || email, role: (role as Person["role"]) || "household" }];
  }),
);

export function personFrom(headers: Headers): Person | null {
  const email = (headers.get("cf-access-authenticated-user-email") ?? process.env.DEV_USER_EMAIL ?? "").toLowerCase();
  if (!email) return null;
  const p = PEOPLE[email];
  return p ? { email, ...p } : { email, name: email.split("@")[0], role: "guest" };
}

export function greeting(name: string, d = new Date()) {
  const h = d.getHours();
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}
