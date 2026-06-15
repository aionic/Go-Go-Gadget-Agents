import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    clientId: process.env.AZURE_AD_CLIENT_ID ?? "",
    tenantId: process.env.AZURE_AD_TENANT_ID ?? "",
    redirectUri: process.env.REDIRECT_URI ?? "http://localhost:3000",
    gitCommit: process.env.GIT_COMMIT ?? "",
    buildDate: process.env.BUILD_DATE ?? "",
  });
}
