import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth-session";

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("session_id")?.value;
  if (sessionId) {
    deleteSession(sessionId);
  }

  const response = NextResponse.redirect(
    process.env.REDIRECT_URI ?? "http://localhost:3000"
  );
  response.cookies.delete("session_id");
  return response;
}
