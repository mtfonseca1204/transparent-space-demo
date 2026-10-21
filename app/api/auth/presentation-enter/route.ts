import { NextResponse } from "next/server";
import { setAuthSessionCookie } from "@/lib/auth-cookie";
import {
  DEV_LOCAL_AUTH_EMAIL,
  getDevLocalAuthAccess,
  isDevLocalAuthEnabled,
} from "@/lib/dev-local-auth";
import { DEMO_SPACE_SLUG } from "@/lib/demo/constants";

/**
 * One-click Demo entry for recruiter / presentation deploys.
 * Only works when DEV_LOCAL_AUTH + PRESENTATION_DEMO_AUTH (or local DEV_LOCAL_AUTH) are enabled.
 * No email verification — sets a demo session cookie and returns the Demo space.
 */
export async function POST() {
  if (!isDevLocalAuthEnabled()) {
    return NextResponse.json({ available: false }, { status: 404 });
  }

  const access = getDevLocalAuthAccess(DEV_LOCAL_AUTH_EMAIL);
  if (!access) {
    return NextResponse.json({ available: false }, { status: 404 });
  }

  const response = NextResponse.json({
    available: true,
    valid: true,
    email: access.email,
    role: access.role,
    spaces: access.spaces,
    redirectTo: `/${DEMO_SPACE_SLUG}`,
  });
  setAuthSessionCookie(response, access.email, access.role);
  return response;
}

export async function GET() {
  return NextResponse.json({
    available: isDevLocalAuthEnabled(),
  });
}
