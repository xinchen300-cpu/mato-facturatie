import { NextResponse } from "next/server";

import { statementPdf } from "@/lib/pdf";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  if (!(await store.isOwner())) return new NextResponse("Not allowed", { status: 403 });
  const statement = await store.statement(Number(id));
  if (!statement) return new NextResponse("Not found", { status: 404 });
  const pdf = await statementPdf(statement, statement.snapshot.company);
  const name = `Afrekening ${statement.period} ${statement.snapshot.client.name}`.replace(/[^\w\- .]+/g, "_");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
