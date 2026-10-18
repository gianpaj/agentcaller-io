import { NextResponse } from "next/server";
import { resolveBillingSetupToken } from "@/lib/billing-setup";
import { billingErrorResponse } from "@/lib/billing-policy";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("request") ?? "";
    const setup = await resolveBillingSetupToken(token);
    const response = NextResponse.redirect(
      new URL("/billing/connect", request.url),
    );
    response.cookies.set("billing_continuation", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/billing",
      expires: setup.expiresAt,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return billingErrorResponse(error);
  }
}
