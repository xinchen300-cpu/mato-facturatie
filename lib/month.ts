// The month at a glance: per client the sales (= payout), the commission over their contracts, the documents,
// and what still needs attention. Also creates a client for every MATO Info owner that sells and has none yet.

import { monthBounds, percentOf, roundMoney, sumMoney } from "./belgium";
import { activeIn, compute } from "./contracts";
import type { Store } from "./store/types";
import type { Calc, Catalog, Client, Contract, DailyRow, Invoice, Statement } from "./types";

export function ownerNames(catalog: Catalog): Record<string, string> {
  const names: Record<string, string> = {};
  for (const b of catalog.businesses) names[`business:${b.id}`] = b.name;
  for (const p of catalog.partners) names[p.key] = p.name;
  names["business:none"] = "(machine without business)";
  return names;
}

export function machineLabel(owner: string, machineId: string, catalog: Catalog): string {
  const machine = catalog.machines.find((m) => m.id === machineId);
  if (!machine) return machineId;
  const own = owner === `business:${machine.business_id}` && !machine.shared_business_id;
  return own ? machine.name : `${machine.name} - vakken ${ownerNames(catalog)[owner] ?? owner}`;
}

/** The Payter terminal (serial number) in a machine, or "". */
export function machineSerial(machineId: string, catalog: Catalog): string {
  return catalog.machines.find((m) => m.id === machineId)?.serial ?? "";
}

/**
 * The terminals a client sells through: the machines of their businesses in MATO Info, plus every machine where
 * their sales were made (shared machines, Ledoux and Sferio slots).
 */
export function clientTerminals(client: Client, catalog: Catalog, rows: DailyRow[]): { name: string; serial: string }[] {
  const own = new Set(client.owners);
  const ids = new Set(rows.filter((r) => own.has(r.owner)).map((r) => r.machine_id));
  for (const m of catalog.machines) {
    if (own.has(`business:${m.business_id}`) || own.has(`business:${m.shared_business_id}`)) ids.add(m.id);
  }
  return catalog.machines.filter((m) => ids.has(m.id) && m.serial)
    .map((m) => ({ name: m.name, serial: m.serial! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Create a client for every owner that has sales but no client yet (first run, or a new business). */
export async function ensureClients(store: Store, catalog: Catalog, rows: DailyRow[], clients: Client[]): Promise<Client[]> {
  const known = new Set(clients.flatMap((c) => c.owners));
  const names = ownerNames(catalog);
  const missing = [...new Set(rows.map((r) => r.owner))].filter((o) => o !== "business:none" && !known.has(o));
  if (!missing.length) return clients;
  for (const owner of missing.sort()) {
    const business = catalog.businesses.find((b) => `business:${b.id}` === owner);
    await store.insertClient({
      name: names[owner] ?? owner, owners: [owner], vat_number: "", street: business?.address ?? "", zipcode: "",
      city: "", country: "BE", email: business?.email ?? "", cc_email: "", iban: "", active: true,
      notes: business?.contact_name ? `Contact: ${business.contact_name}` : "",
    });
  }
  return store.clients();
}

export type OverviewRow = {
  client: Client;
  calc: Calc;
  vat: number;
  total: number;
  invoice: Invoice | null;
  statement: Statement | null;
  issues: string[];
};

export type Overview = {
  period: string;
  rows: OverviewRow[];
  catalog: Catalog;
  clients: Client[];
  contracts: Contract[];
  daily: DailyRow[];
  unassigned: { owner: string; label: string; revenue: number }[];
  vatPct: number;
};

export async function loadOverview(store: Store, period: string): Promise<Overview> {
  const { first, last } = monthBounds(period);
  const [catalog, daily, settings, contracts, invoices, statements, clientList] = await Promise.all([
    store.catalog(), store.salesDaily(first, last), store.settings(), store.contracts(),
    store.invoices({ period }), store.statements({ period }), store.clients(),
  ]);
  const clients = await ensureClients(store, catalog, daily, clientList);
  const vatPct = Number(settings.invoice_vat_pct || 0);
  const owned = new Set(clients.filter((c) => c.active).flatMap((c) => c.owners));
  const names = ownerNames(catalog);

  const rows: OverviewRow[] = [];
  for (const client of clients.filter((c) => c.active)) {
    const own = contracts.filter((c) => c.client_id === client.id);
    const running = own.filter((c) => activeIn(c, first, last));
    const calc = compute(client, period, daily, contracts);
    const invoice = invoices.find((i) => i.client_id === client.id) ?? null;
    const statement = statements.find((s) => s.client_id === client.id) ?? null;
    const hasFee = running.some((c) => c.fixed_monthly || c.minimum_monthly);
    if (!calc.sales_total && !hasFee && !invoice && !statement) continue;
    const vat = percentOf(calc.subtotal, vatPct);
    const issues: string[] = [];
    if (calc.sales_total && !running.length) issues.push("no contract this month");
    else if (calc.uncovered_total) issues.push(`€ ${calc.uncovered_total.toFixed(2)} sales outside a contract`);
    if (!client.email) issues.push("no e-mail");
    if (calc.subtotal && !client.vat_number) issues.push("no VAT number");
    if (calc.subtotal && (!client.street || !client.city)) issues.push("address incomplete");
    if (calc.sales_total && !client.iban) issues.push("no IBAN for payout");
    for (const [doc, name] of [[invoice, "invoice"], [statement, "afrekening"]] as const) {
      if (doc && Math.abs(Number(doc.sales_total) - calc.sales_total) > 0.005) {
        issues.push(`sales changed since ${name} (was € ${Number(doc.sales_total).toFixed(2)})`);
      }
    }
    rows.push({ client, calc, vat, total: roundMoney(calc.subtotal + vat), invoice, statement, issues });
  }

  const unassignedMap = new Map<string, number>();
  for (const r of daily) {
    if (!owned.has(r.owner)) unassignedMap.set(r.owner, (unassignedMap.get(r.owner) ?? 0) + Number(r.revenue));
  }
  const unassigned = [...unassignedMap.entries()].map(([owner, revenue]) => ({
    owner, label: names[owner] ?? owner, revenue: roundMoney(revenue),
  }));

  return { period, rows, catalog, clients, contracts, daily, unassigned, vatPct };
}

export function totals(rows: OverviewRow[]) {
  return {
    sales: sumMoney(rows.map((r) => r.calc.sales_total)),
    items: rows.reduce((acc, r) => acc + r.calc.items, 0),
    commission: sumMoney(rows.map((r) => r.calc.subtotal)),
  };
}
