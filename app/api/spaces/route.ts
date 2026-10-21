import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/auth-cookie";
import { getRequestAuthAccess } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  try {
    const access = await getRequestAuthAccess(request);

    if (!access) {
      const response = NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
      clearAuthCookies(response);
      return response;
    }

    return NextResponse.json({
      email: access.email,
      spaces: access.spaces,
      role: access.role,
    });
  } catch (error) {
    console.error("Spaces fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
