// In-memory store with made-up sales, for trying the screens locally (FACT_DEMO=1) and for tests.
// Same names as Mato Vending's businesses and machines; every number is invented.

import { addDays, ogm, percentOf, roundMoney } from "../belgium";
import { DEFAULT_SETTINGS } from "../types";
import type { Catalog, Client, Contract, DailyRow, DetailRow, Invoice, ManualSales, Settings, Statement } from "../types";
import type { NewInvoice, StatementInput, Store } from "./types";

const ORG = "00000000-0000-0000-0000-00000000demo";
const B = Object.fromEntries(
  ["Brood", "Chens Garden", "ChocaBake", "Drank Automaat", "GreenBowl", "Hillewaere", "Istanbul", "SFERIO", "Tallore", "Zoete Zonde"]
    .map((name, i) => [name, `b-${i}`]),
);
const MACHINES: [string, string, string, string | null, number, number[]][] = [
  ["m-brood", "Brood", "Brood", null, 16, [2.5, 3.0, 3.5, 4.2]],
  ["m-chens", "Chens Garden", "Chens Garden", null, 9, [9.5, 10.0, 12.0]],
  ["m-choca", "ChocaBake", "ChocaBake", null, 9, [3.9, 4.5, 5.2]],
  ["m-snoep", "NATHALIE_SNOEP", "Drank Automaat", null, 19, [2.8, 3.5, 3.8]],
  ["m-green", "GreenBowl", "GreenBowl", null, 4, [7.9, 8.9, 11.5]],
  ["m-hille", "Hillewaere Istanbul", "Hillewaere", "Istanbul", 8, [6.5, 7.5, 8.5]],
  ["m-sferio", "SFERIO", "SFERIO", null, 1, [9.0, 13.0, 15.0]],
  ["m-tallore", "Tallore", "Tallore", null, 5, [8.5, 9.5, 10.5]],
  ["m-zonde", "Zoete Zonde", "Zoete Zonde", null, 4, [3.5, 4.5, 5.0]],
];

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSales(from: string, to: string): DetailRow[] {
  const rnd = random(42);
  const out: DetailRow[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    for (const [mid, , owner, shared, perDay, prices] of MACHINES) {
      const count = Math.max(0, Math.round(perDay + (rnd() - 0.5) * perDay));
      for (let i = 0; i < count; i++) {
        const minute = 420 + Math.floor(rnd() * 960);
        const at = `${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`;
        let ownerKey = `business:${B[owner]}`;
        let slot = String([11, 12, 13, 21, 22, 31, 33, 41][Math.floor(rnd() * 8)]);
        let amount = prices[Math.floor(rnd() * prices.length)];
        if (shared && rnd() < 0.5) {
          ownerKey = `business:${B[shared]}`;
          slot = String([61, 62, 63, 71][Math.floor(rnd() * 4)]);
        }
        if (mid === "m-brood" && rnd() < 0.03) {
          ownerKey = "partner:ledoux";
          slot = String(51 + Math.floor(rnd() * 5));
          amount = 8.84;
        }
        if (mid === "m-sferio") {
          const r = rnd();
          if (r < 0.4) {
            ownerKey = "partner:ledoux";
            slot = ["1", "4", "7", "11", "13", "15"][Math.floor(rnd() * 6)];
            amount = [29.49, 15.94, 24.94][Math.floor(rnd() * 3)];
          } else if (r < 0.9 && day >= "2026-09-30") {
            ownerKey = "partner:sferio";
            slot = ["21", "23", "31", "35", "45"][Math.floor(rnd() * 5)];
          }
        }
        out.push({ owner: ownerKey, machine_id: mid, at, slot, product: `Product ${slot}`, units: 1, amount });
      }
    }
  }
  return out;
}

type Db = {
  settings: Settings;
  clients: Client[];
  contracts: Contract[];
  invoices: Invoice[];
  statements: Statement[];
  manual: ManualSales[];
  sales: DetailRow[];
  next: number;
};

function seed(): Db {
  const sales = makeSales("2026-06-01", "2026-10-21");
  const names: Record<string, string> = Object.fromEntries(Object.entries(B).map(([n, id]) => [`business:${id}`, n]));
  names["partner:ledoux"] = "Ledoux";
  names["partner:sferio"] = "Sferio";
  let next = 1;
  const clients: Client[] = Object.entries(names).map(([owner, name], i) => ({
    id: next++, name, owners: [owner], vat_number: ["BE0403170701", "BE0447372345", "BE0811111187"][i % 3],
    street: `Markt ${i + 1}`, zipcode: "8820", city: "Torhout", country: "BE",
    email: `${name.split(" ")[0].toLowerCase()}@example.be`, cc_email: "", iban: i % 4 ? "BE71096123456769" : "",
    active: true, notes: "",
  }));
  const id = (name: string) => clients.find((c) => c.name === name)!.id;
  const contract = (client: string, terms: Partial<Contract>): Contract => ({
    id: next++, client_id: id(client), name: "", starts_on: "2026-01-01", ends_on: null, pct: 0, base: "incl",
    sales_vat_pct: 6, per_item: 0, fixed_monthly: 0, minimum_monthly: 0, prorate: true, machines: [], notes: "", ...terms,
  });
  return {
    settings: {
      ...DEFAULT_SETTINGS, company_name: "Mato Vending BV", company_vat: "BE0477472701", company_iban: "BE68539007547034",
      company_bic: "GKCCBEBB", company_street: "Stationsstraat 1", company_zipcode: "8820", company_city: "Torhout",
      company_email: "facturen@mato-vending.be",
      billit_api_key: process.env.FACT_DEMO_BILLIT ? "test-key" : "", billit_party_id: process.env.FACT_DEMO_BILLIT ? "123" : "",
      smtp_host: process.env.FACT_DEMO_SMTP ? "localhost" : "", smtp_port: process.env.FACT_DEMO_SMTP ?? "587",
      smtp_from_email: "facturen@mato-vending.be", smtp_from_name: "Mato Vending BV",
    },
    clients,
    contracts: [
      contract("Brood", { name: "Commissie", pct: 15 }),
      contract("Chens Garden", { name: "Maaltijden", pct: 20, base: "excl" }),
      contract("ChocaBake", { name: "Huur + commissie", pct: 5, fixed_monthly: 150 }),
      contract("Drank Automaat", { name: "Per stuk", per_item: 0.25 }),
      contract("GreenBowl", { name: "Commissie met minimum", pct: 12, minimum_monthly: 100 }),
      contract("Hillewaere", { pct: 10 }),
      contract("Istanbul", { pct: 10 }),
      contract("Ledoux", { name: "Vakken", pct: 18 }),
      contract("SFERIO", { pct: 10 }),
      contract("Tallore", { name: "Oud contract", pct: 15, ends_on: "2026-09-15" }),
      contract("Tallore", { name: "Nieuw contract", pct: 17, starts_on: "2026-09-16" }),
      contract("Zoete Zonde", { name: "Vaste huur", fixed_monthly: 50 }),
    ],
    invoices: [],
    statements: [],
    manual: [],
    sales,
    next,
  };
}

const globalDb = globalThis as unknown as { __factDemo?: Db };

export class MemoryStore implements Store {
  readonly orgId = ORG;
  private db: Db;

  constructor(db?: Db) {
    this.db = db ?? (globalDb.__factDemo ??= seed());
  }

  static fresh() {
    return new MemoryStore(seed());
  }

  async user() {
    return { email: "demo@mato-vending.be" };
  }

  async isOwner() {
    return true;
  }

  async catalog(): Promise<Catalog> {
    return {
      org: { id: ORG, name: "Mato Vending (demo)", timezone: "Europe/Brussels" },
      businesses: Object.entries(B).map(([name, id]) => ({ id, name, address: null, email: null, contact_name: null })),
      machines: MACHINES.map(([id, name, owner, shared], i) => ({
        id, name, business_id: B[owner], shared_business_id: shared ? B[shared] : null,
        serial: `APO2025220${String(1000 + i * 17).padStart(4, "0")}`, terminal_model: "Apollo",
      })),
      partners: [{ key: "partner:ledoux", name: "Ledoux" }, { key: "partner:sferio", name: "Sferio" }],
    };
  }

  async settings() {
    return { ...this.db.settings };
  }

  async saveSettings(patch: Partial<Settings>) {
    this.db.settings = { ...this.db.settings, ...patch };
  }

  async clients() {
    return [...this.db.clients].sort((a, b) => a.name.localeCompare(b.name));
  }

  async insertClient(client: Omit<Client, "id">) {
    const row = { ...client, id: this.db.next++ };
    this.db.clients.push(row);
    return row;
  }

  async updateClient(id: number, patch: Partial<Client>) {
    this.db.clients = this.db.clients.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  async deleteClient(id: number) {
    this.db.clients = this.db.clients.filter((c) => c.id !== id);
    this.db.contracts = this.db.contracts.filter((c) => c.client_id !== id);
    this.db.manual = this.db.manual.filter((m) => m.client_id !== id);
  }

  async contracts() {
    return [...this.db.contracts].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  }

  async insertContract(contract: Omit<Contract, "id">) {
    this.db.contracts.push({ ...contract, id: this.db.next++ });
  }

  async updateContract(id: number, patch: Partial<Contract>) {
    this.db.contracts = this.db.contracts.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  async deleteContract(id: number) {
    this.db.contracts = this.db.contracts.filter((c) => c.id !== id);
  }

  async manualSales(period?: string) {
    return this.db.manual.filter((m) => !period || m.period === period).map((m) => ({ ...m }));
  }

  async saveManualSales(input: Omit<ManualSales, "id">) {
    const existing = this.db.manual.find((m) => m.client_id === input.client_id && m.period === input.period);
    if (existing) Object.assign(existing, input);
    else this.db.manual.push({ ...input, id: this.db.next++ });
  }

  async deleteManualSales(id: number) {
    this.db.manual = this.db.manual.filter((m) => m.id !== id);
  }

  async salesDaily(from: string, to: string) {
    const map = new Map<string, DailyRow>();
    for (const s of this.db.sales) {
      const day = s.at.slice(0, 10);
      if (day < from || day > to) continue;
      const key = `${s.owner}|${s.machine_id}|${day}`;
      const row = map.get(key) ?? { owner: s.owner, machine_id: s.machine_id, day, items: 0, revenue: 0 };
      row.items += s.units;
      row.revenue = Math.round((row.revenue + s.amount) * 100) / 100;
      map.set(key, row);
    }
    return [...map.values()];
  }

  async salesDetail(from: string, to: string, owners: string[]) {
    return this.db.sales.filter((s) => s.at.slice(0, 10) >= from && s.at.slice(0, 10) <= to && owners.includes(s.owner));
  }

  async invoices(filter: { period?: string; clientId?: number } = {}) {
    return this.db.invoices
      .filter((i) => (!filter.period || i.period === filter.period) && (!filter.clientId || i.client_id === filter.clientId))
      .sort((a, b) => b.year - a.year || b.seq - a.seq);
  }

  async invoice(id: number) {
    return this.db.invoices.find((i) => i.id === id) ?? null;
  }

  async createInvoice(input: NewInvoice) {
    const s = this.db.settings;
    const year = Number(input.invoiceDate.slice(0, 4));
    let seq = Number(s.invoice_next_number || 1);
    if (s.invoice_use_year === "1" && s.invoice_counter_year && year > Number(s.invoice_counter_year)) seq = 1;
    const digits = Number(s.invoice_digits || 4);
    const number = `${s.invoice_prefix}${s.invoice_use_year === "1" ? `${year}-` : ""}${String(seq).padStart(digits, "0")}`;
    if (this.db.invoices.some((i) => i.number === number)) {
      throw new Error(`Invoice number ${number} already exists. Set the next invoice number in Settings.`);
    }
    if (this.db.invoices.some((i) => i.client_id === input.clientId && i.period === input.period)) {
      throw new Error("This client already has an invoice for this month.");
    }
    const vat = percentOf(input.subtotal, input.vatPct);
    const invoice: Invoice = {
      id: this.db.next++, client_id: input.clientId, period: input.period, number, seq, year,
      invoice_date: input.invoiceDate, due_date: addDays(input.invoiceDate, input.dueDays), lines: input.lines,
      snapshot: input.snapshot, sales_total: input.salesTotal, items: input.items, subtotal: input.subtotal,
      vat_pct: input.vatPct, vat_amount: vat, total: roundMoney(input.subtotal + vat),
      payment_ref: ogm(year, seq), billit_order_id: "", peppol_status: "", peppol_message: "", peppol_at: null,
      email_status: "", email_message: "", emailed_at: null, paid: false, paid_on: null,
    };
    this.db.invoices.push(invoice);
    this.db.settings = { ...s, invoice_next_number: String(seq + 1), invoice_counter_year: String(year) };
    return invoice;
  }

  async updateInvoice(id: number, patch: Partial<Invoice>) {
    this.db.invoices = this.db.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i));
  }

  async deleteInvoice(id: number) {
    this.db.invoices = this.db.invoices.filter((i) => i.id !== id);
  }

  async statements(filter: { period?: string; clientId?: number } = {}) {
    return this.db.statements.filter(
      (s) => (!filter.period || s.period === filter.period) && (!filter.clientId || s.client_id === filter.clientId),
    );
  }

  async statement(id: number) {
    return this.db.statements.find((s) => s.id === id) ?? null;
  }

  async saveStatement(input: StatementInput, existingId?: number) {
    if (existingId) {
      this.db.statements = this.db.statements.map((s) => (s.id === existingId ? { ...s, ...input } : s));
      return this.db.statements.find((s) => s.id === existingId)!;
    }
    const row: Statement = {
      ...input, id: this.db.next++, email_status: "", email_message: "", emailed_at: null, paid_out: false, paid_out_on: null,
    };
    this.db.statements.push(row);
    return row;
  }

  async updateStatement(id: number, patch: Partial<Statement>) {
    this.db.statements = this.db.statements.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  async deleteStatement(id: number) {
    this.db.statements = this.db.statements.filter((s) => s.id !== id);
  }
}
