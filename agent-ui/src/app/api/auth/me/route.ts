import { NextRequest, NextResponse } from "next/server";
import { deleteSession, getSession } from "@/lib/auth-session";

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json({ authenticated: false });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  if (Date.now() > session.expiresAt) {
    deleteSession(sessionId);
    const res = NextResponse.json({ authenticated: false });
    res.cookies.delete("session_id");
    return res;
  }

  return NextResponse.json({
    authenticated: true,
    userName: session.userName,
    userEmail: session.userEmail,
    userOid: session.userOid,
  });
}
