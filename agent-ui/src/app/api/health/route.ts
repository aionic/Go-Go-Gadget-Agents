import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    commit: process.env.GIT_COMMIT ?? "unknown",
  });
}
