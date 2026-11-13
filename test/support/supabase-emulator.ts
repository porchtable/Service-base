/**
 * ============================================================================
 * TEST-ONLY local emulator for the Supabase Auth (GoTrue) and Storage REST APIs.
 * ============================================================================
 *
 * Why: this development environment cannot pull Supabase's Docker images, so the
 * Supabase CLI stack cannot run. End-to-end tests still need a real HTTP auth
 * server for the unmodified @supabase/ssr code paths in the app.
 *
 * Scope: implements only the endpoints the app uses, with GoTrue-compatible
 * request/response shapes. Users are stored in the same local Postgres
 * `auth.users` table that real Supabase uses, so database triggers, foreign keys
 * and RLS behave exactly as in production. Emails are captured in memory and
 * exposed at GET /__emails for tests.
 *
 * NEVER deploy this. Production uses a real Supabase project.
 */
import http from "node:http";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import postgres from "postgres";
import { SignJWT, jwtVerify } from "jose";

const PORT = Number(process.env.EMULATOR_PORT ?? 54321);
const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/fsa_e2e";
const SECRET = new TextEncoder().encode("local-emulator-jwt-secret-not-for-production");
const ACCESS_TTL = 3600;

if (!/127\.0\.0\.1|localhost/.test(DATABASE_URL)) {
  throw new Error("The Supabase emulator only runs against a local database");
}

const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });

interface CapturedEmail {
  id: string;
  to: string;
  subject: string;
  kind: string;
  link: string;
  at: string;
}
const emails: CapturedEmail[] = [];
const refreshTokens = new Map<string, string>(); // refresh token -> user id
const otpTokens = new Map<string, { userId: string; type: string; expires: number }>(); // token_hash -> ...
const storage = new Map<string, { body: Buffer; contentType: string }>(); // bucket/path -> object
const signedUrls = new Map<string, { key: string; expires: number }>();

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
function checkPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(pw, salt, 32);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

type UserRow = {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  raw_user_meta_data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_sign_in_at: Date | null;
};

function userJson(u: UserRow) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.email_confirmed_at?.toISOString() ?? null,
    confirmed_at: u.email_confirmed_at?.toISOString() ?? null,
    phone: "",
    last_sign_in_at: u.last_sign_in_at?.toISOString() ?? null,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.raw_user_meta_data ?? {},
    identities: [],
    created_at: u.created_at.toISOString(),
    updated_at: u.updated_at.toISOString(),
    is_anonymous: false,
  };
}

async function session(u: UserRow) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = await new SignJWT({ email: u.email, role: "authenticated", aud: "authenticated", session_id: randomUUID() })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(u.id)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TTL)
    .sign(SECRET);
  const refresh_token = randomBytes(24).toString("base64url");
  refreshTokens.set(refresh_token, u.id);
  await sql`update auth.users set last_sign_in_at = now() where id = ${u.id}`;
  return { access_token, token_type: "bearer", expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token, user: userJson(u) };
}

async function findUserByEmail(email: string) {
  const rows = await sql<UserRow[]>`select * from auth.users where lower(email) = lower(${email})`;
  return rows[0];
}
async function findUserById(id: string) {
  const rows = await sql<UserRow[]>`select * from auth.users where id = ${id}`;
  return rows[0];
}

function issueOtp(userId: string, type: string) {
  const token = randomBytes(24).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  otpTokens.set(tokenHash, { userId, type, expires: Date.now() + 3600_000 });
  return tokenHash;
}

function captureEmail(to: string, kind: string, subject: string, link: string) {
  emails.push({ id: randomUUID(), to: to.toLowerCase(), kind, subject, link, at: new Date().toISOString() });
}

// Mirrors the templates in supabase/templates/*.html (token-hash SSR flow).
function sendConfirmation(u: UserRow) {
  const th = issueOtp(u.id, "email");
  captureEmail(u.email, "confirmation", "Confirm your email", `${SITE_URL}/auth/confirm?token_hash=${th}&type=email&next=/onboarding`);
}
function sendRecovery(u: UserRow) {
  const th = issueOtp(u.id, "recovery");
  captureEmail(u.email, "recovery", "Reset your password", `${SITE_URL}/auth/confirm?token_hash=${th}&type=recovery&next=/reset-password`);
}

class HttpError extends Error {
  constructor(public status: number, public code: string, msg: string) {
    super(msg);
  }
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function authUser(req: http.IncomingMessage): Promise<UserRow> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const u = await findUserById(String(payload.sub));
    if (!u) throw new Error("gone");
    return u;
  } catch {
    throw new HttpError(401, "bad_jwt", "invalid JWT");
  }
}

async function handleAuth(req: http.IncomingMessage, url: URL, body: Record<string, unknown>) {
  const path = url.pathname.replace(/^\/auth\/v1/, "");
  const m = req.method;

  if (m === "GET" && path === "/health") return { status: 200, json: { name: "emulator" } };

  if (m === "POST" && path === "/signup") {
    const email = String(body.email ?? "").toLowerCase();
    const password = String(body.password ?? "");
    if (!email.includes("@")) throw new HttpError(400, "validation_failed", "Unable to validate email address: invalid format");
    if (password.length < 6) throw new HttpError(422, "weak_password", "Password should be at least 6 characters.");
    const existing = await findUserByEmail(email);
    if (existing) {
      // GoTrue returns an obfuscated user for existing addresses (no enumeration).
      if (!existing.email_confirmed_at) sendConfirmation(existing);
      return { status: 200, json: { ...userJson(existing), id: randomUUID(), identities: [] } };
    }
    const [u] = await sql<UserRow[]>`
      insert into auth.users (email, encrypted_password, raw_user_meta_data, confirmation_sent_at)
      values (${email}, ${hashPassword(password)}, ${sql.json((body.data as Record<string, string>) ?? {})}, now())
      returning *`;
    sendConfirmation(u);
    return { status: 200, json: userJson(u) };
  }

  if (m === "POST" && path === "/token") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const u = await findUserByEmail(String(body.email ?? ""));
      if (!u || !checkPassword(String(body.password ?? ""), u.encrypted_password)) {
        throw new HttpError(400, "invalid_credentials", "Invalid login credentials");
      }
      if (!u.email_confirmed_at) throw new HttpError(400, "email_not_confirmed", "Email not confirmed");
      return { status: 200, json: await session(u) };
    }
    if (grant === "refresh_token") {
      const rt = String(body.refresh_token ?? "");
      const userId = refreshTokens.get(rt);
      if (!userId) throw new HttpError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(rt);
      const u = await findUserById(userId);
      if (!u) throw new HttpError(400, "user_not_found", "User not found");
      return { status: 200, json: await session(u) };
    }
    throw new HttpError(400, "unsupported_grant_type", "unsupported grant type");
  }

  if (m === "POST" && path === "/verify") {
    const th = String(body.token_hash ?? "");
    const entry = otpTokens.get(th);
    if (!entry || entry.expires < Date.now()) throw new HttpError(403, "otp_expired", "Email link is invalid or has expired");
    otpTokens.delete(th);
    if (entry.type === "email" || entry.type === "signup") {
      await sql`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = ${entry.userId}`;
    }
    const u = await findUserById(entry.userId);
    return { status: 200, json: await session(u!) };
  }

  if (m === "POST" && path === "/resend") {
    const u = await findUserByEmail(String(body.email ?? ""));
    if (u && !u.email_confirmed_at) sendConfirmation(u);
    return { status: 200, json: {} };
  }

  if (m === "POST" && path === "/recover") {
    const u = await findUserByEmail(String(body.email ?? ""));
    if (u) sendRecovery(u);
    return { status: 200, json: {} };
  }

  if (m === "GET" && path === "/user") {
    return { status: 200, json: userJson(await authUser(req)) };
  }

  if (m === "PUT" && path === "/user") {
    const u = await authUser(req);
    if (typeof body.password === "string") {
      if (checkPassword(body.password, u.encrypted_password)) {
        throw new HttpError(422, "same_password", "New password should be different from the old password.");
      }
      await sql`update auth.users set encrypted_password = ${hashPassword(body.password)}, updated_at = now() where id = ${u.id}`;
    }
    return { status: 200, json: userJson((await findUserById(u.id))!) };
  }

  if (m === "POST" && path === "/logout") {
    await authUser(req).catch(() => null);
    return { status: 204, json: null };
  }

  if (m === "DELETE" && path.startsWith("/admin/users/")) {
    const id = path.split("/").pop()!;
    await sql`delete from auth.users where id = ${id}`;
    return { status: 200, json: {} };
  }

  throw new HttpError(404, "not_found", `emulator: ${m} ${path} not implemented`);
}

/** Minimal private-bucket Storage API: upload, sign, download, remove. */
async function handleStorage(req: http.IncomingMessage, url: URL, raw: Buffer) {
  const path = url.pathname.replace(/^\/storage\/v1/, "");
  const m = req.method;
  let match: RegExpMatchArray | null;
  if ((m === "POST" || m === "PUT") && (match = path.match(/^\/object\/([^/]+)\/(.+)$/)) && !path.startsWith("/object/sign/")) {
    const key = `${match[1]}/${decodeURIComponent(match[2])}`;
    if (storage.has(key) && req.headers["x-upsert"] !== "true") throw new HttpError(409, "Duplicate", "The resource already exists");
    storage.set(key, { body: raw, contentType: String(req.headers["content-type"] ?? "application/octet-stream") });
    return { status: 200, json: { Key: key, Id: randomUUID() } };
  }
  if (m === "POST" && (match = path.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
    const key = `${match[1]}/${decodeURIComponent(match[2])}`;
    if (!storage.has(key)) throw new HttpError(404, "not_found", "Object not found");
    const { expiresIn } = JSON.parse(raw.toString() || "{}");
    const token = randomBytes(16).toString("hex");
    signedUrls.set(token, { key, expires: Date.now() + Number(expiresIn ?? 60) * 1000 });
    return { status: 200, json: { signedURL: `/object/sign/${match[1]}/${match[2]}?token=${token}` } };
  }
  if (m === "GET" && (match = path.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
    const s = signedUrls.get(url.searchParams.get("token") ?? "");
    if (!s || s.expires < Date.now()) throw new HttpError(400, "InvalidJWT", "Signed URL expired");
    const obj = storage.get(s.key)!;
    return { status: 200, raw: obj.body, contentType: obj.contentType };
  }
  if (m === "DELETE" && path.match(/^\/object\/([^/]+)$/)) {
    const bucket = path.split("/")[2];
    const { prefixes } = JSON.parse(raw.toString() || "{}");
    for (const p of prefixes ?? []) storage.delete(`${bucket}/${p}`);
    return { status: 200, json: [] };
  }
  throw new HttpError(404, "not_found", `emulator storage: ${m} ${path} not implemented`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  try {
    const raw = await readBody(req);
    if (url.pathname === "/__emails") {
      const to = url.searchParams.get("to")?.toLowerCase();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(to ? emails.filter((e) => e.to === to) : emails));
    }
    let out: { status: number; json?: unknown; raw?: Buffer; contentType?: string };
    if (url.pathname.startsWith("/auth/v1")) {
      const body = raw.length && String(req.headers["content-type"]).includes("json") ? JSON.parse(raw.toString()) : {};
      out = await handleAuth(req, url, body);
    } else if (url.pathname.startsWith("/storage/v1")) {
      out = await handleStorage(req, url, raw);
    } else {
      throw new HttpError(404, "not_found", "not found");
    }
    if (out.raw) {
      res.writeHead(out.status, { "content-type": out.contentType ?? "application/octet-stream" });
      return res.end(out.raw);
    }
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(out.json === null ? undefined : JSON.stringify(out.json));
  } catch (err) {
    const e = err instanceof HttpError ? err : new HttpError(500, "unexpected_failure", String((err as Error).message));
    if (!(err instanceof HttpError)) console.error("[emulator]", err);
    res.writeHead(e.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: e.status, error_code: e.code, msg: e.message, message: e.message, error: e.code }));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[supabase-emulator] listening on http://127.0.0.1:${PORT} (TEST ONLY)`));
