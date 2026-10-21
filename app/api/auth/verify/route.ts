import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkAuthRateLimit, resetAuthRateLimit } from "@/lib/auth-rate-limit";
import { setAuthSessionCookie, setPasswordChangeCookie } from "@/lib/auth-cookie";
import { isDevLocalAuthEnabled, verifyDevLocalPassword } from "@/lib/dev-local-auth";
import { getAccessForEmail } from "@/lib/server-auth";
import bcrypt from "bcryptjs";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { valid: false, error: "Email is required" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { valid: false, error: "Password is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const rateLimit = checkAuthRateLimit(request, normalizedEmail);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { valid: false, error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        }
      );
    }

    const access = await getAccessForEmail(normalizedEmail);
    if (!access) {
      return NextResponse.json(
        { valid: false, error: "Invalid email or password." },
        { status: 401 }
      );
    }

    if (isDevLocalAuthEnabled() && verifyDevLocalPassword(normalizedEmail, password)) {
      resetAuthRateLimit(request, normalizedEmail);
      const response = NextResponse.json({
        valid: true,
        role: access.role,
        email: access.email,
        spaces: access.spaces,
      });
      setAuthSessionCookie(response, access.email, access.role);
      return response;
    }

    const { data: credentials } = await supabaseAdmin
      .from("user_credentials")
      .select("password_hash, must_change_password")
      .eq("email", normalizedEmail)
      .single();

    if (!credentials) {
      return NextResponse.json(
        { valid: false, error: "Invalid email or password." },
        { status: 401 }
      );
    }

    const passwordValid = await bcrypt.compare(password, credentials.password_hash);
    if (!passwordValid) {
      return NextResponse.json(
        { valid: false, error: "Invalid email or password." },
        { status: 401 }
      );
    }

    resetAuthRateLimit(request, normalizedEmail);

    if (credentials.must_change_password) {
      const response = NextResponse.json({
        valid: true,
        mustChangePassword: true,
        email: access.email,
        role: access.role,
        spaces: access.spaces,
      });
      setPasswordChangeCookie(response, access.email, access.role);
      return response;
    }

    const response = NextResponse.json({
      valid: true,
      role: access.role,
      email: access.email,
      spaces: access.spaces,
    });
    setAuthSessionCookie(response, access.email, access.role);
    return response;
  } catch (error) {
    console.error("Auth verify error:", error);
    return NextResponse.json(
      { valid: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
