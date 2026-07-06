# Prospera — Retail Lending Lead Intelligence Platform

A data-driven lead scoring and income-assessment engine for retail lending
(Personal Loan, Home Loan, Mortgage Loan, Auto Loan), built to replace
traditional bureau-only screening with **transaction and behavioral
intelligence**.

Built for the brief: *low conversions and limited insight into customer
intent → generate leads with >30% conversion, and accurately assess actual
borrower income for prudent underwriting.*

In the bundled demo dataset (180 synthetic customers, 6–12 months of
transaction history each), the engine surfaces **~36% of the book as
"High Quality" leads** — clearing the 30% conversion target — while also
producing an income estimate and per-product FOIR-based eligibility for
every prospect.

---

## What it does

1. **Income estimation** (`backend/scoring.py :: estimate_income`)
   Detects recurring payroll-pattern credits to confirm salaried income.
   Where no payroll signal exists (self-employed / gig / irregular credit
   patterns), infers income from trimmed, haircut-adjusted aggregate
   monthly inflow — so genuinely capable borrowers aren't excluded for
   lacking a salary slip.

2. **Lead quality score** (0–100, five weighted pillars)
   | Pillar | Weight | Signal |
   |---|---|---|
   | Income confidence | 20 | How well-evidenced the income estimate is |
   | Affordability | 25 | Headroom between income and existing obligations |
   | Behavioral intent | 25 | EMI-calculator use, loan page visits, offer clicks, inquiries — genuine in-market signals |
   | Stability | 15 | Account vintage + cash-flow volatility |
   | Relationship depth | 15 | Existing product holding + bureau standing |

3. **Loan eligibility** (per product: Personal / Home / Mortgage / Auto)
   FOIR-based (Fixed Obligation to Income Ratio) repayment-capacity
   calculation with product-specific rate/tenure/FOIR-cap assumptions,
   returning a max eligible amount and an Eligible / Needs Review /
   Not Eligible status with a plain-language reason.

## Architecture

```
bank-lead-scoring/
├── backend/
│   ├── main.py            FastAPI app + REST endpoints
│   ├── models.py          Pydantic schemas
│   ├── scoring.py         Income estimation, scoring, eligibility engine
│   ├── data_generator.py  Synthetic customer/transaction generator (demo data)
│   └── requirements.txt
└── frontend/
    ├── index.html         Dashboard shell (Overview / Pipeline / Demand / Methodology)
    ├── styles.css         Design system (ink/gold, Fraunces + Inter + IBM Plex Mono)
    └── app.js             Data fetching, SVG scoring rings, table/drawer rendering
```

In production, swap `data_generator.py` for a real ingestion pipeline
(core banking transaction feed + digital-channel event stream) feeding
the same `Customer` / `Transaction` / `BehaviorSignals` schema — the
scoring engine itself needs no changes.

## Run it

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000** — the FastAPI app serves the dashboard
directly, no separate frontend server needed.

Interactive API docs: **http://localhost:8000/docs**

## Key endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/leads` | Scored lead list, filterable by `min_score`, `tier`, `loan_type`, `city` |
| `GET /api/leads/{customer_id}` | Full customer file: income estimate, score breakdown, eligibility across all 4 products |
| `GET /api/leads/{customer_id}/transactions` | Raw transaction feed for a customer |
| `GET /api/dashboard/stats` | Portfolio KPIs, score histogram, product demand vs. eligible book |
| `GET /api/cities` | Distinct cities in the current dataset (for filters) |

## Frontend

A dashboard, not a slide deck: an ink-and-gold banking palette, a
**"repayment fingerprint"** — a five-ring radial signature per lead that
visualizes exactly how its score is composed — a live conversion-rate
ring pinned against the 30% target, and a slide-in Customer 360 panel
with income trend and per-product eligibility.

## Tuning for production

- `LOAN_PRODUCT_PARAMS` in `scoring.py` holds FOIR caps, assumed rates,
  and tenures per product — replace with your bank's actual credit
  policy table.
- Score pillar weights are explicit constants in `score_lead()` —
  recalibrate against a labeled conversion outcome dataset once real
  campaign results are available.
- Swap the in-memory `CUSTOMERS` list in `main.py` for a real data
  warehouse / feature store query.
