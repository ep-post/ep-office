/* ================= FUND TRACKER =================
   The same shape as the Empower People Fund Tracker workbook:
   Summary · Receipts · Expenses · Unallocated · By project (budget heads) · Monthly · Projects
   Figures are worked out from what is entered, so the tracker is never out of date. */
const ftINR = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const ftPC = (a, b) => b ? Math.round((Number(a) || 0) / b * 100) : 0;
const ftPCTag = p => p > 110 ? `<span class="tag bad">${p}%</span>` : p > 90 ? `<span class="tag warn">${p}%</span>` : `${p}%`;

async function fundData() {
  const g = c => db.collection(c).limit(3000).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [rec, exp, heads] = await Promise.all([g("incomeReceipts"), g("expenses"), g("budgetHeads")]);
  const sum = (a, f) => a.reduce((x, y) => x + (Number(y[f]) || 0), 0);
  const rows = activeProjects().map(p => {
    const r = sum(rec.filter(x => x.projectId === p.id), "amount");
    const s = sum(exp.filter(x => x.projectId === p.id), "amount");
    const san = Number(p.budget) || sum(heads.filter(h => h.projectId === p.id && !h.orgBorne), "total");
    return { p, san, rec: r, spent: s, yet: Math.max(0, san - r), bal: r - s, pcRec: ftPC(s, r), pcSan: ftPC(s, san) };
  });
  return { rec, exp, heads, rows, sum };
}

routes.tracker = async (tab) => {
  tab = tab || state.trackerTab || "summary"; state.trackerTab = tab;
  setTitle("Fund Tracker");
  const { rec, exp, heads, rows, sum } = await fundData();
  const closedCount = (state.projects || []).filter(p => !isLiveProject(p)).length;
  const unalloc = exp.filter(e => !e.projectId);
  const TABS = [
    ["summary", "Summary"],
    ...(fnAccounts() || has("super_admin") ? [["receipts", "Receipts"], ["expenses", "Expenses"], ["unalloc", "Unallocated"], ["monthly", "Monthly"]] : []),
    ["heads", "By project"],
    ["projects", "Projects"],
  ];
  const months = {};
  rec.forEach(r => { const m = String(r.date || "").slice(0, 7); if (m) (months[m] = months[m] || { r: 0, s: 0 }).r += Number(r.amount) || 0; });
  exp.forEach(e => { const m = (e.date || e.month || "").slice(0, 7); if (m) (months[m] = months[m] || { r: 0, s: 0 }).s += Number(e.amount) || 0; });
  let run = 0;
  const body = {
    summary: () => `<div class="grid">
        <div class="card stat"><span class="muted small">Sanctioned</span><b>${ftINR(sum(rows, "san"))}</b></div>
        <div class="card stat"><span class="muted small">Received</span><b>${ftINR(sum(rows, "rec"))}</b></div>
        <div class="card stat"><span class="muted small">Yet to receive</span><b>${ftINR(sum(rows, "yet"))}</b></div>
        <div class="card stat"><span class="muted small">Spent</span><b>${ftINR(sum(rows, "spent"))}</b></div>
        <div class="card stat"><span class="muted small">Balance in hand</span><b>${ftINR(sum(rows, "bal"))}</b></div>
        <div class="card stat"><span class="muted small">Unallocated spend</span><b>${ftINR(unalloc.reduce((a, e) => a + (Number(e.amount) || 0), 0))}</b></div></div>
      <div class="card"><h2>Fund position · as on ${fmtD(today())}</h2><div class="tablewrap"><table class="table">
        <tr><th>Project</th><th>Donor</th><th>Fund type</th><th>Sanctioned</th><th>Received</th><th>Yet to receive</th><th>Spent</th><th>Balance in hand</th><th>% of received spent</th><th>% of sanctioned spent</th></tr>
        ${rows.map(x => `<tr><td><b>${esc(x.p.code || x.p.name)}</b><div class="s">${esc(x.p.name)}</div></td><td class="small">${esc(x.p.donor || "")}</td>
          <td>${esc(x.p.fundType || "")}</td><td>${ftINR(x.san)}</td><td>${ftINR(x.rec)}</td><td>${ftINR(x.yet)}</td><td>${ftINR(x.spent)}</td>
          <td><b>${ftINR(x.bal)}</b></td><td>${ftPCTag(x.pcRec)}</td><td>${ftPCTag(x.pcSan)}</td></tr>`).join("") || `<tr><td colspan="10" class="empty">No projects yet</td></tr>`}
        ${rows.length ? `<tr><td colspan="3"><b>Total</b></td><td><b>${ftINR(sum(rows, "san"))}</b></td><td><b>${ftINR(sum(rows, "rec"))}</b></td><td><b>${ftINR(sum(rows, "yet"))}</b></td><td><b>${ftINR(sum(rows, "spent"))}</b></td><td><b>${ftINR(sum(rows, "bal"))}</b></td><td></td><td></td></tr>` : ""}</table></div></div>
      <div class="card"><h2>By fund type</h2><table class="table"><tr><th></th><th>Received</th><th>Spent</th><th>Balance</th></tr>
        ${Object.entries(rows.reduce((a, x) => { const k = x.p.fundType || "Domestic"; a[k] = a[k] || { r: 0, s: 0 }; a[k].r += x.rec; a[k].s += x.spent; return a; }, {}))
          .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${ftINR(v.r)}</td><td>${ftINR(v.s)}</td><td>${ftINR(v.r - v.s)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">—</td></tr>`}</table></div>`,
    receipts: () => `<div class="card"><h2>Funds received (${rec.length})</h2><p class="small muted">Every credit from a donor, with the bank reference against it.</p>
      <div class="tablewrap"><table class="table"><tr><th>Date</th><th>Project</th><th>Tranche / description</th><th>Amount</th><th>Bank credited</th><th>Bank ref / advice</th><th>Fund type</th><th>Remarks</th></tr>
        ${[...rec].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(r => `<tr><td>${fmtD(r.date)}</td><td>${esc(projectName(r.projectId))}</td>
          <td>${esc(r.description || r.type || "")}</td><td>${ftINR(r.amount)}</td><td class="small">${esc(r.bank || "")}</td><td class="small">${esc(r.ref || "")}</td>
          <td>${esc(r.fcra || "")}</td><td class="small">${esc(r.remitter || r.remarks || "")}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">Nothing yet</td></tr>`}</table></div></div>`,
    expenses: () => `<div class="card"><h2>Expenses (${exp.filter(e => e.projectId).length})</h2>
      <div class="tablewrap"><table class="table"><tr><th>Date</th><th>Project</th><th>Head</th><th>Particulars</th><th>Payee</th><th>Voucher</th><th>Amount</th><th>Mode</th><th>Fund type</th><th>Bills</th></tr>
        ${exp.filter(e => e.projectId).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 400).map(e => `<tr><td>${fmtD(e.date)}</td><td>${esc(projectName(e.projectId))}</td>
          <td>${esc(e.head || "")}</td><td>${esc(e.particulars || "")}</td><td>${esc(e.payee || "")}</td><td class="small">${esc(e.voucher || "")}</td>
          <td>${ftINR(e.amount)}</td><td class="small">${esc(e.mode || "")}</td><td>${esc(e.fcra || "")}</td><td>${(e.billUrl||(typeof e.bill==="string"&&e.bill))?`<a href="${esc(e.billUrl||e.bill)}" target="_blank" rel="noopener">📎 bill</a>`:e.bills==="Yes"?"✓":`<span class="tag warn">no</span>`}</td></tr>`).join("") || `<tr><td colspan="10" class="empty">Nothing yet</td></tr>`}</table></div></div>`,
    unalloc: () => `<div class="card"><h2>Unallocated expenses (${unalloc.length}) · ${ftINR(unalloc.reduce((a, e) => a + (Number(e.amount) || 0), 0))}</h2>
      <p class="small muted">Payments not booked to any project — office rent, unfunded salaries, audit and the like. Move them to a project when the funding is settled.</p>
      <div class="tablewrap"><table class="table"><tr><th>Date</th><th>Particulars</th><th>Category</th><th>Payee</th><th>Voucher</th><th>Amount</th><th>Mode</th><th>Likely project</th><th>Bills</th>${isAccounts() ? "<th></th>" : ""}</tr>
        ${unalloc.map(e => `<tr><td>${esc(e.date || "")}</td><td>${esc(e.particulars || "")}</td><td>${esc(e.category || "")}</td><td>${esc(e.payee || "")}</td>
          <td class="small">${esc(e.voucher || "")}</td><td>${ftINR(e.amount)}</td><td class="small">${esc(e.mode || "")}</td><td>${esc(e.likelyProject || "")}</td>
          <td>${(e.billUrl||(typeof e.bill==="string"&&e.bill))?`<a href="${esc(e.billUrl||e.bill)}" target="_blank" rel="noopener">📎</a>`:e.bills==="Yes"?"✓":""}</td>${isAccounts() ? `<td><button class="btn small quiet" data-mv="${e.id}">Book to a project</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="10" class="empty">Nothing unallocated</td></tr>`}</table></div></div>`,
    heads: () => activeProjects().map(p => {
      const hs = heads.filter(h => h.projectId === p.id);
      if (!hs.length) return "";
      const spentOn = code => exp.filter(e => e.projectId === p.id && e.head === code).reduce((a, e) => a + (Number(e.amount) || 0), 0);
      const r = rows.find(x => x.p.id === p.id) || {};
      return `<div class="card"><h2>${esc(p.code || p.name)} — fund position by budget head</h2>
        <p class="small">Received ${ftINR(r.rec)} · Spent ${ftINR(r.spent)} · Balance in hand <b>${ftINR(r.bal)}</b> · ${ftPCTag(r.pcRec)} of received spent</p>
        <div class="tablewrap"><table class="table"><tr><th>Head</th><th>Budget line</th><th>Year 1</th><th>Year 2</th><th>Total budget</th><th>Spent</th><th>Balance</th><th>% used</th></tr>
        ${hs.map(h => { const s = spentOn(h.code), b = Number(h.total) || 0;
          return `<tr><td><b>${esc(h.code)}</b>${h.orgBorne ? ' <span class="tag">ORG</span>' : ""}</td><td>${esc(h.line)}</td>
            <td>${h.y1 ? ftINR(h.y1) : ""}</td><td>${h.y2 ? ftINR(h.y2) : ""}</td><td>${ftINR(b)}</td><td>${ftINR(s)}</td><td>${ftINR(b - s)}</td><td>${ftPCTag(ftPC(s, b))}</td></tr>`; }).join("")}
        </table></div></div>`; }).join("") || `<div class="card"><div class="empty">No budget heads entered yet — the Accountant adds them in Budget heads.</div></div>`,
    monthly: () => `<div class="card"><h2>Month-wise fund flow</h2><div class="tablewrap"><table class="table">
      <tr><th>Month</th><th>Received</th><th>Spent</th><th>Cumulative balance</th></tr>
      ${Object.keys(months).sort().map(m => { run += months[m].r - months[m].s;
        return `<tr><td>${m}</td><td>${ftINR(months[m].r)}</td><td>${ftINR(months[m].s)}</td><td>${ftINR(run)}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty">Nothing yet</td></tr>`}</table></div></div>`,
    projects: () => `<div class="card"><h2>Projects (${(showClosed ? state.projects : activeProjects()).length})</h2><div class="tablewrap"><table class="table">
      <tr><th>Code</th><th>Project</th><th>Donor</th><th>Fund type</th><th>Restriction</th><th>Period</th><th>Sanctioned</th><th>Bank account</th><th>Coordinator</th></tr>
      ${activeProjects().map(p => `<tr><td><b>${esc(p.code || "")}</b></td><td>${esc(p.name)}</td><td class="small">${esc(p.donor || "")}</td><td>${esc(p.fundType || "")}</td>
        <td class="small">${esc(p.restriction || "")}</td><td class="small">${esc(p.start || "")} → ${esc(p.end || "")}</td><td>${ftINR(p.budget)}</td>
        <td class="small">${esc(p.bank || "")}</td><td class="small">${esc(userName(p.leadId) || "")}</td></tr>`).join("") || `<tr><td colspan="9" class="empty">No projects yet</td></tr>`}</table></div></div>`
  };
  html(`<div class="card"><div style="display:flex;gap:4px;flex-wrap:wrap">${TABS.map(([k, l]) => `<button class="btn small ${k === tab ? "" : "quiet"}" data-tt="${k}">${l}</button>`).join("")}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn small quiet" id="xl">Export the workbook</button>
        ${closedCount ? `<button class="btn small quiet" id="tclosed">${state.trackerClosed ? "Hide" : "Show"} ${closedCount} closed project${closedCount > 1 ? "s" : ""}</button>` : ""}
        ${isAccounts() ? `<button class="btn small quiet" onclick="go('ledgerDesk')">Entry desk</button><button class="btn small quiet" onclick="go('trackerImport')">Import a workbook</button>` : ""}</div></div>
    ${body[tab]()}`);
  if ($("tclosed")) $("tclosed").onclick = () => { state.trackerClosed = !state.trackerClosed; routes.tracker(tab); };
  $("content").querySelectorAll("[data-tt]").forEach(b => b.onclick = () => routes.tracker(b.dataset.tt));
  $("content").querySelectorAll("[data-mv]").forEach(b => b.onclick = async () => {
    const name = prompt("Book to which project?\n" + activeProjects().map(p => "· " + p.name).join("\n")); if (!name) return;
    const p = state.projects.find(x => x.name.toLowerCase().includes(name.toLowerCase())); if (!p) return toast("Not found");
    const head = prompt("Budget head code (optional):") || "";
    await db.collection("expenses").doc(b.dataset.mv).update({ projectId: p.id, head, fcra: p.fundType || "" });
    audit("allocate", "expenses", b.dataset.mv, p.name); toast("Booked"); routes.tracker("unalloc"); });
  $("xl").onclick = async () => {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(x => ({ Project: x.p.code || x.p.name, Donor: x.p.donor, "Fund type": x.p.fundType,
      "Sanctioned (INR)": x.san, "Received (INR)": x.rec, "Yet to receive (INR)": x.yet, "Spent (INR)": x.spent, "Balance in hand (INR)": x.bal,
      "% of received spent": x.pcRec / 100, "% of sanctioned spent": x.pcSan / 100 }))), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rec.map(r => ({ Date: r.date, Project: projectName(r.projectId), "Tranche / description": r.description,
      "Amount (INR)": r.amount, "Bank credited": r.bank, "Bank ref / advice no.": r.ref, FCRA: r.fcra, Remarks: r.remitter || r.remarks }))), "Receipts");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exp.filter(e => e.projectId).map(e => ({ Date: e.date, Project: projectName(e.projectId), Head: e.head,
      Particulars: e.particulars, Payee: e.payee, "Voucher no.": e.voucher, "Amount (INR)": e.amount, Mode: e.mode, Month: e.month, FCRA: e.fcra, "Bills filed (Y/N)": e.bills, Remarks: e.remarks }))), "Expenses");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unalloc.map(e => ({ Date: e.date, Particulars: e.particulars, Category: e.category, Payee: e.payee,
      "Voucher no.": e.voucher, "Amount (INR)": e.amount, Mode: e.mode, "Paid from": e.paidFrom, "Bills filed (Y/N)": e.bills, Status: e.status, "Likely project (if any)": e.likelyProject, Remarks: e.remarks }))), "Unallocated Expenses");
    (showClosed ? state.projects : activeProjects()).forEach(p => { const hs = heads.filter(h => h.projectId === p.id); if (!hs.length) return;
      const spentOn = code => exp.filter(e => e.projectId === p.id && e.head === code).reduce((a, e) => a + (Number(e.amount) || 0), 0);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hs.map(h => ({ Head: h.code, "Budget line": h.line, "Year 1 (INR)": h.y1, "Year 2 (INR)": h.y2,
        "Total budget (INR)": h.total, "Spent (INR)": spentOn(h.code), "Balance (INR)": (Number(h.total) || 0) - spentOn(h.code),
        "% used": ftPC(spentOn(h.code), Number(h.total) || 0) / 100 }))), (p.code || p.name).slice(0, 28)); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.keys(months).sort().map(m => ({ Month: m, "Total received": months[m].r, "Total spent": months[m].s }))), "Monthly");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(activeProjects().map(p => ({ Code: p.code, Project: p.name, Donor: p.donor, FCRA: p.fundType,
      Period: `${p.start || ""} – ${p.end || ""}`, "Sanctioned (INR)": p.budget, "Bank account": p.bank, Notes: p.objectives }))), "Projects");
    XLSX.writeFile(wb, `Empower_People_Fund_Tracker_${today()}.xlsx`);
  };
};

/* ---- The Accountant's entry desk: receipts, expenses, unallocated, petty cash in one place ---- */
routes.ledgerDesk = async () => {
  if (!isAccounts()) return html(`<div class="card"><div class="empty">The entry desk belongs to Accounts.</div></div>`);
  setTitle("Entry desk");
  const kind = state.deskKind || "expense";
  const g = (c, n) => db.collection(c).orderBy("createdAt", "desc").limit(n).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [lastE, lastR, lastP] = await Promise.all([g("expenses", 8), g("incomeReceipts", 5), g("pettyCash", 5)]);
  const heads = (await db.collection("budgetHeads").limit(500).get().catch(() => ({ docs: [] }))).docs.map(d => d.data());
  const headsFor = pid => heads.filter(h => h.projectId === pid);
  const KINDS = [["expense", "Expense against a project"], ["unallocated", "Unallocated payment"], ["receipt", "Money received"]];
  // Petty cash is recorded via Cash Box → "I spent" — not Entry desk
  const forms = {
    expense: `<div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field"><span>Office</span><select name="officeId"><option value="">— select office —</option>
        ${(state.offices||[]).map(o=>`<option value="${o.id}" ${o.id===state.me.officeId?"selected":""}>${esc(o.name)}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Budget head</span><select name="head" id="dh"></select></label>
        <label class="field"><span>Voucher no.</span><input name="voucher" placeholder="SAM/09/014"></label></div>
      <label class="field"><span>Particulars</span><input name="particulars" required></label>
      <div class="two"><label class="field"><span>Payee</span><input name="payee"></label>
        <label class="field"><span>Amount ₹</span><input type="number" step="any" inputmode="decimal" name="amount" required></label></div>
      <div class="two"><label class="field"><span>Mode</span><select name="mode">${["NEFT · FCRA utilisation (UBI)", "NEFT · Domestic (Kotak)", "NEFT · Domestic (IDFC)", "Cheque", "UPI", "Petty cash"].map(x => `<option>${x}</option>`).join("")}</select></label>
        <label class="field"><span>Bill — photo or scan</span><input type="file" id="_allocBill" accept="image/*,.pdf" capture="environment"><input type="hidden" name="billUrl" id="_allocBillUrl"><input type="hidden" name="bills" id="_allocBillsFlag" value="No"><span class="small muted" id="_allocBillStatus">Optional</span></label></div>
      <div class="two"><label class="field"><span>Is this support for a Sakhi? (Sakhi ID)</span><input name="personCode" placeholder="EP-OT/NO/HR-KA/2026-2090"></label>
        <label class="field"><span>What the support was for</span><input name="supportFor" placeholder="Hospital bill, school fees, travel home"></label></div>
      <p class="small muted">Give the Sakhi ID and this payment shows on her case profile as a benefit, with this voucher against it. Her name is not stored on the voucher — only the Sakhi ID.</p>
      <label class="field"><span>Remarks</span><input name="remarks"></label>`,
    unallocated: `<div class="two"><label class="field"><span>Date or period</span><input name="date" placeholder="2026-09-14 or April 2026 to August 2026" required></label>
        <label class="field"><span>Category</span><select name="category">${["Office rent", "Salaries (unfunded)", "Audit & legal", "Utilities", "Travel", "Office running", "Other"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
      <label class="field"><span>Particulars</span><input name="particulars" required></label>
      <div class="two"><label class="field"><span>Payee</span><input name="payee"></label><label class="field"><span>Amount ₹</span><input type="number" step="any" inputmode="decimal" name="amount" required></label></div>
      <div class="two"><label class="field"><span>Mode</span><select name="mode">${["Cheque", "NEFT", "UPI", "Cash"].map(x => `<option>${x}</option>`).join("")}</select></label>
        <label class="field"><span>Likely project (if any)</span><select name="likelyProject"><option value="">—</option>${activeProjects().map(p => `<option>${esc(p.code || p.name)}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Voucher no.</span><input name="voucher"></label><label class="field"><span>Bill — photo or scan</span><input type="file" id="_allocBill" accept="image/*,.pdf" capture="environment"><input type="hidden" name="billUrl" id="_allocBillUrl"><input type="hidden" name="bills" id="_allocBillsFlag" value="No"><span class="small muted" id="_allocBillStatus">Optional</span></label></div>`,
    receipt: `<div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field"><span>Project</span><select name="projectId" required>${activeProjects().map(p => `<option value="${p.id}">${esc(p.code || p.name)}</option>`).join("")}</select></label></div>
      <label class="field"><span>Tranche / description</span><input name="description" required placeholder="Tranche 1 – Year 1 (US$50,000)"></label>
      <div class="two"><label class="field"><span>Foreign amount, if the credit came from abroad</span>
          <div style="display:flex;gap:6px"><select name="foreignCurrency" style="max-width:88px"><option value="">—</option>${["USD", "EUR", "GBP", "CHF"].map(x => `<option>${x}</option>`).join("")}</select>
            <input type="number" step="any" inputmode="decimal" name="foreignAmount" placeholder="50000"></div></label>
        <label class="field"><span>Rate on the day (₹ per unit)</span><input type="number" step="any" inputmode="decimal" name="rate" placeholder="90.27"></label></div>
      <label class="field"><span>Amount credited ₹</span><input type="number" step="any" inputmode="decimal" name="amount" required></label>
      <div class="two"><label class="field"><span>Bank credited</span><input name="bank" placeholder="SBI A/c ••••2031, NDMB"></label>
        <label class="field"><span>Bank ref / FIRC</span><input name="ref"></label></div>
      <div class="two"><label class="field"><span>Donor's name, as it should read on the receipt</span><input name="remitter" required></label>
        <label class="field"><span>Received by</span><select name="mode">${["Bank transfer / NEFT", "Cheque", "Demand draft", "UPI", "Foreign remittance", "Cash"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Donor's address</span><input name="donorAddress"></label>
        <label class="field"><span>Donor's PAN (for 80G)</span><input name="donorPan"></label></div>
      <label class="field"><span>Towards</span><input name="purpose" placeholder="General donation, or towards the Coaching Centre"></label>`,
    petty: `<div class="two"><label class="field"><span>Office</span><select name="officeId">${state.offices.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label></div>
      <label class="field"><span>Particulars</span><input name="particulars" required></label>
      <div class="two"><label class="field"><span>Cash in ₹ (top-up)</span><input type="number" step="any" inputmode="decimal" name="inAmt"></label>
        <label class="field"><span>Cash out ₹</span><input type="number" step="any" inputmode="decimal" name="outAmt"></label></div>
      <div class="two"><label class="field"><span>Project</span><select name="projectId"><option value="">—</option>${activeProjects().map(p => `<option value="${p.id}">${esc(p.code || p.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Head</span><input name="head"></label></div>
      <label class="field"><span>Paid by</span><select name="mode"><option>Cash</option><option>UPI</option><option>Bank transfer / NEFT</option><option>Cheque</option></select></label>`
  };
  const advs = (await db.collection("advances").where("status", "==", "issued").limit(200).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() }));
  const days = r => r.neededBy ? Math.round((Date.now() - new Date(r.neededBy)) / 86400000) : 0;
  const unbooked = (await db.collection("benefits").limit(500).get().catch(() => ({ docs: [] }))).docs
    .map(d => ({ id: d.id, ...d.data() })).filter(b => Number(b.value) > 0 && !b.fromAccounts && !b.voucher);
  html(`${advs.length ? `<div class="card" ${advs.some(r => days(r) > 30) ? 'style="border-left:4px solid #C0392B"' : ""}>
      <h2>Advances not yet settled (${advs.length}) · ${ftINR(advs.reduce((a2, r) => a2 + (Number(r.amount) || 0), 0))}</h2>
      <div class="list">${advs.sort((x, y) => days(y) - days(x)).slice(0, 8).map(r => `<div class="item"><div class="grow">
        <div class="t">${esc(userName(r.uid))} · ${ftINR(r.amount)}</div>
        <div class="s">${esc(r.purpose || "")}${r.projectId ? " · " + esc(projectName(r.projectId)) : ""}${r.neededBy ? " · for " + fmtD(r.neededBy) : ""}</div></div>
        ${days(r) > 30 ? `<span class="tag bad">${days(r)} days</span>` : `<span class="tag warn">${days(r)} days</span>`}</div>`).join("")}</div>
      <button class="btn small quiet" style="margin-top:8px" onclick="go('advance')">Open advances</button></div>` : ""}
    ${unbooked.length ? `<div class="card"><h2>Benefits waiting to be booked (${unbooked.length})</h2>
      <p class="small muted">Programme staff recorded these as support given, with a value. Book the voucher so the books and the case notes agree.</p>
      <div class="list">${unbooked.slice(0, 8).map(b => `<div class="item"><div class="grow"><div class="t">${ftINR(b.value)} · ${esc(b.description || b.service || "")}</div>
        <div class="s">${fmtD(b.date)} · ${esc(projectName(b.projectId))} · recorded by ${esc(userName(b.recordedBy))}${b.personCode ? " · " + esc(b.personCode) : ""}</div></div></div>`).join("")}</div></div>` : ""}
    <div class="card"><h2>Entry desk</h2><p class="small muted">Everything the books need, entered from one screen. A voucher you prepare is approved by the Director – Finance, Administration &amp; Compliance (FP §3); you cannot approve your own.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${KINDS.map(([k, l]) => `<button class="btn small ${k === kind ? "" : "quiet"}" data-k="${k}">${l}</button>`).join("")}</div></div>
    <div class="card"><form id="df">${forms[kind]}<button class="btn" type="submit" style="margin-top:8px">Save and enter another</button>
      <div class="err" id="dErr"></div></form></div>
    <div class="card"><h2>Last entries</h2><div class="list">
      ${lastE.slice(0, 6).map(e => `<div class="item"><div class="grow"><div class="t">${esc(e.particulars || "")} · ${ftINR(e.amount)}</div>
        <div class="s">${fmtD(e.date)} · ${e.projectId ? esc(projectName(e.projectId)) : "unallocated"}${e.head ? " · " + esc(e.head) : ""}${e.voucher ? " · " + esc(e.voucher) : ""}</div></div>
        <span class="tag ${/approved|paid/.test(e.status || "") ? "ok" : "warn"}">${esc(e.status || "")}</span></div>`).join("")}
      ${lastR.slice(0, 3).map(r => `<div class="item"><div class="grow"><div class="t">Received ${ftINR(r.amount)} · ${esc(r.description || "")}</div>
        <div class="s">${fmtD(r.date)} · ${esc(projectName(r.projectId))}${r.ref ? " · " + esc(r.ref) : ""}</div></div><span class="tag ok">receipt</span></div>`).join("")}
      ${lastP.slice(0, 3).map(p => `<div class="item"><div class="grow"><div class="t">Petty cash ${ftINR(p.outAmt || p.inAmt)}</div><div class="s">${fmtD(p.date)} · ${esc(p.particulars || "")}</div></div><span class="tag">petty</span></div>`).join("")}
      ${!lastE.length && !lastR.length && !lastP.length ? `<div class="empty">Nothing entered yet</div>` : ""}</div>
      <button class="btn small quiet" style="margin-top:8px" onclick="go('tracker')">Open the Fund Tracker</button></div>`);
  $("content").querySelectorAll("[data-k]").forEach(b => b.onclick = () => { state.deskKind = b.dataset.k; routes.ledgerDesk(); });
  const fillHeads = () => { const sel = $("dh"); if (!sel) return; const pid = $("dp").value;
    sel.innerHTML = `<option value="">—</option>` + headsFor(pid).map(h => `<option value="${esc(h.code)}">${esc(h.code)} · ${esc(h.line)}</option>`).join(""); };
  if ($("dp")) { $("dp").onchange = fillHeads; fillHeads(); }
  $("df").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    ["amount", "inAmt", "outAmt"].forEach(k => { if (d[k] !== undefined) d[k] = d[k] === "" ? null : Number(d[k]); });
    try {
      if (kind === "receipt") { d.fcra = (state.projects.find(p => p.id === d.projectId) || {}).fundType || "";
        d.foreignAmount = d.foreignAmount ? Number(d.foreignAmount) : null;
        d.rate = d.rate ? Number(d.rate) : null;
        if (!d.amount && d.foreignAmount && d.rate) d.amount = Math.round(d.foreignAmount * d.rate);
        if (d.foreignAmount && d.foreignCurrency) d.foreign = `${d.foreignCurrency} ${Number(d.foreignAmount).toLocaleString("en-IN")}${d.rate ? ` at ₹${d.rate}` : ""}`;
        const y = fyOfDate(d.date); const seq = await nextCode("RCPT-" + y);
        d.receiptNo = `EP/${y}/${String(seq.split("-").pop()).padStart(5, "0")}`;
        const _rcRef = await db.collection("incomeReceipts").add({ ...d, createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        if (confirm(`Receipt ${d.receiptNo} saved. Print the donation receipt now?`)) printDonationReceipt({...d, id: _rcRef.id}); }

      else if (kind === "petty") {
        if (!d.inAmt && !d.outAmt) throw new Error("Enter either Cash in or Cash out.");
        d.by = state.user.uid; d.status = "accepted"; d.accepted = true; d.acceptedBy = state.user.uid; d.month = String(d.date || "").slice(0, 7);
        await db.collection("pettyCash").add({ ...d, createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        audit("petty_entry", "pettyCash", null, `${d.inAmt ? "in ₹" + d.inAmt : "out ₹" + d.outAmt} · ${d.particulars}`);
        toast("Petty cash entry saved"); routes.ledgerDesk(); return;
      } else { const preparerOnly = has("accountant") && !has("super_admin", "director_acf");
        d.status = preparerOnly ? "prepared — awaiting Director FAC" : (d.amount >= 50000 ? "needs EC approval" : d.amount >= 10000 ? "needs 2nd approver" : "approved");
        d.preparedBy = state.user.uid; d.month = String(d.date || "").slice(0, 7);
        if (kind === "unallocated") d.projectId = null;
        d.fcra = (state.projects.find(p => p.id === d.projectId) || {}).fundType || "";
        const ref = await db.collection("expenses").add({ ...d, createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        try{await downloadFilledForm("F-04","expenses",ref.id,d);}catch(_e4){console.warn("F-04 failed",_e4);}
  // a payment made for a named case also becomes a benefit on her profile
        if (d.personCode) {
          const m = await db.collection("persons").where("code", "==", String(d.personCode).trim()).limit(1).get().catch(() => ({ empty: true }));
          if (m.empty) { $("dErr").textContent = "Saved, but no case matches " + d.personCode + " — the benefit was not added to any profile."; }
          else { const pid = m.docs[0].id;
            await db.collection("benefits").add({ personId: pid, personCode: d.personCode, date: d.date, service: "Financial / material",
              description: d.supportFor || d.particulars, value: d.amount, projectId: d.projectId || null, voucher: d.voucher || "",
              fromAccounts: true, expenseId: ref.id, recordedBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            await db.collection("persons").doc(pid).update({ lastUpdateAt: d.date || today() }).catch(() => {});
            toast("Saved, and added to the case profile"); }
        } }
      audit("create", kind, null, d.particulars || d.description || ""); toast("Saved"); routes.ledgerDesk();
    } catch (err) { $("dErr").textContent = err.message; } };
};

/* ---- Import an existing Fund Tracker workbook ---- */
routes.trackerImport = async () => {
  if (!isAccounts()) return html(`<div class="card"><div class="empty">Importing the tracker belongs to Accounts.</div></div>`);
  setTitle("Import a Fund Tracker workbook");
  html(`<div class="card"><h2>Import the workbook</h2>
    <p class="small muted">Upload the Fund Tracker and the app reads the sheets it recognises — Projects, Receipts, Expenses, Unallocated Expenses, and a budget-head sheet for each project. Nothing is saved until you press Import, and rows already in the app are skipped.</p>
    <input type="file" id="wb" accept=".xlsx,.xls"><div id="wbOut"></div><div class="err" id="wbErr"></div></div>`);
  $("wb").onchange = async () => { const f = $("wb").files[0]; if (!f) return; $("wbErr").textContent = "";
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "", range: 2 }) : [];
    const projects = sheet("Projects"), receipts = sheet("Receipts"), expenses = sheet("Expenses"), unalloc = sheet("Unallocated Expenses");
    const headSheets = wb.SheetNames.filter(n => !["Summary", "Receipts", "Expenses", "Unallocated Expenses", "Monthly", "Projects"].includes(n));
    $("wbOut").innerHTML = `<div class="tablewrap" style="margin-top:10px"><table class="table"><tr><th>Sheet</th><th>Rows found</th></tr>
        <tr><td>Projects</td><td>${projects.length}</td></tr><tr><td>Receipts</td><td>${receipts.length}</td></tr>
        <tr><td>Expenses</td><td>${expenses.length}</td></tr><tr><td>Unallocated Expenses</td><td>${unalloc.length}</td></tr>
        <tr><td>Budget heads</td><td>${headSheets.join(", ") || "none"}</td></tr></table></div>
      <button class="btn" id="go" style="margin-top:10px">Import</button>`;
    $("go").onclick = async () => { $("go").disabled = true; $("go").textContent = "Importing…";
      const d2s = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || "");
      const num = v => { const n = Number(String(v).replace(/[^0-9.-]/g, "")); return isNaN(n) ? null : n; };
      let n = { projects: 0, heads: 0, receipts: 0, expenses: 0, unalloc: 0 };
      const codeToId = {};
      state.projects.forEach(p => { if (p.code) codeToId[String(p.code).trim().toUpperCase()] = p.id; codeToId[String(p.name).trim().toUpperCase()] = p.id; });
      for (const r of projects) { const code = String(r.Code || "").trim(); if (!code) continue;
        if (codeToId[code.toUpperCase()]) { n.projects++; continue; }
        const ref = await db.collection("projects").add({ code, name: r.Project || code, donor: r.Donor || "", fundType: r.FCRA || "",
          budget: num(r["Sanctioned (INR)"]) || 0, bank: r["Bank account"] || "", objectives: r.Notes || "", status: "active", createdBy: state.user.uid });
        codeToId[code.toUpperCase()] = ref.id; n.projects++; }
      await loadMasters();
      for (const name of headSheets) { const rowsH = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "", range: 3 });
        const pid = codeToId[name.trim().toUpperCase()]; if (!pid) continue;
        const b = db.batch();
        rowsH.forEach(h => { const code = String(h.Head || "").trim(); const line = h["Budget line"] || "";
          if (!code || !line) return;
          b.set(db.collection("budgetHeads").doc(), { projectId: pid, code, line, y1: num(h["Year 1 (INR)"]), y2: num(h["Year 2 (INR)"]),
            total: num(h["Total budget (INR)"]) || num(h["Budget (INR)"]), importedFrom: f.name, createdBy: state.user.uid }); n.heads++; });
        await b.commit(); }
      const chunk = async (rows, make) => { for (let i = 0; i < rows.length; i += 400) { const b = db.batch();
        rows.slice(i, i + 400).forEach(r => { const doc = make(r); if (doc) b.set(db.collection(doc._c).doc(), (delete doc._c, doc)); }); await b.commit(); } };
      await chunk(receipts, r => { const amt = num(r["Amount (INR)"]); if (!amt) return null; n.receipts++;
        return { _c: "incomeReceipts", date: d2s(r.Date), projectId: codeToId[String(r.Project || "").trim().toUpperCase()] || null,
          description: r["Tranche / description"] || "", amount: amt, bank: r["Bank credited"] || "", ref: r["Bank ref / advice no."] || "",
          fcra: r.FCRA || "", remitter: r.Remarks || "", importedFrom: f.name, createdBy: state.user.uid }; });
      await chunk(expenses, e => { const amt = num(e["Amount (INR)"]); if (!amt) return null; n.expenses++;
        return { _c: "expenses", date: d2s(e.Date), projectId: codeToId[String(e.Project || "").trim().toUpperCase()] || null, head: String(e.Head || ""),
          particulars: e.Particulars || "", payee: e.Payee || "", voucher: e["Voucher no."] || "", amount: amt, mode: e.Mode || "",
          month: String(e.Month || d2s(e.Date)).slice(0, 7), fcra: e.FCRA || "", bills: e["Bills filed (Y/N)"] || "", remarks: e.Remarks || "",
          status: "approved", importedFrom: f.name, createdBy: state.user.uid }; });
      await chunk(unalloc, e => { const amt = num(e["Amount (INR)"]); if (!amt) return null; n.unalloc++;
        return { _c: "expenses", date: d2s(e.Date), projectId: null, particulars: e.Particulars || "", category: e.Category || "", payee: e.Payee || "",
          voucher: e["Voucher no."] || "", amount: amt, mode: e.Mode || "", paidFrom: e["Paid from"] || "", bills: e["Bills filed (Y/N)"] || "",
          likelyProject: e["Likely project (if any)"] || "", remarks: e.Remarks || "", status: "approved", importedFrom: f.name, createdBy: state.user.uid }; });
      audit("import", "fundTracker", null, `${f.name} · ${JSON.stringify(n)}`);
      await loadMasters();
      $("wbOut").innerHTML += `<p class="small" style="color:var(--green);margin-top:8px">Imported — ${n.projects} projects, ${n.heads} budget heads, ${n.receipts} receipts, ${n.expenses} expenses, ${n.unalloc} unallocated. Open the Fund Tracker to check before entering anything new.</p>`;
      $("go").textContent = "Imported"; }; };
};

async function nextAssetSerial() {
  const ref = db.collection("counters").doc("assets");
  return db.runTransaction(async tx => { const s = await tx.get(ref); const n = (s.exists ? s.data().n : 0) + 1; tx.set(ref, { n }); return n; });
}
async function qrDataUrl(text, size) {
  const px = size || 150;
  if (!window.QRCode) {
    try { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"); }
    catch { return ""; }
  }
  if (!window.QRCode) return "";
  // the element must be in the page, or some browsers never draw it
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:-9999px;top:0;width:" + px + "px;height:" + px + "px";
  document.body.appendChild(box);
  try {
    new QRCode(box, { text, width: px, height: px, correctLevel: QRCode.CorrectLevel.M });
    for (let i = 0; i < 40; i++) {                       // wait until it has actually drawn
      const img = box.querySelector("img"), cv = box.querySelector("canvas");
      if (img && img.src && img.src.length > 100) return img.src;
      if (cv) { try { const d = cv.toDataURL("image/png"); if (d.length > 100) return d; } catch {} }
      await new Promise(r => setTimeout(r, 50));
    }
    return "";
  } finally { box.remove(); }
}
const assetUrl = id => `${location.origin}${location.pathname}#asset=${id}`;

/* ---- one asset, as the QR opens it ---- */
routes.asset = async (id) => {
  id = id || state.assetId; state.assetId = id;
  const _navId = id; // capture to detect stale renders
  html(`<div class="card"><div class="empty">Loading asset…</div></div>`);
  const snap = await db.collection("assets").doc(id).get().catch(() => null);
  if (state.assetId !== _navId || state.route !== "asset") return; // navigated away
  if (!snap || !snap.exists) return html(`<div class="card"><div class="empty">No asset with that code. It may have been written off.</div><button class="btn small quiet" onclick="go('assets')">All assets</button></div>`);
  const a = { id, ...snap.data() };
  if (state.assetId !== _navId || state.route !== "asset") return; // navigated away
  setTitle(a.tag || "Asset");
  const canEdit = has("super_admin", "director_acf", "procurement", "admin");
  const line = (l, v) => v ? `<tr><td class="small muted" style="width:44%">${l}</td><td>${esc(v)}</td></tr>` : "";
  html(`<div class="card"><div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
      <div id="assetQrBox" style="width:120px;height:120px;border:1px solid var(--line);border-radius:8px;padding:4px;background:#fff;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:10px">QR…</div>
      ${a.photo ? `<img src="${esc(driveImg(a.photo))}" alt="photo" style="width:120px;height:120px;border-radius:8px;object-fit:cover;border:1px solid var(--line)">` : `<div style="width:120px;height:120px;border-radius:8px;border:1px dashed var(--line);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;text-align:center">No photo<br>yet</div>`}
      <div style="flex:1;min-width:220px"><h2 style="margin:0">${esc(a.item)}</h2>
        <p style="font-family:monospace;font-size:15px;margin:4px 0"><b>${esc(a.tag || "")}</b></p>
        <p style="margin:4px 0">${a.fundSource ? `<span class="tag ${/FCRA/.test(a.fundSource) && !/Non/.test(a.fundSource) ? "warn" : ""}">${esc(a.fundSource)}</span>` : ""}
          ${a.projectId ? `<span class="tag">${esc(projectName(a.projectId))}</span>` : `<span class="tag">Organisation</span>`}
          ${a.capitalise ? `<span class="tag">capitalised</span>` : ""}
          <span class="tag ${a.condition === "Written off" ? "bad" : a.condition === "Needs repair" ? "warn" : "ok"}">${esc(a.condition || "Good")}</span></p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" id="lbl">Print label</button>${canEdit ? `<button class="btn small quiet" id="seen">Mark verified today</button>` : ""}<button class="btn small quiet" onclick="go('assets')">All assets</button></div></div>
    ${a.invoice && /^data:image/.test(a.invoice) ? `<div class="card"><img src="${a.invoice}" style="max-width:100%;border-radius:8px"></div>` : ""}
    <div class="card"><h2>Details</h2><table class="table">
      ${line("Category", a.category)}${line("Quantity", a.qty)}${line("Cost per unit", a.cost ? ftINR(a.cost) : "")}
      ${line("How it came", a.fundSource)}${line("Donor", a.fundSource === "Donated in kind" ? (a.donor || a.donorCode) : (state.projects.find(p => p.id === a.projectId) || {}).donor)}
      ${line("Project", projectName(a.projectId))}${line("Financial year", fyOfDate(a.boughtOn))}${line("Bought / received on", a.boughtOn ? fmtD(a.boughtOn) : "")}
      ${line("Asset type", a.assetType)}${line("Capitalised (FP §8, ≥ ₹5,000)", a.capitalise ? "Yes" : "No")}
      ${line("Office", officeName(a.officeId))}${line("Issued to", userName(a.assignedTo))}
      ${line("Condition", a.condition)}${line("Notes", a.notes)}
      ${line("Last verified", a.verifiedAt ? `${fmtD(a.verifiedAt)} by ${userName(a.verifiedBy) || ""}` : "never")}</table></div>

${(a.files||[]).length ? '<div class="card"><h2>Documents</h2><div class="list">' + (a.files||[]).map(function(f){return '<div class="item"><div class="grow"><div class="t">'+esc(f.name)+'</div><div class="s muted">'+esc(f.at||"")+'</div></div><a class="btn small quiet" href="'+esc(f.url||f.link||"#")+'" target="_blank" rel="noopener">Open</a></div>';}).join("") + '</div></div>' : ""}
${has("super_admin","admin","accounts","procurement","director_acf") ? '<div class="card"><h2>Attach photo or document</h2><label class="field"><span>File</span><input type="file" id="_assetFile" accept="image/*,.pdf" capture="environment"></label><p class="small muted">Photo replaces the current image &middot; PDF or other document added to the list</p></div>' : ""}
    ${(a.history || []).length ? `<div class="card"><h2>History</h2><div class="list">${(a.history || []).slice().reverse().map(h => `<div class="item"><div class="grow"><div class="t">${esc(h.what)}</div><div class="s">${esc(h.at)} · ${esc(userName(h.by) || "")}</div></div></div>`).join("")}</div></div>` : ""}`);
  // Fill QR code async — don't block screen render
  qrDataUrl(assetUrl(id), 140).then(qr => {
    const box = document.getElementById("assetQrBox");
    if (box && qr) box.innerHTML = `<img src="${qr}" alt="" style="width:100%;height:100%;object-fit:contain">`;
  }).catch(()=>{});
  $("lbl").onclick = () => printLabels([a]);
  if ($("seen")) $("seen").onclick = async () => {
    await db.collection("assets").doc(id).update({ verifiedAt: today(), verifiedBy: state.user.uid,
      history: [...(a.history || []), { what: "Verified in place", at: today(), by: state.user.uid }] });
    audit("verify", "assets", id, a.tag || ""); toast("Marked verified"); routes.asset(id); };
  // Asset file upload handler
  var _af = document.getElementById("_assetFile");
  if(_af) _af.onchange = async function(){
    var f=this.files[0]; if(!f) return;
    toast("Uploading…");
    try{
      var r=await uploadToDrive(f,"admin",f.name);
      if(!r||!r.link) throw new Error("no link returned");
      if(f.type.startsWith("image/")){
        // Use direct image URL if available, otherwise convert Drive view link to uc?export=view
        var photoUrl = r.imageUrl || r.url || (r.link&&r.link.includes('drive.google.com/file/d/')
          ? 'https://drive.google.com/uc?export=view&id='+r.link.match(/\/d\/([^/]+)/)?.[1]
          : r.link);
        await db.collection("assets").doc(id).update({photo:photoUrl});
        toast("Photo saved"); routes.asset(id);
      } else {
        var files=[...(a.files||[]),{name:r.name,url:r.link,at:today()}];
        await db.collection("assets").doc(id).update({files});
        toast("Document attached"); routes.asset(id);
      }
    } catch(err){toast("Upload failed: "+err.message);}
  };
};

/* ---- printable labels ---- */
async function printLabels(list) {
  if (!list.length) { toast("Nothing to print"); return; }
  toast("Generating " + list.length + " label" + (list.length > 1 ? "s" : "") + "\u2026");
  // Generate QR codes in batches of 10 to avoid freezing the renderer
  const qrs = [];
  for (let i = 0; i < list.length; i += 10) {
    const batch = await Promise.all(list.slice(i, i + 10).map(a => qrDataUrl(assetUrl(a.id), 120).catch(() => "")));
    qrs.push(...batch);
    await new Promise(r => setTimeout(r, 0));
  }
  const cells = list.map((a, i) => `<div class="lbl">
      <img src="${qrs[i]}" alt="">
      ${a.photo ? `<img src="${esc(driveImg(a.photo))}" alt="" style="width:21mm;height:21mm;object-fit:cover;border-radius:2mm;border:1px solid #ddd">` : ""}
      <div class="txt"><div class="tag">${esc(a.tag || "")}</div>
        <div class="itm">${esc(String(a.item || "").slice(0, 34))}</div>
        <div class="sub">${esc(officeName(a.officeId) || "")}${a.projectId ? " \u00b7 " + esc((state.projects.find(p => p.id === a.projectId) || {}).code || "") : ""}</div>
        ${/under an FCRA/.test(a.fundSource || "") ? `<div class="fc">Purchased under FCRA</div>` : a.fundSource === "Donated in kind" ? `<div class="fc">Donated in kind</div>` : ""}
        <div class="own">Property of Empower People</div></div></div>`).join("");
  const w = window.open("", "_blank");
  if (!w) { toast("Popups are blocked \u2014 please allow popups for this site and try again."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Asset labels</title><style>
    @page { size: A4; margin: 10mm }
    body { font-family: system-ui, sans-serif; margin: 0 }
    .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm }
    .lbl { display: flex; gap: 3mm; align-items: center; border: 1px dashed #aaa; border-radius: 3mm; padding: 3mm; height: 26mm; box-sizing: border-box; page-break-inside: avoid }
    .lbl img { width: 21mm; height: 21mm }
    .txt { min-width: 0 }
    .tag { font-family: ui-monospace, monospace; font-weight: 700; font-size: 10pt; letter-spacing: .2px }
    .itm { font-size: 8.5pt; margin-top: .5mm }
    .sub { font-size: 7pt; color: #555 }
    .fc  { font-size: 6.5pt; color: #8a5a00; margin-top: .5mm }
    .own { font-size: 6pt; color: #777; margin-top: .8mm }
    .note { font-size: 8pt; color: #666; margin: 0 0 3mm }
    @media print { .note { display: none } }
  </style></head><body>
    <p class="note">${list.length} label(s). Print at 100% \u2014 do not scale. Cut along the dashed lines.</p>
    <div class="sheet">${cells}</div>
    <script>window.onload = () => setTimeout(() => window.print(), 400)<\/script></body></html>`);
  w.document.close();
}

/* ---- the asset round: scan or type a code and tick it as seen ---- */
routes.assetVerify = async () => {
  if (!has("super_admin", "director_acf", "procurement", "admin")) return html(`<div class="card"><div class="empty">The asset round belongs to Procurement and Administration.</div></div>`);
  setTitle("Asset verification round");
  const all = (await db.collection("assets").limit(1000).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const fy = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const seen = all.filter(a => (a.verifiedAt || "") >= fy);
  const notSeen = all.filter(a => (a.verifiedAt || "") < fy);
  html(`<div class="grid">
      <div class="card stat"><span class="muted small">Assets on the register</span><b>${all.length}</b></div>
      <div class="card stat"><span class="muted small">Verified this financial year</span><b>${seen.length}</b></div>
      <div class="card stat"><span class="muted small">Still to check</span><b>${notSeen.length}</b></div>
      <div class="card stat"><span class="muted small">FCRA assets</span><b>${all.filter(a => /under an FCRA/.test(a.fundSource || "")).length}</b></div></div>
    <div class="card"><h2>Walk round and tick them off</h2>
      <p class="small muted">Scan a sticker with the phone camera and it opens that asset; or type the code here and press enter.</p>
      <label class="field"><span>Asset code or product name</span><input id="code" placeholder="EP/F/LAP/SAM/0007 or laptop, projector…" autocomplete="off"></label>
      <div id="found"></div></div>
    <div class="card"><h2 class="unseen-count">Still to check (${notSeen.length})</h2>
      <p class="small muted" style="margin-bottom:6px">Tap <b>Seen</b> next to each asset after physically checking it. The row disappears when done.</p>
      <div class="tablewrap"><table class="table" id="unseenTable">
      <tr><th>Code</th><th>Item</th><th>Office</th><th>Issued to</th><th>Last seen</th><th></th></tr>
      ${notSeen.slice(0, 20).map(a => `<tr><td style="font-family:monospace;font-size:11px">${esc(a.tag || "")}</td><td>${esc(a.item)}</td><td>${esc(officeName(a.officeId))}</td>
        <td>${esc(userName(a.assignedTo) || "")}</td><td>${a.verifiedAt ? fmtD(a.verifiedAt) : "never"}</td>
        <td><button class="btn small" data-seen="${a.id}">Seen</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">All verified</td></tr>`}
      ${notSeen.length > 20 ? `<tr id="moreRow"><td colspan="6" style="text-align:center;padding:8px"><button class="btn small quiet" id="showMore">Show ${notSeen.length - 20} more</button></td></tr>` : ""}
      </table></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn small quiet" id="printAll">Print labels for all ${all.length}</button>
        <button class="btn small quiet" id="printMissing">Print labels for the ${notSeen.length} unchecked</button></div></div>`);
  const mark = async (a) => {
    try {
      await db.collection("assets").doc(a.id).update({ verifiedAt: today(), verifiedBy: state.user.uid,
        history: [...(a.history || []), { what: "Verified in place", at: today(), by: state.user.uid }] });
      audit("verify", "assets", a.id, a.tag || "");
      // Remove the row in-place — no full reload needed
      const row = $("content").querySelector(`[data-seen="${a.id}"]`)?.closest("tr");
      if (row) row.remove();
      // Update the counter
      const stillEl = $("content").querySelector("h2.unseen-count");
      if (stillEl) {
        const n = parseInt(stillEl.textContent.match(/\d+/)?.[0] || "0") - 1;
        stillEl.textContent = "Still to check (" + Math.max(0, n) + ")";
      }
      toast(a.item + " — verified ✓");
    } catch(e) {
      toast("Could not mark seen — " + (e.code === "permission-denied" ? "check with admin (permission denied)" : e.message));
      console.error("assetVerify mark failed:", e.code, e.message);
    }
  };
  $("content").querySelectorAll("[data-seen]").forEach(b => b.onclick = () => mark(all.find(x => x.id === b.dataset.seen)));
  $("code").onkeydown = e => { if (e.key !== "Enter") return;
    const q = e.target.value.trim().toUpperCase();
    const a = all.find(x => String(x.tag || "").toUpperCase() === q)
      || all.find(x => String(x.tag || "").toUpperCase().endsWith(q))
      || all.find(x => String(x.item || "").toUpperCase().includes(q));
    $("found").innerHTML = a ? `<div class="item"><div class="grow"><div class="t">${esc(a.item)}</div><div class="s">${esc(a.tag)} · ${esc(officeName(a.officeId))} · ${esc(a.fundSource || "")}</div></div>
        <button class="btn small" id="okSeen">Mark seen</button><button class="btn small quiet" id="openIt">Open</button></div>`
      : `<div class="empty">No asset with that code</div>`;
    if (a) { $("okSeen").onclick = () => mark(a); $("openIt").onclick = () => { state.assetId = a.id; go("asset"); }; } };
  $("printAll").onclick = () => printLabels(all);
  $("printMissing").onclick = () => printLabels(notSeen);
  if ($("showMore")) $("showMore").onclick = () => {
    const tbl = $("unseenTable");
    const moreRow = $("moreRow");
    notSeen.slice(20).forEach(a => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="font-family:monospace;font-size:11px">${esc(a.tag||"")}</td><td>${esc(a.item)}</td><td>${esc(officeName(a.officeId))}</td><td>${esc(userName(a.assignedTo)||"")}</td><td>${a.verifiedAt?fmtD(a.verifiedAt):"never"}</td><td><button class="btn small" data-seen="${a.id}">Seen</button></td>`;
      tr.querySelector("[data-seen]").onclick = () => mark(all.find(x => x.id === a.id));
      tbl.insertBefore(tr, moreRow);
    });
    moreRow.remove();
  };
};


/* ---- a numbered donation receipt, printable ---- */
const inWords = n => {
  n = Math.round(Number(n) || 0);
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
    "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = x => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  const three = x => (x >= 100 ? ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " and " : "") : "") + (x % 100 ? two(x % 100) : "");
  if (!n) return "Zero";
  const cr = Math.floor(n / 10000000), lk = Math.floor((n % 10000000) / 100000), th = Math.floor((n % 100000) / 1000), rest = n % 1000;
  return [cr ? two(cr) + " Crore" : "", lk ? two(lk) + " Lakh" : "", th ? two(th) + " Thousand" : "", rest ? three(rest) : ""]
    .filter(Boolean).join(" ") + " Rupees Only";
};
async function printDonationReceipt(r) {
  const proj = state.projects.find(p => p.id === r.projectId) || {};
  const fcra = /FCRA/.test(r.fcra || proj.fundType || "") && !/Non/.test(r.fcra || proj.fundType || "");
  // Pre-generate verify code so it appears on the printed receipt
  const _vCode = r.id && typeof makeVerifyCode === "function"
    ? await makeVerifyCode("F-05", "incomeReceipts", r.id).catch(() => "")
    : "";
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(typeof _fyReceiptNo==="function"?_fyReceiptNo({...r}):r.receiptNo||"")}</title>
  <link href="https://fonts.googleapis.com/css2?family=Mukta:wght@400;600;700&display=swap" rel="stylesheet"><style>
    @page { size: A5 landscape; margin: 10mm }
    body { font-family: Mukta, system-ui, sans-serif; color: #111; margin: 0; font-size: 11pt }
    .sheet { border: 2px solid #1F4D3A; border-radius: 4mm; padding: 6mm 8mm }
    .hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #1F4D3A; padding-bottom: 3mm }
    .org { font-size: 15pt; font-weight: 700; color: #1F4D3A; line-height: 1.1 }
    .sub { font-size: 7.5pt; color: #555; line-height: 1.45 }
    .ttl { text-align: center; font-weight: 700; letter-spacing: 1px; margin: 4mm 0 3mm; font-size: 12pt; color: #1F4D3A }
    table { width: 100%; border-collapse: collapse; font-size: 10pt }
    td { padding: 1.4mm 0; vertical-align: top }
    .k { color: #555; width: 34mm }
    .amt { font-size: 14pt; font-weight: 700; color: #1F4D3A }
    .words { font-style: italic; font-size: 9.5pt }
    .ft { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 8mm; font-size: 8.5pt; color: #444 }
    .sig { text-align: center; font-size: 9pt }
    .line { border-top: 1px solid #777; width: 46mm; margin-bottom: 1mm }
    .note { font-size: 7.5pt; color: #666; margin-top: 3mm; line-height: 1.5 }
  </style></head><body><div class="sheet">
    <div class="hd"><div><div class="org">EMPOWER PEOPLE</div>
      <div class="sub">Registered address: 5 Dreams Apartments, A-4 Abulfazal Enclave, Jamia Nagar, Delhi-110025 · post@empowerpeople.in · 011-40671714<br>
        Registered under the Societies Registration Act 1860, Delhi · PAN AABAE2016N<br>
        12A: AABAE2016N25DL01 · 80G: AABAE2016N25DLO2${fcra ? " · FCRA: 231661880" : ""}</div></div>
      <div style="text-align:right;font-size:9pt"><div><b>${esc(typeof _fyReceiptNo==="function"?_fyReceiptNo({...r}):r.receiptNo||"")}</b></div>
        <div>${esc(fmtD(r.date))}</div></div></div>
    <div style="text-align:right;font-size:8pt;color:#667">Form ${FORM_NUMS.receipt}</div>
    <div class="ttl">${fcra ? "FOREIGN CONTRIBUTION RECEIPT" : "DONATION RECEIPT"}</div>
    <table>
      <tr><td class="k">Received with thanks from</td><td><b>${esc(r.remitter || "—")}</b></td></tr>
      ${r.donorAddress ? `<tr><td class="k">Address</td><td>${esc(r.donorAddress)}</td></tr>` : ""}
      ${r.donorPan ? `<tr><td class="k">PAN</td><td>${esc(r.donorPan)}</td></tr>` : ""}
      <tr><td class="k">The sum of</td><td class="amt">₹${Number(r.amount || 0).toLocaleString("en-IN")}</td></tr>
      <tr><td class="k"></td><td class="words">${inWords(r.amount)}</td></tr>
      <tr><td class="k">Received by</td><td>${esc(r.mode || "Bank transfer")}${r.ref ? " · reference " + esc(r.ref) : ""}${r.bank ? " · credited to " + esc(r.bank) : ""}</td></tr>
      ${r.foreign ? `<tr><td class="k">Foreign amount</td><td>${esc(r.foreign)}${r.rate ? ` at ₹${esc(r.rate)}` : ""}</td></tr>` : ""}
      <tr><td class="k">Towards</td><td>${esc(r.purpose || r.description || "General donation")}${proj.name ? " — " + esc(proj.name) : ""}</td></tr>
    </table>
    <div class="ft"><div class="note">
      ${fcra ? "This contribution has been received in the designated FCRA account and will be used only for the purposes permitted under the Foreign Contribution (Regulation) Act, 2010." : "Donations to Empower People are exempt under section 80G of the Income Tax Act, 1961. Please quote your PAN to claim the deduction."}<br>
      This receipt is issued subject to realisation of the instrument where applicable.
      ${_vCode ? `<br><span style="font-family:monospace;font-size:7pt;color:#888">Verify at app.empowerpeople.in &nbsp;·&nbsp; Code: ${esc(_vCode)}</span>` : ""}</div>
      <div class="sig" style="text-align:center;font-size:9pt">
        <div style="display:flex;align-items:flex-end;gap:4px;justify-content:center">
          <img src="/stamp.png" alt="">
          ${(state.users.find(u => u.id === (r.createdBy || state.user.uid)) || {}).signature
            ? `<img src="${(state.users.find(u => u.id === (r.createdBy || state.user.uid)) || {}).signature}" style="height:13mm;display:block;margin:0 auto 1mm">`
            : `<div style="height:13mm;width:46mm;border:1px dashed #bbb;margin:0 auto 1mm"></div>`}
        </div>
        <div class="line"></div>Authorised signatory<br>${esc(userName(r.createdBy) || state.me.name)}<br>Empower People</div></div>
  </div><script>window.onload = () => setTimeout(() => window.print(), 400)<\/script></body></html>`);
  w.document.close();
}

/* ---- payment voucher ---- */
function signatureBlock(label, uid, dateStr) {
  const u = state.users.find(x => x.id === uid) || {};
  return `<div class="sig">
    ${u.signature ? `<img src="${u.signature}" alt="">` : `<div class="sigspace"></div>`}
    <div class="line"></div>
    <b>${esc(label)}</b><br>${esc(u.name || "—")}${u.postTitle ? `<br><span class="post">${esc(u.postTitle)}</span>` : ""}
    ${dateStr ? `<br><span class="post">${esc(fmtD(dateStr))}</span>` : ""}</div>`;
}
async function printVoucher(e) {
  const proj = state.projects.find(p => p.id === e.projectId) || {};
  const head = (await db.collection("budgetHeads").where("projectId", "==", e.projectId || "~").limit(200).get()
    .catch(() => ({ docs: [] }))).docs.map(d => d.data()).find(h => h.code === e.head);
  const fcra = /under an FCRA|^FCRA/.test(e.fcra || proj.fundType || "");
  const audit = [
    e.preparedBy ? `Prepared in the Empower People Office app by ${userName(e.preparedBy)}${e.date ? " on " + fmtD(e.date) : ""}.` : "",
    e.approvedBy ? `Approved by ${userName(e.approvedBy)}${e.approvedAt ? " on " + fmtD(e.approvedAt) : ""}.` : "",
    e.facApprovedBy ? `Countersigned by ${userName(e.facApprovedBy)}.` : ""
  ].filter(Boolean).join(" ");
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Voucher ${esc(e.voucher || "")}</title>
  <link href="https://fonts.googleapis.com/css2?family=Mukta:wght@400;600;700&display=swap" rel="stylesheet"><style>
    @page { size: A5 landscape; margin: 9mm }
    body { font-family: Mukta, system-ui, sans-serif; color: #111; margin: 0; font-size: 10.5pt }
    .sheet { border: 2px solid #1F4D3A; border-radius: 3mm; padding: 5mm 7mm }
    .hd { display: flex; justify-content: space-between; border-bottom: 1.5px solid #1F4D3A; padding-bottom: 2.5mm }
    .org { font-size: 14pt; font-weight: 700; color: #1F4D3A; line-height: 1.1 }
    .sub { font-size: 7pt; color: #555; line-height: 1.45 }
    .ttl { text-align: center; font-weight: 700; letter-spacing: 1px; margin: 3mm 0 2.5mm; font-size: 11.5pt; color: #1F4D3A }
    table.d { width: 100%; border-collapse: collapse; font-size: 9.5pt }
    table.d td { padding: 1.2mm 0; vertical-align: top } .k { color: #555; width: 30mm }
    .amt { font-size: 13pt; font-weight: 700; color: #1F4D3A }
    .words { font-style: italic; font-size: 9pt }
    .sigs { display: flex; justify-content: space-between; gap: 6mm; margin-top: 9mm }
    .sig { flex: 1; text-align: center; font-size: 8.5pt }
    .sig img { height: 13mm; display: block; margin: 0 auto 1mm }
    .sigspace { height: 13mm } .line { border-top: 1px solid #777; margin-bottom: 1mm }
    .post { color: #666; font-size: 7.5pt }
    .note { font-size: 7pt; color: #666; margin-top: 3mm; line-height: 1.5 }
  </style></head><body><div class="sheet">
    <div class="hd"><div><div class="org">EMPOWER PEOPLE</div>
      <div class="sub">Registered address: 5 Dreams Apartments, A-4 Abulfazal Enclave, Jamia Nagar, Delhi-110025 · post@empowerpeople.in · 011-40671714<br>
        PAN AABAE2016N${fcra ? " · FCRA 231661880" : ""}</div></div>
      <div style="text-align:right;font-size:9pt"><b>${esc(e.voucher || "—")}</b><br>${esc(fmtD(e.date))}</div></div>
    <div style="text-align:right;font-size:8pt;color:#667">Form ${FORM_NUMS.voucher}</div>
    <div class="ttl">${fcra ? "PAYMENT VOUCHER · FCRA" : "PAYMENT VOUCHER"}</div>
    <table class="d">
      <tr><td class="k">Paid to</td><td><b>${esc(e.payee || "—")}</b></td></tr>
      <tr><td class="k">Amount</td><td class="amt">₹${Number(e.amount || 0).toLocaleString("en-IN")}</td></tr>
      <tr><td class="k"></td><td class="words">${inWords(e.amount)}</td></tr>
      <tr><td class="k">On account of</td><td>${esc(e.particulars || "")}</td></tr>
      <tr><td class="k">Project</td><td>${esc(proj.name || "Unallocated")}${proj.donor ? " · " + esc(proj.donor) : ""}</td></tr>
      <tr><td class="k">Budget head</td><td>${esc(e.head || "—")}${head ? " · " + esc(head.line) : ""}</td></tr>
      <tr><td class="k">Paid by</td><td>${esc(paidByLine(e))}${e.ref && !/UTR|UPI/.test(paidByLine(e)) ? " · " + esc(e.ref) : ""}</td></tr>
      <tr><td class="k">Bills attached</td><td>${(e.files||[]).length ? e.files.map(f=>`<a href="${esc(f.url||f.link||"#")}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>`).join(" ") : ""}${e.billUrl?` <a href="${esc(e.billUrl)}" target="_blank" rel="noopener">📎 bill</a>`:""}${!(e.files||[]).length&&!e.billUrl?(e.bills==="Yes"?"Yes":"No"):""}${e.remarks ? " · " + esc(e.remarks) : ""}</td></tr>
    </table>
    <div class="sigs">
      ${signatureBlock("Prepared by", e.preparedBy || e.createdBy, e.date)}
      ${signatureBlock("Approved by", e.approvedBy || e.facApprovedBy, e.approvedAt)}
      <div class="sig"><div class="sigspace"></div><div class="line"></div><b>Received by</b><br>${esc(e.payee || "")}<br><span class="post">Signature &amp; date</span></div>
    </div>
    <div class="note">${e.ecApproval ? `Executive Committee approval: ${esc(e.ecApproval)}. ` : ""}${esc(audit)}${fcra ? " This payment was made from the FCRA utilisation account for purposes permitted under the Foreign Contribution (Regulation) Act, 2010." : ""}</div>
  </div><script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  w.document.close();
}

/* ================= THE OFFICE'S OWN FORMS =================
   Requisition, Reimbursement and the Monthly Account, printed in the
   shape the office already uses, filled from the record. */
function formHead(title, formNo) {
  return `${formNo ? `<div style="text-align:right;font-size:8.5pt;color:#667;margin-bottom:-4mm">Form ${esc(formNo)}</div>` : ""}
    <div class="hd">
    <div class="org">EMPOWER PEOPLE</div>
    <div class="sub">Registered address: 5 Dreams Apartments, A-4 Abulfazal Enclave, Jamia Nagar, Delhi-110025<br>
      www.empowerpeople.in · post@empowerpeople.in · 011-40671714</div></div>
    <div class="ttl">${title}</div>`;
}
function formSigs(prepared, verified, approved, preparedDate, verifiedDate, approvedDate) {
  return `<div class="sigs">
    ${signatureBlock("Approved by", approved, approvedDate)}
    ${signatureBlock("Verified by", verified, verifiedDate)}
    ${signatureBlock("Submitted by", prepared, preparedDate)}</div>`;
}
const FORM_CSS = `
  @page { size: A4; margin: 16mm }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 0; font-size: 11pt }
  .sheet { border: 1px solid #000; padding: 8mm 10mm }
  .hd { text-align: center; border-bottom: 2px solid #000; padding-bottom: 4mm; margin-bottom: 4mm }
  .org { font-size: 16pt; font-weight: 700; letter-spacing: .5px }
  .sub { font-size: 8pt; line-height: 1.6; margin-top: 1.5mm }
  .ttl { text-align: center; font-weight: 700; letter-spacing: 1.5px; margin: 5mm 0 5mm; font-size: 12pt;
         text-transform: uppercase; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 2mm 0 }
  .meta { display: flex; justify-content: space-between; font-size: 10pt; margin-bottom: 5mm;
          border-bottom: 0.5px solid #888; padding-bottom: 3mm }
  table.t { width: 100%; border-collapse: collapse; font-size: 10pt }
  table.t th, table.t td { border: 0.75px solid #000; padding: 1.8mm 2.5mm; text-align: left; vertical-align: top }
  table.t th { font-weight: 700; font-size: 9.5pt; border-bottom: 1.5px solid #000 }
  table.t td.n, table.t th.n { text-align: right; white-space: nowrap }
  .tot td { font-weight: 700; border-top: 1.5px solid #000 }
  .words { font-size: 10pt; font-style: italic; margin: 3mm 0 0 }
  .note { font-size: 8.5pt; color: #333; margin-top: 4mm; line-height: 1.6 }
  .sigs { display: flex; justify-content: space-between; gap: 8mm; margin-top: 16mm }
  .sig { flex: 1; text-align: center; font-size: 9pt }
  .sig img { height: 14mm; display: block; margin: 0 auto 1mm }
  .sigspace { height: 14mm } .line { border-top: 1px solid #000; margin-bottom: 1.5mm }
  .post { font-size: 8pt }
`
function openForm(title, inner) {
  const w = window.open("", "_blank");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Mukta:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${FORM_CSS}</style></head><body><div class="sheet">${inner}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`);
  w.document.close();
}

/* Requisition / advance form */
function printRequisitionForm(r) {
  const lines = String(r.items || r.item || "").split("\n").map(s => s.trim()).filter(Boolean);
  const rows = lines.length ? lines : [`${r.item || r.purpose || ""}${r.qty ? " × " + r.qty : ""}`];
  const total = Number(r.amount || r.estimate) || 0;
  openForm("Requisition form", `${formHead("REQUISITION FORM", FORM_NUMS.requisition)}
    <div class="meta"><div><b>Name:</b> ${esc(userName(r.uid))}</div><div><b>Date:</b> ${esc(fmtD(r.createdAt && r.createdAt.seconds ? new Date(r.createdAt.seconds * 1000).toISOString().slice(0, 10) : (r.neededBy || today())))}</div></div>
    <div class="meta"><div><b>Project:</b> ${esc(projectName(r.projectId) || "—")}</div><div><b>Needed by:</b> ${esc(fmtD(r.neededBy) || "—")}</div></div>
    <table class="t"><tr><th style="width:12mm">S. No.</th><th>Item name</th><th>Purpose</th><th class="n" style="width:28mm">Amount ₹</th></tr>
      ${rows.map((l, i) => { const parts = l.split("·").map(s => s.trim());
        return `<tr><td>${i + 1}</td><td>${esc(parts[0] || l)}</td><td>${esc(r.purpose || parts[2] || "")}</td><td class="n">${parts[3] ? esc(parts[3].replace(/[^\d.]/g, "")) : (rows.length === 1 ? total.toLocaleString("en-IN") : "")}</td></tr>`; }).join("")}
      ${Array.from({ length: Math.max(0, 6 - rows.length) }, (_, i) => `<tr><td>${rows.length + i + 1}</td><td></td><td></td><td class="n"></td></tr>`).join("")}
      <tr class="tot"><td colspan="3">TOTAL</td><td class="n">₹${total.toLocaleString("en-IN")}</td></tr></table>
    <p class="words"><b>Amount in words:</b> ${esc(inWords(total))}</p>
    <p class="note">An advance must be settled within 30 days of the period it was taken for; bills are to be submitted with the settlement (Financial Procedures §5B).</p>
    ${formSigs(r.uid, r.headApprovedBy || r.verifiedBy, r.facApprovedBy || r.approvedBy, null, r.headApprovedAt, r.facApprovedAt || r.approvedAt)}`);
}

/* Reimbursement / expense claim form */
function printReimbursementForm(c) {
  const lines = String(c.items || "").split("\n").map(s => s.trim()).filter(Boolean);
  const rows = lines.length ? lines.map(l => { const p = l.split("·").map(s => s.trim()); return { d: p[0], v: p[1] || "Y", a: Number(String(p[2] || "").replace(/[^\d.]/g, "")) || 0 }; })
    : [{ d: c.description || c.particulars || "", v: c.bills === "No" ? "N" : "Y", a: Number(c.amount) || 0 }];
  const total = rows.reduce((a, r) => a + r.a, 0) || Number(c.amount) || 0;
  openForm("Reimbursement form", `${formHead("REIMBURSEMENT FORM", FORM_NUMS.reimbursement)}
    <div class="meta"><div><b>Name:</b> ${esc(userName(c.uid))}</div><div><b>Date:</b> ${esc(fmtD(c.date || today()))}</div></div>
    <div class="meta"><div><b>Project:</b> ${esc(projectName(c.projectId) || "—")}</div><div><b>Paid by:</b> ${esc(c.payment || c.mode || "—")}</div></div>
    <table class="t"><tr><th style="width:12mm">S. No.</th><th>Description</th><th style="width:26mm">Voucher (Y/N)</th><th class="n" style="width:28mm">Amount ₹</th></tr>
      ${rows.map((r, i) => { const f = (c.files || [])[i];
        return `<tr><td>${i + 1}</td><td>${esc(r.d)}</td><td>${f ? "Y" : esc(r.v)}</td><td class="n">${r.a ? r.a.toLocaleString("en-IN") : ""}</td></tr>`; }).join("")}
      ${Array.from({ length: Math.max(0, 6 - rows.length) }, (_, i) => `<tr><td>${rows.length + i + 1}</td><td></td><td></td><td class="n"></td></tr>`).join("")}
      <tr class="tot"><td colspan="3">TOTAL</td><td class="n">₹${total.toLocaleString("en-IN")}</td></tr></table>
    <p class="words"><b>Amount in words:</b> ${esc(inWords(total))}</p>
    ${(c.files || []).length ? `<p class="note"><b>Bills attached (${(c.files || []).length}):</b> ${(c.files || []).map(f => esc(f.name)).join(" · ")}</p>` : ""}
    ${c.utr || c.upiId ? `<p class="note"><b>Paid:</b> ${esc(paidByLine(c))}</p>` : ""}
    <p class="note">* Amount claimed against particulars without a voucher is to be submitted later within 15 days of the claim.</p>
    ${formSigs(c.uid, c.verifiedBy, c.approvedBy, c.date, c.verifiedAt, c.approvedAt)}`);
}

/* Monthly account */
routes.monthlyAccount = async () => {
  if (!isAccounts() && !isActive()) return html(`<div class="card"><div class="empty">—</div></div>`);
  const m = state.monthFor || today().slice(0, 7);
  setTitle("Monthly account");
  const who = state.monthWho || viewUid();
  const staff = staffList();
  const rows = (await db.collection("expenses").where("month", "==", m).limit(400).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(r => isAccounts() ? (!state.monthWho || r.preparedBy === who || r.createdBy === who) : (r.preparedBy === state.user.uid || r.createdBy === state.user.uid));
  const petty = (await db.collection("pettyCash").where("date", ">=", m+"-01").where("date", "<=", m+"-31").limit(200).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !r.deleted && !r.voided && r.status !== "rejected" && (isAccounts() ? (!state.monthWho || r.by === who) : r.by === state.user.uid));
  const all = [...rows.map(r => ({ date: r.date, cat: r.head || r.category || "", to: r.payee || "", by: r.mode || "", amt: Number(r.amount) || 0, note: r.remarks || "", on: projectName(r.projectId) || "Unallocated", particulars: r.particulars, bill: r.billUrl||r.voucherUrl||r.receiptUrl||r.webViewLink||"", formUrl: r.form_F01_url||r.form_F02_url||r.form_F03_url||r.form_F04_url||r.form_F05_url||r.form_F06_url||r.form_F07_url||r.form_F08_url||r.form_F09_url||"", formHtmlKey: Object.keys(r).find(function(k){return /_html$/.test(k);})||"" })),
    ...petty.map(p => ({ date: p.date, cat: p.head || "Staff advance", to: p.particulars || "", by: p.mode || "Cash", amt: Number(p.outAmt) || 0, note: "", on: projectName(p.projectId) || "Office", particulars: p.particulars, bill: p.receiptDriveUrl||p.billUrl||"", formUrl: p.form_F05_url||"", formHtmlKey: p.form_F05_html?"form_F05_html":"" }))]
    .filter(r => r.amt).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const total = all.reduce((a, r) => a + r.amt, 0);
  html(`<div class="card"><h2>Monthly account</h2>
      <p class="small muted">The month's spending as the office form sets it out, ready to print and sign.</p>
      <div class="two"><label class="field"><span>Month</span><input type="month" id="mMonth" value="${m}"></label>
        ${isAccounts() ? `<label class="field"><span>Whose</span><select id="mWho"><option value="">Everyone</option>${staff.map(u => `<option value="${u.id}" ${u.id === state.monthWho ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>` : ""}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" id="mPrint">Print the form</button><button class="btn small quiet" id="mF03">↓ F-03</button></div></div>
    <div class="card"><h2>${all.length} entries · ${ftINR(total)}</h2><div class="tablewrap"><table class="table">
      <tr><th>Date</th><th>Category</th><th>Paid to</th><th>Paid by</th><th>Amount</th><th>On account of</th></tr>
      ${all.map(r => `<tr><td>${fmtD(r.date)}</td><td>${esc(r.cat)}</td><td>${esc(r.to || r.particulars || "")}</td><td>${esc(r.by)}</td>
        <td>${ftINR(r.amt)}</td><td>${esc(r.on)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Nothing recorded for this month</td></tr>`}</table></div></div>`);
  $("mMonth").onchange = e => { state.monthFor = e.target.value; routes.monthlyAccount(); };
  if ($("mWho")) $("mWho").onchange = e => { state.monthWho = e.target.value || null; routes.monthlyAccount(); };
  $("mF03").onclick = async () => {
    $("mF03").textContent="Generating…"; $("mF03").disabled=true;
    const name = state.monthWho ? userName(state.monthWho) : "All staff";
    const monthLabel = new Date(m+"-01").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
    await downloadFilledForm("F-03","monthlyExpenses",m+"-"+(state.monthWho||"all"),{
      month: monthLabel, officeName: officeName(state.me.officeId),
      fy: fyOfDate(m+"-01"), total, rows: all.map(r=>({date:r.date,desc:r.to||r.particulars||"",head:r.cat,amount:r.amt}))
    });
    $("mF03").textContent="↓ F-03"; $("mF03").disabled=false; };
  $("mPrint").onclick = () => {
    const name = state.monthWho ? userName(state.monthWho) : (isAccounts() ? "All staff" : state.me.name);
    openForm("Monthly account", `${formHead("MONTHLY ACCOUNT", FORM_NUMS.monthly)}
      <div class="meta"><div><b>Name:</b> ${esc(name)}</div><div><b>Month:</b> ${esc(new Date(m + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" }))}</div></div>
      <table class="t"><tr><th style="width:11mm">S. No.</th><th style="width:22mm">Date</th><th>Category</th><th>Paid to</th><th style="width:22mm">Paid by</th><th class="n" style="width:25mm">Amount ₹</th><th style="width:20mm">Evidence</th><th style="width:16mm">Evidence</th><th>Notes</th><th>On account of</th></tr>
        ${all.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(fmtD(r.date))}</td><td>${esc(r.cat)}</td><td>${esc(r.to || r.particulars || "")}</td>
          <td>${esc(r.by)}</td><td class="n">${r.amt.toLocaleString("en-IN")}</td><td>${esc(r.note)}</td><td>${esc(r.on)}</td><td>${(function(){var _b=r.bill?(typeof r.bill==='object'?(r.bill.link||r.bill.url||r.bill.webViewLink||''):String(r.bill||'')):'';var _v=r.voucherUrl||'';return _b?'<a href="'+esc(_b)+'" target="_blank" rel="noopener">📎 bill</a>':_v?'<a href="'+esc(_v)+'" target="_blank" rel="noopener">📄 rcpt</a>':'';})()} </td></tr>`).join("")}
        <tr class="tot"><td colspan="5">TOTAL</td><td class="n">₹${total.toLocaleString("en-IN")}</td><td colspan="2"></td></tr></table>
      <p class="words"><b>Amount in words:</b> ${esc(inWords(total))}</p>
      ${formSigs(state.monthWho || state.user.uid, null, null, today(), null, null)}`);
  };
};

/* ================= FORM NUMBERS ================= */
const FORM_NUMS = { requisition: "F-01", reimbursement: "F-02", monthly: "F-03",
  voucher: "F-04", receipt: "F-05", travel: "F-06", leave: "F-07", settlement: "F-08", monthlyReport: "F-09" };

/* ================= PAID BY — the reference changes with the method ================= */
const PAY_METHODS = {
  "NEFT / RTGS / IMPS": [["valueDate", "Date payment was made", "date"], ["utr", "UTR number", "AXISN52026101234567"], ["fromAccount", "Paid from which account", "SBI ••••2031 (FCRA)"]],
  "UPI": [["valueDate", "Date payment was made", "date"], ["upiId", "UPI transaction ID", "428716392054"], ["vpa", "Paid to (UPI ID)", "sharmaprinters@okaxis"], ["fromAccount", "Account linked", "Kotak ••••2785"]],
  "Cheque": [["chequeNo", "Cheque number", "004217"], ["chequeDate", "Cheque date", "date"], ["fromAccount", "Bank", "Bank of India ••••2272"], ["clearedOn", "Cleared on", "date"]],
  "Demand draft": [["valueDate", "Date payment was made", "date"], ["ddNo", "DD number", ""], ["fromAccount", "Bank", ""]],
  "Cash": [["valueDate", "Date payment was made", "date"], ["receivedBy", "Received by (name)", ""]],
  "Petty cash": [["valueDate", "Date payment was made", "date"], ["receivedBy", "Received by (name)", ""]]
};
/* A one-line description of how something was paid, for forms and lists. */
function paidByLine(r) {
  const m = r.mode || "";
  if (/UPI/i.test(m)) return `UPI${r.upiId ? " · " + r.upiId : ""}${r.vpa ? " · to " + r.vpa : ""}${r.valueDate ? " · " + fmtD(r.valueDate) : ""}`;
  if (/NEFT|RTGS|IMPS/i.test(m)) return `${m}${r.utr ? " · UTR " + r.utr : ""}${r.valueDate ? " · value date " + fmtD(r.valueDate) : ""}${r.fromAccount ? " · " + r.fromAccount : ""}`;
  if (/Cheque/i.test(m)) return `Cheque${r.chequeNo ? " no. " + r.chequeNo : ""}${r.chequeDate ? " dated " + fmtD(r.chequeDate) : ""}${r.fromAccount ? " · " + r.fromAccount : ""}${r.clearedOn ? " · cleared " + fmtD(r.clearedOn) : ""}`;
  if (/draft/i.test(m)) return `Demand draft${r.ddNo ? " no. " + r.ddNo : ""}${r.fromAccount ? " · " + r.fromAccount : ""}`;
  if (/Cash|Petty/i.test(m)) return `${m}${r.receivedBy ? " · received by " + r.receivedBy : ""}`;
  return m || "—";
}
/* Generic inline edit dialog — returns form field values or null on cancel. */
function askEdit(title, fieldsHtml) {
  return new Promise(resolve => {
    const box = document.createElement("div"); box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>${esc(title)}</h2>${fieldsHtml}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn small quiet" id="_editCancel">Cancel</button>
        <button class="btn small" id="_editSave">Save</button>
      </div></div>`;
    document.body.appendChild(box);
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#_editCancel").onclick = () => close(null);
    box.querySelector("#_editSave").onclick = () => {
      const out = {};
      box.querySelectorAll("[name]").forEach(i => out[i.name] = i.value);
      close(out);
    };
    box.onclick = e => { if (e.target === box) close(null); };
  });
}

/* Ask for the reference at the moment something is marked paid. */
function askPaymentRef(rec) {
  return new Promise(resolve => {
    const box = document.createElement("div"); box.className = "modal";
    const methods = Object.keys(PAY_METHODS);
    const start = methods.find(m => (rec.mode || "").toLowerCase().includes(m.split(" ")[0].toLowerCase())) || methods[0];
    const fieldsFor = m => PAY_METHODS[m].map(([k, l, ph]) =>
      `<label class="field"><span>${esc(l)}</span>${ph === "date"
        ? `<input type="date" name="${k}" value="${esc(rec[k] || today())}">`
        : `<input name="${k}" value="${esc(rec[k] || "")}" placeholder="${esc(ph)}">`}</label>`).join("");
    box.innerHTML = `<div class="modal-card"><h2>How was it paid?</h2>
      <p class="small muted">${esc(rec.particulars || rec.description || "")}${rec.amount ? " · ₹" + Number(rec.amount).toLocaleString("en-IN") : ""}${rec.payee ? " · " + esc(rec.payee) : ""}</p>
      <label class="field"><span>Paid by</span><select id="pmMode">${methods.map(m => `<option ${m === start ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      <div id="pmFields">${fieldsFor(start)}</div>
      <p class="small muted">The reference is what lets this be matched against the bank statement later. A UPI payment has a transaction ID, not a UTR.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="pmCancel">Cancel</button><button class="btn small" id="pmOk">Save</button></div></div>`;
    document.body.appendChild(box);
    const sel = box.querySelector("#pmMode");
    sel.onchange = () => { box.querySelector("#pmFields").innerHTML = fieldsFor(sel.value); };
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#pmCancel").onclick = () => close(null);
    box.querySelector("#pmOk").onclick = () => { const out = { mode: sel.value };
      box.querySelectorAll("#pmFields [name]").forEach(i => out[i.name] = i.value);
      close(out); };
    box.onclick = e => { if (e.target === box) close(null); };
  });
}




/* Advance settlement statement — what was drawn, what was spent, what comes back. */
function printSettlementForm(adv) {
  const advance = Number(adv.amount) || 0;
  const lines = (adv.settleItems || []).length ? adv.settleItems
    : String(adv.items || "").split("\n").map(s => s.trim()).filter(Boolean)
        .map(l => { const p = l.split("·").map(x => x.trim()); return { d: p[0] || l, a: 0, bill: "" }; });
  const rows = lines.length ? lines : [{ d: adv.purpose || "Expenditure against the advance", a: Number(adv.spent) || 0, bill: adv.bills || "" }];
  const spent = Number(adv.spent) || rows.reduce((x, r) => x + (Number(r.a) || 0), 0);
  const bal = advance - spent;
  const attached = (adv.files || []).length;
  openForm("Advance settlement", `${formHead("ADVANCE SETTLEMENT STATEMENT", FORM_NUMS.settlement)}
    <div class="meta"><div><b>Name:</b> ${esc(userName(adv.uid))}</div><div><b>Date of settlement:</b> ${esc(fmtD(adv.settledOn || today()))}</div></div>
    <div class="meta"><div><b>Project:</b> ${esc(projectName(adv.projectId) || "—")}</div><div><b>Advance taken for:</b> ${esc(adv.purpose || "—")}${adv.neededBy ? " · " + fmtD(adv.neededBy) : ""}</div></div>
    <table class="t"><tr><th style="width:12mm">S. No.</th><th>What the money was spent on</th><th style="width:26mm">Bill (Y/N)</th><th class="n" style="width:28mm">Amount ₹</th></tr>
      ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.d || "")}</td><td>${esc(r.bill || ((adv.files || [])[i] ? "Y" : (adv.bills === "Yes" ? "Y" : "N")))}</td>
        <td class="n">${r.a ? Number(r.a).toLocaleString("en-IN") : (rows.length === 1 ? spent.toLocaleString("en-IN") : "")}</td></tr>`).join("")}
      ${Array.from({ length: Math.max(0, 6 - rows.length) }, (_, i) => `<tr><td>${rows.length + i + 1}</td><td></td><td></td><td class="n"></td></tr>`).join("")}
      <tr class="tot"><td colspan="3">TOTAL SPENT</td><td class="n">₹${spent.toLocaleString("en-IN")}</td></tr></table>
    <table class="t" style="margin-top:4mm;width:92mm;margin-left:auto">
      <tr><td>Advance drawn</td><td class="n">₹${advance.toLocaleString("en-IN")}</td></tr>
      <tr><td>Less: spent</td><td class="n">₹${spent.toLocaleString("en-IN")}</td></tr>
      <tr class="tot"><td>${bal >= 0 ? "Balance returned to the office" : "To be reimbursed to the staff member"}</td>
        <td class="n">₹${Math.abs(bal).toLocaleString("en-IN")}</td></tr></table>
    <p class="words"><b>Amount in words (spent):</b> ${esc(inWords(spent))}</p>
    ${attached ? `<p class="note"><b>Bills attached (${attached}):</b> ${(adv.files || []).map(f => esc(f.name)).join(" · ")}</p>` : ""}
    ${adv.settleNote ? `<p class="note"><b>Note:</b> ${esc(adv.settleNote)}</p>` : ""}
    ${bal !== 0 ? `<p class="note"><b>${bal > 0 ? "Returned" : "Reimbursed"} by:</b> ${esc(paidByLine(adv.returnRef || {}))}</p>` : ""}
    <p class="note">Settled within 30 days of the period for which it was taken, as required by the Financial Procedures §5B.
      ${adv.settledBy ? `Recorded in the Empower People Office app by ${esc(userName(adv.settledBy))} on ${esc(fmtD(adv.settledOn))}.` : ""}</p>
    ${formSigs(adv.uid, adv.verifiedBy || adv.headApprovedBy, adv.facApprovedBy || adv.approvedBy, adv.settledOn, null, null)}`);
}

/* ================= MONEY IN HAND =================
   What a person is holding: advances issued to them, less what they have
   reported spending against each. Reporting an expense reduces it. */
async function advanceAccount(uid) {
  const advs = (await db.collection("advances").where("uid", "==", uid).limit(100).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(a => /issued|settled — to reimburse/.test(a.status || ""));
  if (!advs.length) return { advs: [], inHand: 0, lines: [] };
  const claims = (await db.collection("expenseClaims").where("uid", "==", uid).limit(300).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.advanceId && c.status !== "rejected");
  const lines = advs.map(a => {
    const against = claims.filter(c => c.advanceId === a.id);
    const reported = against.reduce((x, c) => x + (Number(c.amount) || 0), 0) + (Number(a.spentDirect) || 0);
    const drawn = Number(a.amount) || 0;
    return { a, drawn, reported, left: drawn - reported, against,
      days: a.neededBy ? Math.round((Date.now() - new Date(a.neededBy)) / 86400000) : 0 };
  });
  return { advs, lines, inHand: lines.reduce((x, l) => x + l.left, 0) };
}
/** The card shown on a profile and on the person's own home. */
function advanceCard(acc, uid) {
  if (!acc.lines.length) return "";
  const self = uid === state.user.uid;
  return `<div class="card" ${acc.lines.some(l => l.days > 30) ? 'style="border-left:4px solid #C0392B"' : ""}>
    <h2>Money in hand · ${ftINR(acc.inHand)}</h2>
    <p class="small muted">${self ? "Advances you are holding. Report what you spend and this comes down; settle when the work is done."
      : "Advances this person is holding."}</p>
    <div class="tablewrap"><table class="table">
      <tr><th>Taken for</th><th>Drawn</th><th>Reported</th><th>Still in hand</th><th>Age</th><th></th></tr>
      ${acc.lines.map(l => `<tr>
        <td>${esc(l.a.purpose || "")}<div class="s">${esc(projectName(l.a.projectId))}${l.a.neededBy ? " · " + fmtD(l.a.neededBy) : ""}</div></td>
        <td>${ftINR(l.drawn)}</td><td>${ftINR(l.reported)}${l.against.length ? `<div class="s">${l.against.length} claim(s)</div>` : ""}</td>
        <td><b>${ftINR(l.left)}</b></td>
        <td>${l.days > 30 ? `<span class="tag bad">${l.days} days</span>` : `<span class="tag warn">${l.days} days</span>`}</td>
        <td style="white-space:nowrap">${self ? `<button class="btn small" data-spend="${l.a.id}">Report spending</button>` : ""}
          ${l.left <= 0 && self ? `<button class="btn small quiet" data-settle="${l.a.id}">Settle</button>` : ""}</td></tr>`).join("")}
    </table></div>
    <p class="small muted" style="margin-top:6px">An advance must be settled within 30 days of the period it was taken for (Financial Procedures §5B).</p></div>`;
}
function wireAdvanceCard(acc) {
  $("content").querySelectorAll("[data-spend]").forEach(b => b.onclick = () => {
    state.spendAgainst = b.dataset.spend; go("expense");
  });
  $("content").querySelectorAll("[data-settle]").forEach(b => b.onclick = async () => {
    const advId = b.dataset.settle;
    const adv = await db.collection("advances").doc(advId).get().catch(()=>null);
    if (!adv||!adv.exists) return;
    const s = await askSettlement(adv.data()); if (!s) return;
    const spent = Number(s.spent)||0, ret = Number(s.returned)||0, drawn = Number(adv.data().amount)||0;
    await db.collection("advances").doc(advId).update({
      status: ret < 0 ? "settled — to reimburse" : "settled",
      spent, returned: ret, excess: Math.max(0, spent-drawn),
      settledOn: s.date||today(), settleItems: s.items||[], settleNote: s.note||"", bills: s.bills, settledBy: state.user.uid
    });
    audit("settle","advances",advId,"self settle");
    toast(ret >= 0 ? `Settled · ₹${Math.abs(ret).toLocaleString("en-IN")} returned` : `Settled · ₹${Math.abs(ret).toLocaleString("en-IN")} to reimburse`);
    go("advance");
  });
}

/* ================= THE PAYMENT PROCESS =================
   As set out in the Payment Process Organigram: six stages, three flows.
   The person who asks for a payment can never be the one who approves or pays it. */
const PAY_FLOWS = {
  /* Salary: Zainab prepares the input, then it goes straight to finance — there is no
     separate functional stage, because preparing the salary input is that stage. */
  salary:      { label: "Salary", raise: ["admin", "admin_assistant"], verify: null,
                 stage2Title: null, verifyNote: "Attendance, leave and HR changes" },
  /* Programme: the field team raises it, the Coordination Lead or Program Officer verifies. */
  programme:   { label: "Programme / activity", raise: ["program_lead", "field_staff", "program_coord", "program_officer"],
                 verify: ["program_coord", "program_officer"], stage2Title: "Functional verification",
                 verifyNote: "Programme relevance, plan and justification" },
  /* Procurement: the programme or admin team states the requirement; Procurement then does
     the buying — quotations and the vendor process. That is work, not verification;
     the verifying is Bhumish's at stage 3. */
  procurement: { label: "Procurement", raise: ["program_lead", "field_staff", "admin", "admin_assistant", "program_coord"],
                 verify: ["procurement"], stage2Title: "Procurement",
                 verifyNote: "Quotations, vendor process and procurement documentation" },
  other:       { label: "Other payment", raise: [], verify: ["admin", "program_coord"],
                 stage2Title: "Functional verification", verifyNote: "Completeness of the request" }
};
const PAY_STAGES = [
  { k: "requested", n: 1, title: "Request / prepare", who: "The person raising it",
    doing: "Raise the request and attach the papers", next: "verified_fn" },
  { k: "verified_fn", n: 2, title: "Functional verification", roleKey: "verify",
    doing: "Check it is in the plan, with budget and justification", next: "verified_fin" },
  { k: "verified_fin", n: 3, title: "Finance & compliance verification", roles: ["director_acf"],
    doing: "Budget availability, financial rules, procurement procedure, donor and statutory compliance", next: "prepared" },
  { k: "prepared", n: 4, title: "Payment preparation", roles: ["accountant", "director_acf"],
    doing: "Prepare the voucher, the accounting entries and the bank file", next: "authorised" },
  { k: "authorised", n: 5, title: "Final approval & bank authorisation", roles: ["super_admin"],
    doing: "Review, approve and authorise the bank payment — Executive Committee approval is obtained outside the app and recorded here", next: "paid" },
  { k: "paid", n: 6, title: "Payment & record closure", roles: ["accountant", "director_acf"],
    doing: "Record the payment, file the papers, update the registers", next: null }
];
const stageOf = r => PAY_STAGES.find(s => s.k === (r.payStage || "requested")) || PAY_STAGES[0];
/* The Director ACF may approve up to his limit; above it the Founder & General
   Secretary approves and authorises, having taken the Executive Committee's approval
   outside the app. Below the limit the voucher goes straight to payment. */
const GS_THRESHOLD = 50000;
const needsGS = r => (Number(r.amount) || 0) > GS_THRESHOLD;
/* A flow with no stage 2 goes from the request straight to finance. */
const nextStage = r => { const s = stageOf(r);
  if (s.k === "requested" && !flowOf(r).verify) return "verified_fin";
  if (s.k === "prepared" && !needsGS(r)) return "paid";          // under the limit, no stage 5
  return s.next; };
const flowOf = r => PAY_FLOWS[r.payFlow || "other"] || PAY_FLOWS.other;
/** May this person act on this payment at its current stage? */
function canActOn(r) {
  const s = stageOf(r);
  if (!s.next) return false;
  if (s.k === "verified_fn" && !flowOf(r).verify) return false;      // this flow has no stage 2
  if (s.k === "authorised" && !needsGS(r)) return false;             // under the limit, this stage does not apply
  const roles = s.roles || (s.roleKey ? flowOf(r)[s.roleKey] : []);
  const allowed = has("super_admin") || (roles || []).some(x => has(x));
  if (!allowed) return false;
  // Separation of duties (the organigram's first principle): the person who asked for a payment
  // cannot verify, prepare, authorise or record it — only raise it. Where the Director ACF
  // himself raised it, the approval belongs to the Founder & General Secretary.
  const raiser = r.uid || r.createdBy || r.by_requested;
  if (raiser === state.user.uid && s.k !== "requested") return false;
  if (s.k === "verified_fin" && r.raisedByDirector && !has("super_admin")) return false;
  if (s.k === "authorised" && r.preparedBy === state.user.uid && !has("super_admin")) return false;
  return true;
}
function payTrail(r) {
  const f = flowOf(r);
  return PAY_STAGES.filter(s => !(s.k === "verified_fn" && !f.verify) && !(s.k === "authorised" && !needsGS(r))).map(s => {
    const done = r["at_" + s.k], by = r["by_" + s.k];
    const here = (r.payStage || "requested") === s.k;
    const title = s.k === "verified_fn" ? (f.stage2Title || s.title) : s.title;
    return { ...s, title, done, by, here };
  });
}
routes.payments = async (tab) => {
  tab = tab || state.payTab || "mine"; state.payTab = tab;
  setTitle("Payments");
  const rows = (await db.collection("expenses").orderBy("createdAt", "desc").limit(300).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.payStage);
  const forMe = rows.filter(canActOn);
  const mine = rows.filter(r => (r.uid || r.createdBy) === state.user.uid);
  const open = rows.filter(r => stageOf(r).next);
  const list = tab === "forme" ? forMe : tab === "mine" ? mine : tab === "open" ? open : rows;
  const TABS = [["forme", `With me (${forMe.length})`], ["mine", `Mine (${mine.length})`],
    ...(isAccounts() || has("super_admin", "admin") ? [["open", `In progress (${open.length})`], ["all", "All"]] : [])];
  if (!isAccounts() && !has("super_admin", "admin") && (tab === "all" || tab === "open")) { tab = "forme"; state.payTab = tab; }
  html(`<div class="card"><h2>Payments</h2>
      <p class="small muted">Six stages, as the payment process sets them out. The person who asks for a payment is never the one who approves or pays it.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${TABS.map(([k, l]) => `<button class="btn small ${k === tab ? "" : "quiet"}" data-pyt="${k}">${l}</button>`).join("")}</div></div>
    ${list.map(r => { const s = stageOf(r), f = flowOf(r), act = canActOn(r);
      return `<div class="card" ${act ? 'style="border-left:4px solid #1C7A3E"' : ""}>
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div><div class="t" style="font-weight:700">${esc(r.particulars || "")} · ${ftINR(r.amount)}</div>
            <div class="s">${esc(f.label)} · ${esc(projectName(r.projectId) || "Unallocated")}${r.head ? " · " + esc(r.head) : ""} · asked by ${esc(userName(r.uid || r.createdBy))}</div></div>
          <div><span class="tag ${s.next ? "warn" : "ok"}">${s.n}. ${esc(s.k === "verified_fn" ? (f.stage2Title || s.title) : s.title)}</span></div></div>
        <div class="paytrail">${payTrail(r).map(t => `<div class="paystep ${t.done ? "done" : t.here ? "here" : ""}">
          <b>${t.n}</b><span>${esc(t.title)}</span>${t.done ? `<i>${esc(userName(t.by))} · ${fmtD(t.done)}</i>` : t.here ? `<i>waiting</i>` : ""}</div>`).join("")}</div>
        ${needsGS(r) ? `<p class="small" style="color:#8A5A00;margin:6px 0 0"><b>Above ₹${GS_THRESHOLD.toLocaleString("en-IN")}</b> — after the voucher is prepared this goes to the Founder &amp; General Secretary to approve and authorise.</p>` : ""}
        ${act ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          <button class="btn small" data-ok="${r.id}">${esc(s.n === 5 ? "Approve & authorise" : s.n === 6 ? "Record the payment" : s.n === 4 ? "Prepare the voucher"
            : s.n === 2 && f.stage2Title === "Procurement" ? "Procurement done" : "Verify")}</button>
          <button class="btn small quiet" data-back="${r.id}">Send back</button>
          <button class="btn small quiet" data-vch="${r.id}">Voucher F-04</button></div>
          <p class="small muted" style="margin-top:4px">${esc(s.doing)}${s.roleKey && f.verifyNote ? " — " + esc(f.verifyNote) : ""}</p>` : ""}
      </div>`; }).join("") || `<div class="card"><div class="empty">Nothing here</div></div>`}`);
  $("content").querySelectorAll("[data-pyt]").forEach(b => b.onclick = () => routes.payments(b.dataset.pyt));
  $("content").querySelectorAll("[data-vch]").forEach(b => b.onclick = () => printVoucher(rows.find(x => x.id === b.dataset.vch)));
  $("content").querySelectorAll("[data-ok]").forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === b.dataset.ok), s = stageOf(r);
    const patch = { payStage: nextStage(r), ["at_" + s.k]: today(), ["by_" + s.k]: state.user.uid };
    if (s.k === "prepared") { const v = prompt("Voucher number for this payment:", r.voucher || "") || r.voucher || ""; patch.voucher = v; patch.preparedBy = state.user.uid; }
    if (s.k === "authorised") {
      if (!confirm(`Authorise payment of ${ftINR(r.amount)} to ${r.payee || "the payee"}?`)) return;
      const ec = prompt(`This is above ₹${GS_THRESHOLD.toLocaleString("en-IN")}.\n\nIf the Executive Committee approved it, record the date and reference — it is kept on the voucher.\n(Leave blank if not applicable.)`) || "";
      patch.approvedBy = state.user.uid; patch.approvedAt = today(); if (ec) patch.ecApproval = ec;
    }
    if (s.k === "paid") { const p = await askPaymentRef(r); if (!p) return; Object.assign(patch, p, { paidOn: p.valueDate || today(), status: "paid" }); }
    await db.collection("expenses").doc(r.id).update(patch);
    audit("pay_stage", "expenses", r.id, s.title + " → " + (s.next || "closed"));
    toast(s.next === "paid" ? "Authorised — Accounts will record the payment" : "Done"); routes.payments(tab);
  });
  $("content").querySelectorAll("[data-back]").forEach(b => b.onclick = async () => {
    const r = rows.find(x => x.id === b.dataset.back), why = prompt("Send it back — what needs fixing?");
    if (!why) return;
    const s = stageOf(r), i = PAY_STAGES.findIndex(x => x.k === s.k);
    await db.collection("expenses").doc(r.id).update({ payStage: PAY_STAGES[Math.max(0, i - 1)].k, sentBack: why, sentBackBy: state.user.uid, sentBackOn: today() });
    audit("pay_back", "expenses", r.id, why); toast("Sent back"); routes.payments(tab);
  });
};


/* ---- A month of day reports, as one signed sheet ---- */
function printMonthlyReports(rows, person, month) {
  const label = new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const days = rows.length, places = [...new Set(rows.map(r => r.location).filter(Boolean))];
  const projects = [...new Set(rows.map(r => projectName(r.projectId)).filter(Boolean))];
  openForm("Monthly field report", `${formHead("MONTHLY FIELD REPORT", FORM_NUMS.monthlyReport)}
    <div class="meta"><div><b>Name:</b> ${esc(person.name || "")}${person.postTitle ? ` · ${esc(person.postTitle)}` : ""}</div>
      <div><b>Month:</b> ${esc(label)}</div></div>
    <div class="meta"><div><b>Days reported:</b> ${days}</div><div><b>Projects:</b> ${esc(projects.join(", ") || "—")}</div></div>
    ${places.length ? `<p class="note" style="margin-top:0"><b>Where the work was done:</b> ${esc(places.join(" · "))}</p>` : ""}
    <table class="t"><tr><th style="width:22mm">Date</th><th style="width:32mm">Place</th><th>What was done</th><th style="width:30mm">Still in the way</th></tr>
      ${rows.map(r => `<tr><td>${esc(fmtD(r.date))}</td><td>${esc(r.location || "")}</td>
        <td>${esc(r.text || "")}${r.taskProgress ? `<br><i>Tasks: ${esc(r.taskProgress)}</i>` : ""}</td>
        <td>${esc(r.blockers || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">No reports for this month</td></tr>`}
    </table>
    <p class="note">Submitted from the Empower People Office app on ${esc(fmtD(today()))}.
      ${rows.filter(r => r.status === "verified").length} of ${days} ${days === 1 ? "report has" : "reports have"} been read by the line manager.</p>
    ${formSigs(person.id, (rows.find(r => r.verifiedBy) || {}).verifiedBy, null, today(), null, null)}`);
}

/* ---- My month: read it back, print it, send it ---- */
routes.myMonth = async () => {
  const month = state.myMonth || today().slice(0, 7);
  const whoId = state.myMonthWho || viewUid();
  const person = (state.users || []).find(u => u.id === whoId) || state.me;
  const canPickPerson = isManager() || has("super_admin", "admin");
  setTitle("My month");
  const all = (await db.collection("dayReports").where("uid", "==", whoId).limit(200).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(r => String(r.date || "").startsWith(month))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const team = canPickPerson ? (state.users || []).filter(u => u.active && (mgrs(u).includes(state.user.uid) || has("super_admin"))) : [];
  const read = all.filter(r => r.status === "verified").length;
  const dim = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  html(`<div class="card"><h2>A month of day reports</h2>
      <p class="small muted">Everything you wrote that month, in one sheet — to read back, to print, or to send to whoever asks for it.</p>
      <div class="two"><label class="field"><span>Month</span><input type="month" id="mm" value="${month}"></label>
        ${canPickPerson && team.length ? `<label class="field"><span>Whose</span><select id="mmWho">
          <option value="${state.user.uid}">Mine</option>${team.map(u => `<option value="${u.id}" ${u.id === whoId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label>` : ""}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" id="mmPrint">Print the sheet (F-09)</button>
        <button class="btn small quiet" id="mmSend">Send it</button>
        <button class="btn small quiet" id="mmCsv">Download as a file</button></div></div>

    <div class="grid">
      <div class="card stat"><span class="muted small">Days reported</span><b>${all.length}</b><span class="small muted">of ${dim} in the month</span></div>
      <div class="card stat"><span class="muted small">Read by the manager</span><b>${read}</b></div>
      <div class="card stat"><span class="muted small">Places worked</span><b>${new Set(all.map(r => r.location).filter(Boolean)).size}</b></div>
      <div class="card stat"><span class="muted small">Days not reported</span><b>${Math.max(0, dim - all.length)}</b></div></div>

    <div class="card"><h2>${new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
      <div class="list">${all.map(r => `<div class="item"><div class="grow">
        <div class="t">${fmtD(r.date)}${r.location ? " · " + esc(r.location) : ""}</div>
        <div class="s" style="white-space:pre-wrap">${esc(r.text || "")}</div>
        ${r.blockers ? `<div class="s" style="color:#8A5A00">In the way: ${esc(r.blockers)}</div>` : ""}</div>
        <span class="tag ${r.status === "verified" ? "ok" : "warn"}">${esc(r.status || "submitted")}</span></div>`).join("")
        || `<div class="empty">Nothing written for this month</div>`}</div></div>`);
  $("mm").onchange = e => { state.myMonth = e.target.value; routes.myMonth(); };
  if ($("mmWho")) $("mmWho").onchange = e => { state.myMonthWho = e.target.value; routes.myMonth(); };
  $("mmPrint").onclick = () => printMonthlyReports(all, person, month);
  $("mmCsv").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all.map(r => ({ Date: r.date, Place: r.location,
      Project: projectName(r.projectId), "What was done": r.text, "Task progress": r.taskProgress,
      "In the way": r.blockers, Status: r.status }))), "Day reports");
    XLSX.writeFile(wb, `${(person.name || "reports").replace(/\s+/g, "-")}-${month}.xlsx`); };
  $("mmSend").onclick = async () => {
    const label = new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const text = `${person.name} — day reports for ${label}\n${all.length} days reported\n\n`
      + all.map(r => `${fmtD(r.date)}${r.location ? " · " + r.location : ""}\n${r.text || ""}`).join("\n\n");
    const mgr = (mgrs(person)[0] && userName(mgrs(person)[0])) || "your line manager";
    if (navigator.share) { try { await navigator.share({ title: `Day reports — ${label}`, text }); return; } catch { } }
    try { await navigator.clipboard.writeText(text);
      alert(`Copied the month's reports.\n\nPaste them into an email or a message to ${mgr}.\nFor a signed copy, use Print the sheet instead.`); }
    catch { prompt("Copy this and send it:", text.slice(0, 2000)); }
  };
};

/** Rupees, written the way they are read here. */
const inr = n => "\u20B9" + Number(n || 0).toLocaleString("en-IN");

/* ================= THE CASH BOX =================
   Procurement holds the cash box and records what goes out of it, with the bill.
   The Accountant tops it up and reconciles; the holder is answerable for the balance. */
/* Accounts: money given to people to spend on the organisation's behalf, and what
   they have done with it. Not the spending form — that belongs to whoever holds it. */
/* The holder: what you were given, what you have spent, what is left. */
routes.cashBox = async () => {
  const uid = viewUid();
  const isAcc = isAccounts() || has("super_admin","director_acf");
  if (!state._cbFromDropdown) state.cbWho = null; // reset on fresh open
  state._cbFromDropdown = false;
  const viewId = isAcc ? (state.cbWho || uid) : uid;
  const viewPerson = (state.users || []).find(u => u.id === viewId) || state.me;
  setTitle(isAcc && viewId !== uid ? `Cash box · ${viewPerson.name || ""}` : "My cash box");

  const personId = isAcc && viewId !== uid ? viewId : uid;
  const [advSnap, claimSnap, pettySnap] = await Promise.all([
    db.collection("advances").where("uid", "==", personId).limit(100).get().catch(() => ({ docs: [] })),
    db.collection("expenseClaims").where("uid", "==", personId).limit(100).get().catch(() => ({ docs: [] })),
    db.collection("pettyCash").where("by", "==", personId).limit(200).get().catch(() => ({ docs: [] }))
  ]);
  const advRows = advSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.deleted);
  const claimRows = claimSnap.docs.map(d => ({id:d.id,...d.data()})).filter(r => !r.deleted);
  const pettyRows = pettySnap.docs.map(d => ({id:d.id,...d.data()})).filter(r => !r.deleted);
  // Voided entries show in ledger but are excluded from balance
  const notVoided = r => !r.voided;
  const rows = [
    ...advRows.map(a => { const d = a.issuedOn || (a.createdAt?.seconds ? new Date(a.createdAt.seconds*1000).toISOString().slice(0,10) : null) || today(); const isSettled = a.settled || /settled/i.test(a.status||''); return { _type:"adv", id:a.id, date:d, particulars:(isSettled?"✓ Settled — ":"")+"Advance: "+(a.purpose||""), inAmt:isSettled?0:Number(a.amount)||0, outAmt:0, by:a.issuedBy||a.createdBy, accepted:true, _raw:a }; }),
    ...claimRows.map(c => { const d = c.date||(c.createdAt?.seconds?new Date(c.createdAt.seconds*1000).toISOString().slice(0,10):null)||today(); return { _type:"claim", id:c.id, date:d, particulars:`Claim: ${c.particulars||c.description||""}`, inAmt:0, outAmt:Number(c.amount)||0, by:c.uid, accepted:c.status==="approved", _raw:c }; }),
    ...pettyRows.map(p => { return { _type:"petty", id:p.id, date:p.date||today(), particulars:(p.voided?"⊘ VOID — ":"")+( p.particulars||p.purpose||"Petty cash"), payee:p.payee||"", inAmt:Number(p.inAmt)||0, outAmt:Number(p.outAmt)||0, by:p.by, bill:p.bill||null, accepted:p.accepted||p.status==="accepted", status:p.voided?"voided":p.status||"", _raw:p }; })
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const totalIn  = advRows.filter(r => notVoided(r) && !r.settled && !/settled/i.test(r.status||'')).reduce((s, a) => s + (Number(a.amount)||0), 0)
    + pettyRows.filter(p => notVoided(p) && Number(p.inAmt) > 0).reduce((s, p) => s + (Number(p.inAmt) || 0), 0);
  const totalOut = claimRows.filter(c => notVoided(c) && c.status === "approved").reduce((s, c) => s + (Number(c.amount) || 0), 0)
    + pettyRows.filter(p => notVoided(p) && p.status === "accepted" && !p.rejected).reduce((s, p) => s + (Number(p.outAmt) || 0), 0);
  const balance  = totalIn - totalOut;
  const missingBills = rows.filter(r => r.outAmt && !r.accepted && !r.bill).length;
  const month = state.cbMonth || today().slice(0, 7);
  const monthRows = rows.filter(r => (r.date || "").startsWith(month));
  const mIn = monthRows.reduce((s, r) => s + (Number(r.inAmt)  || 0), 0);
  const mOut = monthRows.reduce((s, r) => s + (Number(r.outAmt) || 0), 0);

  const entryIcon = r => r.inAmt > 0 ? `<span title="Money received" style="font-size:16px">💰</span>`
    : r.bill ? `<a href="${esc(typeof r.bill==='object'?(r.bill.link||r.bill.url||r.bill.webViewLink||''):String(r.bill||''))}" target="_blank" rel="noopener" title="Open bill in Drive" style="font-size:16px;text-decoration:none">🧾</a>`
    : `<span title="No bill yet" style="font-size:16px;opacity:.6">📋</span>`;

  html(`<div class="card" style="border-left:4px solid ${balance < 0 ? "var(--bad)" : "var(--green)"}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        <div class="small muted">${isAcc && viewId !== uid ? esc(viewPerson.name) + " · " : ""}Cash box</div>
        <div style="font-size:32px;font-weight:500;color:${balance < 0 ? "var(--bad)" : "var(--green)"}">${balance < 0 ? "−" : ""}${inr(Math.abs(balance))}</div>
        ${missingBills ? `<div class="small" style="color:#8A5A00;margin-top:2px">${missingBills} entr${missingBills===1?"y":"ies"} without a bill</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start">
        ${(isAcc || has("super_admin","founder")) && viewId === uid ? `<select id="cbWhoSel" style="width:auto;padding:5px 9px;border-radius:9px;font-size:13px" onchange="state.cbWho=this.value||null;state._cbFromDropdown=true;routes.cashBox()">
          <option value="${uid}">My box</option>
          ${(state.users||[]).filter(u=>u.active&&isStaff(u)&&u.id!==uid).map(u=>`<option value="${u.id}" ${u.id===viewId?"selected":""}>${esc(u.name)}</option>`).join("")}
        </select>` : ""}
        <button class="btn small" id="cbPrint">Print month (F-03)</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <span class="tag">${inr(totalIn)} received</span>
      <span class="tag">${inr(totalOut)} spent</span>
      <input type="month" id="cbMonth" value="${month}" style="border:0.5px solid var(--border-strong);border-radius:var(--radius);padding:3px 8px;font-size:12px;background:transparent;color:var(--text-primary)">
    </div></div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
    ${isAcc||has("procurement")?`<button class="btn" id="btnOfficeExp" style="padding:14px;border-radius:12px;text-align:left;height:auto">
      <div style="font-size:18px">📋</div><div style="font-weight:600;margin-top:4px">Record office expense</div>
      <div class="small muted" style="margin-top:2px;font-weight:400">Record spending from the box</div>
    </button>`:""}
    ${isAcc?`<button class="btn" id="btnCashIn" style="padding:14px;border-radius:12px;text-align:left;height:auto">
      <div style="font-size:18px">💰</div><div style="font-weight:600;margin-top:4px">Cash / bank received</div>
      <div class="small muted" style="margin-top:2px;font-weight:400">Record money arriving in the box</div>
    </button>`:""}
    <button class="btn" id="btnNeedMoney" style="padding:14px;border-radius:12px;text-align:left;height:auto">
      <div style="font-size:20px;margin-bottom:4px">💰</div>
      <div style="font-weight:500">I need money</div>
      <div class="small muted" style="margin-top:2px;font-weight:400">Request advance or ask for something</div>
    </button>
    <button class="btn" id="btnSpent" style="padding:14px;border-radius:12px;text-align:left;height:auto">
      <div style="font-size:20px;margin-bottom:4px">🧾</div>
      <div style="font-weight:500">I spent</div>
      <div class="small muted" style="margin-top:2px;font-weight:400">Record spending or claim reimbursement</div>
    </button>
  </div>
  <div id="cbActionForm"></div>

  

  <div class="card"><h2>Ledger · ${rows.length} entries</h2><div class="list">
    ${rows.slice(0,150).map(r=>`<div class="item">
      <div style="width:28px;flex-shrink:0;text-align:center">${entryIcon(r)}</div>
      <div class="grow"><div class="t">${esc(r.particulars||"")}</div>
        <div class="s">${fmtD(r.date)}${r.payee?" · "+esc(r.payee):""}${r.projectId?" · "+esc(projectName(r.projectId)):""} · ${esc(userName(r.by))}</div>
        ${r.outAmt&&!r.bill&&!r.accepted?`<div class="small" style="color:#8A5A00">${esc(r.noBillNote||"Bill missing")}</div>`:""}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:500;color:${r.inAmt>0?"var(--green)":"var(--bad)"}">${r.inAmt>0?"+":"−"}${inr(r.inAmt>0?r.inAmt:r.outAmt)}</div>
        <div class="small muted">${r.inAmt>0?"":(r.bill&&(typeof r.bill==='object'?r.bill.link||r.bill.url||r.bill.webViewLink:r.bill))?`<a href="${esc(typeof r.bill==='object'?(r.bill.link||r.bill.url||r.bill.webViewLink||""):String(r.bill))}" target="_blank" rel="noopener" style="text-decoration:underline">📎 bill</a>${r.accepted?' <span class="tag ok" style="font-size:10px">✓</span>':''}`:r.accepted?"accepted":"no bill"}</div>
        ${r._type==="adv"?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
          <button class="btn small quiet" style="font-size:11px" data-f01="${r.id}">F-01</button>
          ${r._raw&&r._raw.status==="issued"&&r._raw.uid===viewId?`<button class="btn small quiet" style="font-size:11px" data-adv-bills="${r.id}">Upload bills</button><button class="btn small quiet" style="font-size:11px" data-adv-settle="${r.id}">Settle</button>`:""}
          ${r._raw&&r._raw.ackStatus==="pending"&&r._raw.uid===state.user.uid?`<button class="btn small" style="font-size:11px;background:var(--warn)" data-adv-ack="${r.id}">✓ I received this</button>`:""}
          ${r._raw&&r._raw.outOfApp&&!r._raw.ackStatus&&(isAcc||has("super_admin","founder"))?`<button class="btn small quiet" style="font-size:11px" data-adv-send-ack="${r.id}">📤 Send for acknowledgement</button>`:""}
          ${r._raw&&r._raw.ackStatus==="pending"&&(isAcc||has("super_admin","founder"))&&r._raw.uid!==state.user.uid?`<span class="tag warn" style="font-size:10px">⏳ Awaiting acknowledgement</span>`:""}
          ${r._raw&&r._raw.ackStatus==="acknowledged"?`<span class="tag ok" style="font-size:10px">✓ Acknowledged</span>`:""}
          ${r._raw&&!r._raw.supportingDoc&&r._raw.outOfApp&&(isAcc||has("super_admin","founder"))?`<button class="btn small quiet" style="font-size:11px;color:var(--warn)" data-adv-upload-doc="${r.id}">📎 Add supporting doc</button>`:""}
          ${r._raw&&(isAcc||has("super_admin","founder")||r._raw.uid===state.user.uid||r._raw.by===state.user.uid)?`<button class="btn small quiet" style="font-size:11px" data-adv-edit="${r.id}">✎ Edit</button>`:""}
          ${r._raw&&/^settled/.test(r._raw.status||"")&&!r._raw.settleConfirmedBy?(isAcc&&r._raw.uid!==state.user.uid?`<button class="btn small quiet" style="font-size:11px" data-adv-confirm="${r.id}">✓ Confirm settlement</button>`:`<span class="tag warn" style="font-size:10px">Awaiting accountant confirmation</span>`):""}
          ${r._raw&&r._raw.settleConfirmedBy?`<span class="tag ok" style="font-size:10px">Confirmed ✓</span>`:""}
        </div>`:""}

        ${r._type==="claim"?`<button class="btn small quiet" style="margin-top:4px;font-size:11px" data-f02="${r.id}">F-02</button>`:""}
        ${(isAcc||has("super_admin","founder")||r._raw?.by===state.user.uid||r._raw?.uid===state.user.uid)?`<button class="btn small quiet" style="margin-top:4px;font-size:11px" data-cb-edit="${r.id}" data-cb-type="${r._type}">✎ Edit</button>`:""}
        ${(isAcc||has("super_admin","founder"))?`<button class="btn small quiet" style="margin-top:4px;font-size:11px;color:var(--warn)" data-cb-del="${r.id}" data-cb-type="${r._type}" title="Void — keeps record, removes from balance">${r._raw?.voided?"⊘ Voided":"⊘ Void"}</button>`:""}
      </div>
      ${r._type==="petty"&&!r.accepted?`<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;flex-shrink:0">
        ${/awaiting accountant/i.test(r.status||"")?
          (isAcc?`<button class="btn small" style="font-size:11px" data-acc="${r.id}">✓ Accept & generate F-05</button><button class="btn small quiet" style="font-size:11px;color:var(--bad)" data-ret="${r.id}">Return</button>`
          :`<span style="font-size:11px;color:#8A5A00;padding:2px 6px;background:#fef3c7;border-radius:6px">Awaiting accountant</span>`)
          :`<span style="font-size:11px;color:#8A5A00;padding:2px 6px;background:#fef3c7;border-radius:6px">Awaiting director</span>`}
      </div>`:""}
    </div>`).join("")||`<div class="empty">Nothing recorded yet</div>`}
  </div></div>`);

  $("content").querySelectorAll("[data-cb-edit]").forEach(b => b.onclick = async () => {
    const id = b.dataset.cbEdit, type = b.dataset.cbType;
    const r = rows.find(x => x.id === id)?._raw || {};
    const col = type==="petty" ? "pettyCash" : type==="claim" ? "expenseClaims" : null;
    if (!col) return;
    const s = await askEdit("Edit entry", `
      <label class="field"><span>Particulars</span><input name="particulars" value="${esc(r.particulars||r.purpose||"")}" required></label>
      <label class="field"><span>Amount ₹</span><input type="number" name="amt" value="${r.outAmt||r.amount||""}" required></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${r.date||today()}"></label>
      ${type==="petty"?`<label class="field"><span>Paid by</span><select name="mode"><option>Cash</option><option ${/Bank|NEFT/i.test(r.mode||"")?"selected":""}>Bank transfer / NEFT</option><option ${r.mode==="UPI"?"selected":""}>UPI</option><option ${r.mode==="Cheque"?"selected":""}>Cheque</option></select></label>`:""}
      <label class="field"><span>Payee</span><input name="payee" value="${esc(r.payee||"")}"></label>
      <label class="field"><span>Reason for edit</span><input name="reason" placeholder="What was wrong or missing?" required></label>`);
    if (!s) return;
    const update = { particulars:s.particulars, date:s.date, payee:s.payee||"",
      editLog: firebase.firestore.FieldValue.arrayUnion({by:state.user.uid,name:state.me.name,at:today(),reason:s.reason,change:`Edited particulars/amount/date`}) };
    if (type==="petty") { update.outAmt=Number(s.amt); update.mode=s.mode; }
    else { update.amount=Number(s.amt); }
    await db.collection(col).doc(id).update(update);
    successFlash("Entry updated");
    routes.cashBox();
  });

  $("content").querySelectorAll("[data-cb-del]").forEach(b => b.onclick = async () => {
    const id = b.dataset.cbDel, type = b.dataset.cbType;
    const r = rows.find(x => x.id === id)?._raw || {};
    if (r.voided) { alert("This entry is already voided."); return; }
    const col = type==="petty" ? "pettyCash" : type==="claim" ? "expenseClaims" : type==="adv" ? "advances" : null;
    if (!col) return;
    const s = await askEdit("Void entry", `
      <p class="small muted">The entry stays in the records but is excluded from all balances and reports. This cannot be undone except by the Founder.</p>
      <div class="item" style="background:var(--bg2);border-radius:8px;padding:8px;margin-bottom:8px"><div class="t">₹${(r.outAmt||r.amount||r.inAmt||0).toLocaleString("en-IN")} · ${esc(r.particulars||r.purpose||r.description||"")}</div><div class="s">${esc(r.date||"")}</div></div>
      <label class="field"><span>Reason for voiding</span><input name="reason" placeholder="e.g. Duplicate entry, wrong amount entered" required></label>`);
    if (!s) return;
    await db.collection(col).doc(id).update({
      voided: true, voidedBy: state.user.uid, voidedByName: state.me.name, voidedAt: today(), voidReason: s.reason,
      editLog: firebase.firestore.FieldValue.arrayUnion({by:state.user.uid, name:state.me.name, at:today(), change:`Voided — ${s.reason}`})
    });
    successFlash("Entry voided — stays in records, excluded from balances");
    routes.cashBox();
  });
  $("cbMonth").onchange = e => { state.cbMonth = e.target.value; routes.cashBox(); };
  // When viewing someone else's box, back arrow goes to My box first (not all the way out)
  if (viewId !== uid) {
    const backBtn = document.getElementById("backBtn");
    if (backBtn) { backBtn.classList.remove("hidden"); backBtn.onclick = () => { state.cbWho = null; state._cbFromDropdown = false; routes.cashBox(); }; }
  }

  // F-01 — print advance/requisition form
  $("content").querySelectorAll("[data-f01]").forEach(b => b.onclick = async () => {
    const row = rows.find(r => r.id === b.dataset.f01);
    if (row?._raw) { b.textContent="Generating…"; b.disabled=true; await downloadFilledForm("F-01","advances",row.id,row._raw).catch(e=>toast(e.message)); b.textContent="F-01"; b.disabled=false; }
  });
  $("content").querySelectorAll("[data-f02]").forEach(b => b.onclick = async () => {
    const row = rows.find(r => r.id === b.dataset.f02);
    if (row?._raw) { b.textContent="Generating…"; b.disabled=true; await downloadFilledForm("F-02","expenseClaims",row.id,row._raw).catch(e=>toast(e.message)); b.textContent="F-02"; b.disabled=false; }
  });
  // Upload bills against an advance (from cash box)
  $("content").querySelectorAll("[data-adv-bills]").forEach(b => b.onclick = async () => {
    const row = rows.find(r => r.id === b.dataset.advBills);
    if (!row?._raw) return;
    const files = await askBills(row._raw);
    if (!files) return;
    await db.collection("advances").doc(row.id).update({ files, bills: files.length ? "Yes" : "No" });
    toast(files.length + " bill(s) attached"); routes.cashBox();
  });
  // Settle an advance from cash box
  $("content").querySelectorAll("[data-adv-settle]").forEach(b => b.onclick = async () => {
    const row = rows.find(r => r.id === b.dataset.advSettle);
    if (!row?._raw) return;
    const s = await askSettlement(row._raw); if (!s) return;
    const spent = Number(s.spent)||0, ret = Number(s.returned)||0, adv = Number(row._raw.amount)||0;
    await db.collection("advances").doc(row.id).update({
      status: ret < 0 ? "settled — to reimburse" : "settled",
      spent, returned: ret, excess: Math.max(0, spent-adv),
      settledOn: s.date||today(), settleItems: s.items||[], settleNote: s.note||"", bills: s.bills, settledBy: state.user.uid
    });
    audit("settle","advances",row.id,`spent $\{spent\}`);
    toast(ret >= 0 ? `Settled · $\{ret.toLocaleString("en-IN")\} returned · accountant will confirm` : `Settled · $\{Math.abs(ret).toLocaleString("en-IN")\} to reimburse`);
    routes.cashBox();
  });

  // Accountant confirms a settled advance
  // Payee acknowledges receipt
  $("content").querySelectorAll("[data-adv-ack]").forEach(b => b.onclick = async () => {
    if (!confirm("Confirm you received this payment?")) return;
    await db.collection("advances").doc(b.dataset.advAck).update({ ackStatus:"acknowledged", ackedBy:state.user.uid, ackedAt:today() });
    successFlash("Acknowledged ✓"); routes.cashBox();
  });
  // Accountant/admin sends for acknowledgement on existing record
  $("content").querySelectorAll("[data-adv-send-ack]").forEach(b => b.onclick = async () => {
    const adv = rows.find(r=>r.id===b.dataset.advSendAck)?._raw||{};
    if (!adv.supportingDoc) { toast("Please upload a supporting document first."); return; }
    const ackDue = new Date(); ackDue.setDate(ackDue.getDate()+7);
    await db.collection("advances").doc(b.dataset.advSendAck).update({ ackStatus:"pending", ackDue:ackDue.toISOString().slice(0,10), outOfApp:true });
    successFlash("Sent for acknowledgement — payee has 7 days"); routes.cashBox();
  });
  // Upload supporting doc to existing record (like Rajender's)
  $("content").querySelectorAll("[data-adv-upload-doc]").forEach(b => b.onclick = async () => {
    const id = b.dataset.advUploadDoc;
    const s = await askEdit("Upload supporting document", `
      <p class="small muted">Attach the email, requisition, or approval letter for this out-of-app payment.</p>
      <label class="field"><span>Document</span><input type="file" id="uploadDocFile" required></label>
      <label class="field"><span>Note</span><input name="reason" placeholder="e.g. Email from Rajender Prasad dated 3 Nov 2026"></label>`);
    if (!s) return;
    const f = document.getElementById("uploadDocFile")?.files?.[0];
    if (!f) { toast("Please select a file"); return; }
    const doc = await uploadToDrive(f,"accounts",f.name).catch(()=>null);
    if (!doc) { toast("Upload failed — try again"); return; }
    const ackDue = new Date(); ackDue.setDate(ackDue.getDate()+7);
    await db.collection("advances").doc(id).update({ supportingDoc:doc, outOfApp:true, ackStatus:"pending", ackDue:ackDue.toISOString().slice(0,10), editLog:firebase.firestore.FieldValue.arrayUnion({by:state.user.uid,name:state.me.name,at:today(),change:`Supporting doc uploaded: ${s.reason||f.name}`}) });
    successFlash("Document uploaded — sent to payee for acknowledgement"); routes.cashBox();
  });
  $("content").querySelectorAll("[data-adv-edit]").forEach(b => b.onclick = async () => {
    const advId = b.dataset.advEdit;
    const adv = rows.find(r => r.id === advId)?._raw || {};
    const s = await askEdit("Edit advance", `
      <label class="field"><span>Purpose</span><input name="purpose" value="${esc(adv.purpose||"")}" required></label>
      <label class="field"><span>Amount ₹</span><input type="number" name="amount" value="${adv.amount||""}" required></label>
      <label class="field"><span>Date paid out</span><input type="date" name="issuedOn" value="${adv.issuedOn||""}"></label>
      <label class="field"><span>Paid by</span><select name="mode">
        <option value="">— select —</option>
        <option ${/^Cash/i.test(adv.mode||"")?"selected":""}>Cash</option>
        <option ${/Bank|NEFT/i.test(adv.mode||"")?"selected":""}>Bank transfer / NEFT</option>
        <option ${adv.mode==="UPI"?"selected":""}>UPI</option>
        <option ${adv.mode==="Cheque"?"selected":""}>Cheque</option>
      </select></label>
      <label class="field"><span>Reference / UTR</span><input name="ref" value="${esc(adv.ref||"")}"></label>
      <label class="field"><span>Paid from account</span><input name="fromAccount" value="${esc(adv.fromAccount||"")}"></label>
      <label class="field"><span>Reason for edit</span><input name="reason" placeholder="Why are you changing this?" required></label>`);
    if (!s) return;
    const before = {purpose:adv.purpose,amount:adv.amount,issuedOn:adv.issuedOn,mode:adv.mode};
    await db.collection("advances").doc(advId).update({
      purpose: s.purpose, amount: Number(s.amount),
      ...(s.issuedOn?{issuedOn:s.issuedOn}:{}),
      ...(s.mode?{mode:s.mode,isBank:!/^Cash/i.test(s.mode)}:{}),
      ...(s.ref?{ref:s.ref}:{}),
      ...(s.fromAccount?{fromAccount:s.fromAccount}:{}),
      editLog: firebase.firestore.FieldValue.arrayUnion({ by:state.user.uid, name:state.me.name, at:today(), reason:s.reason, before:JSON.stringify(before), change:`Edited: ${Object.keys(before).filter(k=>String(before[k])!==String({purpose:s.purpose,amount:s.amount,issuedOn:s.issuedOn,mode:s.mode}[k])).join(", ")}` })
    });
    successFlash("Advance updated");
    routes.cashBox();
  });
  $("content").querySelectorAll("[data-adv-confirm]").forEach(b => b.onclick = async () => {
    if (!confirm("Confirm this settlement?")) return;
    await db.collection("advances").doc(b.dataset.advConfirm).update({
      settleConfirmedBy: state.user.uid, settleConfirmedOn: today()
    });
    audit("confirm_settle","advances",b.dataset.advConfirm,"confirmed");
    toast("Settlement confirmed ✓");
    routes.cashBox();
  });
  $("cbPrint").onclick = () => {
    const label = new Date(month+"-01").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
    const name = isAcc&&viewId!==uid ? viewPerson.name : state.me.name;
    openForm("Monthly account – F-03", `${formHead("MONTHLY ACCOUNT",FORM_NUMS.monthly)}
      <div class="meta"><div><b>Name:</b> ${esc(name)}</div><div><b>Month:</b> ${esc(label)}</div>
        <div><b>Received:</b> ${inr(mIn)}</div><div><b>Spent:</b> ${inr(mOut)}</div><div><b>Balance:</b> ${inr(mIn-mOut)}</div></div>
      <table class="t"><tr><th style="width:11mm">No.</th><th style="width:22mm">Date</th><th>Particulars</th><th>Paid to</th>
        <th class="n" style="width:22mm">In ₹</th><th class="n" style="width:22mm">Out ₹</th><th>Project</th><th>Accepted?</th></tr>
        ${monthRows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(fmtD(r.date))}</td><td>${esc(r.particulars||"")}</td><td>${esc(r.payee||"")}</td>
          <td class="n">${r.inAmt?r.inAmt.toLocaleString("en-IN"):""}</td><td class="n">${r.outAmt?r.outAmt.toLocaleString("en-IN"):""}</td>
          <td>${esc(projectName(r.projectId)||"")}</td><td>${r.accepted?"Yes":r.inAmt?"—":"No"}</td></tr>`).join("")}
        <tr class="tot"><td colspan="4">TOTAL</td><td class="n">${mIn.toLocaleString("en-IN")}</td><td class="n">${mOut.toLocaleString("en-IN")}</td><td colspan="2"></td></tr>
      </table><p class="words"><b>Balance in hand:</b> ${esc(inr(mIn-mOut))} (${esc(inWords(mIn-mOut))})</p>
      ${formSigs(viewId,null,null,today(),null,null)}`);
  };

  if ($("btnOfficeExp")) $("btnOfficeExp").onclick = () => {
    const f = $("cbActionForm");
    f.innerHTML = `<div class="card"><h2>Record office expense</h2>
      <form id="officeExpForm">
        <div class="two"><label class="field"><span>Office</span><select name="officeId">${(state.offices||[]).map(o=>`<option value="${o.id}" ${o.id===state.me.officeId?"selected":""}>${esc(o.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label></div>
        <label class="field"><span>Particulars</span><input name="particulars" required></label>
        <label class="field"><span>Payee</span><input name="payee"></label>
        <div class="two"><label class="field"><span>Amount ₹</span><input type="number" name="outAmt" required></label>
          <label class="field"><span>Paid by</span><select name="mode"><option>Cash</option><option>UPI</option><option>Bank transfer / NEFT</option><option>Cheque</option></select></label></div>
        <div class="two"><label class="field"><span>Project</span><select name="projectId"><option value="">— office —</option>${activeProjects().map(p=>`<option value="${p.id}">${esc(p.code||p.name)}</option>`).join("")}</select></label>
          <label class="field"><span>Head</span><input name="head"></label></div>
        <label class="field"><span>Bill / receipt</span><input type="file" id="officeExpBill"></label>
        <div style="display:flex;gap:8px;margin-top:8px"><button class="btn" type="submit">Save</button><button class="btn quiet" type="button" onclick="$('cbActionForm').innerHTML=''">Cancel</button></div>
      </form></div>`;
    $("officeExpForm").onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      let billObj = null;
      const billFile = $("officeExpBill")?.files?.[0];
      if (billFile) { try { billObj = await uploadToDrive(billFile,"accounts",billFile.name); } catch {} }
      await db.collection("pettyCash").add({ by: personId, officeId: data.officeId, date: data.date, particulars: data.particulars, payee: data.payee||"", outAmt: Number(data.outAmt), inAmt: 0, mode: data.mode, projectId: data.projectId||"", head: data.head||"", bill: billObj||null, noBillNote: billObj?"":"No bill provided", status: "awaiting accountant", accepted: false, withinAuthority: true, moneyType: "org", createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: state.user.uid });
      successFlash("Expense recorded"); $("cbActionForm").innerHTML = ""; routes.cashBox();
    };
  };
  if ($("btnCashIn")) $("btnCashIn").onclick = async () => {
    const s = await askEdit("Record cash received", `
      <label class="field"><span>Amount received ₹</span><input type="number" name="inAmt" required></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${today()}"></label>
      <label class="field"><span>Source</span><input name="particulars" placeholder="e.g. Bank transfer, HQ disbursement" required></label>
      <label class="field"><span>Reference / transaction no.</span><input name="ref" placeholder="UTR, cheque no., etc."></label>
      <label class="field"><span>Mode</span><select name="mode"><option>Bank transfer / NEFT</option><option>UPI</option><option>Cash</option><option>Cheque</option></select></label>`);
    if (!s) return;
    await db.collection("pettyCash").add({ by: personId, officeId: state.me.officeId||"", date: s.date, particulars: s.particulars, inAmt: Number(s.inAmt), outAmt: 0, mode: s.mode, ref: s.ref||"", status: "accepted", accepted: true, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: state.user.uid });
    successFlash("Cash received recorded");
    routes.cashBox();
  };
  if ($("btnNeedMoney")) $("btnNeedMoney").style.display = uid === state.user.uid ? "" : "none";
  $("btnNeedMoney").onclick = () => {
    $("cbActionForm").innerHTML = `<div class="card"><h2>I need money</h2><form id="needForm">
      <div class="two"><label class="field"><span>Amount ₹</span><input type="number" step="any" inputmode="decimal" name="amount" required></label>
        <label class="field"><span>Needed by</span><input type="date" name="neededBy"></label></div>
      <label class="field"><span>What for?</span><input name="purpose" required placeholder="Field travel, event materials, etc."></label>
      <label class="field"><span>Type</span><select name="reqType">
        <option value="advance">Advance — I will spend and report back</option>
        <option value="salary_advance">Advance against salary</option>
        <option value="requisition">Requisition — buy something specific</option>
      </select></label>
      <div class="two"><label class="field"><span>Office</span><select name="officeId"><option value="">— select office —</option>
        ${(state.offices||[]).map(o=>`<option value="${o.id}" ${o.id===state.me.officeId?"selected":""}>${esc(o.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Project (if for a specific project)</span><select name="projectId"><option value="">— unallocated —</option>
        ${myActiveProjects().map(p=>`<option value="${p.id}">${esc(p.code||p.name)}</option>`).join("")}</select></label></div>
      <label class="field"><span>Programme</span><select name="programmeId"><option value="">— all / not programme-specific —</option>
        ${(state.programmes||[]).map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></label>
      <div style="display:flex;gap:8px">
        <button class="btn" type="submit">Send request</button>
        <button class="btn quiet" type="button" onclick="$('cbActionForm').innerHTML=''">Cancel</button>
      </div></form></div>`;
    $("needForm").onsubmit = async e => { e.preventDefault();
      if (typeof canWrite === "function" && !canWrite()) { toast("You are viewing as someone else — exit View As to make changes."); return; }
      const d = Object.fromEntries(new FormData(e.target));
      await db.collection("advances").add({...d, amount:Number(d.amount)||0, uid:state.user.uid, name:state.me.name,
        status:"requested", managerIds:mgrs(state.me), createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      toast("Request sent"); $("cbActionForm").innerHTML=""; routes.cashBox(); };
  };

  $("btnSpent").onclick = () => {
    $("cbActionForm").innerHTML = `<div class="card"><h2>I spent</h2><form id="spentForm">
      <div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field"><span>Amount ₹</span><input type="number" step="any" inputmode="decimal" name="outAmt" required></label></div>
      <label class="field"><span>What was it for?</span><input name="particulars" required placeholder="Tea and refreshments, travel fare, etc."></label>
      <div class="two"><label class="field"><span>Paid to</span><input name="payee" placeholder="Shop, person or vendor"></label>
        <label class="field"><span>Whose money?</span><select name="moneyType">
          <option value="org">Organisation money (from my cash box)</option>
          <option value="own">My own money — I need reimbursement</option>
        </select></label></div>
      <div class="two"><label class="field"><span>Project</span><select name="projectId"><option value="">— unallocated —</option>
        ${myActiveProjects().map(p=>`<option value="${p.id}">${esc(p.code||p.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Programme</span><select name="programmeId"><option value="">—</option>
        ${(state.programmes||[]).map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("")}</select></label></div>
      <label class="field"><span>Bill</span><input type="file" id="spBill" accept="image/*,.pdf">
        <span class="small muted">Photograph it now. A bill found later is a bill lost.</span></label>
      <div style="display:flex;gap:8px">
        <button class="btn" type="submit">Record</button>
        <button class="btn quiet" type="button" onclick="$('cbActionForm').innerHTML=''">Cancel</button>
      </div></form></div>`;
    let spBillData = null;
    $("spBill").onchange = async e => { const f=e.target.files[0]; if(!f) return;
      try { spBillData = f.size<700000&&/^image\//.test(f.type)
        ? await uploadToDrive(f,"accounts","cash box bill")
        : await uploadToDrive(f,"accounts","cash box bill");
        if(spBillData?.link||spBillData?.url||spBillData?.webViewLink) toast("Bill saved to Drive ✔");
        else { toast("Upload failed — try a smaller file"); spBillData=null; } }
      catch(err){ alert(err.message); } };
    $("spentForm").onsubmit = async e => { e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const isOwn = d.moneyType==="own";
      if(!spBillData){ const why=prompt("No bill.\nRecord anyway — say what happened.\n(Cancel to attach bill first.)");
        if(why===null) return; d.noBillNote=(why||"").trim()||"No bill given"; }
      if(isOwn){
        await db.collection("expenseClaims").add({...d,amount:Number(d.outAmt)||0,uid,name:state.me.name,
          bill:spBillData,status:"submitted",managerIds:mgrs(state.me),createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        toast("Reimbursement claim submitted");
      } else {
        const _cbPost = (state.posts||[]).find(p=>p.holderId===uid);
        const _cbAuth = Number(_cbPost?.limit || state.me?.spendLimit || 0);
        const _cbAmt = Number(d.outAmt) || 0;
        const _cbWithin = _cbAuth > 0 && _cbAmt <= _cbAuth; // within authorised spending limit → goes to accountant directly
        const _cbStatus = _cbWithin ? "awaiting accountant" : (spBillData ? "awaiting director" : "no bill — awaiting director");
        await db.collection("pettyCash").add({...d,outAmt:_cbAmt,inAmt:0,officeId:state.me.officeId,
          bill:spBillData,accepted:false,status:_cbStatus,withinAuthority:_cbWithin,
          by:uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        toast("Recorded");
      }
      $("cbActionForm").innerHTML=""; routes.cashBox(); };
  };

  $("content").querySelectorAll("[data-acc]").forEach(b => b.onclick = async () => {
    const r=rows.find(x=>x.id===b.dataset.acc);
    if(!r.bill&&!confirm(`No bill.\n"${r.noBillNote||""}"\nAccept anyway?`)) return;
    await db.collection("pettyCash").doc(r.id).update({accepted:true,status:"accepted",acceptedBy:state.user.uid,acceptedOn:today()});
    try{var _bu=r.bill?(typeof r.bill==='object'?(r.bill.link||r.bill.url||r.bill.webViewLink||''):String(r.bill||'')):'';var _rc="CASH BOX RECEIPT\n================\nDate: "+(r.date||today())+"\nDescription: "+(r.description||r.particulars||"")+"\nAmount: ₹"+(r.outAmt||0).toLocaleString("en-IN")+"\nAccepted by: "+state.me.name+"\nOn: "+today()+"\nBill: "+(_bu||"No bill")+"\nRef: "+r.id;uploadToDrive(new File([_rc],"receipt-"+r.id+"-"+today()+".txt",{type:"text/plain"}),"accounts","receipt-"+r.id+".txt").then(function(_rr){if(_rr&&_rr.link)db.collection("pettyCash").doc(r.id).update({voucherUrl:_rr.link}).catch(function(){});}).catch(function(){});}catch(_re){console.warn("Receipt:",_re&&_re.message);}
    audit("petty_accept","pettyCash",r.id,`₹${r.outAmt}`); toast("Accepted"); routes.cashBox(); });
  $("content").querySelectorAll("[data-ret]").forEach(b => b.onclick = async () => {
    const r=rows.find(x=>x.id===b.dataset.ret);
    const why=prompt("Sending back — what is needed?"); if(!why) return;
    await db.collection("pettyCash").doc(r.id).update({accepted:false,status:"returned — "+why.slice(0,40),returnNote:why,returnedBy:state.user.uid,returnedOn:today()});
    audit("petty_return","pettyCash",r.id,why.slice(0,50)); toast("Sent back"); routes.cashBox(); });

};

routes.financialTrail = async () => {
  setTitle("Financial trail");
  if (!isAccounts() && !has("super_admin","founder")) { html(`<div class="card"><p>Not available.</p></div>`); return; }

  const [advSnap, claimSnap, expSnap, paySnap] = await Promise.all([
    db.collection("advances").orderBy("createdAt","desc").limit(100).get().catch(()=>({docs:[]})),
    db.collection("expenseClaims").orderBy("createdAt","desc").limit(100).get().catch(()=>({docs:[]})),
    db.collection("expenses").orderBy("createdAt","desc").limit(100).get().catch(()=>({docs:[]})),
    db.collection("payments").orderBy("createdAt","desc").limit(100).get().catch(()=>({docs:[]})),
  ]);

  const adv   = advSnap.docs.map(d=>({id:d.id,...d.data(),_c:"advances"}));
  const claim = claimSnap.docs.map(d=>({id:d.id,...d.data(),_c:"expenseClaims"}));
  const exp   = expSnap.docs.map(d=>({id:d.id,...d.data(),_c:"expenses"}));
  const pay   = paySnap.docs.map(d=>({id:d.id,...d.data(),_c:"payments"}));

  const fmtAmt = n => n ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
  const statusTag = s => {
    const ok = /paid|settled|issued|approved|accepted/i.test(s||"");
    const bad = /reject|cancel/i.test(s||"");
    return `<span class="tag ${ok?"ok":bad?"bad":"warn"}">${esc(s||"—")}</span>`;
  };

  

  

  const section = (title, rows, isEmpty) => `
    <div class="card">
      <h2>${title}</h2>
      ${isEmpty ? `<div class="empty">None</div>` : `
      <div style="overflow-x:auto">
      <table class="data-table"><thead><tr>
        <th>Date</th><th>Person</th><th>Amount</th><th>Purpose</th>
        <th>Project</th><th>Status</th><th>Paid on</th><th>Settled</th><th>Bills</th><th>Form</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`}
    </div>`;

    const tab = state.ftTab || "month";
  const now = new Date();
  const cutoff = tab === "month"
    ? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10)
    : tab === "3month"
    ? new Date(now.getFullYear(), now.getMonth()-2, 1).toISOString().slice(0,10)
    : new Date(now.getFullYear(), 3, 1).toISOString().slice(0,10); // Apr 1 = FY start

  const filtAdv   = adv.filter(r => (r.createdAt?.toDate?.()?.toISOString?.() || r.issuedOn || "").slice(0,10) >= cutoff);
  const filtClaim = claim.filter(r => (r.date || r.createdAt?.toDate?.()?.toISOString?.() || "").slice(0,10) >= cutoff);

  const advRowsF   = filtAdv.map(r => {
    const bills = (r.files||[]).map(f=>f.link||f.url||f.webViewLink||"").filter(Boolean);
    const billsHtml = bills.length
      ? bills.map((u,i)=>`<a href="${u}" target="_blank" rel="noopener">🧾${bills.length>1?" "+(i+1):""}</a>`).join(" ")
      : (r.bills==="Yes"?"🧾 (not linked)":"—");
    const f08 = r.form_F08_url
      ? `<a href="${r.form_F08_url}" target="_blank" rel="noopener">F-08</a>`
      : r.form_F08_html
      ? `<a href="data:text/html;charset=utf-8,${encodeURIComponent(r.form_F08_html)}" target="_blank" rel="noopener">F-08 ↗</a>`
      : "";
    return `<tr>
    <td>${fmtDate(r.issuedOn||r.neededBy||"")}</td>
    <td>${esc(userName(r.uid))}</td>
    <td>${fmtAmt(r.amount)}</td>
    <td>${esc(r.purpose||"")}</td>
    <td>${esc(projectName(r.projectId))}</td>
    <td>${statusTag(r.status)}</td>
    <td>${r.issuedOn?fmtDate(r.issuedOn):"—"}</td>
    <td>${r.settledOn?fmtDate(r.settledOn):"—"}</td>
    <td>${billsHtml}</td><td>${f08}</td>
  </tr>`;}).join("");

  const claimRowsF = filtClaim.map(r=>{
    const billLink = r.bill && typeof r.bill==="object" && r.bill.link
      ? `<a href="${r.bill.link}" target="_blank" rel="noopener" title="View bill">🧾</a>`
      : r.bill && typeof r.bill==="string" && r.bill.startsWith("http")
      ? `<a href="${r.bill}" target="_blank" rel="noopener" title="View bill">🧾</a>`
      : r.bill ? "🧾" : "—";
    return `<tr>
    <td>${fmtDate(r.date||"")}</td>
    <td>${esc(userName(r.uid))}</td>
    <td>${fmtAmt(r.amount)}</td>
    <td>${esc(r.description||r.category||"")}</td>
    <td>${esc(projectName(r.projectId))}</td>
    <td>${statusTag(r.status)}</td>
    <td>${r.payment||"—"}</td>
    <td>${billLink}</td><td>${r.form_F02_url?`<a href="${r.form_F02_url}" target="_blank" rel="noopener">F-02</a>`:""}</td>
  </tr>`;}).join("");

  html(`
    <div class="card">
      <h2>Financial trail</h2>
      <p class="small muted">All advances and expense claims. Financial year runs April–March.</p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn small ${tab==="month"?"":"quiet"}" data-ft="month">This month</button>
        <button class="btn small ${tab==="3month"?"":"quiet"}" data-ft="3month">Last 3 months</button>
        <button class="btn small ${tab==="year"?"":"quiet"}" data-ft="year">This FY</button>
      </div>
    </div>
    ${section("Advances", advRowsF, !filtAdv.length)}
    ${section("Expense claims", claimRowsF, !filtClaim.length)}
  `);
  $("content").querySelectorAll("[data-ft]").forEach(b => b.onclick = () => {
    state.ftTab = b.dataset.ft; routes.financialTrail();
  });
};


// ─── BANK INTEREST CALCULATOR ────────────────────────────────────────────────
routes.bankInterest = async () => {
  setTitle("Bank interest");
  if (!has("super_admin","director_acf","accountant","finance_manager")) {
    html(`<div class="card"><div class="empty">Available to Accounts and Director ACF.</div></div>`);
    return;
  }

  const g = c => db.collection(c).limit(3000).get().then(s => s.docs.map(d => ({id:d.id,...d.data()}))).catch(() => []);
  const [banks, receipts, postedInterest] = await Promise.all([
    g("banks"),
    g("incomeReceipts"),
    db.collection("incomeReceipts").where("type","==","Interest").limit(200).get().then(s=>s.docs.map(d=>({id:d.id,...d.data()}))).catch(()=>[]),
  ]);

  const banksWithRate = banks.filter(b => b.interestRate && Number(b.interestRate) > 0);

  // Parse currently selected bank + period from state
  const selBankId = state._biBank || (banksWithRate[0]?.id || "");
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const selYear  = state._biYear  || prevMonth.getFullYear();
  const selMonth = state._biMonth || (prevMonth.getMonth() + 1); // 1-12

  const selBank = banks.find(b => b.id === selBankId);
  const monthStr = String(selMonth).padStart(2, "0");
  const periodStart = `${selYear}-${monthStr}-01`;
  const nextM = selMonth === 12 ? `${selYear+1}-01-01` : `${selYear}-${String(selMonth+1).padStart(2,"0")}-01`;
  const periodEnd = nextM;
  const daysInMonth = (new Date(periodEnd) - new Date(periodStart)) / 86400000;
  const monthLabel = new Date(periodStart).toLocaleDateString("en-IN", {month:"long",year:"numeric"});

  // Receipts into this bank, before end of month (for proportional split)
  const bankCode = selBank?.accNo || "";
  const bankReceipts = receipts.filter(r => r.bank === bankCode || r.bank === selBankId);
  const toDate = r => String(r.date || "").slice(0,10);

  // Cumulative receipts into this bank by project up to period start (opening balance calc)
  const rcptsUpToStart  = bankReceipts.filter(r => toDate(r) < periodStart && r.type !== "Interest");
  const rcptsInMonth    = bankReceipts.filter(r => toDate(r) >= periodStart && toDate(r) < periodEnd && r.type !== "Interest");
  const rcptsUpToEnd    = bankReceipts.filter(r => toDate(r) < periodEnd && r.type !== "Interest");

  const sumAmt = arr => arr.reduce((t, r) => t + (Number(r.amount) || 0), 0);

  // Group by project for proportional split
  const projMap = {};
  rcptsUpToEnd.forEach(r => {
    if (!r.projectId) return;
    projMap[r.projectId] = (projMap[r.projectId] || 0) + (Number(r.amount) || 0);
  });
  const totalReceipts = sumAmt(rcptsUpToEnd);

  // Interest already posted for this bank+period
  const alreadyPosted = postedInterest.filter(r =>
    (r.bank === bankCode || r.bank === selBankId) &&
    toDate(r) >= periodStart && toDate(r) < periodEnd
  );
  const alreadyPostedAmt = sumAmt(alreadyPosted);

  // Rate
  const rate = Number(selBank?.interestRate || 0);
  const interestType = selBank?.interestType || "Savings account";

  // Generate month options (last 24 months)
  const monthOpts = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1 - i, 1);
    const y = d.getFullYear(), mo = d.getMonth() + 1;
    const label = d.toLocaleDateString("en-IN", {month:"long",year:"numeric"});
    monthOpts.push({y, mo, label, val:`${y}-${String(mo).padStart(2,"0")}`});
  }

  html(`
    <div class="card">
      <h2>Bank interest calculator</h2>
      <p class="small muted">Calculates monthly interest on project money sitting in the bank and posts it as income receipts. 
      ${banksWithRate.length === 0 ? `<strong>Set interest rates on your banks first — go to <button class="btn small quiet" onclick="routes.banks()">Bank accounts</button></strong>` : `${banksWithRate.length} bank${banksWithRate.length===1?"":"s"} with interest rates.`}</p>
      
      <div class="two" style="margin-top:12px">
        <label class="field"><span>Bank account</span>
          <select id="biBank">
            ${banks.map(b => `<option value="${b.id}" ${b.id===selBankId?"selected":""}>${esc(b.bank||"")} ${b.accNo?`(${b.accNo})`:""}${b.interestRate?` · ${b.interestRate}% p.a.`:" · no rate set"}</option>`).join("")}
          </select></label>
        <label class="field"><span>Period</span>
          <select id="biPeriod">
            ${monthOpts.map(o => `<option value="${o.val}" ${o.y===selYear&&o.mo===selMonth?"selected":""}>${o.label}</option>`).join("")}
          </select></label>
      </div>
      <button class="btn small" id="biCalc">Calculate</button>
    </div>

    ${selBank ? `
    <div class="card">
      <h2>${esc(selBank.bank||"")} · ${monthLabel}</h2>
      <div class="two">
        <div class="field"><span class="small muted">Account type</span><div>${esc(interestType)}</div></div>
        <div class="field"><span class="small muted">Interest rate</span><div>${rate > 0 ? `<strong>${rate}% p.a.</strong> = ${(rate/12).toFixed(4)}% per month` : `<span style="color:var(--red)">Rate not set — edit this bank first</span>`}</div></div>
      </div>
      <div class="two" style="margin-top:8px">
        <div class="field"><span class="small muted">Total receipts into this bank</span><div>₹${totalReceipts.toLocaleString("en-IN")}</div></div>
        <div class="field"><span class="small muted">Receipts in ${monthLabel}</span><div>₹${sumAmt(rcptsInMonth).toLocaleString("en-IN")}</div></div>
      </div>

      ${rate > 0 && totalReceipts > 0 ? `
      <hr style="margin:16px 0">
      <h3>Enter actual bank balance for interest calculation</h3>
      <p class="small muted">Use your bank statement for accuracy. The receipts total (₹${totalReceipts.toLocaleString("en-IN")}) is the upper bound — actual balance after expenses will be lower.</p>
      <div class="two">
        <label class="field"><span>Actual balance at month end (₹) <span style="color:var(--red)">*</span></span>
          <input type="number" id="biBalance" placeholder="Enter from bank statement" min="0" step="0.01"></label>
        <div class="field"><span class="small muted">Estimated interest</span>
          <div id="biPreview" style="font-size:18px;font-weight:600;color:var(--green)">Enter balance above</div></div>
      </div>

      ${Object.keys(projMap).length > 0 ? `
      <h3 style="margin-top:12px">Project split (by receipts share)</h3>
      <div class="tablewrap"><table class="table">
        <tr><th>Project</th><th>Receipts</th><th>Share</th><th>Interest (estimated)</th></tr>
        ${Object.entries(projMap).map(([pid, amt]) => {
          const share = totalReceipts > 0 ? (amt/totalReceipts*100).toFixed(1) : "0.0";
          return `<tr data-pid="${pid}" data-share="${amt/totalReceipts}">
            <td>${esc(projectName(pid))}</td>
            <td>₹${amt.toLocaleString("en-IN")}</td>
            <td>${share}%</td>
            <td class="proj-interest">—</td></tr>`;
        }).join("")}
      </table></div>

      ${alreadyPosted.length ? `<div class="small muted" style="margin-top:8px;color:var(--amber)">⚠ ₹${alreadyPostedAmt.toLocaleString("en-IN")} interest already posted for this bank in ${monthLabel}. Posting again will be in addition.</div>` : ""}

      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="biPost" disabled>Post interest receipts</button>
        <span class="small muted" style="align-self:center">Posts one receipt per project into the incomeReceipts ledger</span>
      </div>` : `<p class="small muted" style="margin-top:8px">No receipts found in this bank account. Make sure bank account numbers match between bank records and income receipts.</p>`}
      ` : ""}
    </div>` : ""}

    ${postedInterest.length ? `
    <div class="card"><h2>Posted interest receipts</h2>
      <div class="tablewrap"><table class="table">
        <tr><th>Date</th><th>Project</th><th>Bank</th><th>Amount</th><th>Reference</th></tr>
        ${postedInterest.sort((a,b) => (b.date||"") > (a.date||"") ? 1 : -1).slice(0,30).map(r => `<tr>
          <td>${r.date||""}</td><td>${esc(projectName(r.projectId))}</td><td>${esc(r.bank||"")}</td>
          <td>₹${Number(r.amount||0).toLocaleString("en-IN")}</td><td class="small muted">${esc(r.ref||"")}</td></tr>`).join("")}
      </table></div></div>` : ""}
  `);

  // Bank / period selector
  $("biBank").onchange = e => { state._biBank = e.target.value; routes.bankInterest(); };
  $("biPeriod").onchange = () => { const [y,m] = $("biPeriod").value.split("-").map(Number); state._biYear=y; state._biMonth=m; routes.bankInterest(); };
  $("biCalc")?.addEventListener("click", () => { const [y,m] = $("biPeriod").value.split("-").map(Number); state._biBank=$("biBank").value; state._biYear=y; state._biMonth=m; routes.bankInterest(); });

  // Live interest preview as user types balance
  const balInput = $("biBalance");
  const postBtn = $("biPost");
  const preview = $("biPreview");
  if (balInput && rate > 0) {
    balInput.oninput = () => {
      const bal = Number(balInput.value) || 0;
      const interest = bal * (rate/100) * (daysInMonth/365);
      if (preview) preview.textContent = bal > 0 ? `₹${interest.toFixed(2)}` : "Enter balance above";
      // Update project rows
      [...document.querySelectorAll("[data-pid]")].forEach(row => {
        const share = Number(row.dataset.share) || 0;
        const cell = row.querySelector(".proj-interest");
        if (cell) cell.textContent = bal > 0 ? `₹${(interest * share).toFixed(2)}` : "—";
      });
      if (postBtn) postBtn.disabled = !(bal > 0 && Object.keys(projMap).length > 0);
    };

    // Post interest
    if (postBtn) postBtn.onclick = async () => {
      const bal = Number(balInput.value) || 0;
      if (!bal) return;
      const totalInterest = bal * (rate/100) * (daysInMonth/365);
      const postDate = new Date(periodEnd);
      postDate.setDate(0); // last day of the selected month
      const dateStr = postDate.toISOString().slice(0,10);
      const ref = `INT/${selBank.bank?.replace(/\s+/g,"").slice(0,6)||"BNK"}/${selYear}-${monthStr}`;
      
      postBtn.disabled = true; postBtn.textContent = "Posting…";
      try {
        const batch = db.batch();
        let count = 0;
        for (const [pid, amt] of Object.entries(projMap)) {
          const share = totalReceipts > 0 ? amt/totalReceipts : 0;
          const projInterest = Math.round(totalInterest * share * 100) / 100;
          if (projInterest < 0.01) continue;
          const proj = (state.projects||[]).find(p=>p.id===pid)||{};
          const ref2 = db.collection("incomeReceipts").doc();
          batch.set(ref2, {
            date: dateStr,
            projectId: pid,
            type: "Interest",
            description: `Bank interest — ${monthLabel} — ${esc(selBank.bank||"")}`,
            amount: projInterest,
            bank: bankCode || selBankId,
            ref: ref,
            remitter: selBank.bank||"",
            fcra: proj.fcra || "",
            mode: "Interest credit",
            interestOnBalance: bal,
            interestRate: rate,
            interestDays: daysInMonth,
            createdBy: state.user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          count++;
        }
        await batch.commit();
        toast(`✓ ${count} interest receipt${count===1?"":"s"} posted for ${monthLabel}`);
        audit("create","incomeReceipts",null,`Bank interest · ${monthLabel} · ${selBank.bank}`);
        state._biBank = selBankId; state._biYear = selYear; state._biMonth = selMonth;
        await routes.bankInterest();
      } catch(e) {
        toast("Error posting: " + e.message, "error");
        postBtn.disabled = false; postBtn.textContent = "Post interest receipts";
      }
    };
  }
};


// Auto-upload bill file in expense entry form
document.addEventListener("change", async function(evt){
  if(evt.target.id !== "_allocBill") return;
  var f=evt.target.files[0]; if(!f) return;
  var st=document.getElementById("_allocBillStatus");
  var urlIn=document.getElementById("_allocBillUrl");
  var flag=document.getElementById("_allocBillsFlag");
  if(!urlIn) return;
  if(st) st.textContent="Uploading…";
  try{
    var r=await uploadToDrive(f,"accounts",f.name);
    if(r&&r.link){
      urlIn.value=r.link;
      if(flag) flag.value="Yes";
      if(st) st.textContent="✅ Ready to save";
    } else { if(st) st.textContent="Upload failed"; }
  } catch(err){ if(st) st.textContent=err.message; }
});
