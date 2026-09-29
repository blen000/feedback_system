import type { Mail } from "./mailer";

const APP_NAME = process.env.NEXT_PUBLIC_BANK_NAME || "Customer Feedback";
const BROWN = "#823e16";
const GOLD = "#e99d02";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function layout(opts: {
  heading: string;
  body: string[];
  cta: string;
  link: string;
  footer: string;
}): string {
  const paragraphs = opts.body
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3b342c">${esc(p)}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#f5f2ed;padding:24px;font-family:Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:8px;border:1px solid #e8e2d9">
<tr><td style="padding:20px 28px;border-bottom:3px solid ${GOLD};font-size:18px;font-weight:600;color:${BROWN}">${esc(APP_NAME)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;color:#1d1a17">${esc(opts.heading)}</h1>
${paragraphs}
<p style="margin:24px 0"><a href="${esc(opts.link)}" style="display:inline-block;background:${GOLD};color:#2a1706;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:6px">${esc(opts.cta)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#6b6357">If the button does not work, copy this address into your browser:</p>
<p style="margin:0 0 20px;font-size:12px;word-break:break-all;color:${BROWN}">${esc(opts.link)}</p>
<p style="margin:0;font-size:13px;color:#6b6357">${esc(opts.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function inviteEmail(input: { to: string; name: string; link: string; hours: number }): Mail {
  const first = input.name.split(" ")[0] || input.name;
  return {
    to: input.to,
    subject: `Set up your ${APP_NAME} account`,
    text: [
      `Hello ${first},`,
      "",
      `An account has been created for you on ${APP_NAME}. Choose your password using the link below:`,
      input.link,
      "",
      `This link can be used once and expires in ${input.hours} hours.`,
      "If you were not expecting this, you can ignore this email.",
    ].join("\n"),
    html: layout({
      heading: `Welcome, ${first}`,
      body: [
        `An account has been created for you on ${APP_NAME}.`,
        "Choose a password to finish setting it up.",
      ],
      cta: "Set my password",
      link: input.link,
      footer: `This link can be used once and expires in ${input.hours} hours. If you were not expecting this email, you can ignore it.`,
    }),
  };
}

export function resetEmail(input: { to: string; name: string; link: string; minutes: number }): Mail {
  const first = input.name.split(" ")[0] || input.name;
  return {
    to: input.to,
    subject: `Reset your ${APP_NAME} password`,
    text: [
      `Hello ${first},`,
      "",
      "We received a request to reset your password. Use the link below to choose a new one:",
      input.link,
      "",
      `This link can be used once and expires in ${input.minutes} minutes.`,
      "If you did not ask for this, ignore this email; your password will not change.",
    ].join("\n"),
    html: layout({
      heading: "Reset your password",
      body: [
        `Hello ${first},`,
        "We received a request to reset your password. Choose a new one with the button below.",
      ],
      cta: "Reset my password",
      link: input.link,
      footer: `This link can be used once and expires in ${input.minutes} minutes. If you did not ask for it, ignore this email and your password will stay the same.`,
    }),
  };
}
