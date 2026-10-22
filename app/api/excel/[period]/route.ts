import { NextResponse } from "next/server";

import { monthWorkbook } from "@/lib/excel";
import { loadOverview } from "@/lib/month";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  if (!/^\d{4}-\d{2}$/.test(period)) return new NextResponse("Bad month", { status: 400 });
  const store = await getStore();
  if (!(await store.isOwner())) return new NextResponse("Not allowed", { status: 403 });
  const [overview, statements] = await Promise.all([loadOverview(store, period), store.statements({ period })]);
  const file = await monthWorkbook(overview, statements);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Maand ${period}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
