# Mato Facturatie

Monthly afrekeningen, commission invoices (Peppol via Billit) and e-mails for Mato Vending, with the
sales read live from MATO Info.

- Sign in with your MATO Info owner account.
- **Close the month**: make the afrekeningen and commission invoices, send them (Peppol + e-mail), tick off the payouts.
- **Contracts**: % of sales, per item, fixed per month and a monthly minimum, per client and per period.
- **Settings**: your company details, invoice numbering, Billit API key and e-mail (SMTP).

## Deploy (Vercel)

Import this repository in Vercel and press Deploy: no environment variables are needed.
The connection to MATO Info (Supabase URL, publishable key, organisation) is in `lib/config.ts`;
environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `FACT_ORG_ID`
override it. Functions run in Dublin (`vercel.json`).

## Develop

```bash
npm install
FACT_DEMO=1 npm run dev   # demo data, no login
npm test
```

The data lives in the MATO Info database in the `fact_` tables and functions, readable only by the
organisation owner (row-level security).
