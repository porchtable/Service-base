import { formatCents, formatDate } from "@/lib/format";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function layout(orgName: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0a1433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #dde3ee;border-radius:12px">
<tr><td style="background:#0a1433;color:#ffffff;padding:16px 24px;border-radius:12px 12px 0 0;font-weight:600">${escapeHtml(orgName)}</td></tr>
<tr><td style="padding:24px">${bodyHtml}</td></tr></table></td></tr></table></body></html>`;
}

export interface EstimateEmailInput {
  kind: "delivery" | "reminder";
  orgName: string;
  orgPhone: string | null;
  customerName: string;
  estimateNumber: number;
  title: string;
  totalCents: number;
  expiresAt: string;
  timeZone: string;
  link: string;
}

export function estimateEmail(i: EstimateEmailInput): { subject: string; html: string; text: string } {
  const total = formatCents(i.totalCents);
  const expires = formatDate(i.expiresAt, i.timeZone);
  const subject = i.kind === "delivery"
    ? `Your estimate from ${i.orgName}: ${i.title}`
    : `Reminder: your estimate from ${i.orgName} is awaiting your response`;
  const intro = i.kind === "delivery"
    ? `${i.orgName} has prepared estimate #${i.estimateNumber} for you: <strong>${escapeHtml(i.title)}</strong>.`
    : `This is a reminder that estimate #${i.estimateNumber} (<strong>${escapeHtml(i.title)}</strong>) from ${escapeHtml(i.orgName)} is still awaiting your response.`;
  const html = layout(i.orgName, `
<p style="margin:0 0 12px">Hi ${escapeHtml(i.customerName)},</p>
<p style="margin:0 0 12px">${intro.replace(i.orgName, escapeHtml(i.orgName))}</p>
<p style="margin:0 0 20px">Total: <strong>${total}</strong> · Valid until ${expires}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(i.link)}" style="display:inline-block;background:#ffd21f;color:#0a1433;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Review and respond</a></p>
<p style="margin:0;font-size:12px;color:#4a5675">This link is private to you. ${i.orgPhone ? `Questions? Call ${escapeHtml(i.orgPhone)} or reply to this email.` : "Questions? Reply to this email."}</p>`);
  const text = [
    `Hi ${i.customerName},`,
    "",
    i.kind === "delivery"
      ? `${i.orgName} has prepared estimate #${i.estimateNumber} for you: ${i.title}.`
      : `Reminder: estimate #${i.estimateNumber} (${i.title}) from ${i.orgName} is still awaiting your response.`,
    `Total: ${total} · Valid until ${expires}`,
    "",
    `Review and respond: ${i.link}`,
    "",
    i.orgPhone ? `Questions? Call ${i.orgPhone} or reply to this email.` : "Questions? Reply to this email.",
  ].join("\n");
  return { subject, html, text };
}

export function invitationEmail(i: { orgName: string; inviterName: string; role: string; link: string }) {
  const subject = `You're invited to join ${i.orgName}`;
  const html = layout(i.orgName, `
<p style="margin:0 0 12px">${escapeHtml(i.inviterName)} invited you to join <strong>${escapeHtml(i.orgName)}</strong> as ${escapeHtml(i.role)}.</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(i.link)}" style="display:inline-block;background:#0a1433;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Accept invitation</a></p>
<p style="margin:0;font-size:12px;color:#4a5675">The link expires in 7 days and only works for this email address.</p>`);
  const text = `${i.inviterName} invited you to join ${i.orgName} as ${i.role}.\n\nAccept: ${i.link}\n\nThe link expires in 7 days and only works for this email address.`;
  return { subject, html, text };
}
