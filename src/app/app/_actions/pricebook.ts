"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formToObject } from "@/lib/schemas";
import { actionContext } from "@/server/auth/context";
import { createPriceBookItem, setPriceBookItemActive, updatePriceBookItem } from "@/server/domain/pricebook";
import { runAction, type ActionResult } from "@/server/errors";

export async function createPriceBookItemAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    await createPriceBookItem(await actionContext(), formToObject(fd));
  });
  if (!res.ok) return res;
  revalidatePath("/app/price-book");
  redirect("/app/price-book?saved=1");
}

export async function updatePriceBookItemAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    await updatePriceBookItem(await actionContext(), String(fd.get("id") ?? ""), formToObject(fd));
  });
  if (!res.ok) return res;
  revalidatePath("/app/price-book");
  redirect("/app/price-book?saved=1");
}

export async function setPriceBookItemActiveAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    await setPriceBookItemActive(await actionContext(), String(fd.get("id") ?? ""), fd.get("active") === "true");
    revalidatePath("/app/price-book");
  });
}
