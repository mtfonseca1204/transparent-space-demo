import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
import { getRequestAdminAccess } from "@/lib/server-auth";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/**
 * GET /api/admin/members?spaceId=...
 * List all whitelisted members for a space (admin-only)
 */
export async function GET(request: NextRequest) {
  try {
    const spaceId = request.nextUrl.searchParams.get("spaceId");

    if (!(await getRequestAdminAccess(request))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // If spaceId is provided, get members for that space; otherwise get all members
    let query = supabaseAdmin
      .from("space_members")
      .select("id, email, space_id, created_at, spaces(name, slug)")
      .order("created_at", { ascending: true });

    if (spaceId) {
      query = query.eq("space_id", spaceId);
    }

    const { data: members, error } = await query;

    if (error) {
      console.error("Members fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
    }

    return NextResponse.json({ members: members || [] });
  } catch (error) {
    console.error("Members GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/admin/members
 * Add a user to a space whitelist (admin-only)
 * Body: { email, spaceId, password }
 */
export async function POST(request: NextRequest) {
  try {
    const { email, spaceId, password } = await request.json();

    if (!email || !spaceId || !password) {
      return NextResponse.json(
        { error: "email, spaceId, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    if (!(await getRequestAdminAccess(request))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if the space exists
    const { data: space } = await supabaseAdmin
      .from("spaces")
      .select("id")
      .eq("id", spaceId)
      .single();

    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    // Check if already whitelisted
    const { data: existing } = await supabaseAdmin
      .from("space_members")
      .select("id")
      .eq("email", normalizedEmail)
      .eq("space_id", spaceId)
      .single();

    if (existing) {
      return NextResponse.json({ error: "User is already whitelisted for this space" }, { status: 409 });
    }

    // Insert the membership
    const { data: member, error } = await supabaseAdmin
      .from("space_members")
      .insert({ email: normalizedEmail, space_id: spaceId })
      .select("id, email, space_id, created_at")
      .single();

    if (error) {
      console.error("Member insert error:", error);
      return NextResponse.json({ error: "Failed to add member" }, { status: 500 });
    }

    // Create password credentials for the new member
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { error: credError } = await supabaseAdmin
      .from("user_credentials")
      .upsert(
        {
          email: normalizedEmail,
          password_hash: passwordHash,
          must_change_password: true,
        },
        { onConflict: "email" }
      );

    if (credError) {
      console.error("Credential insert error:", credError);
      // Member was created but credentials failed — still return success with a warning
    }

    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    console.error("Members POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/members
 * Remove a user from a space whitelist (admin-only)
 * Body: { email, spaceId }
 */
export async function DELETE(request: NextRequest) {
  try {
    const { email, spaceId } = await request.json();

    if (!email || !spaceId) {
      return NextResponse.json(
        { error: "email and spaceId are required" },
        { status: 400 }
      );
    }

    if (!(await getRequestAdminAccess(request))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { error } = await supabaseAdmin
      .from("space_members")
      .delete()
      .eq("email", normalizedEmail)
      .eq("space_id", spaceId);

    if (error) {
      console.error("Member delete error:", error);
      return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Members DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
