import type {
  Catalog, Client, Contract, DailyRow, DetailRow, Invoice, InvoiceLine, ManualSales, Settings, Statement, StatementSnapshot,
} from "../types";

export type NewInvoice = {
  clientId: number;
  period: string;
  invoiceDate: string;
  dueDays: number;
  lines: InvoiceLine[];
  snapshot: Invoice["snapshot"];
  salesTotal: number;
  items: number;
  subtotal: number;
  vatPct: number;
};

export type StatementInput = {
  client_id: number;
  period: string;
  made_on: string;
  sales_total: number;
  items: number;
  payout: number;
  invoice_id: number | null;
  snapshot: StatementSnapshot;
};

/** Everything the app reads and writes. Implemented on Supabase (live) and in memory (demo/tests). */
export interface Store {
  readonly orgId: string;
  user(): Promise<{ email: string } | null>;
  isOwner(): Promise<boolean>;
  catalog(): Promise<Catalog>;

  settings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;

  clients(): Promise<Client[]>;
  insertClient(client: Omit<Client, "id">): Promise<Client>;
  updateClient(id: number, patch: Partial<Omit<Client, "id">>): Promise<void>;
  deleteClient(id: number): Promise<void>;

  contracts(): Promise<Contract[]>;
  insertContract(contract: Omit<Contract, "id">): Promise<void>;
  updateContract(id: number, patch: Partial<Omit<Contract, "id">>): Promise<void>;
  deleteContract(id: number): Promise<void>;

  /** The health index (gezondheidsindex) per month, "YYYY-MM" -> value, for indexing contracts. */
  healthIndex(): Promise<Record<string, number>>;
  saveHealthIndex(values: Record<string, number>): Promise<void>;

  /** Sales typed in by hand, per client and month (replace the MATO Info sales of that client and month). */
  manualSales(period?: string): Promise<ManualSales[]>;
  saveManualSales(input: Omit<ManualSales, "id">): Promise<void>;
  deleteManualSales(id: number): Promise<void>;

  salesDaily(from: string, to: string): Promise<DailyRow[]>;
  salesDetail(from: string, to: string, owners: string[]): Promise<DetailRow[]>;

  invoices(filter?: { period?: string; clientId?: number }): Promise<Invoice[]>;
  invoice(id: number): Promise<Invoice | null>;
  createInvoice(input: NewInvoice): Promise<Invoice>;
  updateInvoice(id: number, patch: Partial<Invoice>): Promise<void>;
  deleteInvoice(id: number): Promise<void>;

  statements(filter?: { period?: string; clientId?: number }): Promise<Statement[]>;
  statement(id: number): Promise<Statement | null>;
  saveStatement(input: StatementInput, existingId?: number): Promise<Statement>;
  updateStatement(id: number, patch: Partial<Statement>): Promise<void>;
  deleteStatement(id: number): Promise<void>;
}
