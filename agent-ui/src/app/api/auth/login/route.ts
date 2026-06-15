import { NextResponse } from "next/server";
import crypto from "crypto";

// Generic Entra sign-in scopes — identity only, no resource API.
const SCOPES = "openid profile email offline_access";

export async function GET() {
  const clientId = process.env.AZURE_AD_CLIENT_ID!;
  const redirectUri = process.env.REDIRECT_URI ?? "http://localhost:3000";

  console.log("[AUTH LOGIN] Starting login — clientId:", clientId?.substring(0, 8) + "...", "redirectUri:", redirectUri);

  // Generate PKCE
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
    prompt: "login",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const tenantId = process.env.AZURE_AD_TENANT_ID || "common";
  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;

  console.log("[AUTH LOGIN] Redirecting to tenant:", tenantId);

  const isSecure = redirectUri.startsWith("https://");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("oauth_verifier", codeVerifier, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return response;
}
