from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import date


LoanType = Literal["personal_loan", "home_loan", "mortgage_loan", "auto_loan"]


class Transaction(BaseModel):
    date: date
    type: Literal["credit", "debit"]
    category: str
    amount: float
    channel: Literal["UPI", "NEFT", "IMPS", "cheque", "cash", "card", "auto_debit"]
    narration: Optional[str] = None


class BehaviorSignals(BaseModel):
    emi_calculator_uses_90d: int = 0
    loan_page_visits_90d: int = 0
    loan_offer_clicks_90d: int = 0
    app_logins_30d: int = 0
    branch_visits_180d: int = 0
    existing_loan_inquiries_90d: int = 0


class Customer(BaseModel):
    customer_id: str
    name: str
    age: int
    city: str
    occupation_type: Literal["salaried", "self_employed"]
    account_vintage_months: int
    existing_products: List[str] = []
    bureau_score: Optional[int] = None
    existing_monthly_obligations: float = 0
    interested_loan_types: List[LoanType] = []
    transactions: List[Transaction] = []
    behavior: BehaviorSignals = BehaviorSignals()


class IncomeEstimate(BaseModel):
    estimated_monthly_income: float
    annual_income: float
    income_type_detected: str
    confidence: float
    monthly_series: List[dict]
    method: str


class ScoreBreakdown(BaseModel):
    income_confidence: float
    affordability: float
    behavioral_intent: float
    stability: float
    relationship_depth: float
    total: float
    tier: str


class LoanEligibilityResult(BaseModel):
    loan_type: LoanType
    eligible: bool
    status: str
    max_eligible_amount: float
    available_emi_capacity: float
    assumed_rate_pct: float
    assumed_tenure_years: int
    foir_cap_pct: float
    reason: str


class LeadResult(BaseModel):
    customer_id: str
    name: str
    city: str
    age: int
    occupation_type: str
    income_estimate: IncomeEstimate
    score: ScoreBreakdown
    interested_loan_types: List[LoanType]
    top_eligibility: List[LoanEligibilityResult]
