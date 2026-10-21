import { DEMO_SPACE_SLUG } from "@/lib/demo/constants";
import type { AuthAccess, AuthSpace } from "@/lib/server-auth";

export const DEV_LOCAL_AUTH_EMAIL = "dev@transparent.space";
export const DEV_LOCAL_AUTH_PASSWORD = "changeme123";

const DEV_LOCAL_DEMO_SPACE: AuthSpace = {
  id: "local-dev-demo-space",
  name: "Demo",
  slug: DEMO_SPACE_SLUG,
  description: "Local demo showcase",
  logo_url: null,
};

/**
 * Local/dev Demo login without Supabase.
 * - Development: enable with DEV_LOCAL_AUTH=true
 * - Ephemeral presentation deploys: also allow PRESENTATION_DEMO_AUTH=true
 *   (Hobby/preview share links). Never enable PRESENTATION_DEMO_AUTH on the
 *   main production Transparent Space project.
 */
export function isDevLocalAuthEnabled(): boolean {
  if (process.env.DEV_LOCAL_AUTH !== "true") return false;
  if (process.env.NODE_ENV === "development") return true;
  return process.env.PRESENTATION_DEMO_AUTH === "true";
}

export function getDevLocalAuthAccess(email: string): AuthAccess | null {
  if (!isDevLocalAuthEnabled()) return null;

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== DEV_LOCAL_AUTH_EMAIL) return null;

  return {
    email: normalizedEmail,
    role: "member",
    spaces: [DEV_LOCAL_DEMO_SPACE],
  };
}

export function verifyDevLocalPassword(email: string, password: string): boolean {
  const access = getDevLocalAuthAccess(email);
  return Boolean(access && password === DEV_LOCAL_AUTH_PASSWORD);
}
