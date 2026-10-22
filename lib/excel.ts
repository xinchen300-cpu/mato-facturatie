import ExcelJS from "exceljs";

import { formatIban, periodLabel } from "./belgium";
import type { Overview } from "./month";
import { machineLabel, machineSerial } from "./month";
import type { Statement } from "./types";

/** The month in Excel: overview, payouts and sales per machine - for you or the accountant. */
export async function monthWorkbook(overview: Overview, statements: Statement[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "Mato Facturatie";

  const sheet = book.addWorksheet("Maandoverzicht");
  sheet.columns = [
    { header: "Klant", key: "client", width: 28 }, { header: "Verkopen", key: "items", width: 10 },
    { header: "Omzet (uit te betalen)", key: "sales", width: 22 }, { header: "Contract(en)", key: "deal", width: 45 },
    { header: "Commissie excl. btw", key: "subtotal", width: 20 }, { header: "Btw", key: "vat", width: 12 },
    { header: "Commissie incl. btw", key: "total", width: 20 }, { header: "Factuur", key: "invoice", width: 14 },
    { header: "Opmerkingen", key: "issues", width: 45 },
  ];
  for (const r of overview.rows) {
    sheet.addRow({ client: r.client.name, items: r.calc.items, sales: r.calc.sales_total, deal: r.calc.deal,
      subtotal: r.calc.subtotal, vat: r.vat, total: r.total, invoice: r.invoice?.number ?? "", issues: r.issues.join(", ") });
  }

  const pay = book.addWorksheet("Uitbetalingen");
  pay.columns = [
    { header: "Klant", key: "client", width: 28 }, { header: "IBAN", key: "iban", width: 24 },
    { header: "Uit te betalen", key: "payout", width: 16 }, { header: "Uitbetaald", key: "paid", width: 12 },
    { header: "Op", key: "on", width: 12 },
  ];
  const names = new Map(overview.clients.map((c) => [c.id, c]));
  for (const s of statements) {
    const client = names.get(s.client_id);
    pay.addRow({ client: client?.name ?? s.client_id, iban: formatIban(client?.iban), payout: Number(s.payout),
      paid: s.paid_out ? "ja" : "nee", on: s.paid_out_on ?? "" });
  }

  const machines = book.addWorksheet("Per automaat");
  machines.columns = [
    { header: "Eigenaar", key: "owner", width: 28 }, { header: "Automaat", key: "machine", width: 40 },
    { header: "Terminal", key: "terminal", width: 18 },
    { header: "Verkopen", key: "items", width: 10 }, { header: "Omzet", key: "revenue", width: 14 },
  ];
  const totals = new Map<string, { owner: string; machine: string; terminal: string; items: number; revenue: number }>();
  const ownerClient = new Map(overview.clients.flatMap((c) => c.owners.map((o) => [o, c.name] as const)));
  for (const r of overview.daily) {
    const key = `${r.owner}@${r.machine_id}`;
    const row = totals.get(key) ?? {
      owner: ownerClient.get(r.owner) ?? r.owner, machine: machineLabel(r.owner, r.machine_id, overview.catalog),
      terminal: machineSerial(r.machine_id, overview.catalog), items: 0, revenue: 0,
    };
    row.items += Number(r.items);
    row.revenue = Math.round((row.revenue + Number(r.revenue)) * 100) / 100;
    totals.set(key, row);
  }
  [...totals.values()].sort((a, b) => b.revenue - a.revenue).forEach((r) => machines.addRow(r));

  for (const ws of [sheet, pay, machines]) {
    ws.getRow(1).font = { bold: true };
    ws.eachRow((row, i) => {
      if (i === 1) return;
      row.eachCell((cell) => {
        if (typeof cell.value === "number" && !["items"].includes(String(ws.getColumn(cell.col).key))) cell.numFmt = "€ #,##0.00";
      });
    });
  }
  book.title = `Maand ${periodLabel(overview.period)}`;
  return Buffer.from(await book.xlsx.writeBuffer());
}
