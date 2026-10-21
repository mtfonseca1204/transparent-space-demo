import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getRequestAdminAccess } from "@/lib/server-auth";

/**
 * GET /api/admin/admins
 * List all admin users (admin-only)
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await getRequestAdminAccess(request))) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const { data: admins, error } = await supabaseAdmin
      .from("admin_users")
      .select("id, email, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Admins fetch error:", error);
      return NextResponse.json(
        { error: "Failed to fetch admins" },
        { status: 500 }
      );
    }

    return NextResponse.json({ admins: admins || [] });
  } catch (error) {
    console.error("Admins GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
