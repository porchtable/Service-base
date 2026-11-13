"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formToObject } from "@/lib/schemas";
import { actionContext } from "@/server/auth/context";
import { createCustomer, setCustomerArchived, updateCustomer } from "@/server/domain/customers";
import { runAction, type ActionResult } from "@/server/errors";

export async function createCustomerAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  let id = "";
  const res = await runAction(async () => {
    id = await createCustomer(await actionContext(), formToObject(fd));
  });
  if (!res.ok) return res;
  redirect(`/app/customers/${id}?created=1`);
}

export async function updateCustomerAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const id = String(fd.get("id") ?? "");
  const res = await runAction(async () => {
    await updateCustomer(await actionContext(), id, formToObject(fd));
  });
  if (!res.ok) return res;
  revalidatePath(`/app/customers/${id}`);
  redirect(`/app/customers/${id}?updated=1`);
}

export async function setCustomerArchivedAction(_p: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const id = String(fd.get("id") ?? "");
    await setCustomerArchived(await actionContext(), id, fd.get("archived") === "true");
    revalidatePath(`/app/customers/${id}`);
    revalidatePath("/app/customers");
  });
}
