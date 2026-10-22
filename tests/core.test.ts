import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as be from "@/lib/belgium";
import { buildOrderPayload } from "@/lib/billit";
import { compute } from "@/lib/contracts";
import { closeMonth, deleteInvoice, mailValues } from "@/lib/invoicing";
import { render } from "@/lib/mailer";
import { loadOverview } from "@/lib/month";
import { invoicePdf, statementPdf } from "@/lib/pdf";
import { MemoryStore } from "@/lib/store/memory";
import type { Client, Contract, DailyRow } from "@/lib/types";

const client = (id: number, owners: string[]): Client => ({
  id, name: `Client ${id}`, owners, vat_number: "BE0403170701", street: "Kerkstraat 12 bus 3", zipcode: "9300",
  city: "Aalst", country: "BE", email: "x@example.be", cc_email: "", iban: "BE71096123456769", active: true, notes: "",
});
const contract = (terms: Partial<Contract>): Contract => ({
  id: 1, client_id: 1, name: "", starts_on: "2026-01-01", ends_on: null, pct: 0, base: "incl", sales_vat_pct: 6,
  per_item: 0, fixed_monthly: 0, minimum_monthly: 0, prorate: true, machines: [], notes: "", ...terms,
});
const row = (day: string, revenue: number, items = 1, owner = "business:a", machine = "m1"): DailyRow =>
  ({ owner, machine_id: machine, day, items, revenue });

describe("belgium", () => {
  it("rounds money like Python's Decimal half-up", () => {
    expect(be.percentOf(510.7, 15)).toBe(76.61);
    expect(be.roundMoney(2.675)).toBe(2.68);
    expect(be.roundMoney(1.005)).toBe(1.01);
    expect(be.percentOf(2835.85, 20)).toBe(567.17);
    expect(be.sumMoney([0.1, 0.2])).toBe(0.3);
  });
  it("formats and validates", () => {
    expect(be.fmtEur(1234.5)).toBe("€ 1.234,50");
    expect(be.fmtPct(12.5)).toBe("12,5%");
    expect(be.periodLabel("2026-10")).toBe("oktober 2026");
    expect(be.vatProblem("BE0477472701")).toBeNull();
    expect(be.vatProblem("BE0477472702")).toMatch(/checksum/);
    expect(be.ibanProblem("BE68 5390 0754 7034")).toBeNull();
    expect(be.ibanProblem("BE68539007547035")).toMatch(/check digits/);
    expect(be.ogm(2026, 1)).toBe("+++260/0000/00170+++"); // same as the database function and the desktop app
    expect(be.splitStreet("Kerkstraat 12 bus 3")).toEqual(["Kerkstraat", "12 bus 3"]);
    expect(be.monthBounds("2026-02").last).toBe("2026-02-28");
  });
});

describe("contracts", () => {
  it("combines %, per item and fixed fee", () => {
    const calc = compute(client(1, ["business:a"]), "2026-10", [row("2026-10-03", 1000, 100)],
      [contract({ pct: 10, base: "excl", per_item: 0.05, fixed_monthly: 25 })]);
    // 1000 / 1.06 = 943.40 -> 10% = 94.34; 100 x 0.05 = 5; + 25
    expect(calc.subtotal).toBe(124.34);
    expect(calc.lines.map((l) => l.kind)).toEqual(["pct", "per_item", "fixed"]);
  });

  it("splits a month when the deal changes, with pro rata and minimum", () => {
    const calc = compute(client(1, ["business:a"]), "2026-10", [row("2026-10-01", 1000, 100)], [
      contract({ id: 1, ends_on: "2026-10-15", pct: 10 }),
      contract({ id: 2, starts_on: "2026-10-16", pct: 12, fixed_monthly: 31, minimum_monthly: 62 }),
    ]);
    expect(calc.contracts[0].pct_amount).toBe(100);
    expect(calc.contracts[1].fixed).toBe(16);
    expect(calc.contracts[1].topup).toBe(32);
    expect(calc.subtotal).toBe(148);
  });

  it("limits a contract to machines and reports the rest", () => {
    const rows = [row("2026-10-02", 803.4, 1, "business:a", "m1"), row("2026-10-02", 540.1, 1, "business:a", "m2")];
    const calc = compute(client(1, ["business:a"]), "2026-10", rows, [contract({ pct: 10, machines: ["business:a@m1"] })]);
    expect(calc.subtotal).toBe(80.34);
    expect(calc.uncovered_total).toBe(540.1);
  });

  it("only counts the client's own owners", () => {
    const rows = [row("2026-10-02", 100, 1, "business:a"), row("2026-10-02", 50, 1, "partner:ledoux")];
    expect(compute(client(1, ["partner:ledoux"]), "2026-10", rows, [contract({ pct: 18 })]).subtotal).toBe(9);
  });
});

describe("month closing (demo store)", () => {
  it("makes invoices and afrekeningen, numbers them, and sends nothing twice", async () => {
    const store = MemoryStore.fresh();
    const overview = await loadOverview(store, "2026-09");
    expect(overview.rows.length).toBeGreaterThan(5);
    const ids = overview.rows.map((r) => r.client.id);
    const { made, errors } = await closeMonth(store, "2026-09", ids, "2026-10-03");
    expect(errors).toEqual([]);
    const numbers = made.map((m) => m.invoice).filter(Boolean);
    expect(numbers[0]).toBe("2026-0001");
    expect(new Set(numbers).size).toBe(numbers.length);

    const invoices = await store.invoices({ period: "2026-09" });
    const statements = await store.statements({ period: "2026-09" });
    expect(statements.length).toBe(overview.rows.filter((r) => r.calc.sales_total).length);
    for (const s of statements) expect(s.payout).toBe(s.sales_total);

    // Ledoux sells in two machines; her afrekening lists both with her slots
    const ledoux = overview.rows.find((r) => r.client.name === "Ledoux")!;
    const ledouxStatement = statements.find((s) => s.client_id === ledoux.client.id)!;
    expect(ledouxStatement.snapshot.machines.map((m) => m.label).sort()).toEqual(["Brood - vakken Ledoux", "SFERIO - vakken Ledoux"]);

    // Closing again does not make new invoices
    const again = await closeMonth(store, "2026-09", ids, "2026-10-03");
    expect(again.made.every((m) => m.invoice === null)).toBe(true);
    expect((await store.invoices({ period: "2026-09" })).length).toBe(invoices.length);

    // PDFs build
    const inv = invoices[0];
    expect((await invoicePdf(inv, inv.snapshot.company, inv.snapshot.client)).length).toBeGreaterThan(2000);
    expect((await statementPdf(ledouxStatement, ledouxStatement.snapshot.company)).length).toBeGreaterThan(3000);

    // Billit payload and e-mail text
    const payload = buildOrderPayload(inv, inv.snapshot.client) as Record<string, unknown>;
    expect(payload.OrderNumber).toBe(inv.number);
    const settings = await store.settings();
    const body = render(settings.mail_body, mailValues(inv.snapshot.client, "2026-09", null, inv, settings));
    expect(body).toContain("september 2026");
    expect(body).toContain(inv.payment_ref);

    // Only the latest unsent invoice can be deleted; its number comes back
    const latest = invoices.reduce((a, b) => (a.seq > b.seq ? a : b));
    const oldest = invoices.reduce((a, b) => (a.seq < b.seq ? a : b));
    await expect(deleteInvoice(store, oldest.id)).rejects.toThrow(/most recent/);
    await deleteInvoice(store, latest.id);
    expect((await store.settings()).invoice_next_number).toBe(String(latest.seq));
  });
});
