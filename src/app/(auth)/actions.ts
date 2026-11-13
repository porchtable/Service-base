"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { formToObject, loginSchema, passwordSchema, registerSchema } from "@/lib/schemas";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { enforceRateLimit } from "@/server/ratelimit";
import { clientIp, safeNextPath } from "@/server/request";
import { runAction, invalid, type ActionResult } from "@/server/errors";
import { env } from "@/server/env";
import { ACTIVE_ORG_COOKIE } from "@/server/auth/context";

export async function registerAction(_prev: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const result = await runAction(async () => {
    const d = registerSchema.parse(formToObject(fd));
    await enforceRateLimit("register", await clientIp());
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signUp({
      email: d.email,
      password: d.password,
      options: {
        data: { full_name: d.fullName },
        emailRedirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/onboarding`,
      },
    });
    if (error) {
      // Do not reveal whether an account already exists.
      if (error.code === "weak_password") throw invalid("Choose a stronger password", { password: [error.message] });
      if (error.status === 429) throw invalid("Too many attempts. Please wait and try again.");
      if (error.code !== "user_already_exists") throw invalid("We could not create your account. Please try again.");
    }
  });
  if (!result.ok) return result;
  redirect("/verify-email?sent=1");
}

export async function loginAction(_prev: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const obj = formToObject(fd);
  const next = safeNextPath(obj.next);
  const result = await runAction(async () => {
    const d = loginSchema.parse(obj);
    await enforceRateLimit("login", `${await clientIp()}:${d.email}`);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email: d.email, password: d.password });
    if (error) {
      if (error.code === "email_not_confirmed") {
        throw invalid("Please verify your email address first. Check your inbox for the confirmation link.");
      }
      throw invalid("Incorrect email or password");
    }
  });
  if (!result.ok) return result;
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  redirect("/login?signed_out=1");
}

export async function resendVerificationAction(_prev: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).parse(fd.get("email"));
    await enforceRateLimit("register", `resend:${await clientIp()}`);
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/onboarding` },
    });
  }, "If that address has an unverified account, a new confirmation email is on its way.");
}

export async function forgotPasswordAction(_prev: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).parse(fd.get("email"));
    await enforceRateLimit("passwordReset", `${await clientIp()}:${email}`);
    const supabase = await createSupabaseServerClient();
    // Always respond the same way so the form cannot be used to discover accounts.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${env().NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/reset-password`,
    });
  }, "If an account exists for that address, a password reset link has been sent.");
}

export async function resetPasswordAction(_prev: ActionResult<unknown>, fd: FormData): Promise<ActionResult<unknown>> {
  const result = await runAction(async () => {
    const { password } = z
      .object({ password: passwordSchema, confirm: z.string() })
      .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] })
      .parse(formToObject(fd));
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw invalid("Your reset link has expired. Request a new one.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw invalid(error.code === "same_password" ? "Choose a password you have not used before" : "Could not update your password");
  });
  if (!result.ok) return result;
  redirect("/app?password_updated=1");
}
