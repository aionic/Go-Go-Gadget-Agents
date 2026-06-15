import { NextResponse } from "next/server";

// Read GIT_COMMIT from the runtime container env, not a build-time inline.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    commit: process.env.GIT_COMMIT ?? "unknown",
  });
}
