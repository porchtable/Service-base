import { NextResponse, type NextRequest } from "next/server";
import { handleStripeWebhook } from "@/server/billing/stripe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text(); // raw body is required for signature verification
  try {
    const res = await handleStripeWebhook(raw, req.headers.get("stripe-signature"));
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    console.error("[stripe] webhook processing failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe will retry
  }
}
