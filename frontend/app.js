const API = window.API_BASE || "";

const TIER_COLOR = { "High Quality": "#04844B", "Medium": "#A8620A", "Low": "#BA0517" };
const LOAN_LABEL = {
  personal_loan: "Personal Loan", home_loan: "Home Loan",
  mortgage_loan: "Mortgage Loan", auto_loan: "Auto Loan",
};
const COMPONENT_META = [
  { key: "income_confidence", label: "Income confidence", max: 20, color: "#0176D3" },
  { key: "affordability", label: "Affordability", max: 25, color: "#04844B" },
  { key: "behavioral_intent", label: "Behavioral intent", max: 25, color: "#5B8DEF" },
  { key: "stability", label: "Stability", max: 15, color: "#A8620A" },
  { key: "relationship_depth", label: "Relationship depth", max: 15, color: "#BA0517" },
];
const STAGES = ["New", "Contacted", "Income Verified", "Offer Sent", "Converted", "Disqualified"];

const fmtINR = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtINRShort = (n) => {
  if (n >= 1e7) return "₹" + (n / 1e7).toFixed(2) + "Cr";
  if (n >= 1e5) return "₹" + (n / 1e5).toFixed(1) + "L";
  if (n >= 1e3) return "₹" + (n / 1e3).toFixed(0) + "K";
  return "₹" + Math.round(n);
};
const initials = (name) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  if (!res.ok) throw new Error("API error " + res.status);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res;
}

/* ---------- Toasts ---------- */
function toast(msg, type = "default") {
  const stack = document.getElementById("toastStack");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .25s"; setTimeout(() => el.remove(), 250); }, 2600);
}

/* ---------- State ---------- */
let allCitiesLoaded = false;
let currentLeadsCache = [];
let selectedIds = new Set();
let currentTableView = "table";

/* ---------- SVG helpers ---------- */
function ringCircle(cx, cy, r, pct, color, width, trackColor) {
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, pct)) * c;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackColor || '#EDEDEC'}" stroke-width="${width}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-dasharray="${dash} ${c - dash}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>`;
}
function convRingSVG(pct) {
  const size = 130, cx = 65, cy = 65, r = 54, width = 11;
  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`;
  svg += ringCircle(cx, cy, r, pct / 100, "#0176D3", width);
  const angle = ((30 / 100) * 360 - 90) * Math.PI / 180;
  const mx = cx + r * Math.cos(angle), my = cy + r * Math.sin(angle);
  svg += `<circle cx="${mx}" cy="${my}" r="4" fill="#04844B" stroke="#fff" stroke-width="2"/>`;
  svg += `</svg>`;
  return svg;
}
function fingerprintSVG(score, size = 140) {
  const cx = size / 2, cy = size / 2, baseR = size * 0.15, step = size * 0.10, width = size * 0.05;
  let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`;
  COMPONENT_META.forEach((c, i) => {
    svg += ringCircle(cx, cy, baseR + step * i, (score[c.key] || 0) / c.max, c.color, width);
  });
  svg += `<text x="${cx}" y="${cy + size * 0.045}" text-anchor="middle" font-family="Sora" font-size="${size * 0.15}" fill="#14171A" font-weight="700">${Math.round(score.total)}</text>`;
  svg += `</svg>`;
  return svg;
}
function sparklineSVG(series, width = 460, height = 50) {
  if (!series || series.length < 2) return `<svg width="${width}" height="${height}"></svg>`;
  const vals = series.map((s) => s.total_credits);
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const stepX = width / (vals.length - 1);
  const pts = vals.map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 8) - 4}`);
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
      <polygon points="0,${height} ${pts.join(" ")} ${width},${height}" fill="#0176D3" opacity="0.08"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="#0176D3" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
}

/* ---------- Nav ---------- */
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
    if (btn.dataset.view === "pipeline") loadPipelineView();
  });
});

/* ---------- Overview ---------- */
async function loadOverview() {
  const stats = await api("/api/dashboard/stats");
  document.getElementById("engineStatus").textContent = `${stats.total_leads} accounts indexed`;
  document.getElementById("navLeadCount").textContent = stats.total_leads;

  const kpis = [
    { label: "Total leads", value: stats.total_leads, sub: "transaction + behavior data", accent: "var(--brand)" },
    { label: "High-quality leads", value: stats.high_quality_leads, sub: `${stats.high_quality_rate_pct}% of book`, pos: true, accent: "var(--success)" },
    { label: "Avg. est. income", value: fmtINRShort(stats.average_estimated_monthly_income) + "/mo", sub: "inferred from inflow", accent: "var(--warning)" },
    { label: "Avg. lead score", value: stats.average_lead_score, sub: "composite / 100", accent: "var(--brand)" },
  ];
  document.getElementById("kpiRow").innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--kpi-accent:${k.accent}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub ${k.pos ? 'pos' : ''}">${k.sub}</div>
    </div>`).join("");

  const maxHist = Math.max(...stats.score_histogram, 1);
  document.getElementById("histogram").innerHTML = stats.score_histogram.map((v, i) => {
    const low = i * 10;
    const cls = low >= 70 ? "" : low >= 50 ? "mid" : "low";
    return `<div class="hist-bar">
      <div class="hist-count">${v}</div>
      <div class="hist-fill ${cls}" style="height:${Math.max(3, (v / maxHist) * 100)}%"></div>
      <div class="hist-label">${low}</div>
    </div>`;
  }).join("");

  document.getElementById("convBlock").innerHTML = `
    <div class="conv-ring-wrap">
      ${convRingSVG(stats.projected_conversion_rate_pct)}
      <div class="conv-num"><span class="v">${stats.projected_conversion_rate_pct}%</span><span class="l">projected</span></div>
    </div>
    <div class="conv-detail">
      <div class="conv-stat"><span class="k">High quality</span><span class="v good">${stats.high_quality_leads}</span></div>
      <div class="conv-stat"><span class="k">Medium</span><span class="v">${stats.medium_leads}</span></div>
      <div class="conv-stat"><span class="k">Low</span><span class="v">${stats.low_leads}</span></div>
      <div class="conv-stat"><span class="k">Target</span><span class="v good">&gt; 30%</span></div>
    </div>`;

  const top = await api("/api/leads?sort_by=score_desc&limit=8");
  document.getElementById("topLeadsTable").innerHTML = renderLeadTable(top, false);
  bindRowInteractions(document.getElementById("topLeadsTable"), false);
}

/* ---------- Lead table renderer ---------- */
function scoreBarColor(tier) { return TIER_COLOR[tier] || "#0176D3"; }

function renderLeadTable(leads, selectable = true) {
  if (!leads.length) {
    return `<div style="padding:36px;color:var(--text-3);text-align:center;">No leads match these filters — try widening them.</div>`;
  }
  const rows = leads.map((l) => {
    const tierClass = l.score.tier.replace(" ", "");
    const chips = l.interested_loan_types.map(lt => `<span class="loan-chip">${LOAN_LABEL[lt]}</span>`).join("");
    const checked = selectedIds.has(l.customer_id) ? "checked" : "";
    return `<tr data-id="${l.customer_id}" class="${selectedIds.has(l.customer_id) ? 'selected' : ''}">
      ${selectable ? `<td><input type="checkbox" class="row-check" data-check="${l.customer_id}" ${checked}></td>` : ""}
      <td>
        <div class="name-cell">
          <div class="mini-avatar">${initials(l.name)}</div>
          <div>
            <div class="cell-name">${l.name}</div>
            <div class="cell-sub">${l.customer_id} · ${l.city}</div>
          </div>
        </div>
      </td>
      <td><span class="pill ${tierClass}">${l.score.tier}</span></td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-track"><div class="score-fill" style="width:${l.score.total}%;background:${scoreBarColor(l.score.tier)}"></div></div>
          <div class="score-num">${Math.round(l.score.total)}</div>
        </div>
      </td>
      <td class="mono">${fmtINRShort(l.income_estimate.estimated_monthly_income)}/mo</td>
      <td><span class="pill stage">${l.stage || "New"}</span></td>
      <td>${chips || '<span class="cell-sub">—</span>'}</td>
      <td><button class="kebab-btn" data-kebab="${l.customer_id}">⋮</button></td>
    </tr>`;
  }).join("");
  return `<table class="crm-table">
    <thead><tr>
      ${selectable ? "<th></th>" : ""}
      <th>Prospect</th><th>Tier</th><th>Score</th><th>Est. income</th><th>Stage</th><th>Interested in</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function bindRowInteractions(container, selectable = true) {
  container.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("[data-check]") || e.target.closest("[data-kebab]")) return;
      openDrawer(tr.dataset.id);
    });
  });
  if (!selectable) return;
  container.querySelectorAll("[data-check]").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.check;
      if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkBar();
      e.target.closest("tr").classList.toggle("selected", e.target.checked);
    });
  });
  container.querySelectorAll("[data-kebab]").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openDrawer(btn.dataset.kebab); });
  });
}

function updateBulkBar() {
  const bar = document.getElementById("bulkBar");
  const count = selectedIds.size;
  document.getElementById("bulkCount").textContent = `${count} selected`;
  bar.classList.toggle("show", count > 0);
}

/* ---------- Leads view ---------- */
async function loadCitiesFilter() {
  if (allCitiesLoaded) return;
  const cities = await api("/api/cities");
  const sel = document.getElementById("filterCity");
  cities.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  allCitiesLoaded = true;
}

async function loadLeadsView() {
  const tier = document.getElementById("filterTier").value;
  const loan = document.getElementById("filterLoan").value;
  const city = document.getElementById("filterCity").value;
  const minScore = document.getElementById("filterScore").value;
  const sort = document.getElementById("filterSort").value;
  const q = document.getElementById("globalSearch").value.trim().toLowerCase();

  const params = new URLSearchParams({ min_score: minScore, sort_by: sort, limit: 200 });
  if (tier) params.set("tier", tier);
  if (loan) params.set("loan_type", loan);
  if (city) params.set("city", city);

  let leads = await api("/api/leads?" + params.toString());
  if (q) leads = leads.filter(l => l.name.toLowerCase().includes(q) || l.customer_id.toLowerCase().includes(q) || l.city.toLowerCase().includes(q));
  currentLeadsCache = leads;

  if (currentTableView === "table") {
    const wrap = document.getElementById("leadsTable");
    wrap.innerHTML = renderLeadTable(leads, true);
    bindRowInteractions(wrap, true);
  } else {
    renderKanban(leads);
  }
}

["filterTier", "filterLoan", "filterCity", "filterSort"].forEach((id) => {
  document.getElementById(id).addEventListener("change", loadLeadsView);
});
document.getElementById("filterScore").addEventListener("input", (e) => {
  document.getElementById("filterScoreVal").textContent = e.target.value;
});
document.getElementById("filterScore").addEventListener("change", loadLeadsView);
document.getElementById("btnClearFilters").addEventListener("click", () => {
  document.getElementById("filterTier").value = "";
  document.getElementById("filterLoan").value = "";
  document.getElementById("filterCity").value = "";
  document.getElementById("filterScore").value = 0;
  document.getElementById("filterScoreVal").textContent = "0";
  document.getElementById("filterSort").value = "score_desc";
  document.getElementById("globalSearch").value = "";
  loadLeadsView();
});

document.querySelectorAll(".toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTableView = btn.dataset.tableview;
    document.getElementById("tableViewWrap").style.display = currentTableView === "table" ? "" : "none";
    document.getElementById("kanbanViewWrap").style.display = currentTableView === "kanban" ? "" : "none";
    loadLeadsView();
  });
});

/* ---------- Kanban (tier-based, in Leads view) ---------- */
function renderKanban(leads) {
  const tiers = ["High Quality", "Medium", "Low"];
  const board = document.getElementById("kanbanViewWrap");
  board.innerHTML = tiers.map(t => {
    const items = leads.filter(l => l.score.tier === t);
    return `<div class="kanban-col">
      <div class="kanban-col-head">
        <span class="kanban-col-title">${t}</span>
        <span class="kanban-col-count">${items.length}</span>
      </div>
      ${items.map(l => `
        <div class="kanban-card" data-id="${l.customer_id}">
          <div class="kc-top">
            <div><div class="kc-name">${l.name}</div><div class="kc-sub">${l.city} · ${l.customer_id}</div></div>
            <div class="kc-score" style="color:${TIER_COLOR[l.score.tier]}">${Math.round(l.score.total)}</div>
          </div>
          <div class="kc-income">${fmtINRShort(l.income_estimate.estimated_monthly_income)}/mo</div>
        </div>`).join("")}
    </div>`;
  }).join("");
  board.querySelectorAll(".kanban-card").forEach(card => {
    card.addEventListener("click", () => openDrawer(card.dataset.id));
  });
}

/* ---------- Pipeline view (stage-based, draggable) ---------- */
async function loadPipelineView() {
  const leads = await api("/api/leads?limit=200&sort_by=score_desc");
  renderPipelineBoard(leads);
}

function renderPipelineBoard(leads) {
  const board = document.getElementById("pipelineBoard");
  board.classList.add("stages");
  const activeStages = STAGES.filter(s => s !== "Disqualified");
  board.innerHTML = activeStages.map(stage => {
    const items = leads.filter(l => (l.stage || "New") === stage);
    return `<div class="kanban-col" data-stage="${stage}">
      <div class="kanban-col-head">
        <span class="kanban-col-title">${stage}</span>
        <span class="kanban-col-count">${items.length}</span>
      </div>
      ${items.map(l => `
        <div class="kanban-card" draggable="true" data-id="${l.customer_id}">
          <div class="kc-top">
            <div><div class="kc-name">${l.name}</div><div class="kc-sub">${l.city}</div></div>
            <div class="kc-score" style="color:${TIER_COLOR[l.score.tier]}">${Math.round(l.score.total)}</div>
          </div>
          <div class="kc-income">${fmtINRShort(l.income_estimate.estimated_monthly_income)}/mo</div>
        </div>`).join("")}
    </div>`;
  }).join("");

  board.querySelectorAll(".kanban-card").forEach(card => {
    card.addEventListener("click", (e) => { if (!card.classList.contains("dragging")) openDrawer(card.dataset.id); });
    card.addEventListener("dragstart", () => { card.classList.add("dragging"); });
    card.addEventListener("dragend", () => { card.classList.remove("dragging"); });
  });
  board.querySelectorAll(".kanban-col").forEach(col => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const dragging = board.querySelector(".dragging");
      if (!dragging) return;
      const id = dragging.dataset.id;
      const newStage = col.dataset.stage;
      col.querySelector(".kanban-col-head").insertAdjacentElement("afterend", dragging);
      try {
        await api(`/api/leads/${id}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: newStage }) });
        toast(`Moved to "${newStage}"`, "success");
        loadPipelineView();
      } catch { toast("Could not update stage", "error"); }
    });
  });
}

/* ---------- Products view ---------- */
async function loadProductsView() {
  const stats = await api("/api/dashboard/stats");
  const params = stats.product_params;
  document.getElementById("productGrid").innerHTML = Object.keys(LOAN_LABEL).map((lt) => {
    const p = params[lt];
    const demand = stats.loan_demand_by_type[lt] || 0;
    const eligible = stats.eligible_leads_by_type[lt] || 0;
    const pct = stats.total_leads ? Math.round((eligible / stats.total_leads) * 100) : 0;
    return `<div class="product-card">
      <h3>${LOAN_LABEL[lt]}</h3>
      <div class="p-meta">FOIR cap ${p.foir_cap * 100}% · ${p.rate}% p.a. · up to ${p.tenure_years}y tenure</div>
      <div class="product-stats">
        <div><div class="p-stat-label">Genuinely interested</div><div class="p-stat-value">${demand}</div></div>
        <div><div class="p-stat-label">Capacity-eligible</div><div class="p-stat-value">${eligible}</div></div>
      </div>
      <div class="p-progress"><div class="p-progress-fill" style="width:${pct}%"></div></div>
      <div class="cell-sub" style="margin-top:6px">${pct}% of book clears FOIR for this product</div>
    </div>`;
  }).join("");
}

/* ---------- Record panel (drawer) ---------- */
let currentDrawerId = null;

async function openDrawer(customerId) {
  currentDrawerId = customerId;
  const drawer = document.getElementById("drawer");
  const scrim = document.getElementById("scrim");
  const content = document.getElementById("drawerContent");
  content.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-3)">Loading customer file…</div>`;
  drawer.classList.add("open"); scrim.classList.add("open");

  const [lead, txns] = await Promise.all([
    api(`/api/leads/${customerId}`),
    api(`/api/leads/${customerId}/transactions?limit=25`),
  ]);
  renderDrawer(lead, txns);
}

function renderDrawer(lead, txns) {
  const content = document.getElementById("drawerContent");
  const tierClass = lead.score.tier.replace(" ", "");
  const stage = lead.stage || "New";
  const stageIdx = STAGES.indexOf(stage);

  const legendRows = COMPONENT_META.map(c => `
    <div class="fp-item"><span class="fp-swatch" style="background:${c.color}"></span><span class="fp-name">${c.label}</span><span class="fp-val">${lead.score[c.key]}/${c.max}</span></div>`).join("");

  const pathSteps = STAGES.filter(s => s !== "Disqualified").map((s, i) => {
    const cls = i < stageIdx ? "done" : i === stageIdx ? "current" : "";
    return `<div class="path-step ${cls}" data-stage="${s}"><div class="dot">${i < stageIdx ? "✓" : i + 1}</div>${s}</div>`;
  }).join("");

  const eligRows = lead.top_eligibility.map(e => {
    const statusClass = e.status.replace(" ", "");
    return `<div class="elig-row">
      <div>
        <div class="elig-name">${LOAN_LABEL[e.loan_type]}</div>
        <div class="elig-reason">${e.reason}</div>
        <span class="status-pill ${statusClass}">${e.status}</span>
      </div>
      <div class="elig-amt">
        <div class="v">${e.max_eligible_amount > 0 ? fmtINRShort(e.max_eligible_amount) : '—'}</div>
        <div class="mono" style="font-size:10px;color:var(--text-3)">${e.assumed_rate_pct}% · ${e.assumed_tenure_years}y</div>
      </div>
    </div>`;
  }).join("");

  const txnRows = txns.map(t => `
    <div class="txn-row">
      <div class="txn-left"><span class="txn-cat">${t.category}</span><span class="txn-date">${t.date} · ${t.channel}</span></div>
      <div class="txn-amt ${t.type}">${t.type === 'credit' ? '+' : '−'}${fmtINR(t.amount)}</div>
    </div>`).join("");

  content.innerHTML = `
    <div class="d-topband">
      <button class="drawer-close" id="drawerCloseBtn">✕ close</button>
      <div class="d-name">${lead.name}</div>
      <div class="d-meta">${lead.customer_id} · Age ${lead.age} · ${lead.city} · ${lead.occupation_type.replace("_"," ")}</div>
      <div class="d-badges">
        <span class="pill ${tierClass}">${lead.score.tier}</span>
        <span class="pill stage">${stage}</span>
      </div>
    </div>

    <div class="path-bar">${pathSteps}</div>

    <div class="d-body">
      <div class="d-tabs">
        <button class="d-tab active" data-tab="overview">Overview</button>
        <button class="d-tab" data-tab="income">Income & Cash Flow</button>
        <button class="d-tab" data-tab="eligibility">Loan Eligibility</button>
      </div>

      <div class="d-tabpanel active" data-panel="overview">
        <div class="fingerprint-wrap">
          <div>${fingerprintSVG(lead.score, 140)}</div>
          <div class="fp-legend">${legendRows}</div>
        </div>
        <div class="d-section-title">Prospect details</div>
        <div class="field-grid">
          <div class="field-item"><div class="l">Occupation</div><div class="v">${lead.occupation_type.replace("_"," ")}</div></div>
          <div class="field-item"><div class="l">City</div><div class="v">${lead.city}</div></div>
          <div class="field-item"><div class="l">Interested in</div><div class="v chips">${lead.interested_loan_types.map(lt => `<span class="loan-chip">${LOAN_LABEL[lt]}</span>`).join("") || "—"}</div></div>
          <div class="field-item"><div class="l">Composite score</div><div class="v">${lead.score.total} / 100</div></div>
        </div>
      </div>

      <div class="d-tabpanel" data-panel="income">
        <div class="income-card">
          <div class="income-top">
            <div class="income-amt">${fmtINR(lead.income_estimate.estimated_monthly_income)}/mo</div>
            <div class="income-conf">confidence ${Math.round(lead.income_estimate.confidence * 100)}%</div>
          </div>
          <div class="income-type">${lead.income_estimate.income_type_detected} · ${lead.income_estimate.method}</div>
          <div class="spark">${sparklineSVG(lead.income_estimate.monthly_series)}</div>
        </div>
        <div class="d-section-title">Recent transactions</div>
        <div class="txn-list">${txnRows}</div>
      </div>

      <div class="d-tabpanel" data-panel="eligibility">
        <div class="elig-list">${eligRows}</div>
      </div>
    </div>

    <div class="d-actions">
      <button class="btn btn-primary" id="drawerAdvance">Advance stage →</button>
      <button class="btn btn-secondary" id="drawerLogActivity">Log activity</button>
      <button class="btn btn-danger" id="drawerDisqualify">Disqualify</button>
    </div>
  `;

  document.getElementById("drawerCloseBtn").addEventListener("click", closeDrawer);
  content.querySelectorAll(".d-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      content.querySelectorAll(".d-tab").forEach(t => t.classList.remove("active"));
      content.querySelectorAll(".d-tabpanel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      content.querySelector(`.d-tabpanel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });
  content.querySelectorAll(".path-step").forEach(step => {
    step.addEventListener("click", () => setStage(lead.customer_id, step.dataset.stage));
  });
  document.getElementById("drawerAdvance").addEventListener("click", () => {
    const activeStages = STAGES.filter(s => s !== "Disqualified");
    const idx = activeStages.indexOf(stage);
    const next = activeStages[Math.min(idx + 1, activeStages.length - 1)];
    setStage(lead.customer_id, next);
  });
  document.getElementById("drawerLogActivity").addEventListener("click", () => toast("Activity logged to timeline", "success"));
  document.getElementById("drawerDisqualify").addEventListener("click", () => setStage(lead.customer_id, "Disqualified"));
}

async function setStage(customerId, stage) {
  try {
    await api(`/api/leads/${customerId}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
    toast(`Stage updated to "${stage}"`, "success");
    const [lead, txns] = await Promise.all([api(`/api/leads/${customerId}`), api(`/api/leads/${customerId}/transactions?limit=25`)]);
    renderDrawer(lead, txns);
  } catch { toast("Could not update stage", "error"); }
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("scrim").classList.remove("open");
}
document.getElementById("scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); closeModal(); } });

/* ---------- Bulk actions ---------- */
document.getElementById("bulkClear").addEventListener("click", () => { selectedIds.clear(); loadLeadsView(); updateBulkBar(); });
document.getElementById("bulkContact").addEventListener("click", async () => {
  await Promise.all([...selectedIds].map(id => api(`/api/leads/${id}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "Contacted" }) })));
  toast(`${selectedIds.size} leads marked Contacted`, "success");
  selectedIds.clear(); updateBulkBar(); loadLeadsView();
});
document.getElementById("bulkDisqualify").addEventListener("click", async () => {
  await Promise.all([...selectedIds].map(id => api(`/api/leads/${id}/stage`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: "Disqualified" }) })));
  toast(`${selectedIds.size} leads disqualified`, "success");
  selectedIds.clear(); updateBulkBar(); loadLeadsView();
});
document.getElementById("bulkExport").addEventListener("click", () => {
  toast(`Exporting ${selectedIds.size} selected leads…`);
  window.open(API + "/api/leads/export", "_blank");
});

/* ---------- Export buttons ---------- */
["btnExport", "btnExport2"].forEach(id => document.getElementById(id).addEventListener("click", () => {
  toast("Preparing CSV export…");
  window.open(API + "/api/leads/export", "_blank");
}));
document.getElementById("btnNotif").addEventListener("click", () => toast("No new notifications — you're all caught up."));

/* ---------- New Lead modal ---------- */
function openModal() { document.getElementById("modalScrim").classList.add("open"); }
function closeModal() { document.getElementById("modalScrim").classList.remove("open"); document.getElementById("newLeadForm").reset(); }
["btnNewLead", "btnNewLead2", "btnNewLead3"].forEach(id => document.getElementById(id).addEventListener("click", openModal));
document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalCancel").addEventListener("click", closeModal);
document.getElementById("modalScrim").addEventListener("click", (e) => { if (e.target.id === "modalScrim") closeModal(); });

document.getElementById("newLeadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const interested = fd.getAll("interested");
  const payload = {
    name: fd.get("name"), age: Number(fd.get("age")), city: fd.get("city"),
    occupation_type: fd.get("occupation_type"),
    monthly_income_hint: Number(fd.get("monthly_income_hint")),
    existing_monthly_obligations: Number(fd.get("existing_monthly_obligations") || 0),
    interested_loan_types: interested,
  };
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true; submitBtn.textContent = "Scoring…";
  try {
    const lead = await api("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    toast(`Lead created — scored ${Math.round(lead.score.total)}/100 (${lead.score.tier})`, "success");
    closeModal();
    loadOverview(); loadLeadsView();
    openDrawer(lead.customer_id);
  } catch (err) {
    toast("Could not create lead — check the form", "error");
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = "Create lead & score";
  }
});

/* ---------- Global search ---------- */
let searchDebounce;
document.getElementById("globalSearch").addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    document.querySelector('.nav-item[data-view="leads"]').click();
    loadLeadsView();
  }, 300);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    document.getElementById("globalSearch").focus();
  }
});

/* ---------- Boot ---------- */
(async function init() {
  try {
    await loadCitiesFilter();
    await loadOverview();
    await loadLeadsView();
    await loadProductsView();
  } catch (err) {
    console.error(err);
    document.getElementById("engineStatus").textContent = "connection error";
  }
})();
