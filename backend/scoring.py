"""
Scoring engine for the retail lending lead-intelligence platform.

Three pillars, computed purely from transaction + behavioral data:
  1. estimate_income()   -> infers real income from account inflow patterns
  2. score_lead()         -> 0-100 lead quality score across 5 weighted pillars
  3. loan_eligibility()   -> FOIR-based repayment capacity per loan product
"""
import statistics
from collections import defaultdict
from datetime import date
from typing import List, Dict

from models import Transaction, Customer, IncomeEstimate, ScoreBreakdown, LoanEligibilityResult, BehaviorSignals

LOAN_PRODUCT_PARAMS = {
    "personal_loan": {"foir_cap": 0.50, "rate": 13.0, "tenure_years": 5, "label": "Personal Loan"},
    "auto_loan":     {"foir_cap": 0.55, "rate": 9.5,  "tenure_years": 7, "label": "Auto Loan"},
    "home_loan":     {"foir_cap": 0.60, "rate": 8.5,  "tenure_years": 20, "label": "Home Loan"},
    "mortgage_loan": {"foir_cap": 0.55, "rate": 10.0, "tenure_years": 15, "label": "Mortgage Loan (LAP)"},
}


def _monthly_credit_buckets(transactions: List[Transaction]) -> Dict[str, List[float]]:
    buckets = defaultdict(list)
    for t in transactions:
        if t.type == "credit":
            key = f"{t.date.year}-{t.date.month:02d}"
            buckets[key].append(t.amount)
    return buckets


def estimate_income(customer: Customer) -> IncomeEstimate:
    txns = customer.transactions
    buckets = _monthly_credit_buckets(txns)
    months_sorted = sorted(buckets.keys())
    monthly_totals = {m: sum(v) for m, v in buckets.items()}

    # Detect a recurring large "salary-like" credit: same rough amount (+/-10%)
    # appearing in >=60% of months, typically via NEFT/IMPS payroll channel.
    salary_candidates = defaultdict(list)
    for t in txns:
        if t.type == "credit" and t.channel in ("NEFT", "IMPS") and t.amount > 8000:
            bucket_key = round(t.amount / 1000) * 1000
            salary_candidates[bucket_key].append(t)

    detected_salary = None
    for bucket_key, occurrences in salary_candidates.items():
        months_hit = {f"{o.date.year}-{o.date.month:02d}" for o in occurrences}
        if len(months_sorted) > 0 and len(months_hit) / len(months_sorted) >= 0.6 and len(occurrences) >= 3:
            amounts = [o.amount for o in occurrences]
            if detected_salary is None or len(occurrences) > len(detected_salary):
                detected_salary = amounts

    if customer.occupation_type == "salaried" and detected_salary:
        est_income = statistics.median(detected_salary)
        cv = (statistics.pstdev(detected_salary) / est_income) if est_income else 1
        confidence = max(0.55, min(0.98, 1 - cv * 2)) * min(1.0, len(months_sorted) / 6)
        method = "recurring salary-credit detection"
        income_type = "salaried (payroll pattern confirmed)"
    else:
        # Self-employed / no clear payroll signal -> infer from aggregate
        # credit inflow, net of internal transfers/refunds, with a haircut
        # since gross receipts overstate disposable income.
        values = list(monthly_totals.values())
        if not values:
            return IncomeEstimate(
                estimated_monthly_income=0, annual_income=0,
                income_type_detected="insufficient data", confidence=0.0,
                monthly_series=[], method="no transaction history",
            )
        trimmed = sorted(values)
        if len(trimmed) >= 4:
            trimmed = trimmed[1:-1]  # drop min/max outlier month
        gross_median = statistics.median(trimmed)
        haircut = 0.55 if customer.occupation_type == "self_employed" else 0.75
        est_income = gross_median * haircut
        cv = (statistics.pstdev(values) / gross_median) if gross_median else 1
        confidence = max(0.30, min(0.85, 1 - cv)) * min(1.0, len(months_sorted) / 6)
        method = "aggregate inflow inference (haircut-adjusted)"
        income_type = (
            "self-employed (variable receipts)" if customer.occupation_type == "self_employed"
            else "salaried (irregular credits — low confidence)"
        )

    series = [{"month": m, "total_credits": round(monthly_totals[m], 2)} for m in months_sorted]

    return IncomeEstimate(
        estimated_monthly_income=round(est_income, 2),
        annual_income=round(est_income * 12, 2),
        income_type_detected=income_type,
        confidence=round(confidence, 2),
        monthly_series=series,
        method=method,
    )


def _balance_volatility(transactions: List[Transaction]) -> float:
    """Rough proxy: coefficient of variation of monthly net cash flow."""
    buckets = defaultdict(float)
    for t in transactions:
        key = f"{t.date.year}-{t.date.month:02d}"
        buckets[key] += t.amount if t.type == "credit" else -t.amount
    values = list(buckets.values())
    if len(values) < 2:
        return 1.0
    mean = statistics.mean(values) or 1
    return abs(statistics.pstdev(values) / mean)


def _digital_engagement_ratio(transactions: List[Transaction]) -> float:
    if not transactions:
        return 0.0
    digital = sum(1 for t in transactions if t.channel in ("UPI", "IMPS", "card", "NEFT"))
    return digital / len(transactions)


def score_lead(customer: Customer, income: IncomeEstimate) -> ScoreBreakdown:
    # 1. Income confidence (0-20)
    income_confidence = round(income.confidence * 20, 1)

    # 2. Affordability / repayment headroom (0-25)
    if income.estimated_monthly_income > 0:
        headroom_ratio = max(0.0, 1 - (customer.existing_monthly_obligations / income.estimated_monthly_income))
    else:
        headroom_ratio = 0.0
    affordability = round(min(1.0, headroom_ratio * 1.15) * 25, 1)

    # 3. Behavioral intent — genuine interest signals (0-25)
    b: BehaviorSignals = customer.behavior
    intent_raw = (
        min(b.emi_calculator_uses_90d, 8) * 1.5
        + min(b.loan_page_visits_90d, 10) * 1.2
        + min(b.loan_offer_clicks_90d, 6) * 2.0
        + min(b.app_logins_30d, 20) * 0.3
        + min(b.existing_loan_inquiries_90d, 3) * 2.5
    )
    digital_ratio = _digital_engagement_ratio(customer.transactions)
    behavioral_intent = round(min(1.0, intent_raw / 40) * 20 + digital_ratio * 5, 1)

    # 4. Stability (0-15)
    vintage_score = min(1.0, customer.account_vintage_months / 36)
    volatility = _balance_volatility(customer.transactions)
    stability_score = min(1.0, vintage_score * 0.6 + max(0, 1 - volatility) * 0.4)
    stability = round(stability_score * 15, 1)

    # 5. Relationship depth (0-15)
    depth_score = min(1.0, len(customer.existing_products) / 4)
    bureau_bonus = 0.0
    if customer.bureau_score:
        bureau_bonus = max(0.0, min(1.0, (customer.bureau_score - 650) / 200))
    relationship_depth = round((depth_score * 0.6 + bureau_bonus * 0.4) * 15, 1)

    total = round(income_confidence + affordability + behavioral_intent + stability + relationship_depth, 1)
    total = min(100.0, total)

    if total >= 70:
        tier = "High Quality"
    elif total >= 50:
        tier = "Medium"
    else:
        tier = "Low"

    return ScoreBreakdown(
        income_confidence=income_confidence,
        affordability=affordability,
        behavioral_intent=behavioral_intent,
        stability=stability,
        relationship_depth=relationship_depth,
        total=total,
        tier=tier,
    )


def _emi_to_principal(emi: float, annual_rate_pct: float, years: int) -> float:
    r = (annual_rate_pct / 100) / 12
    n = years * 12
    if r == 0:
        return emi * n
    return emi * ((1 + r) ** n - 1) / (r * (1 + r) ** n)


def loan_eligibility(customer: Customer, income: IncomeEstimate, loan_type: str) -> LoanEligibilityResult:
    params = LOAN_PRODUCT_PARAMS[loan_type]
    max_emi_allowed = income.estimated_monthly_income * params["foir_cap"]
    available_capacity = max_emi_allowed - customer.existing_monthly_obligations

    if income.estimated_monthly_income <= 0 or income.confidence < 0.25:
        return LoanEligibilityResult(
            loan_type=loan_type, eligible=False, status="Not Eligible",
            max_eligible_amount=0, available_emi_capacity=0,
            assumed_rate_pct=params["rate"], assumed_tenure_years=params["tenure_years"],
            foir_cap_pct=params["foir_cap"] * 100,
            reason="Insufficient verifiable income signal from transaction history.",
        )

    if available_capacity <= 500:
        return LoanEligibilityResult(
            loan_type=loan_type, eligible=False, status="Not Eligible",
            max_eligible_amount=0, available_emi_capacity=round(max(available_capacity, 0), 2),
            assumed_rate_pct=params["rate"], assumed_tenure_years=params["tenure_years"],
            foir_cap_pct=params["foir_cap"] * 100,
            reason="Existing obligations consume available FOIR headroom.",
        )

    max_principal = _emi_to_principal(available_capacity, params["rate"], params["tenure_years"])

    status = "Eligible"
    reason = f"Repayment capacity supports EMI up to ₹{available_capacity:,.0f}/month within {int(params['foir_cap']*100)}% FOIR cap."
    if income.confidence < 0.55:
        status = "Needs Review"
        reason = "Income signal is directional but not fully corroborated — recommend document verification."

    return LoanEligibilityResult(
        loan_type=loan_type,
        eligible=status != "Not Eligible",
        status=status,
        max_eligible_amount=round(max_principal, -2),
        available_emi_capacity=round(available_capacity, 2),
        assumed_rate_pct=params["rate"],
        assumed_tenure_years=params["tenure_years"],
        foir_cap_pct=params["foir_cap"] * 100,
        reason=reason,
    )


def all_eligibility(customer: Customer, income: IncomeEstimate) -> List[LoanEligibilityResult]:
    return [loan_eligibility(customer, income, lt) for lt in LOAN_PRODUCT_PARAMS.keys()]
