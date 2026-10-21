import type { NextRequest } from "next/server";
import { getAuthSessionFromRequest, type UserRole } from "@/lib/auth-cookie";
import { getDevLocalAuthAccess } from "@/lib/dev-local-auth";
import { supabaseAdmin } from "@/lib/supabase";

export interface AuthSpace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
}

export interface AuthAccess {
  email: string;
  role: UserRole;
  spaces: AuthSpace[];
}

const SPACE_SELECT = "id, name, slug, description, logo_url";

function normalizeSpace(value: unknown): AuthSpace | null {
  if (!value || typeof value !== "object") return null;

  const space = Array.isArray(value) ? value[0] : value;
  if (!space || typeof space !== "object") return null;

  const candidate = space as Partial<AuthSpace>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.slug !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    slug: candidate.slug,
    description: candidate.description ?? null,
    logo_url: candidate.logo_url ?? null,
  };
}

export async function getAccessForEmail(email: string): Promise<AuthAccess | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const devAccess = getDevLocalAuthAccess(normalizedEmail);
  if (devAccess) return devAccess;

  const { data: admin } = await supabaseAdmin
    .from("admin_users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (admin) {
    const { data: spaces } = await supabaseAdmin
      .from("spaces")
      .select(SPACE_SELECT)
      .order("created_at", { ascending: true });

    return {
      email: normalizedEmail,
      role: "admin",
      spaces: (spaces || []).map(normalizeSpace).filter((space): space is AuthSpace => !!space),
    };
  }

  const { data: memberships } = await supabaseAdmin
    .from("space_members")
    .select(`spaces(${SPACE_SELECT})`)
    .eq("email", normalizedEmail);

  const spaces = (memberships || [])
    .map((membership) => normalizeSpace((membership as { spaces?: unknown }).spaces))
    .filter((space): space is AuthSpace => !!space);

  if (spaces.length === 0) {
    return null;
  }

  return {
    email: normalizedEmail,
    role: "member",
    spaces,
  };
}

export async function getRequestAuthAccess(request: NextRequest) {
  const session = getAuthSessionFromRequest(request);
  if (!session) return null;

  return getAccessForEmail(session.email);
}

export async function getRequestAdminAccess(request: NextRequest) {
  const access = await getRequestAuthAccess(request);
  return access?.role === "admin" ? access : null;
}
