import random
from datetime import date, timedelta
from models import Customer, Transaction, BehaviorSignals

random.seed(42)

FIRST_NAMES = ["Aarav", "Vivaan", "Aditi", "Ishaan", "Diya", "Rohan", "Ananya", "Kabir",
               "Meera", "Aryan", "Sneha", "Vikram", "Priya", "Karan", "Neha", "Arjun",
               "Pooja", "Rahul", "Kavya", "Siddharth", "Riya", "Aman", "Tanvi", "Nikhil",
               "Simran", "Yash", "Isha", "Dev", "Anjali", "Manish"]
LAST_NAMES = ["Sharma", "Verma", "Patel", "Gupta", "Reddy", "Iyer", "Nair", "Singh",
              "Mehta", "Kapoor", "Joshi", "Chauhan", "Malhotra", "Bansal", "Rao", "Desai"]
CITIES = ["Jaipur", "Mumbai", "Bengaluru", "Delhi NCR", "Pune", "Hyderabad", "Ahmedabad",
          "Chennai", "Kolkata", "Lucknow"]
PRODUCTS_POOL = ["Savings Account", "Debit Card", "Credit Card", "Fixed Deposit",
                  "Demat Account", "Insurance", "SIP/Mutual Fund"]
LOAN_TYPES = ["personal_loan", "home_loan", "mortgage_loan", "auto_loan"]

DEBIT_CATEGORIES = ["Groceries", "Utilities", "Rent", "Dining", "Fuel", "Shopping",
                     "EMI - Existing Loan", "Insurance Premium", "Entertainment", "Travel", "ATM Withdrawal"]


def _rand_date_in_month(year: int, month: int) -> date:
    day = random.randint(1, 27)
    return date(year, month, day)


def _months_back(n: int):
    today = date.today()
    months = []
    y, m = today.year, today.month
    for _ in range(n):
        months.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(months))


def _gen_salaried_transactions(base_salary: float, months, regularity: float):
    txns = []
    for (y, m) in months:
        if random.random() < regularity:
            salary = round(base_salary * random.uniform(0.97, 1.03), -2)
            txns.append(Transaction(
                date=_rand_date_in_month(y, m), type="credit", category="Salary",
                amount=salary, channel="NEFT", narration="SALARY CREDIT - EMPLOYER"
            ))
        n_debits = random.randint(8, 16)
        for _ in range(n_debits):
            cat = random.choice(DEBIT_CATEGORIES)
            amt = round(random.uniform(300, base_salary * 0.12), 2)
            channel = random.choice(["UPI", "UPI", "UPI", "card", "auto_debit", "cheque"])
            txns.append(Transaction(date=_rand_date_in_month(y, m), type="debit",
                                     category=cat, amount=amt, channel=channel))
        # occasional small extra credit (refund/interest)
        if random.random() < 0.3:
            txns.append(Transaction(date=_rand_date_in_month(y, m), type="credit",
                                     category="Refund/Interest", amount=round(random.uniform(100, 1500), 2),
                                     channel="UPI"))
    return txns


def _gen_self_employed_transactions(avg_monthly_receipts: float, months, volatility: float):
    txns = []
    for (y, m) in months:
        n_credits = random.randint(6, 22)
        total_target = avg_monthly_receipts * random.uniform(1 - volatility, 1 + volatility)
        remaining = total_target
        for i in range(n_credits):
            share = remaining / (n_credits - i) * random.uniform(0.5, 1.5)
            share = max(500, min(share, remaining))
            remaining -= share
            txns.append(Transaction(date=_rand_date_in_month(y, m), type="credit",
                                     category="Business Receipt", amount=round(share, 2),
                                     channel=random.choice(["UPI", "IMPS", "NEFT", "cash"])))
        n_debits = random.randint(10, 20)
        for _ in range(n_debits):
            cat = random.choice(DEBIT_CATEGORIES + ["Supplier Payment", "Shop Rent", "Staff Wages"])
            amt = round(random.uniform(300, avg_monthly_receipts * 0.1), 2)
            txns.append(Transaction(date=_rand_date_in_month(y, m), type="debit",
                                     category=cat, amount=amt,
                                     channel=random.choice(["UPI", "cash", "card", "cheque"])))
    return txns


def generate_customer(idx: int) -> Customer:
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    occupation = random.choices(["salaried", "self_employed"], weights=[0.62, 0.38])[0]
    age = random.randint(23, 55)
    vintage = random.randint(3, 96)
    months = _months_back(random.choice([6, 9, 12]))

    quality_tier = random.choices(["strong", "moderate", "weak"], weights=[0.40, 0.38, 0.22])[0]

    if occupation == "salaried":
        base_salary = random.choice([28000, 35000, 42000, 55000, 68000, 80000, 95000, 120000, 150000])
        regularity = {"strong": random.uniform(0.9, 1.0), "moderate": random.uniform(0.7, 0.89),
                      "weak": random.uniform(0.4, 0.65)}[quality_tier]
        txns = _gen_salaried_transactions(base_salary, months, regularity)
    else:
        avg_receipts = random.choice([40000, 60000, 90000, 130000, 180000, 250000])
        volatility = {"strong": random.uniform(0.1, 0.2), "moderate": random.uniform(0.25, 0.4),
                      "weak": random.uniform(0.45, 0.7)}[quality_tier]
        txns = _gen_self_employed_transactions(avg_receipts, months, volatility)

    n_products = {"strong": random.randint(2, 5), "moderate": random.randint(1, 3),
                  "weak": random.randint(0, 2)}[quality_tier]
    products = random.sample(PRODUCTS_POOL, min(n_products, len(PRODUCTS_POOL)))

    obligations = 0
    if random.random() < 0.45:
        obligations = round(random.uniform(2000, 25000), -2)

    bureau = None
    if random.random() < 0.8:
        bureau = {"strong": random.randint(740, 830), "moderate": random.randint(670, 750),
                  "weak": random.randint(560, 690)}[quality_tier]

    behavior_mult = {"strong": (5, 8, 4), "moderate": (2, 4, 2), "weak": (0, 1, 0)}[quality_tier]
    behavior = BehaviorSignals(
        emi_calculator_uses_90d=random.randint(0, behavior_mult[0]),
        loan_page_visits_90d=random.randint(0, behavior_mult[1] + 4),
        loan_offer_clicks_90d=random.randint(0, behavior_mult[2]),
        app_logins_30d=random.randint(2, 25),
        branch_visits_180d=random.randint(0, 3),
        existing_loan_inquiries_90d=random.randint(0, 2) if quality_tier != "weak" else 0,
    )

    n_interests = random.randint(1, 2) if quality_tier != "weak" else random.randint(0, 1)
    interested = random.sample(LOAN_TYPES, n_interests) if n_interests else []

    return Customer(
        customer_id=f"CUST{idx:05d}",
        name=name,
        age=age,
        city=random.choice(CITIES),
        occupation_type=occupation,
        account_vintage_months=vintage,
        existing_products=products,
        bureau_score=bureau,
        existing_monthly_obligations=obligations,
        interested_loan_types=interested,
        transactions=txns,
        behavior=behavior,
    )


def generate_dataset(n: int = 180):
    return [generate_customer(i + 1) for i in range(n)]
