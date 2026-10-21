import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/auth-cookie";
import { getRequestAuthAccess } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  try {
    const access = await getRequestAuthAccess(request);

    if (!access) {
      const response = NextResponse.json(
        { authenticated: false, error: "Authentication required" },
        { status: 401 },
      );
      clearAuthCookies(response);
      return response;
    }

    return NextResponse.json({
      authenticated: true,
      email: access.email,
      role: access.role,
      spaces: access.spaces,
    });
  } catch (error) {
    console.error("Auth session error:", error);
    return NextResponse.json(
      { authenticated: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
