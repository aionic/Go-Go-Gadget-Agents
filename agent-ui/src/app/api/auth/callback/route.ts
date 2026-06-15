import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { setSession } from "@/lib/auth-session";

// Generic Entra sign-in scopes — identity only, no resource API.
const SCOPES = "openid profile email offline_access";

export async function GET(request: NextRequest) {
  console.log("[AUTH CALLBACK] === Starting callback ===");
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.error("[AUTH CALLBACK] OAuth error:", error, errorDescription);
    return NextResponse.json({ error, error_description: errorDescription }, { status: 400 });
  }

  if (!code) {
    console.error("[AUTH CALLBACK] Missing authorization code");
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const storedState = request.cookies.get("oauth_state")?.value;
  if (state !== storedState) {
    console.error("[AUTH CALLBACK] State mismatch — possible CSRF or cookie loss");
    return NextResponse.json({ error: "State mismatch" }, { status: 400 });
  }

  const codeVerifier = request.cookies.get("oauth_verifier")?.value;
  const clientId = process.env.AZURE_AD_CLIENT_ID!;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI ?? "http://localhost:3000";

  const isSecure = redirectUri.startsWith("https://");

  const tokenParams = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: SCOPES,
  });
  if (clientSecret) {
    tokenParams.set("client_secret", clientSecret);
  }
  if (codeVerifier) {
    tokenParams.set("code_verifier", codeVerifier);
  }

  const tenantId = process.env.AZURE_AD_TENANT_ID || "common";
  console.log("[AUTH CALLBACK] Exchanging code at tenant:", tenantId);
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    }
  );

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    console.error("[AUTH CALLBACK] Token exchange failed:", err);
    return NextResponse.json({ error: "token_exchange_failed", detail: err }, { status: 400 });
  }

  const tokens = await tokenResponse.json();
  console.log("[AUTH CALLBACK] Token exchange succeeded — expiresIn:", tokens.expires_in, "hasRefresh:", !!tokens.refresh_token, "hasIdToken:", !!tokens.id_token);

  // Decode id_token (no signature verification — Entra issued it to us
  // directly, and we only use claims for local attribution / display,
  // never for authorization). Failures are non-fatal.
  let userOid: string | undefined;
  let userName: string | undefined;
  let userEmail: string | undefined;
  if (typeof tokens.id_token === "string") {
    try {
      const payloadB64 = tokens.id_token.split(".")[1];
      const payload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8")
      );
      if (typeof payload.oid === "string") userOid = payload.oid;
      if (typeof payload.name === "string") userName = payload.name;
      if (typeof payload.preferred_username === "string") {
        userEmail = payload.preferred_username;
      } else if (typeof payload.email === "string") {
        userEmail = payload.email;
      }
    } catch (err) {
      console.warn("[AUTH CALLBACK] Failed to decode id_token:", err);
    }
  }

  const sessionId = crypto.randomUUID();
  setSession(sessionId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    userName,
    userEmail,
    userOid,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.delete("oauth_verifier");
  response.cookies.delete("oauth_state");
  response.cookies.set("session_id", sessionId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 86400,
    path: "/",
  });

  return response;
}
