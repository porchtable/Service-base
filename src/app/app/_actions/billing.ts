"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionContext } from "@/server/auth/context";
import { createCheckoutSession, createPortalSession } from "@/server/billing/stripe";
import { runAction, type ActionResult } from "@/server/errors";

export async function checkoutAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  let url = "";
  const res = await runAction(async () => {
    url = await createCheckoutSession(await actionContext(), z.uuid().parse(fd.get("planId")));
  });
  if (!res.ok) return res;
  redirect(url);
}

export async function portalAction(_p: ActionResult<unknown>): Promise<ActionResult<unknown>> {
  let url = "";
  const res = await runAction(async () => {
    url = await createPortalSession(await actionContext());
  });
  if (!res.ok) return res;
  redirect(url);
}
