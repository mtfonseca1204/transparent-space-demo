import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import { getRequestAdminAccess } from "@/lib/server-auth";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function POST(request: NextRequest) {
  try {
    const { targetEmail, newPassword } = await request.json();

    if (!targetEmail || !newPassword) {
      return NextResponse.json(
        { error: "targetEmail and newPassword are required" },
        { status: 400 }
      );
    }

    if (!(await getRequestAdminAccess(request))) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Upsert: insert or update credentials
    const { error } = await supabaseAdmin
      .from("user_credentials")
      .upsert(
        {
          email: normalizedEmail,
          password_hash: passwordHash,
          must_change_password: true,
        },
        { onConflict: "email" }
      );

    if (error) {
      console.error("Reset password error:", error);
      return NextResponse.json(
        { error: "Failed to reset password" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
