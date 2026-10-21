import { NextResponse } from "next/server";
import { Resend } from "resend";

const RECIPIENTS = [
  "pedro@transparent.space",
  "f@transparent.space",
];

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  return new Resend(apiKey);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, website, telegram, message } = body;

    if (!firstName || !lastName || !email || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }

    const resend = getResendClient();

    await resend.emails.send({
      from: "Transparent Space <noreply@transparent.space>",
      to: RECIPIENTS,
      replyTo: email,
      subject: `New Access Request from ${firstName} ${lastName}`,
      html: `
        <h2>New Access Request</h2>
        <p><strong>Name:</strong> ${firstName} ${lastName}</p>
        <p><strong>Email:</strong> ${email}</p>
        ${website ? `<p><strong>Website:</strong> ${website}</p>` : ""}
        ${telegram ? `<p><strong>Telegram:</strong> ${telegram}</p>` : ""}
        <hr />
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, "<br>")}</p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Contact form error:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
