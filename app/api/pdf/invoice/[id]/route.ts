import { NextResponse } from "next/server";

import { invoicePdf } from "@/lib/pdf";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  if (!(await store.isOwner())) return new NextResponse("Not allowed", { status: 403 });
  const invoice = await store.invoice(Number(id));
  if (!invoice) return new NextResponse("Not found", { status: 404 });
  const pdf = await invoicePdf(invoice, invoice.snapshot.company, invoice.snapshot.client);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Factuur ${invoice.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
