import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import {
  getPasswordChangeSessionFromRequest,
  setAuthSessionCookie,
} from "@/lib/auth-cookie";
import { getAccessForEmail } from "@/lib/server-auth";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function POST(request: NextRequest) {
  try {
    const pendingSession = getPasswordChangeSessionFromRequest(request);
    if (!pendingSession) {
      return NextResponse.json(
        { error: "Password change session expired. Please log in again." },
        { status: 401 }
      );
    }

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "currentPassword and newPassword are required" },
        { status: 400 }
      );
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const normalizedEmail = pendingSession.email.trim().toLowerCase();
    const access = await getAccessForEmail(normalizedEmail);

    if (!access) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Fetch current credentials
    const { data: credentials } = await supabaseAdmin
      .from("user_credentials")
      .select("id, password_hash")
      .eq("email", normalizedEmail)
      .single();

    if (!credentials) {
      return NextResponse.json(
        { error: "No credentials found for this email" },
        { status: 404 }
      );
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, credentials.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { error } = await supabaseAdmin
      .from("user_credentials")
      .update({
        password_hash: newHash,
        must_change_password: false,
      })
      .eq("id", credentials.id);

    if (error) {
      console.error("Password update error:", error);
      return NextResponse.json(
        { error: "Failed to update password" },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      email: access.email,
      role: access.role,
      spaces: access.spaces,
    });
    setAuthSessionCookie(response, access.email, access.role);
    return response;
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
