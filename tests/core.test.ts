import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as be from "@/lib/belgium";
import { buildOrderPayload } from "@/lib/billit";
import { applyManual, compute, indexMonths, vatOfLines } from "@/lib/contracts";
import { closeMonth, deleteInvoice, mailValues } from "@/lib/invoicing";
import { render } from "@/lib/mailer";
import { clientTerminals, loadOverview } from "@/lib/month";
import { invoicePdf, statementPdf } from "@/lib/pdf";
import { MemoryStore } from "@/lib/store/memory";
import type { Catalog, Client, Contract, DailyRow } from "@/lib/types";

const client = (id: number, owners: string[]): Client => ({
  id, name: `Client ${id}`, owners, vat_number: "BE0403170701", street: "Kerkstraat 12 bus 3", zipcode: "9300",
  city: "Aalst", country: "BE", email: "x@example.be", cc_email: "", iban: "BE71096123456769", active: true, notes: "",
  own_terminal: false,
});
const contract = (terms: Partial<Contract>): Contract => ({
  id: 1, client_id: 1, name: "", starts_on: "2026-01-01", ends_on: null, pct: 0, base: "incl", sales_vat_pct: 6,
  per_item: 0, fixed_monthly: 0, minimum_monthly: 0, prorate: true, machines: [], notes: "", fee_pct: 0, fee_mode: "payout",
  fixed_alt: 0, fixed_alt_months: [], indexed: false, index_from: null, ...terms,
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
    for (const s of statements) {
      expect(s.payout).toBe(overview.rows.find((r) => r.client.id === s.client_id)!.calc.payout);
      expect(s.payout).toBeLessThanOrEqual(s.sales_total);
    }
    const chens = overview.rows.find((r) => r.client.name === "Chens Garden")!;
    expect(chens.calc.payout).toBeLessThan(chens.calc.sales_total);

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

describe("terminals per client", () => {
  const catalog: Catalog = {
    org: { id: "o", name: "Org", timezone: null },
    businesses: [],
    machines: [
      { id: "m1", name: "Hillewaere Istanbul", business_id: "b1", shared_business_id: "b2", serial: "APO1" },
      { id: "m2", name: "Brood", business_id: "b3", shared_business_id: null, serial: "APO2" },
      { id: "m3", name: "Tallore", business_id: "b4", shared_business_id: null, serial: null },
    ],
    partners: [],
  };
  const client = (owners: string[]) => ({ owners }) as Client;

  it("takes the machines of the business, also when it shares one", () => {
    expect(clientTerminals(client(["business:b2"]), catalog, []).map((t) => t.serial)).toEqual(["APO1"]);
  });

  it("adds machines where the client's sales were made, e.g. a partner's slots", () => {
    const rows = [{ owner: "partner:ledoux", machine_id: "m2", day: "2026-09-01", items: 1, revenue: 3 }];
    expect(clientTerminals(client(["partner:ledoux"]), catalog, rows)).toEqual([{ name: "Brood", serial: "APO2" }]);
  });

  it("skips machines without a terminal", () => {
    expect(clientTerminals(client(["business:b4"]), catalog, [])).toEqual([]);
  });
});

describe("own sales figures", () => {
  const manual = (amount: number, items = 0, clientId = 1, period = "2026-10") =>
    ({ id: 9, client_id: clientId, period, amount, items, note: "Televend" });

  it("replace the client's MATO Info sales of that month only", () => {
    const rows = [row("2026-10-02", 100), row("2026-10-20", 40), row("2026-09-30", 70), row("2026-10-05", 25, 1, "business:b")];
    const out = applyManual(rows, [client(1, ["business:a"])], [manual(500, 120)], "2026-10");
    expect(out.filter((r) => r.owner === "business:a")).toEqual([row("2026-09-30", 70)]);
    expect(out.filter((r) => r.owner === "business:b").length).toBe(1);
    const calc = compute(client(1, ["business:a"]), "2026-10", out, [contract({ pct: 10, per_item: 0.1 })]);
    expect(calc.sales_total).toBe(500);
    expect(calc.items).toBe(120);
    expect(calc.subtotal).toBe(62);
  });

  it("go on the afrekening with their source, without days or products", async () => {
    const store = MemoryStore.fresh();
    const zonde = (await store.clients()).find((c) => c.name === "Zoete Zonde")!;
    await store.saveManualSales({ client_id: zonde.id, period: "2026-09", amount: 1234.5, items: 300, note: "Televend" });
    const overview = await loadOverview(store, "2026-09");
    const row = overview.rows.find((r) => r.client.id === zonde.id)!;
    expect(row.calc.sales_total).toBe(1234.5);
    expect(row.manual?.note).toBe("Televend");
    expect(overview.unassigned).toEqual([]);

    await closeMonth(store, "2026-09", [zonde.id], "2026-10-03");
    const [statement] = await store.statements({ period: "2026-09", clientId: zonde.id });
    expect(statement.sales_total).toBe(1234.5);
    expect(statement.payout).toBe(1234.5);
    expect(statement.snapshot.manual).toEqual({ note: "Televend" });
    expect(statement.snapshot.machines).toEqual([{ label: "Eigen opgave (Televend)", terminal: "", items: 300, revenue: 1234.5 }]);
    expect(statement.snapshot.daily).toEqual([]);
    expect(statement.snapshot.products).toEqual([]);
    const pdf = await statementPdf(statement, statement.snapshot.company);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("transaction costs", () => {
  const rows = [row("2026-10-02", 1000), row("2026-10-20", 234.56)];

  it("come off the payout when the contract says so", () => {
    const calc = compute(client(1, ["business:a"]), "2026-10", rows, [contract({ fixed_monthly: 650, fee_pct: 0.9 })]);
    expect(calc.subtotal).toBe(650);
    expect(calc.fee_deducted).toBe(11.11); // 0.9% of 1234.56 = 11.111
    expect(calc.payout).toBe(1223.45);
    expect(calc.lines.map((l) => l.kind)).toEqual(["fixed"]);
  });

  it("go on the invoice when the contract says so, and the payout stays full", () => {
    const calc = compute(client(1, ["business:a"]), "2026-10", rows, [contract({ pct: 20, fee_pct: 0.9, fee_mode: "invoice" })]);
    expect(calc.lines.map((l) => [l.kind, l.unit_price])).toEqual([["pct", 246.91], ["fee", 11.11]]);
    expect(calc.subtotal).toBe(258.02);
    expect(calc.payout).toBe(1234.56);
  });

  it("only count the days a contract runs", () => {
    const calc = compute(client(1, ["business:a"]), "2026-10", rows,
      [contract({ starts_on: "2026-10-10", pct: 20, fee_pct: 0.9, fee_mode: "invoice" })]);
    expect(calc.uncovered_total).toBe(1000);
    expect(calc.lines.find((l) => l.kind === "fee")!.unit_price).toBe(2.11);
  });

  it("end up on the afrekening and in the e-mail", async () => {
    const store = MemoryStore.fresh();
    const brood = (await store.clients()).find((c) => c.name === "Brood")!;
    for (const c of (await store.contracts()).filter((c) => c.client_id === brood.id)) await store.deleteContract(c.id);
    await store.insertContract({ ...contract({ fixed_monthly: 350, fee_pct: 0.9 }), client_id: brood.id });
    await closeMonth(store, "2026-09", [brood.id], "2026-10-03");
    const [statement] = await store.statements({ period: "2026-09", clientId: brood.id });
    expect(statement.payout).toBe(be.roundMoney(statement.sales_total - be.percentOf(statement.sales_total, 0.9)));
    const values = mailValues(brood, "2026-09", statement, null, await store.settings());
    expect(values.uitbetaling).toBe(be.fmtEur(statement.payout));
    expect(String(values.aftrek_zin)).toContain("transactiekosten");
    expect((await statementPdf(statement, statement.snapshot.company)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("other months and yearly indexation", () => {
  it("charges another fixed amount in some months of every year", () => {
    const sferio = contract({ starts_on: "2026-07-01", pct: 15, fixed_monthly: 180, fixed_alt: 200, fixed_alt_months: [10, 12] });
    const fixed = (period: string) => compute(client(1, ["business:a"]), period, [], [sferio]).lines.find((l) => l.kind === "fixed")!.unit_price;
    expect([fixed("2026-09"), fixed("2026-10"), fixed("2026-11"), fixed("2026-12"), fixed("2027-01"), fixed("2027-10")])
      .toEqual([180, 200, 180, 200, 180, 200]);
  });

  it("indexes from the first whole month after each anniversary, with the index of the month before", () => {
    const chens = { indexed: true, starts_on: "2026-01-31" };
    expect(indexMonths(chens, "2027-01")).toEqual({ base: "2025-12", current: null, since: null, first: "2027-02" });
    expect(indexMonths(chens, "2027-02")).toMatchObject({ base: "2025-12", current: "2027-01", since: "2027-02" });
    expect(indexMonths(chens, "2028-01")).toMatchObject({ current: "2027-01" });
    expect(indexMonths(chens, "2028-05")).toMatchObject({ current: "2028-01", since: "2028-02" });
    expect(indexMonths({ indexed: true, starts_on: "2026-07-01" }, "2027-07")).toMatchObject({ base: "2026-06", current: "2027-06" });
    expect(indexMonths({ indexed: false, starts_on: "2026-07-01" }, "2027-07")).toBeNull();
    // A deal split over contracts keeps indexing from its original start.
    expect(indexMonths({ indexed: true, starts_on: "2027-01-01", index_from: "2026-07-01" }, "2027-07"))
      .toMatchObject({ base: "2026-06", current: "2027-06" });
  });

  it("indexes the amounts, not the percentage, and reports a missing index", () => {
    const sferio = contract({ starts_on: "2026-07-01", pct: 15, fixed_monthly: 180, fixed_alt: 200, fixed_alt_months: [10, 12], indexed: true });
    const rows = [row("2027-07-05", 100), row("2027-10-05", 100)];
    const index = { "2026-06": 128.5, "2027-06": 131.07 };
    const july = compute(client(1, ["business:a"]), "2027-07", rows, [sferio], index);
    expect(july.lines.map((l) => [l.kind, l.unit_price])).toEqual([["pct", 15], ["fixed", 183.6]]); // 180 × 131,07/128,5
    expect(july.lines[1].detail).toContain("gezondheidsindex");
    expect(compute(client(1, ["business:a"]), "2027-10", rows, [sferio], index).lines[1].unit_price).toBe(204);
    expect(compute(client(1, ["business:a"]), "2027-06", rows, [sferio], index).lines.find((l) => l.kind === "fixed")!.unit_price).toBe(180);
    const missing = compute(client(1, ["business:a"]), "2027-07", rows, [sferio], { "2026-06": 128.5 });
    expect(missing.index_missing).toEqual(["2027-06"]);
    expect(missing.lines[1].unit_price).toBe(180);
  });
});

describe("your own sales", () => {
  it("leaves your own businesses out of the afrekeningen and does not report them as missing", async () => {
    const store = MemoryStore.fresh();
    const catalog = await store.catalog();
    const hillewaere = `business:${catalog.businesses.find((b) => b.name === "Hillewaere")!.id}`;
    await store.saveSettings({ own_businesses: hillewaere });
    const client = (await store.clients()).find((c) => c.owners.includes(hillewaere))!;
    await store.updateClient(client.id, { active: false });
    const overview = await loadOverview(store, "2026-09");
    expect(overview.rows.some((r) => r.client.id === client.id)).toBe(false);
    expect(overview.unassigned).toEqual([]);
    expect(overview.own.map((o) => o.label)).toEqual(["Hillewaere"]);
    expect(overview.own[0].revenue).toBeGreaterThan(0);
    expect(overview.own[0].items).toBeGreaterThan(0);
    expect(overview.own[0].terminals.length).toBe(1);
  });

  it("lists your own machines also in a month without sales", async () => {
    const store = MemoryStore.fresh();
    const machine = (await store.catalog()).machines[0];
    await store.saveSettings({ own_machines: machine.id });
    const overview = await loadOverview(store, "2026-01");
    expect(overview.own).toEqual([{ key: machine.id, label: machine.name, terminals: [machine.serial], items: 0, revenue: 0 }]);
  });
});

describe("extra charges", () => {
  it("go on the commission invoice as their own lines", async () => {
    const store = MemoryStore.fresh();
    const tallore = (await store.clients()).find((c) => c.name === "Tallore")!;
    await store.saveExtraLine({ client_id: tallore.id, period: "2026-09", description: "Eenmalige opstartkost", quantity: 1, unit_price: 200 });
    await store.saveExtraLine({ client_id: tallore.id, period: "2026-09", description: "Configuratie (uur)", quantity: 1.5, unit_price: 60 });
    await store.saveExtraLine({ client_id: tallore.id, period: "2026-10", description: "Andere maand", quantity: 1, unit_price: 99 });
    const overview = await loadOverview(store, "2026-09");
    const row = overview.rows.find((r) => r.client.id === tallore.id)!;
    const extra = row.calc.lines.filter((l) => l.kind === "extra");
    expect(extra.map((l) => [l.description, l.quantity, l.unit_price])).toEqual([["Eenmalige opstartkost", 1, 200], ["Configuratie (uur)", 1.5, 60]]);

    await closeMonth(store, "2026-09", [tallore.id], "2026-10-03");
    const [invoice] = await store.invoices({ period: "2026-09", clientId: tallore.id });
    expect(invoice.subtotal).toBe(be.roundMoney(row.calc.subtotal));
    expect(invoice.lines.some((l) => l.description === "Eenmalige opstartkost")).toBe(true);
    expect((await loadOverview(store, "2026-09")).rows.find((r) => r.client.id === tallore.id)!.issues).toEqual(
      expect.not.arrayContaining([expect.stringContaining("commission now")]));
  });
});

describe("first month", () => {
  const today = new Date("2026-10-22T12:00:00Z");
  it("offers no months before the first month and opens on it while it runs", () => {
    expect(be.monthsFrom("2026-10", 24, today)).toEqual(["2026-10"]);
    expect(be.defaultPeriod("2026-10", today)).toBe("2026-10");
    expect(be.monthsFrom("", 3, today)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(be.defaultPeriod("", today)).toBe("2026-09");
    expect(be.monthsFrom("2026-10", 24, new Date("2027-01-10T12:00:00Z"))).toEqual(["2027-01", "2026-12", "2026-11", "2026-10"]);
    expect(be.defaultPeriod("2026-10", new Date("2027-01-10T12:00:00Z"))).toBe("2026-12");
  });
});

describe("transaction costs without VAT", () => {
  it("put the transaction costs on the invoice at 0% and the rest at 21%", async () => {
    const lines = compute(client(1, ["business:a"]), "2026-10", [row("2026-10-02", 1000), row("2026-10-20", 234.56)],
      [contract({ pct: 20, fee_pct: 0.9, fee_mode: "invoice" })]).lines;
    expect(vatOfLines(lines, 21)).toEqual({ rates: [{ pct: 21, base: 246.91, vat: 51.85 }, { pct: 0, base: 11.11, vat: 0 }], vat: 51.85 });

    const store = MemoryStore.fresh();
    const istanbul = (await store.clients()).find((c) => c.name === "Istanbul")!;
    const overview = await loadOverview(store, "2026-09");
    const row9 = overview.rows.find((r) => r.client.id === istanbul.id)!;
    await closeMonth(store, "2026-09", [istanbul.id], "2026-10-03");
    const [invoice] = await store.invoices({ period: "2026-09", clientId: istanbul.id });
    const fee = invoice.lines.find((l) => l.kind === "fee")!;
    expect(fee.vat_pct).toBe(0);
    expect(invoice.lines.filter((l) => l.kind !== "fee").every((l) => l.vat_pct === 21)).toBe(true);
    const taxable = be.roundMoney(invoice.subtotal - fee.unit_price);
    expect(invoice.vat_amount).toBe(be.percentOf(taxable, 21));
    expect(row9.total).toBe(invoice.total);
    const payload = buildOrderPayload(invoice, istanbul) as { OrderLines: { VATPercentage: number }[] };
    expect(payload.OrderLines.map((l) => l.VATPercentage)).toEqual([21, 0]);
    expect((await invoicePdf(invoice, invoice.snapshot.company, invoice.snapshot.client)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("own payment terminal", () => {
  it("pays nothing out and puts transaction costs on the invoice", () => {
    const calc = compute({ ...client(1, []), own_terminal: true }, "2026-10", [row("2026-10-31", 1060, 50, "manual:1", "manual:1")],
      [contract({ pct: 25, base: "excl", fee_pct: 0.9 })]);
    expect(calc.sales_total).toBe(1060);
    expect(calc.lines.map((l) => [l.kind, l.unit_price])).toEqual([["pct", 250], ["fee", 9.54]]);
    expect(calc.payout).toBe(0);
    expect(calc.fee_deducted).toBe(0);
  });

  it("shows the client before their figure is in, then charges both contracts without a payout", async () => {
    const store = MemoryStore.fresh();
    const traiteur = (await store.clients()).find((c) => c.own_terminal)!;
    let row10 = (await loadOverview(store, "2026-10")).rows.find((r) => r.client.id === traiteur.id)!;
    expect(row10.calc.subtotal).toBe(550);
    expect(row10.issues).toContain("own terminal: enter their sales under Own sales figures");

    await store.saveManualSales({ client_id: traiteur.id, period: "2026-10", amount: 2120, items: 400, note: "opgave Traiteur" });
    row10 = (await loadOverview(store, "2026-10")).rows.find((r) => r.client.id === traiteur.id)!;
    expect(row10.calc.lines.map((l) => [l.kind, l.unit_price])).toEqual([["fixed", 550], ["pct", 500]]);
    expect(row10.calc.lines[0].detail).toBe(""); // the fixed fee does not repeat the sales of the commission contract
    expect(row10.issues).toEqual([]);

    await closeMonth(store, "2026-10", [traiteur.id], "2026-11-03");
    const [statement] = await store.statements({ period: "2026-10", clientId: traiteur.id });
    expect(statement.payout).toBe(0);
    const values = mailValues(traiteur, "2026-10", statement, null, await store.settings());
    expect(render((await store.settings()).mail_body, values)).toContain("rechtstreeks via uw eigen betaalterminal");
    expect((await statementPdf(statement, statement.snapshot.company)).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
