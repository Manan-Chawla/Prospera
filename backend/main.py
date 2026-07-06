from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Optional, List
import os

from data_generator import generate_dataset
from scoring import estimate_income, score_lead, all_eligibility, LOAN_PRODUCT_PARAMS
from models import LeadResult, Customer

app = FastAPI(
    title="Prospera — Retail Lending Intelligence API",
    description="Data-driven lead scoring, income estimation, and repayment-capacity "
                "assessment for retail lending (Personal / Home / Mortgage / Auto Loans).",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory "warehouse" — regenerate on boot to simulate a fresh data pull.
CUSTOMERS: List[Customer] = generate_dataset(180)
CUSTOMER_INDEX = {c.customer_id: c for c in CUSTOMERS}

_cache = {}


def _build_lead(customer: Customer) -> LeadResult:
    if customer.customer_id not in _cache:
        income = estimate_income(customer)
        score = score_lead(customer, income)
        elig = all_eligibility(customer, income)
        _cache[customer.customer_id] = (income, score, elig)
    income, score, elig = _cache[customer.customer_id]
    elig_sorted = sorted(elig, key=lambda e: e.max_eligible_amount, reverse=True)
    return LeadResult(
        customer_id=customer.customer_id,
        name=customer.name,
        city=customer.city,
        age=customer.age,
        occupation_type=customer.occupation_type,
        income_estimate=income,
        score=score,
        interested_loan_types=customer.interested_loan_types,
        top_eligibility=elig_sorted,
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "customers_loaded": len(CUSTOMERS)}


@app.get("/api/leads", response_model=List[LeadResult])
def get_leads(
    min_score: float = Query(0, ge=0, le=100),
    tier: Optional[str] = Query(None, description="High Quality | Medium | Low"),
    loan_type: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    sort_by: str = Query("score_desc"),
    limit: int = Query(50, le=500),
):
    results = [_build_lead(c) for c in CUSTOMERS]
    if min_score:
        results = [r for r in results if r.score.total >= min_score]
    if tier:
        results = [r for r in results if r.score.tier.lower() == tier.lower()]
    if loan_type:
        results = [r for r in results if loan_type in r.interested_loan_types]
    if city:
        results = [r for r in results if r.city.lower() == city.lower()]

    if sort_by == "score_desc":
        results.sort(key=lambda r: r.score.total, reverse=True)
    elif sort_by == "income_desc":
        results.sort(key=lambda r: r.income_estimate.estimated_monthly_income, reverse=True)
    elif sort_by == "name_asc":
        results.sort(key=lambda r: r.name)

    return results[:limit]


@app.get("/api/leads/{customer_id}", response_model=LeadResult)
def get_lead_detail(customer_id: str):
    customer = CUSTOMER_INDEX.get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    return _build_lead(customer)


@app.get("/api/leads/{customer_id}/transactions")
def get_transactions(customer_id: str, limit: int = 60):
    customer = CUSTOMER_INDEX.get(customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    txns = sorted(customer.transactions, key=lambda t: t.date, reverse=True)[:limit]
    return [t.model_dump(mode="json") for t in txns]


@app.get("/api/dashboard/stats")
def dashboard_stats():
    leads = [_build_lead(c) for c in CUSTOMERS]
    total = len(leads)
    high = [l for l in leads if l.score.tier == "High Quality"]
    medium = [l for l in leads if l.score.tier == "Medium"]
    low = [l for l in leads if l.score.tier == "Low"]

    high_quality_rate = round(len(high) / total * 100, 1) if total else 0
    avg_income = round(sum(l.income_estimate.estimated_monthly_income for l in leads) / total, 0) if total else 0
    avg_score = round(sum(l.score.total for l in leads) / total, 1) if total else 0

    demand = {lt: 0 for lt in LOAN_PRODUCT_PARAMS.keys()}
    for l in leads:
        for lt in l.interested_loan_types:
            demand[lt] = demand.get(lt, 0) + 1

    eligible_counts = {lt: 0 for lt in LOAN_PRODUCT_PARAMS.keys()}
    for l in leads:
        for e in l.top_eligibility:
            if e.eligible:
                eligible_counts[e.loan_type] += 1

    score_histogram = [0] * 10  # buckets of 10
    for l in leads:
        idx = min(9, int(l.score.total // 10))
        score_histogram[idx] += 1

    return {
        "total_leads": total,
        "high_quality_leads": len(high),
        "medium_leads": len(medium),
        "low_leads": len(low),
        "high_quality_rate_pct": high_quality_rate,
        "projected_conversion_rate_pct": min(45.0, round(high_quality_rate * 1.05, 1)),
        "average_estimated_monthly_income": avg_income,
        "average_lead_score": avg_score,
        "loan_demand_by_type": demand,
        "eligible_leads_by_type": eligible_counts,
        "score_histogram": score_histogram,
        "product_params": LOAN_PRODUCT_PARAMS,
    }


@app.get("/api/cities")
def get_cities():
    return sorted({c.city for c in CUSTOMERS})


# --- Serve the frontend (static build) ---
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
