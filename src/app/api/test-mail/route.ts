export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { sendMail } from "@/lib/mail";

export async function GET() {
  try {
    const res = await sendMail({
      subject: "Testmail from /api/test-mail",
      html: "<p>Hallo! Dit is een test.</p>",
    });
    return NextResponse.json({ ok: true, res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "fail" }, { status: 500 });
  }
}
