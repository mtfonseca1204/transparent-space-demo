import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { isDevLocalAuthEnabled } from "@/lib/dev-local-auth";

export const AUTH_SESSION_COOKIE = "ts_auth_session";
export const PASSWORD_CHANGE_COOKIE = "ts_password_change";

export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const PASSWORD_CHANGE_MAX_AGE_SECONDS = 60 * 10;

export type UserRole = "admin" | "member";
export type SessionKind = "auth" | "password-change";

export interface SignedSessionPayload {
  kind: SessionKind;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

const cookieDefaults = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    if (isDevLocalAuthEnabled()) {
      return "local-dev-auth-secret";
    }

    throw new Error("AUTH_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY is required for auth sessions");
  }

  return secret;
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signBody(body: string) {
  return createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

function isSessionPayload(value: unknown): value is SignedSessionPayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Partial<SignedSessionPayload>;
  const roleIsValid = payload.role === "admin" || payload.role === "member";
  const kindIsValid = payload.kind === "auth" || payload.kind === "password-change";

  return (
    kindIsValid &&
    roleIsValid &&
    typeof payload.email === "string" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  );
}

export function createSignedSessionToken(payload: SignedSessionPayload) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${signBody(body)}`;
}

export function verifySignedSessionToken(token: string | undefined, expectedKind: SessionKind) {
  if (!token) return null;

  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  if (!safeEqual(signBody(body), signature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);

    if (!isSessionPayload(payload)) return null;
    if (payload.kind !== expectedKind) return null;
    if (payload.exp <= now) return null;

    return payload;
  } catch {
    return null;
  }
}

export function createSessionPayload(
  email: string,
  role: UserRole,
  kind: SessionKind = "auth",
): SignedSessionPayload {
  const now = Math.floor(Date.now() / 1000);
  const maxAge =
    kind === "auth" ? AUTH_SESSION_MAX_AGE_SECONDS : PASSWORD_CHANGE_MAX_AGE_SECONDS;

  return {
    kind,
    email: email.trim().toLowerCase(),
    role,
    iat: now,
    exp: now + maxAge,
  };
}

export function getAuthSessionFromRequest(request: NextRequest) {
  return verifySignedSessionToken(request.cookies.get(AUTH_SESSION_COOKIE)?.value, "auth");
}

export function getPasswordChangeSessionFromRequest(request: NextRequest) {
  return verifySignedSessionToken(
    request.cookies.get(PASSWORD_CHANGE_COOKIE)?.value,
    "password-change",
  );
}

export function setAuthSessionCookie(
  response: NextResponse,
  email: string,
  role: UserRole,
) {
  response.cookies.set(
    AUTH_SESSION_COOKIE,
    createSignedSessionToken(createSessionPayload(email, role, "auth")),
    {
      ...cookieDefaults,
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    },
  );
  response.cookies.delete(PASSWORD_CHANGE_COOKIE);
}

export function setPasswordChangeCookie(
  response: NextResponse,
  email: string,
  role: UserRole,
) {
  response.cookies.set(
    PASSWORD_CHANGE_COOKIE,
    createSignedSessionToken(createSessionPayload(email, role, "password-change")),
    {
      ...cookieDefaults,
      maxAge: PASSWORD_CHANGE_MAX_AGE_SECONDS,
    },
  );
  response.cookies.delete(AUTH_SESSION_COOKIE);
}

export function clearAuthCookies(response: NextResponse) {
  response.cookies.delete(AUTH_SESSION_COOKIE);
  response.cookies.delete(PASSWORD_CHANGE_COOKIE);
}
