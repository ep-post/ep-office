/* ================= CHAT & CALLS (channels, DMs, voice notes, audio/video) ================= */
let chatUnsub = null, callUnsub = null, pc = null, localStream = null, _callUnsubbers = [];
let _chatGlobalUnsubs = [], _chatLastSeen = {}, _chatUnread = new Set();

async function startChatNotifications() {
  _chatGlobalUnsubs.forEach(u => { try { u(); } catch(_){} });
  _chatGlobalUnsubs = [];
  const chans = (await ensureChannels()).filter(canSeeChannel);
  chans.forEach(chan => {
    // Track latest message per channel — only toast/badge for messages after we started listening
    const started = Date.now();
    const unsub = db.collection("channels").doc(chan.id).collection("messages")
      .orderBy("at", "desc").limit(1).onSnapshot(snap => {
        if (!snap.docs.length) return;
        const msg = snap.docs[0].data();
        if (!msg.at) return;
        const msgMs = msg.at.seconds ? msg.at.seconds * 1000 : 0;
        if (msgMs < started || msg.uid === state.user.uid) return; // own message or old
        const lastKey = "chat_" + chan.id;
        if (_chatLastSeen[lastKey] === snap.docs[0].id) return; // already seen
        _chatLastSeen[lastKey] = snap.docs[0].id;
        // Track unread channel
        _chatUnread.add(chan.id);
        // Show badge on Chat nav button
        const chatNav = [...document.querySelectorAll(".navout,.navlink")].find(b => b.textContent?.includes("Chat") && !b.dataset.ch);
        if (chatNav && !chatNav.querySelector(".chat-badge")) {
          const badge = document.createElement("span");
          badge.className = "chat-badge";
          badge.style.cssText = "background:#e53935;color:#fff;border-radius:50%;width:8px;height:8px;display:inline-block;margin-left:6px;vertical-align:middle;flex-shrink:0";
          chatNav.appendChild(badge);
        }
        // Show badge on channel button in sidebar (if chat is open)
        const chanBtn = document.querySelector(`.navlink[data-ch="${chan.id}"]`);
        if (chanBtn && !chanBtn.querySelector(".ch-badge")) {
          const b = document.createElement("span");
          b.className = "ch-badge";
          b.style.cssText = "background:#e53935;border-radius:50%;width:7px;height:7px;display:inline-block;margin-left:5px;vertical-align:middle;flex-shrink:0";
          chanBtn.appendChild(b);
        }
        // Toast if not already on chat screen
        if (!window.location.hash.includes("chat") && state.route !== "chat") {
          const who = msg.name || userName(msg.uid) || "Someone";
          const chanName = chan.kind === "dm" ? who : chan.name;
          toast("💬 " + who + " in " + chanName + (msg.text ? ": " + String(msg.text).slice(0, 50) : ""));
        }
      });
    _chatGlobalUnsubs.push(unsub);
  });
}

function clearChatBadge() {
  document.querySelectorAll(".chat-badge").forEach(b => b.remove());
}
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

async function ensureChannels() {
  const snap = await db.collection("channels").get();
  const existing = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Build full expected set
  const base = [{ name: "All staff", kind: "org" }, ...["Admin", "Program", "Accounts", "Fund raising", "Compliance"].map(d => ({ name: d, kind: "department", department: d })),
    ...state.offices.map(o => ({ name: o.name, kind: "office", officeId: o.id })), ...activeProjects().map(p => ({ name: p.name, kind: "project", projectId: p.id }))];
  // Only add channels that don't already exist (match by kind+name/projectId/officeId/department)
  const missing = base.filter(c => !existing.some(e =>
    e.kind === c.kind && (
      (c.kind === "org") ||
      (c.kind === "department" && e.department === c.department) ||
      (c.kind === "office" && e.officeId === c.officeId) ||
      (c.kind === "project" && e.projectId === c.projectId) ||
      (e.name === c.name)
    )
  ));
  if (missing.length) {
    const b = db.batch();
    missing.forEach(c => b.set(db.collection("channels").doc(), { ...c, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
    await b.commit();
    return (await db.collection("channels").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return existing;
}
const canSeeChannel = c => c.kind === "org" || (c.kind === "department" && (c.department === state.me.department || isAdmin() || has("board"))) ||
  (c.kind === "office" && (c.officeId === state.me.officeId || isAdmin())) || (c.kind === "project" && true) || (c.kind === "dm" && (c.members || []).includes(state.user.uid));

routes.chat = async (openId) => {
  setTitle("Chat & calls");
  if (typeof clearChatBadge === "function") clearChatBadge();
  const chans = (await ensureChannels()).filter(canSeeChannel);
  const dms = (await db.collection("channels").where("kind", "==", "dm").where("members", "array-contains", state.user.uid).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const all = [...chans.filter(c => c.kind !== "dm"), ...dms];
  const cur = all.find(c => c.id === (openId || state.chatId)) || all[0]; state.chatId = cur?.id;
  if (cur) { _chatUnread.delete(cur.id); if (_chatUnread.size === 0) clearChatBadge(); }
  html(`<div class="chatwrap">
    <div class="chanlist card">
      <div style="display:flex;gap:6px;margin-bottom:8px"><button class="btn small quiet" id="newDm">＋ Direct message</button></div>
      ${["org", "department", "office", "project", "dm"].map(k => { const list = all.filter(c => c.kind === k); return list.length ? `<div class="nav-section">${{ org: "Organisation", department: "Departments", office: "Offices", project: "Projects", dm: "Direct messages" }[k]}</div>` + list.map(c => `<button class="navlink ${c.id === cur?.id ? "active" : ""}" data-ch="${c.id}">${esc(c.kind === "dm" ? (c.members || []).filter(u => u !== state.user.uid).map(userName).join(", ") || "Direct" : c.name)}</button>`).join("") : ""; }).join("")}
    </div>
    <div class="chatmain card">
      ${cur ? `<div class="chathead"><b>${esc(cur.kind === "dm" ? (cur.members || []).filter(u => u !== state.user.uid).map(userName).join(", ") : cur.name)}</b>
        <div style="display:flex;gap:6px"><button class="btn small quiet" id="callA">📞 Audio</button><button class="btn small quiet" id="callV">🎥 Video</button><button class="btn small quiet" id="meet">Google Meet</button></div></div>
        <div class="msgs" id="msgs"><div class="empty">Loading…</div></div>
        <div class="composer"><input id="mtext" placeholder="Message… (Enter to send)" autocomplete="off">
          <label class="iconbtn" title="Attach">📎<input type="file" id="mfile" hidden accept="image/*,.pdf"></label>
          <button class="iconbtn" id="mvoice" title="Voice note">🎤</button><button class="btn small" id="msend">Send</button></div>` : `<div class="empty">No channels yet</div>`}
    </div></div><div id="callBox"></div>`);
  $("content").querySelectorAll("[data-ch]").forEach(b => b.onclick = () => routes.chat(b.dataset.ch));
  $("newDm").onclick = async () => { const name = prompt("Direct message with (type a name):"); if (!name) return;
    const u = state.users.find(x => x.active && x.name.toLowerCase().includes(name.toLowerCase())); if (!u) return toast("No such person");
    const ex = dms.find(d => (d.members || []).includes(u.id)); if (ex) return routes.chat(ex.id);
    const r = await db.collection("channels").add({ kind: "dm", members: [state.user.uid, u.id], name: "", createdAt: firebase.firestore.FieldValue.serverTimestamp() }); routes.chat(r.id); };
  if (!cur) return;
  if (chatUnsub) chatUnsub();
  chatUnsub = db.collection("channels").doc(cur.id).collection("messages").orderBy("at", "desc").limit(80).onSnapshot(s => {
    const msgs = s.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    $("msgs").innerHTML = msgs.map((m, i) => { const mine = m.uid === state.user.uid; const first = i === 0 || msgs[i - 1].uid !== m.uid;
      return `<div class="msg ${mine ? "mine" : ""}">${first && !mine ? `<div class="who">${esc(userName(m.uid) || m.name || "")}</div>` : ""}
        ${m.system ? `<div class="sys">${esc(m.text)}</div>` : ""}
        ${m.text && !m.system ? `<div class="bub">${esc(m.text)}</div>` : ""}
        ${m.audio ? `<div class="bub"><audio controls src="${m.audio}" style="max-width:220px"></audio></div>` : ""}
        ${m.file ? `<div class="bub"><a href="${m.file}" target="_blank" rel="noopener" download="${esc(m.fileName || "file")}">📎 ${esc(m.fileName || "attachment")}</a></div>` : ""}
        <div class="when">${m.at ? new Date(m.at.seconds * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</div></div>`; }).join("") || `<div class="empty">No messages yet — say hello</div>`;
    $("msgs").scrollTop = $("msgs").scrollHeight;
  });
  const send = async extra => { const text = $("mtext").value.trim(); if (!text && !extra) return;
    await db.collection("channels").doc(cur.id).collection("messages").add({ uid: state.user.uid, name: state.me.name, text, ...extra, at: firebase.firestore.FieldValue.serverTimestamp() });
    $("mtext").value = ""; };
  $("msend").onclick = () => send(); $("mtext").onkeydown = e => { if (e.key === "Enter") send(); };
  $("mfile").onchange = async e => { const f = e.target.files[0]; if (!f) return; const data = f.type.startsWith("image/") ? await blobToDataUrl(await compressImage(f, 1200, 0.6)) : await blobToDataUrl(f);
    if (data.length > 900000) { const l = driveLink("chat"); return toast(l ? "Too large — put it in the Chat files folder and paste the link" : "File too large — share a Drive link instead"); }
    await send({ file: data, fileName: f.name }); };
  $("mvoice").onclick = () => recordVoice(send);
  $("meet").onclick = () => window.open("https://meet.google.com/new", "_blank");
  $("callA").onclick = () => startCall(cur.id, false); $("callV").onclick = () => startCall(cur.id, true);
  watchCalls(cur.id);
};
async function recordVoice(send) {
  const btn = $("mvoice"); if (btn.dataset.rec) { btn.dataset.rec = ""; btn.textContent = "🎤"; window.__rec?.stop(); return; }
  try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const rec = new MediaRecorder(stream); const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size > 900000) return toast("Voice note too long (keep under ~60s)"); await send({ audio: await blobToDataUrl(blob) }); };
    window.__rec = rec; rec.start(); btn.dataset.rec = "1"; btn.textContent = "⏹"; toast("Recording… tap again to send");
    setTimeout(() => { if (btn.dataset.rec) { btn.dataset.rec = ""; btn.textContent = "🎤"; rec.stop(); } }, 60000);
  } catch { toast("Microphone not available"); }
}
/* --- peer-to-peer calls over Firestore signalling (same approach as SAKHI) --- */
async function startCall(channelId, video) {
  try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video }); } catch { return toast("Camera / microphone blocked"); }
  const callRef = db.collection("channels").doc(channelId).collection("calls").doc("active");
  pc = new RTCPeerConnection(ICE); localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const remote = new MediaStream(); pc.ontrack = e => e.streams[0].getTracks().forEach(t => remote.addTrack(t));
  showCallBox(remote, video, channelId);
  const offerCands = callRef.collection("offerCandidates");
  pc.onicecandidate = e => e.candidate && offerCands.add(e.candidate.toJSON());
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  await callRef.set({ offer: { sdp: offer.sdp, type: offer.type }, by: state.user.uid, byName: state.me.name, video, at: firebase.firestore.FieldValue.serverTimestamp() });
  await db.collection("channels").doc(channelId).collection("messages").add({ system: true, text: `${state.me.name} started a ${video ? "video" : "audio"} call`, uid: state.user.uid, at: firebase.firestore.FieldValue.serverTimestamp() });
  _callUnsubbers.push(callRef.onSnapshot(s => { const d = s.data(); if (d?.answer && pc && !pc.currentRemoteDescription) pc.setRemoteDescription(new RTCSessionDescription(d.answer)); }));
  _callUnsubbers.push(callRef.collection("answerCandidates").onSnapshot(s => s.docChanges().forEach(c => c.type === "added" && pc?.addIceCandidate(new RTCIceCandidate(c.doc.data())))));
}
async function joinCall(channelId, video) {
  try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video }); } catch { return toast("Camera / microphone blocked"); }
  const callRef = db.collection("channels").doc(channelId).collection("calls").doc("active"); const snap = await callRef.get(); if (!snap.exists) return toast("Call ended");
  pc = new RTCPeerConnection(ICE); localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const remote = new MediaStream(); pc.ontrack = e => e.streams[0].getTracks().forEach(t => remote.addTrack(t)); showCallBox(remote, video, channelId);
  pc.onicecandidate = e => e.candidate && callRef.collection("answerCandidates").add(e.candidate.toJSON());
  await pc.setRemoteDescription(new RTCSessionDescription(snap.data().offer));
  const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); await callRef.update({ answer: { sdp: ans.sdp, type: ans.type } });
  _callUnsubbers.push(callRef.collection("offerCandidates").onSnapshot(s => s.docChanges().forEach(c => c.type === "added" && pc?.addIceCandidate(new RTCIceCandidate(c.doc.data())))));
}
function showCallBox(remote, video, channelId) {
  $("callBox").innerHTML = `<div class="callpill"><div style="display:flex;gap:8px;align-items:center">
    ${video ? `<video id="rv" autoplay playsinline style="width:160px;border-radius:8px;background:#000"></video><video id="lv" autoplay playsinline muted style="width:70px;border-radius:8px;background:#000"></video>` : `<audio id="rv" autoplay></audio><span>🔊 On call</span>`}
    <button class="btn small quiet" id="mute">Mute</button><button class="btn small danger" id="hang">End</button></div></div>`;
  $("rv").srcObject = remote; if (video && $("lv")) $("lv").srcObject = localStream;
  $("mute").onclick = () => { const t = localStream.getAudioTracks()[0]; t.enabled = !t.enabled; $("mute").textContent = t.enabled ? "Mute" : "Unmute"; };
  $("hang").onclick = async () => endCall(channelId);
}
async function endCall(channelId) {
  _callUnsubbers.forEach(u => { try { u(); } catch(_){} }); _callUnsubbers = [];
  pc?.close(); pc = null; localStream?.getTracks().forEach(t => t.stop()); localStream = null; $("callBox").innerHTML = "";
  try { const ref = db.collection("channels").doc(channelId).collection("calls").doc("active"); await ref.delete(); } catch { }
}
function watchCalls(channelId) {
  if (callUnsub) callUnsub();
  callUnsub = db.collection("channels").doc(channelId).collection("calls").doc("active").onSnapshot(s => {
    const d = s.data(); if (!d || d.by === state.user.uid || pc) { if (!d) $("callBox").innerHTML = ""; return; }
    $("callBox").innerHTML = `<div class="callpill"><span>${esc(d.byName)} is calling (${d.video ? "video" : "audio"})</span>
      <button class="btn small" id="join">Join</button><button class="btn small quiet" id="ign">Ignore</button></div>`;
    $("join").onclick = () => joinCall(channelId, d.video); $("ign").onclick = () => $("callBox").innerHTML = "";
  });
}

/* ================= CASE PAGE: timeline, benefits, groups, activities ================= */
const SERVICE_TYPES = ["Government scheme", "Documentation", "Health", "Financial / material", "Food & lodging", "Information & access", "Counselling", "Skilling / livelihood", "Legal aid", "Other"];
const UPDATE_KINDS = ["Home visit", "Counselling", "Phone follow-up", "Referral", "Court / police", "Benefit delivered", "Group meeting", "Other"];
routes.caseUpdate = async personId => {
  const p = (await db.collection("persons").doc(personId).get()).data();
  setTitle("Case · " + (p?.name || ""));
  const [ups, bens] = await Promise.all([
    db.collection("caseUpdates").where("personId", "==", personId).orderBy("date", "desc").get().catch(() => ({ docs: [] })),
    db.collection("benefits").where("personId", "==", personId).get().catch(() => ({ docs: [] }))]);
  const U = ups.docs.map(d => ({ id: d.id, ...d.data() })), B = bens.docs.map(d => ({ id: d.id, ...d.data() }));
  const canEditBen = isProgramDept() || has("program_lead");
  html(`<div class="card"><h2>${esc(p.name)} <span class="tag">${esc(p.code || "")}</span> <span class="tag ${p.status === "open" ? "ok" : ""}">${esc(p.status || "open")}</span></h2>
    <p class="small">${esc(p.state || "")} · ${esc(p.district || "")} · ${esc(p.block || "")} · ${esc(p.slaveryType || "")} · ${esc(p.sex || "")} · ${esc(p.marital || "")}</p>
    <p class="small">Phone ${esc(p.phone || "—")} · Case worker ${esc(userName(p.caseWorkerId) || "—")} · Referral ${esc(p.source || "—")}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn small" onclick="go('person','${personId}')">Full profile</button>${p.status === "open" ? `<button class="btn small quiet" id="close">Close case</button>` : ""}</div></div>

  <div class="card"><h2>Add an update</h2><form id="uf">
    <div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${today()}"></label><label class="field"><span>What happened</span><select name="kind">${opt(UPDATE_KINDS)}</select></label></div>
    <label class="field"><span>Notes</span><textarea name="notes" required></textarea></label>
    <div class="two"><label class="field"><span>Programme / Project</span><select name="projectId">${programmeProjectOptions()}</select></label><label class="field"><span>Photo / video / document</span><input type="file" name="file" accept="image/*,video/*,.pdf,.doc,.docx"></label></div>
    <button class="btn small" type="submit">Add update</button></form></div>

  <div class="card"><h2>Record a benefit</h2><form id="bf">
    <div class="two"><label class="field"><span>Service</span><select name="service">${opt(SERVICE_TYPES)}</select></label><label class="field"><span>Date</span><input type="date" name="date" value="${today()}"></label></div>
    <div class="two"><label class="field"><span>Value ₹ (if any)</span><input name="value" type="number"></label><label class="field"><span>Funded by (programme / project)</span><select name="projectId">${programmeProjectOptions()}</select></label></div>
    <label class="field"><span>Description</span><input name="description" required></label>
    <button class="btn small" type="submit">Record</button></form>
    <div class="tablewrap" style="margin-top:10px"><table class="table"><tr><th>Date</th><th>Service</th><th>Description</th><th>₹</th><th>Project</th>${canEditBen ? "<th></th>" : ""}</tr>
      ${B.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(b => `<tr><td>${fmtD(b.date)}</td><td>${esc(b.service)}</td><td>${esc(b.description || "")}</td><td>${b.value ? Number(b.value).toLocaleString("en-IN") : ""}</td><td>${esc(projectName(b.projectId))}</td>${canEditBen ? `<td><button class="btn small quiet" data-bedit="${b.id}">Edit</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="5" class="empty">No benefits recorded</td></tr>`}</table></div></div>

  <div class="card"><h2>Timeline</h2><div class="list">
    ${U.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.kind)} · ${fmtD(u.date)}</div><div class="s">${esc(u.notes)}</div>
      <div class="s muted">${esc(userName(u.by))}${u.projectId ? " · " + esc(projectName(u.projectId)) : ""}${u.file ? ` · <a href="${u.file}" target="_blank" rel="noopener">attachment</a>` : ""}</div></div></div>`).join("") || `<div class="empty">No updates yet</div>`}</div></div>`);
  $("uf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); const f = fd.get("file"); delete d.file;
    if (f && f.size) { const s = await uploadToDrive(f,"program",f.name); if (s) { d.file = s.link; d.fileName = s.name; d.fileType = s.type; } }
    await db.collection("caseUpdates").add({ ...d, personId, by: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit("update", "caseUpdates", personId, d.kind);
    const cuLogText = d.date && d.date < today() ? `Logged case update for ${fmtD(d.date)} (entered today — backdated)` : `Logged a case update`;
    autoLogActivity(cuLogText).catch(()=>{});
    toast("Added"); routes.caseUpdate(personId); };
  $("bf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); d.value = d.value ? Number(d.value) : null;
    const editId = ($("bf") && $("bf").dataset.editingId) || "";
    if (editId) {
      await db.collection("benefits").doc(editId).update({ service: d.service, date: d.date, value: d.value, projectId: d.projectId, description: d.description, funding: [{ projectId: d.projectId, amount: d.value || 0 }], editedBy: state.user.uid, editedAt: today() });
      audit("update", "benefits", editId, d.service);
    } else {
      await db.collection("benefits").add({ ...d, personId, funding: [{ projectId: d.projectId, amount: d.value || 0 }], officeId: state.me?.officeId || state.user?.officeId || null, recordedBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      audit("create", "benefits", personId, d.service);
      autoLogActivity(d.date && d.date < today() ? `Recorded benefit dated ${fmtD(d.date)} (entered today — backdated)` : `Recorded a benefit${d.service?" · "+d.service:""}`).catch(()=>{});
    }
    if ($("bf")) { $("bf").dataset.editingId = ""; var bh2 = $("bf").querySelector("h2"); if (bh2) bh2.textContent = "Record a benefit"; }
    successFlash("Saved"); routes.caseUpdate(personId); };
  document.querySelectorAll("[data-bedit]").forEach(function(btn) {
    btn.onclick = function() {
      var bid = btn.dataset.bedit;
      var ben = B.find(function(x) { return x.id === bid; }); if (!ben) return;
      var form = $("bf"); if (!form) return;
      form.dataset.editingId = bid;
      var bh = form.querySelector("h2"); if (bh) bh.textContent = "Edit benefit";
      if (form.elements.service)     form.elements.service.value     = ben.service     || "";
      if (form.elements.date)        form.elements.date.value        = ben.date        || "";
      if (form.elements.description) form.elements.description.value = ben.description || "";
      if (form.elements.value)       form.elements.value.value       = ben.value       || "";
      if (form.elements.projectId)   form.elements.projectId.value   = ben.projectId   || "";
      form.scrollIntoView({ behavior: "smooth" });
    };
  });
  if ($("close")) $("close").onclick = async () => { const outcome = prompt("Outcome on closing:"); if (!outcome) return;
    await db.collection("persons").doc(personId).update({ status: "closed", outcome, closedAt: today(), closedBy: state.user.uid }); toast("Case closed"); routes.caseUpdate(personId); };
};

routes.groups = registerScreen({ route: "groups", col: "groups", title: "Groups / Community Collectives", orderBy: "name", dir: "asc",
  canEdit: () => isProgramDept() || has("field_staff", "program_lead"),
  before: d => { d.createdBy = state.user.uid; },
  scopeByArea: true,
  intro: "Community collectives of every kind. A group belongs to the place it meets in and to the programme it is part of: only the team working in that state, and programme leadership, can see it or add members.",
  fields: [{ k: "name", l: "Name of the group or collective", req: true, w: "half" },
    { k: "programmeId", l: "Programme", t: "programmes", w: "half" },
    { k: "state", l: "State", t: "state", w: "half" }, { k: "district", l: "District", t: "district", w: "half" },
    { k: "village", l: "Village / cluster", w: "half" }, { k: "officeId", l: "Office", t: "offices", w: "half" },
    { k: "projectId", l: "Project", t: "projects", w: "half" },
    { k: "leaderName", l: "Leader / president", w: "half" }, { k: "leaderPhone", l: "Her phone", w: "half" },
    { k: "leaderAlt", l: "Another number (husband, son, neighbour)", w: "half" },
    { k: "leaderAddress", l: "Where she lives", w: "half" },
    { k: "secretaryName", l: "Secretary", w: "half" }, { k: "secretaryPhone", l: "Secretary's phone", w: "half" },
    { k: "meetingPlace", l: "Where the group meets", w: "half" },
    { k: "formedOn", l: "Formed on", t: "date", w: "half" }, { k: "meetingDay", l: "Meeting day", w: "half" },
    { k: "savings", l: "Group savings ₹", t: "number", w: "half" }, { k: "notes", l: "Notes" }],
  cols: [{ k: "name", l: "Group" }, { k: "programmeId", l: "Programme", f: v => esc(programmeName(v)) }, { k: "village", l: "Village" }, { k: "district", l: "District" },
    { k: "state", l: "State" }, { k: "leaderName", l: "Leader", f: (v, r) => esc(v || "") + (r.leaderPhone && !isObserver() ? `<div class="s">${esc(r.leaderPhone)}</div>` : "") },
    { k: "memberCount", l: "Members", f: (v, r) => `${v || 0}` },
    { k: "savings", l: "Savings ₹", t: "money" }, { k: "projectId", l: "Project", t: "projects" }],
  actions: [{ k: "open", l: "Members", run: async r => { state.groupId = r.id; go("group"); } }],
  stats: rows => [["Groups / CC", rows.length], ["Members", rows.reduce((a, r) => a + (r.memberCount || 0), 0)],
    ["Savings ₹", rows.reduce((a, r) => a + (r.savings || 0), 0).toLocaleString("en-IN")]] });

/* ---- one group and its members ---- */
routes.group = async (id) => {
  id = id || state.groupId; state.groupId = id;
  const snap = await db.collection("groups").doc(id).get().catch(() => null);
  if (!snap || !snap.exists) return routes.groups();
  const g = { id, ...snap.data() };
  if (!inMyArea(g)) return html(`<div class="card"><h2>Not your area</h2>
    <p class="small muted">${esc(g.name)} meets in ${esc(g.district || g.state || "another area")}. Collectives are seen by the team working there. Ask the Program Officer if you need access.</p>
    <button class="btn small quiet" onclick="go('groups')">Back to groups / CC</button></div>`);
  setTitle(g.name || "Group");
  const canEdit = (isProgramDept() || has("field_staff", "program_lead")) && inMyArea(g);
  const ms = (await db.collection("groupMembers").where("groupId", "==", id).limit(400).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() }));
  const inr = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
  html(`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div><h2 style="margin:0">${esc(g.name)}</h2>
        <p class="small muted" style="margin:3px 0">${esc(programmeName(g.programmeId) || g.type || "")} · ${esc([g.village, g.district, g.state].filter(Boolean).join(", "))}${g.leaderName ? " · led by " + esc(g.leaderName) : ""}</p>
        ${g.leaderName && !isObserver() ? `<p class="small" style="margin:4px 0">
          <b>${esc(g.leaderName)}</b>${g.leaderPhone ? ` · <a href="tel:${esc(g.leaderPhone)}">${esc(g.leaderPhone)}</a>` : ""}${g.leaderAlt ? ` · alt ${esc(g.leaderAlt)}` : ""}
          ${g.secretaryName ? `<br>Secretary: ${esc(g.secretaryName)}${g.secretaryPhone ? ` · <a href="tel:${esc(g.secretaryPhone)}">${esc(g.secretaryPhone)}</a>` : ""}` : ""}
          ${g.meetingPlace ? `<br>Meets at ${esc(g.meetingPlace)}` : ""}</p>` : ""}
        <p style="margin:4px 0"><span class="tag ok">${ms.length} members</span>${g.savings ? ` <span class="tag">${inr(g.savings)} saved</span>` : ""}${g.formedOn ? ` <span class="tag">formed ${fmtD(g.formedOn)}</span>` : ""}${g.meetingDay ? ` <span class="tag">meets ${esc(g.meetingDay)}</span>` : ""}</p></div>
      <button class="btn small quiet" onclick="go('groups')">All groups / CC</button></div></div>

    ${canEdit ? `<div class="card"><h2>Add a member</h2>
      <p class="small muted">A member who is already a registered Sakhi keeps her case linked — put her Sakhi ID in. Others are recorded here only.</p>
      <form id="gm">
        <div class="two"><label class="field"><span>Name</span><input name="name" required></label>
          <label class="field"><span>Sakhi ID, if she is registered</span><input name="personCode" placeholder="EP-HR/YN/NA/187-2023"></label></div>
        <div class="two"><label class="field"><span>Age</span><input type="number" step="any" inputmode="decimal" name="age"></label>
          <label class="field"><span>Her phone</span><input name="phone" inputmode="tel"></label></div>
        <div class="two"><label class="field"><span>Another number (husband, son, neighbour)</span><input name="altPhone" inputmode="tel"></label>
          <label class="field"><span>Whose number is it?</span><input name="altPhoneWhose" placeholder="her son Rakesh"></label></div>
        <label class="field"><span>Where she lives</span><input name="address" placeholder="House, lane, village"></label>
        <div class="two"><label class="field"><span>Role in the group</span><select name="role">${["Member", "President", "Secretary", "Treasurer", "Salah Sakhi"].map(x => `<option>${x}</option>`).join("")}</select></label>
          <label class="field"><span>Joined the group</span><input type="date" name="joined" value="${today()}"></label></div>
        <label class="field"><span>Notes</span><input name="notes"></label>
        <button class="btn small" type="submit">Add member</button><div class="err" id="gmErr"></div></form></div>` : ""}

    <div class="card"><h2>Members (${ms.length})</h2><div class="tablewrap"><table class="table">
      <tr><th>Name</th><th>Role</th><th>Age</th><th>Phone</th><th>Other number</th><th>Where she lives</th><th>Case</th><th>Joined</th>${canEdit ? "<th></th>" : ""}</tr>
      ${ms.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(m => `<tr>
        <td>${esc(isObserver() ? (m.personCode ? String(m.personCode).split("/").pop() : "Member") : m.name)}</td>
        <td>${esc(m.role || "Member")}</td><td>${m.age || ""}</td>
        <td>${isObserver() ? "" : (m.phone ? `<a href="tel:${esc(m.phone)}">${esc(m.phone)}</a>` : "")}</td>
        <td class="small">${isObserver() ? "" : (m.altPhone ? `<a href="tel:${esc(m.altPhone)}">${esc(m.altPhone)}</a>${m.altPhoneWhose ? ` <span class="muted">${esc(m.altPhoneWhose)}</span>` : ""}` : "")}</td>
        <td class="small">${esc(isObserver() ? "" : (m.address || ""))}</td>
        <td class="small">${m.personId ? `<button class="btn small quiet" data-case="${m.personId}">open case</button>` : esc(m.personCode || "")}</td>
        <td>${fmtD(m.joined)}</td>
        ${canEdit ? `<td><button class="btn small danger" data-rm="${m.id}">✕</button></td>` : ""}</tr>`).join("")
        || `<tr><td colspan="9" class="empty">No members yet</td></tr>`}</table></div>
      ${canEdit && ms.length ? `<button class="btn small quiet" style="margin-top:8px" id="gexp">Export the member list</button>` : ""}
      <p class="small muted" style="margin-top:8px">Phone numbers are for the team working with this group. They are not shown to observers and never leave the app except in this export.</p></div>`);
  if ($("gexp")) $("gexp").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ms.map(m => ({ Name: m.name, Role: m.role, Age: m.age, Phone: m.phone,
      "Other number": m.altPhone, "Whose": m.altPhoneWhose, "Where she lives": m.address, "Sakhi ID": m.personCode, Joined: m.joined, Notes: m.notes }))), "Members");
    XLSX.writeFile(wb, `${(g.name || "group").replace(/[^\w-]+/g, "-")}-members.xlsx`); };
  $("content").querySelectorAll("[data-case]").forEach(b => b.onclick = () => { state.personId = b.dataset.case; go("person"); });
  $("content").querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => { if (!confirm("Remove her from this group?")) return;
    await db.collection("groupMembers").doc(b.dataset.rm).delete();
    await db.collection("groups").doc(id).update({ memberCount: Math.max(0, ms.length - 1) });
    audit("remove", "groupMembers", b.dataset.rm, g.name); routes.group(id); });
  if ($("gm")) $("gm").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    d.age = d.age ? Number(d.age) : null; d.groupId = id; d.groupName = g.name; d.state = g.state || null; d.district = g.district || null;
    if (d.personCode) { const m = await db.collection("persons").where("code", "==", String(d.personCode).trim()).limit(1).get().catch(() => ({ empty: true }));
      if (m.empty) { $("gmErr").textContent = "No case matches " + d.personCode + " — she will be added without a case link."; }
      else d.personId = m.docs[0].id; }
    await db.collection("groupMembers").add({ ...d, createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection("groups").doc(id).update({ memberCount: ms.length + 1 });
    audit("create", "groupMembers", null, `${d.name} → ${g.name}`); toast("Added"); routes.group(id); };
};

routes.activities = registerScreen({ route: "activities", col: "activities", title: "Activities & work plan", orderBy: "period", dir: "asc", canEdit: () => isProgramDept() || has("super_admin","founder","program_officer"),
  intro: "The project work plan. Targets here; 'done' counts automatically from benefits, events and verified assignments linked to the activity.",
  fields: [{ k: "programmeId", l: "Programme", t: "programmes", w: "half" }, { k: "projectId", l: "Project (funding it)", t: "projects", w: "half" },
    { k: "code", l: "Activity code", ph: "A1.2", w: "half" }, { k: "name", l: "Activity", req: true },
    { k: "head", l: "Budget head", w: "half" }, { k: "target", l: "Target", t: "number", w: "half" }, { k: "unit", l: "Unit", ph: "women, meetings, cases", w: "half" }, { k: "period", l: "Period", ph: "Q3 2026-27", w: "half" },
    { k: "leadId", l: "Lead", t: "users", w: "half" }, { k: "status", l: "Status", t: "select", o: ["Planned", "In progress", "Completed", "Dropped"], w: "half" }, { k: "notes", l: "Notes" }],
  cols: [{ k: "projectId", l: "Project", t: "projects" }, { k: "code", l: "Code" }, { k: "name", l: "Activity" }, { k: "target", l: "Target" }, { k: "unit", l: "Unit" }, { k: "period", l: "Period" }, { k: "leadId", l: "Lead", t: "users" }, { k: "status", l: "Status", f: statusTag }] });

routes.events = registerScreen({ route: "events", col: "eventReports", title: "Event report", orderBy: "date", nameKey: "heading",
  canEdit: () => isActive() && !isObserver(),
  intro: "Anyone doing programme work files one — field staff, coordinators, leads and the Program Officer alike. Attach the photographs, the attendance sheet, whatever shows it happened.",
  fields: [{ k: "orgEventId", l: "Link to a planned event (optional)", t: "orgEvents", w: "half", ph: "— select if filing against a planned event —" },
    { k: "date", l: "Date", t: "date", d: today(), w: "half" },
    { k: "activity", l: "Activity", t: "select", o: ["Home visit", "Workshop", "Training", "Follow-up", "Campaign", "Village / community meeting", "Group meeting", "Re-enrolment of drop-out girls", "Emergency support", "Reintegration", "Crisis counselling", "Legal / material help", "Consultation", "CBO formation", "Skill-building", "Club meeting", "Awareness event", "Government liaison", "Other"], w: "half" },
    { k: "heading", l: "Heading", req: true },
    { k: "projectId", l: "Project", t: "projects", w: "half" },
    { k: "activityId", l: "Which activity in the work plan does this deliver?", t: "activities", w: "half" },
    { k: "programmeId", l: "Programme", t: "programmes", w: "half" },
    { k: "sessions", l: "How many sessions or sittings, if more than one", t: "number", w: "half" },
    { k: "place", l: "Place", req: true, w: "half" },
    { k: "state", l: "State", t: "state", w: "half" }, { k: "district", l: "District", t: "district", w: "half" },
    { k: "participants", l: "People present (total)", t: "number", w: "half" },
    { k: "women", l: "of whom women", t: "number", w: "half" },
    { k: "girls", l: "of whom girls under 18", t: "number", w: "half" },
    { k: "Sakhis", l: "of whom Sakhis", t: "number", w: "half" },
    { k: "phone", l: "Contact phone", w: "half" },
    { k: "withWhom", l: "Held with / alongside", ph: "Sakhi Mandal, panchayat, BDO office", w: "half" },
    { k: "report", l: "What happened", t: "textarea", req: true },
    { k: "outcome", l: "What came of it", t: "textarea" },
    { k: "nextStep", l: "What happens next", w: "half" },
    { k: "photos", l: "Photographs (select multiple)", t: "files" },
    { k: "reportDoc", l: "Report document or plan (PDF, Word)", t: "file" }],
  prefill: () => { const r = state.reportFor; if (!r) return {}; state.reportFor = null;
    return { projectId: r.projectId, programmeId: r.programmeId || "", activityId: r.activityId }; },
  before: d => { d.uid = state.user.uid; const myMgrs = mgrs(state.me); d.managerIds = myMgrs; d.status = myMgrs.length ? "submitted" : "approved"; // no manager → skip straight to accountant for payment
    ["participants", "women", "girls", "Sakhis"].forEach(k => { if (d[k] !== undefined && d[k] !== null) d[k] = Number(d[k]) || 0; });
    if (d.women && d.participants && d.women > d.participants) throw new Error("More women than people present — check the numbers.");
  },
  cols: [{ k: "date", l: "Date", t: "date" }, { k: "activity", l: "Activity" }, { k: "heading", l: "Heading" },
    { k: "place", l: "Place" }, { k: "district", l: "District" },
    { k: "participants", l: "People", f: (v, r) => v ? `${v}${r.women ? `<div class="s">${r.women} women</div>` : ""}` : "" },
    { k: "programmeId", l: "Programme", f: v => esc(programmeName(v)) },
    { k: "files", l: "Attached", f: (v, r) => (v || []).length ? `${(v || []).length} 📎` : (r.photo ? "1 📎" : "") },
    { k: "uid", l: "By", t: "users" }, { k: "status", l: "Status", f: statusTag }],
  actions: [
    { k: "files", l: "Attach", show: r => r.uid === state.user.uid || isManager() || isAdmin(),
      run: async (r, ref) => { const files = await askEventFiles(r); if (!files) return;
        await ref.update({ files }); audit("attach", "eventReports", r.id, files.length + " file(s)");
        toast(files.length + " attached"); } },
    { k: "v", l: "Verify", show: r => r.status === "submitted" && (isManager() || isAdmin()),
      run: async (r, ref) => ref.update({ status: "verified", verifiedBy: state.user.uid, verifiedOn: today() }) }],
  filter: r => {
    // Managers, admins, program officers see all
    if (has("super_admin","admin","program_officer","program_coord") || isManager() || isAdmin()) return true;
    // Field staff, volunteers, support staff see only their own
    return r.uid === state.user.uid || (r.managerIds||[]).includes(state.user.uid);
  },
  filter: r => {
    if (has("super_admin","admin","program_officer","program_coord") || isManager() || isAdmin()) return true;
    return r.uid === state.user.uid || (r.managerIds||[]).includes(state.user.uid);
  },
  stats: rows => { const fy = fyOfDate();
    const inFY = rows.filter(r => (r.date || "") >= fy.slice(0, 4) + "-04-01");
    return [["Events this year", inFY.length],
      ["People reached", inFY.reduce((a, r) => a + (Number(r.participants) || 0), 0)],
      ["Women", inFY.reduce((a, r) => a + (Number(r.women) || 0), 0)],
      ["Waiting to be verified", rows.filter(r => r.status === "submitted").length]]; }
});

/* Several files against one event — photographs, the attendance sheet, a news cutting.
   Small images stay with the record; anything larger goes to the shared drive. */
function askEventFiles(rec) {
  return new Promise(resolve => {
    const have = rec.files || [];
    const box = document.createElement("div"); box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>Attach to this event</h2>
      <p class="small muted">${esc(rec.heading || "")}${rec.date ? " · " + fmtD(rec.date) : ""}</p>
      ${have.length ? `<div class="list" style="margin-bottom:8px">${have.map((f, i) => `<div class="item"><div class="grow"><div class="s">${esc(f.name)}</div></div>
        ${f.link ? `<a class="btn small quiet" href="${f.link}" target="_blank" rel="noopener">Open</a>` : ""}
        <button class="btn small danger" data-rmf="${i}">✕</button></div>`).join("")}</div>` : ""}
      <label class="field"><span>Add photographs, attendance sheet, cuttings</span>
        <input type="file" id="evFiles" accept="image/*,video/*,.pdf,.doc,.docx" multiple>
        <span class="small muted" id="evNote">Several at once is fine.</span></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="evCancel">Cancel</button><button class="btn small" id="evOk">Done</button></div></div>`;
    document.body.appendChild(box);
    const files = [...have];
    const paint = () => { const n = box.querySelector("#evNote"); n.textContent = `${files.length} attached.`; };
    box.querySelectorAll("[data-rmf]").forEach(b => b.onclick = () => { files.splice(Number(b.dataset.rmf), 1); b.closest(".item").remove(); paint(); });
    box.querySelector("#evFiles").onchange = async e => {
      const note = box.querySelector("#evNote");
      for (const f of [...e.target.files]) {
        note.textContent = `Saving ${f.name}…`;
        try {
          if (f.size < 700000 && /^image\//.test(f.type)) {
            const sf345 = await uploadToDrive(f,'program',f.name); if(sf345) files.push(sf345);
          } else {
            const up = await uploadToDrive(f, "program", `${rec.heading || "event"} ${rec.date || ""}`);
            if(up&&up.link) files.push({ name: up.name, at: today(), link: up.link, url: up.link, driveId: up.id });
          }
        } catch (err) { note.textContent = err.message; return; }
      }
      paint();
    };
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#evCancel").onclick = () => close(null);
    box.querySelector("#evOk").onclick = () => close(files);
    box.onclick = e => { if (e.target === box) close(null); };
  });
}

/* ================= ORGANIGRAM CHART ================= */
routes.orgchart = async () => {
  setTitle("Organigram");
  const posts = (await db.collection("posts").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  if (!posts.length) return html(`<div class="card"><div class="empty">No posts yet — add them in Posts & organigram, or import them in Bulk import.</div></div>`);
  const byTitle = {}; posts.forEach(p => byTitle[p.title] = p);
  const children = t => posts.filter(p => (p.reportsTo || "") === t);
  const roots = posts.filter(p => !p.reportsTo || !byTitle[p.reportsTo]);
  const colour = { Admin: "#2E6B4F", Program: "#1F4D8C", Accounts: "#7A5230", "Fund raising": "#6B2E6B", Compliance: "#8C3A1F", Governance: "#444" };
  const node = p => `<li><div class="orgnode" style="border-top:4px solid ${colour[p.department] || "#444"}">
      <div class="t">${esc(p.title)}</div>
      <div class="h">${esc(userName(p.holderId) || p.holderName || "Vacant post")}</div>
      <div class="d">${esc(p.department || "")}${p.officeId ? " · " + esc(officeName(p.officeId)) : ""}</div>
      ${p.functional ? `<div class="f">⇠ ${esc(p.functional)}</div>` : ""}</div>
    ${children(p.title).length ? `<ul>${children(p.title).map(node).join("")}</ul>` : ""}</li>`;
  html(`<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn small quiet" id="pdf">Export PDF</button><button class="btn small quiet" onclick="go('posts')">Edit posts</button><button class="btn small quiet" onclick="go('structure')">Change structure</button>
      <span class="small muted">Solid line = line of reporting · ⇠ = functional supervision</span></div>
    <div id="chart" class="orgchart"><ul>${roots.map(node).join("")}</ul></div></div>`);
  $("pdf").onclick = async () => { if (!window.html2canvas) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const c = await html2canvas($("chart"), { scale: 2, backgroundColor: "#fff" });
    const pdf = new jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a3" }); const w = 400, h = w * c.height / c.width;
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 10, 10, w - 20, h); pdf.save(`Empower-People-organigram-${today()}.pdf`); };
};

/* ================= DRIVE ATTACHMENTS ================= */
routes.drive = async () => {
  setTitle("Drive & attachments");
  const s = (await db.collection("settings").doc("drive").get()).data() || {};
  // The folders that exist in the EP APP shared drive, so nothing has to be pasted by hand.
  const F = {
    root:        "1vjzxS6_unZyhAL2ZsHczgJY2yFAddu86",
    program:     "1WEJ7mOEcpKAxcotLUw8D66mo0Q3G6u3S",
    accounts:    "1DmAVENmcXHC_XHMwazMzDEus5Q5AE5_I",
    admin:       "1WZPYFAy-S-BgpM_sJLPsaJbxzC2veyj_",
    fundraising: "1f6rpPIy74iWTDT-HAlLvchIIKuLobHnI",
    compliance:  "1yYadc2j1UA7VjJ6RKy3FmnrxgShI8_Qz",
    governance:  "1jwB3spX-SM_M4FO_J2ZKs3xj4v57o-A4",
    templates:   "1_t4Tkb33pCiLZjxxNxO0OK8ApKnnJRaa",
    chat:        "1ChLd-CxNXnBtp1Vi0tN5DzMdtarXe6sQ",
    backups:     "14CuNuD1g1UKkpRPvQ937OaDAk3vJKd9I"
  };
  const folderUrl = k => `https://drive.google.com/drive/folders/${F[k]}`;
  const regenCard = (has("super_admin","founder")) ? `<div class="card" style="border-left:4px solid #C8922F;margin-bottom:8px"><p class="small muted" style="margin-bottom:6px">Fix existing forms — regenerate HTML to include names, UIDs and signatures.</p><button class="btn small" onclick="regenAllForms()">Regenerate all forms</button></div>` : "";
  const ROOT = F.root;
  const TREE = {
    "01 Programmes": ["Sakhi case documents", "Beneficiary records", "Groups and community collectives", "Event reports & photographs", "Implementation plans & work plans", "Case studies (anonymised)"],
    "02 Accounts": ["Vouchers & bills", "Receipts & FIRC", "Bank statements", "Salary, PF, ESI & TDS", "Fund Tracker", "Budgets & utilisation certificates"],
    "03 Administration, HR & Communication": ["Staff files", "Appointment letters & contracts", "Dak — inward & outward scans", "Assets — invoices & warranties", "Office, lease & utility papers", "Documents & certificates", "Identity cards"],
    "04 Project Development, Research & Innovations": ["Proposals submitted", "Donor agreements", "Donor reports", "Research & publications", "Communications & media", "Volunteers"],
    "05 Compliance": ["FCRA", "Income tax — 12A, 80G & returns", "Audited accounts", "Board & committee meetings", "Policies", "Statutory filings"],
    "06 Governance": ["Registration papers", "Board resolutions", "Organigram & terms of reference"],
    "07 Templates & forms": [], "Backups": ["Daily (3 months)", "Monthly (7 years)", "Financial year end (permanent)"]
  };
  const link = s.root || `https://drive.google.com/drive/folders/${ROOT}`;
  html(regenCard + `<div class="card"><h2>The shared drive</h2>
      <p class="small muted">Everything the organisation keeps lives in the <b>EP APP</b> shared drive, in <b>Empower People Office</b>. The folders below already exist. The drive belongs to the organisation, not to any one account, so it survives people leaving.</p>
      <a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">Open the shared drive</a></div>
    <div class="card"><h2>How it is arranged</h2><div class="list">
      ${Object.entries(TREE).map(([top, subs]) => { const key = { "01 Programmes": "program", "02 Accounts": "accounts", "03 Administration, HR & Communication": "admin", "04 Project Development, Research & Innovations": "fundraising", "05 Compliance": "compliance", "06 Governance": "governance", "07 Templates & forms": "templates", "08 Chat files": "chat", "Backups": "backups" }[top];
        return `<div class="item"><div class="grow"><div class="t">${esc(top)}</div>
        <div class="s">${subs.length ? subs.map(esc).join(" · ") : (top.indexOf("Chat") > -1 ? "files shared in the app's chat" : "blank forms and templates")}</div></div>
        ${key ? `<a class="btn small quiet" href="${folderUrl(key)}" target="_blank" rel="noopener">Open</a>` : ""}</div>`; }).join("")}</div>
      <p class="small muted" style="margin-top:8px">Put a document in the folder of the department that owns it. Anything that belongs to a Sakhi goes in <b>01 Programmes / Sakhi case documents</b> under her case number, never under her name.</p></div>
    <div class="card"><h2>Links the app uses</h2>
      <p class="small muted">Paste a folder link here and the app shows an “Open folder” button where that kind of file belongs. Leave blank to use the main drive.</p>
      <form id="df">${[["root", "Shared drive / root folder"], ["program", "Program · persons & cases"], ["accounts", "Accounts · vouchers & receipts"],
          ["admin", "Admin · staff, assets, handovers"], ["fundraising", "Fund raising · proposals"], ["compliance", "Compliance · registrations & policies"],
          ["governance", "Governance · registration & board papers"], ["templates", "Templates & forms"], ["chat", "Chat files"], ["backups", "Backups"]]
        .map(([k, l]) => `<label class="field"><span>${l}</span><input name="${k}" value="${esc(s[k] || folderUrl(k))}"></label>`).join("")}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" type="submit">Save</button>
        <button class="btn small quiet" type="button" id="reset">Put the folders that exist back</button></div></div>
    <div class="card"><h2>File upload — Apps Script</h2>
      <p class="small muted">Paste the Apps Script web app URL here. Once set, every file attached in the app goes straight to the shared drive — no Google sign-in popup for users, no friction.</p>
      <form id="uf"><label class="field"><span>Apps Script upload URL</span><input name="uploadUrl" value="${esc(s.uploadUrl||"")}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <button class="btn small" type="submit">Save</button>${s.uploadUrl ? ` <span class="tag ok">active</span>` : ` <span class="tag warn">not set — falling back to Google sign-in</span>`}</form></div>
    <div class="card"><h2>What the app keeps, and what the drive keeps</h2><ul class="small" style="margin:0 0 0 18px;line-height:1.8">
      <li>Photographs and small scans are compressed and stored with the record, so they work offline and are inside the nightly backup.</li>
      <li>Anything above about 1 MB — a signed agreement, an audit file, a video — belongs in the drive, with the link pasted into the record.</li>
      <li>The nightly backup writes the whole database into <b>Backups</b> every night, kept three months daily, seven years monthly, and permanently at each financial year end.</li></ul></div>`);
  $("df").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await db.collection("settings").doc("drive").set(d, { merge: true }); state.drive = d; successFlash("Saved"); };
  if ($("uf")) $("uf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    await db.collection("settings").doc("drive").set(d, { merge: true }); state.drive = {...(state.drive||{}), ...d}; successFlash("Saved"); routes.drive(); };
  if ($("reset")) $("reset").onclick = async () => { const d = {}; Object.keys(F).forEach(k => d[k] = folderUrl(k));
    await db.collection("settings").doc("drive").set(d, { merge: true }); state.drive = d; toast("Restored"); routes.drive(); };
};
window.driveLink = key => (state.drive || {})[key] || "";

/* ================= LEADERSHIP DASHBOARD (Founder, board, heads) ================= */
const canLead = () => has("super_admin", "admin", "board", "director_acf", "program_officer", "fundraising", "compliance_head");
function _renderLead(d, fy, fromCache) {
  // Render dashboard from cached stats (d) — avoids 5,000+ reads
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const bar = obj => obj ? Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>{
    const w=Math.round(v/Math.max(...Object.values(obj))*100);
    return `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${esc(k)}</span><b>${v}</b></div>
      <div style="height:7px;background:var(--bg);border-radius:4px;overflow:hidden"><div style="width:${w}%;height:100%;background:var(--green)"></div></div></div>`;}).join("")||`<div class="empty">No data</div>` : `<div class="empty">No data</div>`;
  const liveP = (state.projects||[]).filter(isLiveProject);
  html(`<div class="grid">
    <div class="card stat"><span class="muted small">Sakhis registered</span><b>${(d.personCount||0).toLocaleString("en-IN")}</b>
      <span class="small muted" style="display:block;margin-top:2px">${d.newThisFY||0} new in ${fy.label}</span></div>
    <div class="card stat"><span class="muted small">Open cases</span><b>${(d.openCases||0).toLocaleString("en-IN")}</b></div>
    <div class="card stat"><span class="muted small">Benefits delivered ${fy.label}</span><b>${(d.benCount||0).toLocaleString("en-IN")}</b><span class="small muted">${inr(d.benValue||0)} value</span></div>
    <div class="card stat"><span class="muted small">Groups</span><b>${d.groupCount||0}</b><span class="small muted">${(d.groupMembers||0).toLocaleString("en-IN")} members</span></div>
    <div class="card stat"><span class="muted small">Active staff</span><b>${d.activeStaff||0}</b></div>
    <div class="card stat"><span class="muted small">Live projects</span><b>${liveP.length}</b></div></div>
  ${(d.alerts||[]).length ? `<div class="card"><h2>Needs attention</h2><div class="list">${(d.alerts||[]).map(a=>`<div class="item"><div class="grow"><div class="t">${esc(a.t)}</div><div class="s">${esc(a.dept)}</div></div><span class="tag ${a.kind}">${a.kind==="bad"?"urgent":"soon"}</span><button class="btn small quiet" data-go="${a.route}">Open</button></div>`).join("")}</div></div>` : ""}
  <div class="grid">
    <div class="card"><h2>Money · ${fy.label}</h2>
      <table class="table"><tr><td>Sanctioned · ${liveP.length} running</td><td style="text-align:right"><b>${inr(d.sanctioned||0)}</b></td></tr>
      <tr><td>Received</td><td style="text-align:right"><b>${inr(d.received||0)}</b></td></tr>
      <tr><td>Spent</td><td style="text-align:right"><b>${inr(d.spent||0)}</b></td></tr>
      <tr><td>Balance in hand</td><td style="text-align:right"><b>${inr((d.received||0)-(d.spent||0))}</b></td></tr>
      <tr><td>Yet to receive</td><td style="text-align:right">${inr(Math.max(0,(d.sanctioned||0)-(d.received||0)))}</td></tr></table>
      <button class="btn small quiet" style="margin-top:8px" data-go="funds">Fund position</button></div>
    <div class="card"><h2>Fund raising</h2>
      <table class="table"><tr><td>Proposals sent</td><td style="text-align:right"><b>${d.propsTotal||0}</b></td></tr>
      <tr><td>Approved</td><td style="text-align:right"><b>${d.approved||0}</b></td></tr>
      <tr><td>Waiting for response</td><td style="text-align:right">${d.waiting||0}</td></tr>
      <tr><td>Success rate</td><td style="text-align:right"><b>${d.propsTotal ? Math.round((d.approved||0)/d.propsTotal*100) : 0}%</b></td></tr>
      <tr><td>Reports due in 45 days</td><td style="text-align:right">${d.dueSoonCount||0}</td></tr></table>
      <button class="btn small quiet" style="margin-top:8px" data-go="frProposals">Proposals</button></div>
    <div class="card"><h2>Where we work</h2>${bar(d.byDistrict)}<button class="btn small quiet" style="margin-top:8px" data-go="persons">Sakhis</button></div>
    <div class="card"><h2>Services delivered ${fy.label}</h2>${bar(d.byService)}</div>
  </div>
  <div class="card"><p class="small muted" style="margin:0">${fromCache ? "From cached data · " : ""}
    <button class="btn small quiet" onclick="routes.lead(true)">↻ Refresh dashboard</button></p></div>`);
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
}

routes.lead = async (forceRefresh) => {
  setTitle("Organisation dashboard");
  html(`<div class="card"><div class="empty">Loading the organisation…</div></div>`);

  const fy = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return { label: `${y}-${String(y + 1).slice(2)}`, from: `${y}-04-01`, to: `${y + 1}-03-31` }; })();

  // --- Cache check: 1 read instead of 5,000+ on cache hit ---
  const cacheRef = db.collection("appSettings").doc("dashStats");
  if (!forceRefresh) {
    try {
      const cached = await cacheRef.get();
      if (cached.exists && cached.data().fy === fy.label) {
        const age = (Date.now() - (cached.data().ts || 0));
        if (age < 60 * 60 * 1000) { // 1 hour TTL
          _renderLead(cached.data(), fy, true); return;
        }
      }
    } catch(_) {}
  }

  // --- Compute: optimised queries ---
  const g = (c) => db.collection(c).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const gFY = (c, field) => db.collection(c).where(field, ">=", fy.from).where(field, "<=", fy.to).get()
    .then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);

  const [persons, benefits, rec, exp, heads, props, obl, regs, stat, grp, events, inc, jour] = await Promise.all([
    g("persons"),          // needed for district map + new FY count
    gFY("benefits", "date"),    // FY only — was all 816, now just this year's
    gFY("incomeReceipts", "date"), // FY only
    gFY("expenses", "date"),    // FY only
    g("budgetHeads"),
    g("proposals"),
    g("obligations"),
    g("registrations"),
    g("statutory"),
    g("groups"),
    g("eventReports"),
    g("incidents"),
    g("journeys"),
  ]);
  const users = state.users || []; // use already-loaded users, saves 28 reads
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const sum = (a, f) => a.reduce((x, y) => x + (Number(y[f]) || 0), 0);
  const inFY = d => d && d >= fy.from && d <= fy.to;
  const thisMonth = today().slice(0, 7);

  const received = sum(rec, "amount"), spent = sum(exp, "amount");
  const benFY = benefits; // already filtered to FY in query
  /* Only the projects that are running, and only rupee budgets — a dollar grant
     cannot be added to a rupee one. Foreign-currency projects are listed separately. */
  const liveP = (state.projects || []).filter(isLiveProject);
  /* Everything is kept in rupees. A foreign grant is recorded in its own currency
     on the project and on each receipt, and shown here for reference only. */
  const sanctioned = liveP.reduce((a, p) => a + (Number(p.budget) || 0), 0) || sum(heads.filter(h => !h.orgBorne), "total");
  const byCur = {};
  liveP.filter(p => p.grantCurrency && Number(p.grantAmount)).forEach(p => {
    byCur[p.grantCurrency] = (byCur[p.grantCurrency] || 0) + Number(p.grantAmount); });
  const foreignLine = Object.entries(byCur).map(([cur, amt]) => `${esc(cur)} ${amt.toLocaleString("en-IN")}`).join(" · ");
  const byFund = {}; state.projects.forEach(p => { const k = p.fundType || "Domestic"; byFund[k] = byFund[k] || { rec: 0, sp: 0 };
    byFund[k].rec += sum(rec.filter(r => r.projectId === p.id), "amount"); byFund[k].sp += sum(exp.filter(e => e.projectId === p.id), "amount"); });
  const openCases = persons.filter(p => (p.status || "open") === "open").length;
  /* The year a case was opened is in its Sakhi ID. Where no date was recorded,
     that year is the registration year — otherwise 848 women count as never registered. */
  const yearOf = p => { if (p.registeredOn) return p.registeredOn;
    const m = String(p.code || "").match(/-(\d{4})$/);
    return m ? m[1] + "-04-01" : null; };            // the first day of that financial year
  const newThisFY = persons.filter(p => inFY(yearOf(p))).length;
  // benFY already set above — benefits were queried with FY filter
  const approved = props.filter(p => /^Approved/.test(p.status)).length, waiting = props.filter(p => /Waiting|No response/.test(p.status)).length;
  const dueSoon = obl.filter(o => !o.done && (new Date(o.due) - Date.now()) / 86400000 <= 45).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  const expiring = regs.filter(r => r.validTill && (new Date(r.validTill) - Date.now()) / 86400000 <= 180).sort((a, b) => (a.validTill || "").localeCompare(b.validTill || ""));
  const filings = stat.filter(s => s.status !== "Filed").sort((a, b) => (a.due || "").localeCompare(b.due || "")).slice(0, 6);
  const pending = users.filter(u => !u.active && u.status === "pending").length;
  const openIncidents = inc.filter(i => i.status !== "closed");
  const travelling = jour.filter(j => j.status === "on the way");
  const byDistrict = {}; persons.forEach(p => { const k = p.district || "—"; byDistrict[k] = (byDistrict[k] || 0) + 1; });
  const byService = {}; benFY.forEach(b => { const k = b.service || "—"; byService[k] = (byService[k] || 0) + 1; });
  const bar = (obj, max) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, max || 8).map(([k, v]) => {
    const w = Math.round(v / Math.max(...Object.values(obj)) * 100);
    return `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${esc(k)}</span><b>${v}</b></div>
      <div style="height:7px;background:var(--bg);border-radius:4px;overflow:hidden"><div style="width:${w}%;height:100%;background:var(--green)"></div></div></div>`; }).join("") || `<div class="empty">No data yet</div>`;
  const alerts = [
    ...(pending ? [[`${pending} staff profile${pending > 1 ? "s" : ""} waiting for approval`, "Admin", "profileApprovals", "warn"]] : []),
    /* A donor report is owed by whoever is named on it; otherwise by the project's
       coordinator, and failing that by Project Development, Research & Innovations.
       A report that is narrative and financial needs Programmes and Accounts too. */
    /* A donor report belongs to the department implementing the project — the person
       it is assigned to, or the project's coordinator. A report that is both narrative
       and financial needs Accounts as well. The link goes where that person can actually go. */
    ...dueSoon.slice(0, 4).map(o => {
      const proj = (state.projects || []).find(p => p.id === o.projectId) || {};
      // only the person actually named on the report; a guess is shown as a guess
      const owner = o.ownerId ? (state.users || []).find(u => u.id === o.ownerId) : null;
      const guess = !owner && proj.leadId ? (state.users || []).find(u => u.id === proj.leadId) : null;
      const deptOf = u => { if (!u) return null;
        const r = (u.roles || []).map(x => ROLE_ALIAS[x] || x);
        if (r.some(x => ["program_officer", "program_coord", "program_lead", "field_staff"].includes(x))) return "Programmes";
        if (r.includes("fundraising")) return "Project Development, Research & Innovations";
        if (r.some(x => ["director_acf", "accountant"].includes(x))) return "Accounts";
        if (r.some(x => ["admin", "admin_assistant"].includes(x))) return "Administration";
        return u.department || null; };
      const both = /financ|utilis|expenditure|fund/i.test(o.what || "") && /narrative|progress|programme|program/i.test(o.what || "");
      const dept = owner
        ? [deptOf(owner) || "Programmes", owner.name, both ? "with Accounts" : null].filter(Boolean).join(" · ")
        : guess
          ? `Nobody named yet — the ${esc(proj.code || "project")} coordinator is ${esc(guess.name)}`
          : "Nobody named yet";
      // the fundraising register is closed to programme staff, so send them to the project's own Reports due
      const route = canFR() ? "frObligations" : "project";
      if (route === "project" && proj.id) { state.reportProjectId = proj.id; }
      return [`${o.what} — ${esc(proj.code || projectName(o.projectId))} due ${fmtD(o.due)}`, dept, route,
        new Date(o.due) < new Date() ? "bad" : "warn"];
    }),
    ...expiring.slice(0, 3).map(r => [`${r.name} expires ${fmtD(r.validTill)}`, "Compliance", "registrations", new Date(r.validTill) < new Date() ? "bad" : "warn"]),
    ...filings.slice(0, 3).map(s => [`${s.filing} due ${fmtD(s.due)}`, "Compliance", "statutory", "warn"]),
    ...openIncidents.slice(0, 3).map(i => [`Incident open: ${i.nature || i.type} ${i.location ? "· " + i.location : ""}`, "Program", "incident", "bad"]),
    ...state.projects.filter(p => { const s = sum(exp.filter(e => e.projectId === p.id), "amount"); return p.budget && s / p.budget > 0.9; }).map(p => [`${p.name} has used over 90% of its budget`, "Accounts", "funds", "warn"]),
    ...travelling.map(j => { const mgr = (j.managerIds||[]).map(id=>userName(id)).filter(Boolean)[0] || userName((state.users||[]).find(u=>u.id===j.travellerId)?.managerIds?.[0]) || "Admin"; return [`${userName(j.travellerId)} travelling: ${j.fromPlace} → ${j.toPlace}${j.sensitive ? " (safety-sensitive)" : ""}`, mgr, "travelog", "warn"]; })];

  html(`<div class="grid">
    <div class="card stat"><span class="muted small">Sakhis registered</span><b>${persons.length.toLocaleString("en-IN")}</b>
      <span class="small muted" style="display:block;margin-top:2px">${newThisFY ? `${newThisFY} new in ${fy.label}` : `none registered in ${fy.label}`}${persons.filter(p => !yearOf(p)).length ? ` · ${persons.filter(p => !yearOf(p)).length} with no year at all` : ""}</span></div>
    <div class="card stat"><span class="muted small">Open cases</span><b>${openCases.toLocaleString("en-IN")}</b></div>
    <div class="card stat"><span class="muted small">Benefits delivered ${fy.label}</span><b>${benFY.length.toLocaleString("en-IN")}</b><span class="small muted">${inr(sum(benFY, "value"))} value</span></div>
    <div class="card stat"><span class="muted small">Groups</span><b>${grp.length}</b><span class="small muted">${sum(grp, "memberCount").toLocaleString("en-IN")} members</span></div>
    <div class="card stat"><span class="muted small">Active staff</span><b>${users.filter(u => u.active).length}</b></div>
    <div class="card stat"><span class="muted small">Live projects</span><b>${(state.projects || []).filter(isLiveProject).length}</b></div></div>

  ${alerts.length ? `<div class="card"><h2>Needs attention</h2><div class="list">${alerts.slice(0, 12).map(([t, dept, route, kind]) => `<div class="item"><div class="grow"><div class="t">${esc(t)}</div><div class="s">${esc(dept)}</div></div><span class="tag ${kind}">${kind === "bad" ? "urgent" : "soon"}</span><button class="btn small quiet" data-go="${route}">Open</button></div>`).join("")}</div></div>` : ""}

  <div class="grid">
    <div class="card"><h2>Money · ${fy.label}</h2>
      <table class="table"><tr><td>Sanctioned <span class="small muted">· ${liveP.length} running project${liveP.length === 1 ? "" : "s"}</span></td>
        <td style="text-align:right"><b>${inr(sanctioned)}</b></td></tr>
      <tr><td>Received</td><td style="text-align:right"><b>${inr(received)}</b></td></tr>
      <tr><td>Spent</td><td style="text-align:right"><b>${inr(spent)}</b></td></tr>
      <tr><td>Balance in hand</td><td style="text-align:right"><b>${inr(received - spent)}</b></td></tr>
      <tr><td>Yet to receive</td><td style="text-align:right">${inr(Math.max(0, sanctioned - received))}</td></tr>
      <tr><td>Spent this month</td><td style="text-align:right">${inr(sum(exp.filter(e => String(e.date || "").startsWith(thisMonth)), "amount"))}</td></tr></table>
      ${foreignLine ? `<p class="small muted" style="margin-top:6px">Foreign grants behind these figures: <b>${foreignLine}</b> — each receipt carries the rate on the day it was credited.</p>` : ""}
      <p class="small muted" style="margin-top:4px">Running projects only; closed projects are in the register.</p>
      <div style="margin-top:8px">${Object.entries(byFund).map(([k, v]) => `<div class="small" style="display:flex;justify-content:space-between"><span>${esc(k)}</span><span>${inr(v.rec)} in · ${inr(v.sp)} out</span></div>`).join("")}</div>
      <button class="btn small quiet" style="margin-top:8px" data-go="funds">Fund position</button></div>

    <div class="card"><h2>Fund raising</h2>
      <table class="table"><tr><td>Proposals sent</td><td style="text-align:right"><b>${props.length}</b></td></tr>
      <tr><td>Approved</td><td style="text-align:right"><b>${approved}</b></td></tr>
      <tr><td>Waiting for response</td><td style="text-align:right">${waiting}</td></tr>
      <tr><td>Success rate</td><td style="text-align:right"><b>${props.length ? Math.round(approved / props.length * 100) : 0}%</b></td></tr>
      <tr><td>Reports due in 45 days</td><td style="text-align:right">${dueSoon.length}</td></tr></table>
      <button class="btn small quiet" style="margin-top:8px" data-go="frProposals">Proposals</button></div>

    <div class="card"><h2>Where we work</h2>${bar(byDistrict)}<button class="btn small quiet" style="margin-top:8px" data-go="persons">Sakhis</button></div>
    <div class="card"><h2>Services delivered ${fy.label}</h2>${bar(byService)}</div>
  </div>

  <div class="grid">
    <div class="card"><h2>Projects</h2><div class="tablewrap"><table class="table"><tr><th>Project</th><th>Donor</th><th>Received</th><th>Spent</th><th>Used</th></tr>
      ${activeProjects().map(p => { const r = sum(rec.filter(x => x.projectId === p.id), "amount"), s = sum(exp.filter(x => x.projectId === p.id), "amount"); const pc = p.budget ? Math.round(s / p.budget * 100) : 0;
        return `<tr><td>${esc(p.name)}</td><td>${esc(p.donor || "")}</td><td>${inr(r)}</td><td>${inr(s)}</td><td>${pc > 90 ? `<span class="tag warn">${pc}%</span>` : pc + "%"}</td></tr>`; }).join("") || `<tr><td colspan="5" class="empty">No projects yet</td></tr>`}</table></div></div>

    <div class="card"><h2>Compliance</h2><div class="list">
      ${regs.slice(0, 6).map(r => `<div class="item"><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${esc(r.number || "")}</div></div>${r.validTill ? `<span class="tag ${new Date(r.validTill) < new Date() ? "bad" : (new Date(r.validTill) - Date.now()) / 86400000 < 180 ? "warn" : "ok"}">${fmtD(r.validTill)}</span>` : `<span class="tag ok">perpetual</span>`}</div>`).join("") || `<div class="empty">Add registrations in Compliance</div>`}</div>
      <button class="btn small quiet" style="margin-top:8px" data-go="registrations">Registrations</button></div>
  </div>

  <div class="card"><h2>Activity this month</h2><div class="grid">
    <div class="card stat"><span class="muted small">Event reports</span><b>${events.filter(e => String(e.date || "").startsWith(thisMonth)).length}</b></div>
    <div class="card stat"><span class="muted small">New cases this month</span><b>${persons.filter(p => String(p.registeredOn || "").startsWith(thisMonth)).length}</b>
      <span class="muted small" style="display:block">by the date recorded</span></div>
    <div class="card stat"><span class="muted small">Benefits</span><b>${benefits.filter(b => String(b.date || "").startsWith(thisMonth)).length}</b></div>
    <div class="card stat"><span class="muted small">Journeys logged</span><b>${jour.filter(j => String(j.date || "").startsWith(thisMonth)).length}</b></div>
    <div class="card stat"><span class="muted small">Activities on plan</span><b>—</b></div>
    <div class="card stat"><span class="muted small">Open incidents</span><b>${openIncidents.length}</b></div></div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small quiet" id="exp">Export board pack (Excel)</button><button class="btn small quiet" onclick="window.print()">Print</button><button class="btn small quiet" data-go="orgchart">Organigram</button>
      <button class="btn small quiet" onclick="routes.lead(true)">↻ Refresh dashboard</button></div></div>`);
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));

  // Save to cache so next open costs 1 read instead of 5,000+
  try {
    cacheRef.set({ fy: fy.label, ts: Date.now(),
      personCount: persons.length, openCases: openCases, newThisFY,
      benCount: benFY.length, benValue: sum(benFY, "value"),
      groupCount: grp.length, groupMembers: sum(grp, "memberCount"),
      activeStaff: users.filter(u => u.active).length,
      received, spent, sanctioned,
      propsTotal: props.length, approved, waiting, dueSoonCount: dueSoon.length,
      byDistrict, byService,
      alerts: alerts.slice(0, 12).map(a => ({ t: a[0], dept: a[1], route: a[2], kind: a[3] }))
    });
  } catch(_) {}
  // HQ panel — who is in/WFH/field/on leave today
  if (atHeadquarters() || has("super_admin","founder","director_acf","admin")) {
    (async () => {
      const tod = today();
      const [attSnap, lvSnap] = await Promise.all([
        db.collection("attendance").where("date","==",tod).get().catch(()=>({docs:[]})),
        db.collection("leaveRequests").where("status","==","approved").get().catch(()=>({docs:[]})),
      ]);
      const att = attSnap.docs.map(d=>({uid:d.data().uid,checkIn:d.data().checkIn,location:d.data().location||""}));
      const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s||"");
      const lv  = lvSnap.docs.filter(d=>isDate(d.data().from)&&isDate(d.data().to)&&d.data().from<=tod&&d.data().to>=tod).map(d=>({uid:d.data().uid,type:d.data().type||""}));
      const wfhSet   = new Set(lv.filter(l=>/home|wfh/i.test(l.type)).map(l=>l.uid));
      const lvSet    = new Set(lv.filter(l=>!/home|wfh/i.test(l.type)).map(l=>l.uid));
      const attMap   = new Map(att.map(a=>[a.uid,a]));
      const staff    = (state.users||[]).filter(u=>u.active&&isStaff(u));
      const nm       = u => esc(u.callMe||u.firstName||(u.name||"").split(" ")[0]||"");
      const inOff    = staff.filter(u=>attMap.has(u.id)&&!lvSet.has(u.id)&&!wfhSet.has(u.id)&&!/field|visit|external/i.test(attMap.get(u.id).location));
      const onField  = staff.filter(u=>attMap.has(u.id)&&/field|visit|external/i.test(attMap.get(u.id).location));
      const wfh      = staff.filter(u=>wfhSet.has(u.id));
      const onLv     = staff.filter(u=>lvSet.has(u.id));
      const notIn    = staff.filter(u=>!attMap.has(u.id)&&!lvSet.has(u.id)&&!wfhSet.has(u.id));
      const row = (label, list, col) => !list.length ? "" :
        `<div style="margin-bottom:6px"><span class="tag" style="background:${col};color:#fff;font-size:11px">${esc(label)}</span> ${list.map(nm).join(" · ")}</div>`;
      const panel = `<div class="card" style="margin-top:12px"><h2>Today — who is where</h2>
        ${row("In office", inOff, "#2a6049")}
        ${row("Working from home", wfh, "#4a6fa0")}
        ${row("On field", onField, "#7a5a20")}
        ${row("On leave", onLv, "#888")}
        ${row("Not checked in", notIn, "#c44")}
      </div>`;
      const el = $("content"); if (el) el.insertAdjacentHTML("beforeend", panel);
    })();
  }
  $("exp").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ "As on": today(), "Financial year": fy.label, Sakhis: persons.length, "Open cases": openCases, "New this FY": newThisFY, "Benefits this FY": benFY.length, Groups: grp.length, Members: sum(grp, "memberCount"), Staff: users.filter(u => u.active).length, Sanctioned: sanctioned, Received: received, Spent: spent, Balance: received - spent, "Proposals sent": props.length, Approved: approved, "Success %": props.length ? Math.round(approved / props.length * 100) : 0 }]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(activeProjects().map(p => ({ Project: p.name, Donor: p.donor, FCRA: p.fundType, Budget: p.budget, Received: sum(rec.filter(x => x.projectId === p.id), "amount"), Spent: sum(exp.filter(x => x.projectId === p.id), "amount") }))), "Projects");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(byDistrict).map(([District, Sakhis]) => ({ District, Sakhis }))), "Reach");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(props.map(p => ({ Sent: p.sentOn, Proposal: p.name, Organisation: p.org, Status: p.status }))), "Proposals");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(regs.map(r => ({ Registration: r.name, Number: r.number, "Valid till": r.validTill }))), "Compliance");
    XLSX.writeFile(wb, `Empower-People-board-pack-${today()}.xlsx`); };
  // Karma meter for managers who land on lead (not home)
  if (typeof calcKarma === "function" && isActive() && !has("board", "observer")) {
    const kw = document.createElement("div"); kw.id = "karmaSection";
    const el = $("content"); if (el) el.appendChild(kw);
    (async () => {
      const curMonth = today().slice(0, 7);
      const myScoreRaw = await calcKarma(state.user.uid, curMonth).catch(() => null);
      if (!myScoreRaw) { kw.innerHTML = ""; return; }
      const score = typeof myScoreRaw === "object" ? myScoreRaw.score : myScoreRaw;
      kw.innerHTML = `<div class="card" style="margin-top:12px"><h2>My karma · ${new Date(curMonth+"-01").toLocaleDateString("en-IN",{month:"long",year:"numeric"})}</h2>${karmaGauge(score,"","",200)}</div>`;
      kw.querySelectorAll("[data-target]").forEach(bar => {
        const pct = parseFloat(bar.dataset.target)||0;
        requestAnimationFrame(()=>{ setTimeout(()=>{ bar.style.width = Math.min(100,pct)+"%"; }, 80); });
      });
    })();
  }
};

/* ================= PROJECT PAGE (tabs: overview, budget, team, activities, cases, reports, documents) ================= */
routes.project = async (id, tab) => {
  id = id || state.projectId; state.projectId = id; tab = tab || state.projectTab || "overview"; state.projectTab = tab;
  if (!id) {
    // open on a project that is actually running, and on one of mine where there is one
    const live = (state.projects || []).filter(isLiveProject);
    const mine = live.filter(x => x.leadId === state.user.uid || (x.team || []).includes(state.user.uid) || x.financeId === state.user.uid);
    const p = mine[0] || live[0] || (state.projects || [])[0];
    if (!p) return html(`<div class="card"><div class="empty">No projects yet — add one in Project register</div></div>`);
    id = state.projectId = p.id;
  }
  const p = (state.projects||[]).find(proj => proj.id === id);
  // state.projects.find(x => x.id === id) || {};
  const seeAllProjects = seesWholeOrg() || has("director_acf", "program_officer", "program_coord", "admin", "accountant", "fundraising");
  // Office-based access: field_staff/program_lead can see projects in their office
  const userOfficeId = state.user.officeId || (state.users||[]).find(u=>u.id===state.user.uid)?.officeId;
  const officeMatch = userOfficeId && (p.primaryOffice === userOfficeId || (p.offices||[]).includes(userOfficeId));
  const onTeam = p.leadId === state.user.uid || (p.team || []).includes(state.user.uid) || p.financeId === state.user.uid;
  const onProject = seeAllProjects || onTeam || officeMatch;
  if (!onProject) return html(`<div class="card"><h2>Not your project</h2><p class="small muted">You can open the projects you lead or work on. Ask Administration, HR &amp; Communication to add you to the team if you should see this one.</p><button class="btn small quiet" onclick="go('projects')">Back</button></div>`);
  setTitle("Project · " + (p.name || ""));
  const q = (c, f, v) => db.collection(c).where(f, "==", v).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [heads, rec, exp, acts, bens, obl, users, events] = await Promise.all([
    q("budgetHeads", "projectId", id), q("incomeReceipts", "projectId", id), q("expenses", "projectId", id), q("activities", "projectId", id),
    q("benefits", "projectId", id), q("obligations", "projectId", id), Promise.resolve(state.users.filter(u => (u.projectsText || "").toLowerCase().includes((p.name || "").toLowerCase().slice(0, 6)))), q("eventReports", "projectId", id)]);
  const sum = (a, f) => a.reduce((x, y) => x + (Number(y[f]) || 0), 0); const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const received = sum(rec, "amount"), spent = sum(exp, "amount"), budget = Number(p.budget) || sum(heads.filter(h => !h.orgBorne), "total");
  // Split activities into work activities and indicators
  const actItems = acts.filter(a => !/^IND/i.test(a.code||""));
  const indItems = acts.filter(a => /^IND/i.test(a.code||""));
  const overviewOnly = has("board") || isVolunteerOnly();
  const canSeeBudget = seeAllProjects || has("accountant");
  if (overviewOnly) tab = "overview";
  const isM3SAGE = (p.code||p.name||"").toUpperCase().includes("M3-SAGE");
  const TABS = overviewOnly
    ? [["overview", "Overview"]]
    : [["overview", "Overview"],
       ...(canSeeBudget ? [["budget", "Budget"]] : []),
       ["team", "Team"], ["activities", "Activities"], ["indicators", "Indicators"],
       ["sakhis", "Beneficiaries"], ["cases", "Cases & benefits"],
       ["reports", "Reports due"], ["docs", "Documents"],
       ...(isM3SAGE ? [["baseline", "📋 Baseline"]] : [])];
  if (!TABS.find(t=>t[0]===tab)) tab = "overview";
  const spentOn = code => { const h = heads.find(bh => bh.code === code); const fromExp = sum(exp.filter(e => e.head === code || e.headId === (h&&h.id)), "amount"); return fromExp || Number(h&&h.spentReported) || 0; };
  const body = {
    overview: () => `<div class="grid">
        ${canSeeBudget ? `
        <div class="card stat"><span class="muted small">Sanctioned</span><b>${inr(budget)}</b></div>
        <div class="card stat"><span class="muted small">Received</span><b>${inr(received)}</b></div>
        <div class="card stat"><span class="muted small">Spent</span><b>${inr(heads.length ? heads.reduce((s,h)=>s+spentOn(h.code),0) : spent)}</b></div>
        <div class="card stat"><span class="muted small">Balance</span><b>${inr(received - (heads.length ? heads.reduce((s,h)=>s+spentOn(h.code),0) : spent))}</b></div>
        <div class="card stat"><span class="muted small">Used</span><b>${budget ? Math.round((heads.length ? heads.reduce((s,h)=>s+spentOn(h.code),0) : spent) / budget * 100) : 0}%</b></div>` : ""}</div>
      <div class="card"><h2>Details</h2><table class="table">
        <tr><td>Donor</td><td>${esc(p.donor || "—")}</td></tr><tr><td>FCRA status</td><td>${esc(p.fundType || "—")}</td></tr>
        <tr><td>Restriction</td><td>${esc(p.restriction || "—")}</td></tr><tr><td>Period</td><td>${p.start || p.end
          ? `${p.start ? fmtD(p.start) : "—"} to ${p.end ? fmtD(p.end) : "—"}${p.start && p.end
              ? ` <span class="small muted">· ${Math.max(0, Math.round((new Date(p.end) - new Date(p.start)) / 2629800000))} months</span>` : ""}`
          : "—"}</td></tr>
        <tr><td>Geography</td><td>${esc(p.geography || "—")}</td></tr><tr><td>Project lead</td><td>${esc(userName(p.leadId) || "—")}</td></tr>
        <tr><td>Bank account</td><td>${esc(p.bank || "—")}</td></tr><tr><td>Reporting cycle</td><td>${esc(p.cycle || "—")}</td></tr></table>
        <p class="small muted" style="margin-top:8px">${esc(p.objectives || "")}</p>
        ${has("super_admin", "admin", "director_acf") ? `<button class="btn small quiet" data-go="projects">Edit in Project register</button>` : ""}
        ${p.leadId === state.user.uid ? `<span class="tag ok">you lead this project</span>` : ""}</div>
      <div class="card"><h2>At a glance</h2><div class="grid">
        <div class="card stat tap" data-switchtab="activities" style="cursor:pointer"><span class="muted small">Activities</span><b>${acts.length}</b><span class="muted small" style="font-size:10px">tap to view →</span></div>
        <div class="card stat tap" data-switchtab="sakhis" style="cursor:pointer"><span class="muted small">Benefits</span><b>${bens.length}</b><span class="muted small" style="font-size:10px">tap to view →</span></div>
        <div class="card stat tap" id="eventsCard" style="cursor:pointer"><span class="muted small">Events</span><b>${events.length}</b><span class="muted small" style="font-size:10px">tap to view →</span></div>
        <div class="card stat tap" data-switchtab="reports" style="cursor:pointer"><span class="muted small">Reports due</span><b>${obl.filter(o => !o.done).length}</b><span class="muted small" style="font-size:10px">tap to view →</span></div>
      </div></div>
      ${events.length ? `<div class="card" id="eventsPanel" style="display:none"><h2>Events (${events.length})</h2>
        <div class="tablewrap"><table class="table">
          <tr><th>Date</th><th>Heading</th><th>Activity</th><th>Place</th><th>District</th><th>Participants</th><th>Women</th><th>Status</th></tr>
          ${events.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(e=>`<tr>
            <td style="white-space:nowrap">${e.date?fmtD(e.date):""}</td>
            <td>${esc(e.heading||"")}</td>
            <td class="small muted">${esc(e.activity||"")}</td>
            <td class="small">${esc(e.place||e.venue||"")}</td>
            <td class="small muted">${esc(e.district||"")}</td>
            <td style="text-align:right">${e.participants||""}</td>
            <td style="text-align:right">${e.women||""}</td>
            <td>${e.status?`<span class="tag ${e.status==="approved"?"ok":e.status==="rejected"?"bad":"warn"}">${esc(e.status)}</span>`:""}</td>
          </tr>`).join("")}
        </table></div></div>` : ""}`,
    budget: () => `<div class="card"><h2>Budget heads</h2><div class="tablewrap"><table class="table"><tr><th>Head</th><th>Budget line</th><th>Budget ₹</th><th>Spent ₹</th><th>Balance ₹</th><th>Used</th></tr>
        ${heads.map(h => { const s = spentOn(h.code), b = Number(h.total) || 0, pc = b ? Math.round(s / b * 100) : 0;
          return `<tr><td>${esc(h.code)}${h.orgBorne ? ' <span class="tag">ORG</span>' : ""}</td><td>${esc(h.line)}</td><td>${inr(b)}</td><td>${inr(s)}</td><td>${inr(b - s)}</td><td>${pc > 110 ? `<span class="tag bad">${pc}%</span>` : pc > 90 ? `<span class="tag warn">${pc}%</span>` : pc + "%"}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty">No heads yet — add them in Budget heads</td></tr>`}
        ${heads.length ? (() => { const ts = heads.reduce((s,h)=>s+spentOn(h.code),0); return `<tr><td colspan="2"><b>Total</b></td><td><b>${inr(sum(heads, "total"))}</b></td><td><b>${inr(ts)}</b></td><td><b>${inr(sum(heads, "total") - ts)}</b></td><td></td></tr>`; })() : ""}</table></div>
        <p class="small muted" style="margin-top:8px">A head over 110% breaches the 10% variation rule (FP) — reallocate or seek donor approval.</p>
        <button class="btn small quiet" data-go="heads">Budget heads</button> <button class="btn small quiet" data-go="ledger">Ledger</button></div>`,
    team: () => { const isLead = p.leadId === viewUid() || seesWholeOrg() || has("program_officer","director_acf");
      const members = state.users.filter(u => u.active && (p.team || []).includes(u.id));
      return `<div class="card"><h2>Team on this project</h2>
        <p class="small muted">${p.leadId ? `Coordinator: <b>${esc(userName(p.leadId))}</b>, named by the Founder &amp; General Secretary.` : `<span class="tag warn">No coordinator named yet</span>`} ${isLead ? "You build the team yourself — tick the people working on this project." : ""}</p>
        <div class="tablewrap"><table class="table"><tr><th>Name</th><th>Post</th><th>Office</th><th>Charge-out</th></tr>
        ${members.map(u => `<tr><td>${esc(u.name)}${u.id === p.leadId ? ' <span class="tag ok">coordinator</span>' : ""}</td><td>${esc(u.postTitle || u.designation || "")}</td><td>${esc(officeName(u.officeId))}</td><td class="small">${esc(u.chargeOut || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Nobody on the team yet</td></tr>`}</table></div>
        ${isLead ? `<form id="tf" style="margin-top:10px">
          ${has("program_officer","super_admin","founder","director_acf") ? `<label class="field"><span>Project lead</span>
            <select name="leadId"><option value="">— unassigned —</option>
            ${state.users.filter(u=>u.active&&(p.team||[]).includes(u.id)).map(u=>`<option value="${u.id}" ${u.id===p.leadId?"selected":""}>${esc(u.name)}</option>`).join("")}
            </select></label>` : ""}
          <label class="field"><span>Who works on this project</span>
          <div class="rolebox" style="border:1.5px solid var(--line);border-radius:10px;padding:6px 10px;max-height:200px;overflow:auto">${state.users.filter(u => u.active).map(u => `<label class="check"><input type="checkbox" name="team" value="${u.id}" ${(p.team || []).includes(u.id) ? "checked" : ""}> ${esc(u.name)}${u.postTitle ? ` <span class="small muted">· ${esc(u.postTitle)}</span>` : ""}</label>`).join("")}</div></label>
          <button class="btn small" type="submit">Save team & lead</button></form>` : ""}</div>`; },
    activities: () => { const canEditAct = has("super_admin","founder","program_officer","admin");
      const MMAP={Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
      const parsePer=p=>{if(!p)return"9999-99";const m=String(p).match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);return m?`${m[2]}-${MMAP[m[1]]}`:"9999-99";};
      const dispPer=a=>{if(!a.period)return"";if(a.endPeriod&&a.endPeriod!==a.period){const sm=a.period.split(" "),em=a.endPeriod.split(" ");return sm[1]===em[1]?`${sm[0]}\u2013${em[0]} ${sm[1]}`:`${a.period}\u2013${a.endPeriod}`;}return a.period;};
      const addM=(ym,n)=>{const[y,mo]=ym.split("-").map(Number);const d=new Date(y,mo-1+n,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;};
      const expanded=[];
      for(const a of [...actItems].sort((a,b)=>parsePer(a.period).localeCompare(parsePer(b.period))||(a.code||"").localeCompare(b.code||""))){
        const s=parsePer(a.period);
        const ep=a.endPeriod&&a.endPeriod!==a.period?parsePer(a.endPeriod):null;
        if(!s){expanded.push({...a,_m:"9999-99",_spanning:false});continue;}
        if(!ep){expanded.push({...a,_m:s,_spanning:false});continue;}
        let cur=s; while(cur<=ep){expanded.push({...a,_m:cur,_spanning:true});cur=addM(cur,1);if(cur>addM(s,24))break;}
      }
      const shownEdit=new Set(); let lastM=null;
      const editForm=a=>`<tr class="act-edit-row" data-forid="${a.id}" style="display:none"><td colspan="8" style="padding:12px;background:var(--bg)">
        <form class="act-edit-form" data-actid="${a.id}" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="grid-column:1/-1"><label class="field"><span>Activity</span><input name="name" value="${esc(a.name)}" required></label></div>
          <label class="field"><span>Code</span><input name="code" value="${esc(a.code||"")}"></label>
          <label class="field"><span>Starts (e.g. Oct 2026)</span><input name="period" value="${esc(a.period||"")}"></label>
          <label class="field"><span>Ends (if multi-month)</span><input name="endPeriod" value="${esc(a.endPeriod||"")}"></label>
          <label class="field"><span>Target</span><input name="target" type="number" value="${esc(String(a.target||""))}"></label>
          <label class="field"><span>Unit</span><input name="unit" value="${esc(a.unit||"")}"></label>
          <label class="field"><span>Status</span><select name="status">${["Not started","In progress","Completed","Delayed","Dropped"].map(o=>`<option ${o===a.status?"selected":""}>${o}</option>`).join("")}</select></label>
          <label class="field"><span>Lead (assign to team member)</span><select name="leadId">
            <option value="">— unassigned —</option>
            ${[...(p.team||[])].map(uid=>{const u=(state.users||[]).find(x=>x.id===uid);return u?`<option value="${uid}" ${a.leadId===uid?"selected":""}>${esc(u.name)}${u.postTitle?" · "+esc(u.postTitle):""}</option>`:""}).join("")}
            ${!(p.team||[]).includes(a.leadId)&&a.leadId?`<option value="${a.leadId}" selected>${esc(userName(a.leadId))}</option>`:""}
          </select></label>
          <div style="grid-column:1/-1"><label class="field"><span>Objective</span><input name="objective" value="${esc(a.objective||"")}"></label></div>
          <div style="grid-column:1/-1;display:flex;gap:8px"><button type="submit" class="btn small">Save</button><button type="button" class="btn small quiet act-cancel" data-cancelid="${a.id}">Cancel</button></div>
        </form></td></tr>`;
      const rows=expanded.map(a=>{
        const done=bens.filter(b=>b.activityId===a.id).length+events.filter(e=>e.activityId===a.id).length||a.achieved||"—";
        const MNMS={"01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec"};
        const mlbl=ym=>ym==="9999-99"?"No period":`${MNMS[ym.split("-")[1]]} ${ym.split("-")[0]}`;
        const sep=a._m!==lastM?`<tr><td colspan="8" style="padding:3px 8px;background:var(--bg);font-size:12px;font-weight:600;color:var(--muted);border-top:2px solid var(--line)">${mlbl(a._m)}</td></tr>`:""
        lastM=a._m; const isFirst=!shownEdit.has(a.id); shownEdit.add(a.id);
        return`${sep}<tr style="border-bottom:1px solid var(--line);${!isFirst?"opacity:.65":""}">
          <td style="padding:6px 8px;white-space:nowrap"><b>${esc(a.code||"")}</b></td>
          <td style="padding:6px 8px">${esc(a.name)}${a.objective&&a.objective!=="Work plan"?`<div class="small muted">${esc(String(a.objective).slice(0,55))}</div>`:""}${a.endPeriod&&a.endPeriod!==a.period?`<div class="small muted">\u{1F4C5} ${esc(dispPer(a))}</div>`:""}</td>
          <td style="padding:6px 8px;text-align:right;white-space:nowrap">${a.target?`${a.target} ${esc(a.unit||"")}`:""}</td>
          <td style="padding:6px 8px;text-align:right">${done}</td>
          <td style="padding:6px 8px;white-space:nowrap;font-size:13px">${esc(a.period||"")}</td>
          <td style="padding:6px 8px;font-size:13px">${esc(userName(a.leadId||""))}</td>
          <td style="padding:6px 8px">${statusTag(a.status)}</td>
          <td style="padding:6px 8px">${canEditAct&&isFirst?`<button class="btn small quiet act-edit-btn" data-editact="${a.id}">Edit</button>`:""}</td>
        </tr>${isFirst?editForm(a):""}`;
      }).join("");
      return `<div class="card"><h2>Work plan \u00B7 ${actItems.length} activities</h2>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="border-bottom:2px solid var(--line)">
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Code</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Activity</th>
            <th style="text-align:right;padding:6px 8px;font-size:12px;color:var(--muted)">Target</th>
            <th style="text-align:right;padding:6px 8px;font-size:12px;color:var(--muted)">Done</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Period</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Lead</th>
            <th style="text-align:left;padding:6px 8px;font-size:12px;color:var(--muted)">Status</th>
            <th></th>
          </tr></thead>
          <tbody>${rows||`<tr><td colspan="6" class="empty">No activities yet</td></tr>`}</tbody>
        </table></div>
        <button class="btn small quiet" style="margin-top:8px" data-go="activities">Activities &amp; work plan \u2197</button></div>`; },
    /* The women this project reached — not the services, the people. One line each,
       with what she received and who is working with her. */
    indicators: () => {
      if (!indItems.length) return `<div class="card"><div class="empty">No indicators defined for this project yet. Add activities with code starting "IND" to track indicators.</div></div>`;
      return `<div class="card">
        <h2>Indicators · ${indItems.length}</h2>
        <p class="small muted">Done counts are auto-calculated from benefits, event reports and services filed against each indicator via the activity field.</p>
        <div class="tablewrap"><table class="table">
          <tr><th>Code</th><th>Indicator</th><th>Target</th><th>Done</th><th>%</th><th>Status</th></tr>
          ${indItems.map(a => {
            const done = bens.filter(b => b.activityId === a.id).length + events.filter(e => e.activityId === a.id).length + (a.achieved||0);
            const pct = a.target ? Math.min(100, Math.round((done / Number(a.target)) * 100)) : null;
            const bar = pct !== null ? `<div style="background:var(--line);border-radius:4px;height:6px;width:80px;display:inline-block;vertical-align:middle;margin-left:4px"><div style="background:${pct>=100?"var(--ok)":pct>=50?"var(--warn)":"var(--bad)"};width:${pct}%;height:100%;border-radius:4px"></div></div>` : "";
            return `<tr>
              <td><b>${esc(a.code||"")}</b></td>
              <td>${esc(a.name)}${a.objective&&a.objective!=="Work plan"?`<div class="small muted">${esc(String(a.objective).slice(0,60))}</div>`:""}</td>
              <td style="text-align:right">${a.target?`${a.target} ${esc(a.unit||"")}`:""}</td>
              <td style="text-align:right"><b style="color:${done>0?"var(--ok)":"var(--muted)"}">${done}</b></td>
              <td style="white-space:nowrap">${pct!==null?`${pct}% ${bar}`:""}</td>
              <td>${statusTag(a.status)}</td>
            </tr>`;
          }).join("")}
        </table></div>
      </div>`; },
    sakhis: () => { const byPerson = {};
      bens.forEach(b => { const k = b.personId || b.personCode || b.name; if (!k) return;
        (byPerson[k] = byPerson[k] || { id: b.personId, code: b.personCode, name: b.name,
          district: b.district, village: b.village, services: [], value: 0, last: "" });
        byPerson[k].services.push(b.service); byPerson[k].value += Number(b.value) || 0;
        if (String(b.date || "") > byPerson[k].last) byPerson[k].last = b.date; });
      const rows = Object.values(byPerson).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      const who = (state.persons || []);
      return `<div class="card"><h2>Beneficiaries (${rows.length})</h2>
        <p class="small muted">Everyone this project has helped. ${bens.length} services between them — a beneficiary appears once however many times she was helped.</p>
        <div class="tablewrap"><table class="table">
          <tr><th>Name</th><th>Sakhi ID</th><th>Village</th><th>District</th><th style="text-align:center">Services</th><th>What she received</th><th>₹</th><th>Last</th><th></th></tr>
          ${rows.map(r => `<tr><td>${esc(maskName(r.name, r.code))}</td><td class="small">${esc(r.code || "")}</td>
            <td>${esc(r.village || "")}</td><td>${esc(r.district || "")}</td>
            <td style="text-align:center"><b>${r.services.length}</b></td>
            <td class="small">${[...new Set(r.services)].map(esc).join(", ")}</td>
            <td>${r.value ? inr(r.value) : ""}</td><td class="small">${fmtD(r.last)}</td>
            <td>${r.id ? `<button class="btn small quiet" data-sk="${r.id}">Open</button>` : ""}</td></tr>`).join("")
            || `<tr><td colspan="9" class="empty">No beneficiary has been recorded against this project yet</td></tr>`}
        </table></div>
        <button class="btn small quiet" id="skExp">Export this list</button></div>`; },
    cases: () => `<div class="card"><h2>Benefits funded by this project (${bens.length})</h2><div class="tablewrap"><table class="table"><tr><th>Date</th><th>Service</th><th>Description</th><th>₹</th></tr>
        ${bens.slice(0, 50).map(b => `<tr><td>${fmtD(b.date)}</td><td>${esc(b.service || "")}</td><td>${esc(b.description || "")}</td><td>${b.value ? inr(b.value) : ""}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">None yet</td></tr>`}</table></div>
        <p class="small" style="margin-top:8px"><b>${inr(sum(bens, "value"))}</b> of direct benefit value recorded.</p></div>`,
    reports: () => `<div class="card"><h2>Reporting obligations</h2><div class="list">
        ${obl.map(o => { const d = Math.ceil((new Date(o.due) - Date.now()) / 86400000);
          return `<div class="item"><div class="grow"><div class="t">${esc(o.what)}</div><div class="s">to ${esc(o.to || "")} · due ${fmtD(o.due)}${o.repeat && o.repeat !== "Once" ? " · " + esc(o.repeat) : ""}</div></div>
          ${o.done ? `<span class="tag ok">done</span>` : `<span class="tag ${d < 0 ? "bad" : d <= 30 ? "warn" : ""}">${d < 0 ? `overdue ${-d}d` : `in ${d}d`}</span>`}</div>`; }).join("") || `<div class="empty">No obligations recorded</div>`}</div>
        <button class="btn small quiet" data-go="frObligations">Reporting calendar</button></div>`,
    docs: () => `<div class="card"><h2>Documents</h2><p class="small muted">Agreement, budget, approved proposal, reports and photographs for this project.</p>
        <div class="list">${(p.docs || []).map(d => `<div class="item"><div class="grow"><div class="t">${esc(d.name)}</div><div class="s">${esc(d.at)}</div></div><a class="btn small quiet" href="${d.data || d.link}" target="_blank" rel="noopener">Open</a></div>`).join("") || `<div class="empty">No documents yet</div>`}</div>
        <div class="two" style="margin-top:8px"><label class="field"><span>Upload a file</span><input type="file" id="pdoc" accept="image/*,.pdf"></label><label class="field"><span>Or paste a Drive link</span><input id="plink" placeholder="https://drive.google.com/…"></label></div>
        <button class="btn small" id="paddlink">Add link</button> ${driveLink("program") ? `<a class="btn small quiet" href="${esc(driveLink("program"))}" target="_blank" rel="noopener">Open Drive folder</a>` : ""}</div>`,
    baseline: () => `<div class="card" style="background:#0d4a7c;color:#fff;border-radius:12px;padding:16px 20px;margin-bottom:4px">
      <div style="font-size:13px;opacity:0.8;margin-bottom:4px">M3-SAGE · Oct – Dec 2026 · Gaya, Bihar</div>
      <h2 style="margin:0;color:#fff">📋 Baseline Survey</h2>
      <div style="font-size:13px;opacity:0.8;margin-top:4px">640 households · 318 villages · 36 KIIs · 12 FGDs · 15–25 survivor consultations</div>
    </div>
    <div class="card"><p class="small muted" style="margin:0">Open the baseline module to fill forms, track progress against block targets, and download responses as Excel.</p>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn" onclick="routes.m3baseline()" style="background:#0d4a7c;border-color:#0d4a7c">Open Baseline →</button>
        ${typeof m3canManage==="function"&&m3canManage()?`<button class="btn quiet" onclick="routes.m3responses()">View all responses</button>`:""}
      </div>
    </div>` };
  html(`<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${(() => { const mine = state.projects.filter(x => seesWholeOrg() || has("director_acf", "program_officer", "program_coord", "admin", "accountant", "fundraising") || x.leadId === state.user.uid || (x.team || []).includes(state.user.uid));
        const live = mine.filter(isLiveProject), closed = mine.filter(x => !isLiveProject(x));
        return `<select id="psel" style="width:auto;padding:6px 10px;border-radius:9px;font-weight:600">
          ${live.length ? `<optgroup label="Running">${live.map(x => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>` : ""}
          ${closed.length ? `<optgroup label="Closed">${closed.map(x => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</optgroup>` : ""}
        </select>`; })()}
      ${p.fundType ? `<span class="tag">${esc(p.fundType)}</span>` : ""}${p.donor ? `<span class="tag">${esc(p.donor)}</span>` : ""}
      ${isLiveProject(p) ? `<span class="tag ok">running</span>` : `<span class="tag">closed</span>`}
      ${!isLiveProject(p) && has("super_admin", "fundraising", "director_acf", "program_officer") ? `<button class="btn small quiet" id="reopen">Reopen it</button>` : ""}
      ${isLiveProject(p) && has("super_admin", "fundraising", "director_acf", "program_officer") ? `<button class="btn small quiet" id="closeit">Close it</button>` : ""}</div>
      ${!isLiveProject(p) ? `<p class="small muted" style="margin:6px 0 0">This project is closed, so it no longer appears in forms, plans or dashboards. Everything about it stays here.</p>` : ""}
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px">${TABS.map(([k, l]) => `<button class="btn small ${k === tab ? "" : "quiet"}" data-tab="${k}">${l}</button>`).join("")}</div></div>
    ${body[tab]()}`);
  $("content").querySelectorAll("[data-sk]").forEach(b => b.onclick = () => { state.personId = b.dataset.sk; go("person"); });
  /* ── Service book wiring ── */
  if ($("sbAdd")) $("sbAdd").onclick = () => { $("sbForm").classList.toggle("hidden"); };
  if ($("sbCancel")) $("sbCancel").onclick = () => $("sbForm").classList.add("hidden");
  if ($("sbType")) $("sbType").onchange = e => {
    const needs = ["Concern","Conduct"].includes(e.target.value);
    $("sbCsNote").classList.toggle("hidden", !needs);
  };
  if ($("sbF")) $("sbF").onsubmit = async e => { e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const needsCS = ["Concern","Conduct"].includes(d.type);
    const now = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection("performanceNotes").add({
      uid, type: d.type, entry: d.entry, date: d.date,
      writtenBy: state.user.uid, writtenOn: today(),
      kind: ["Achievement","Commendation","Training completed"].includes(d.type) ? "positive" : "concern",
      countersignNeeded: needsCS, locked: false,
      status: needsCS ? "pending_countersign" : "active",
      fyear: fyOfDate(d.date), createdAt: now
    });
    audit("create","performanceNotes",null,`${d.type} · ${u.name}`);
    toast("Entry saved" + (needsCS ? " — awaiting countersign from Director ACF" : ""));
    routes.staffRecord(uid); };

  /* Countersign */
  $("content").querySelectorAll("[data-sbcs]").forEach(b => b.onclick = async () => {
    if(!confirm("Countersign this entry? It will become part of the permanent service book.")) return;
    await db.collection("performanceNotes").doc(b.dataset.sbcs).update({
      countersignedBy: state.user.uid, countersignedOn: today(), status: "active" });
    audit("countersign","performanceNotes",b.dataset.sbcs,""); toast("Countersigned"); routes.staffRecord(uid); });

  /* Annual review — submit */
  if ($("sbReview")) $("sbReview").onclick = () => $("sbReviewForm").classList.toggle("hidden");
  if ($("sbRCancel")) $("sbRCancel").onclick = () => $("sbReviewForm").classList.add("hidden");
  if ($("sbRF")) $("sbRF").onsubmit = async e => { e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.increment = d.increment ? Number(d.increment) : null;
    const fy = fyOfDate(today());
    await db.collection("serviceReviews").add({
      uid, year: fy, ...d,
      writtenBy: state.user.uid, writtenOn: today(),
      status: "submitted", createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    audit("create","serviceReviews",null,`${u.name} · ${fy}`);
    toast("Review submitted — awaiting Director ACF"); routes.staffRecord(uid); };

  /* Forward to Director ACF */
  $("content").querySelectorAll("[data-sbdirectorreview]").forEach(b => b.onclick = async () => {
    await db.collection("serviceReviews").doc(b.dataset.sbdirectorreview).update({ status: "director_reviewed" });
    toast("Forwarded to Director ACF"); routes.staffRecord(uid); });

  /* GS final approval */
  $("content").querySelectorAll("[data-gsapprove]").forEach(b => b.onclick = async () => {
    const rid = b.dataset.gsapprove;
    const rev = reviewRows.find(r=>r.id===rid); if(!rev) return;
    const decision = $(`gsDecision_${rid}`)?.value || rev.decision;
    const increment = Number($(`gsIncrement_${rid}`)?.value) || null;
    const newPost = $(`gsPost_${rid}`)?.value || null;
    const gsNote = $(`gsNote_${rid}`)?.value || null;
    if(!confirm(`Approve this review and issue the ${decision} letter for ${u.name}?`)) return;
    await db.collection("serviceReviews").doc(rid).update({
      decision, increment, newPost, gsNote,
      status: "gs_approved", approvedBy: state.user.uid, approvedOn: today()
    });
    // Generate F-review letter via forms if applicable
    audit("approve","serviceReviews",rid,`${u.name} · ${decision}`);
    toast(`Approved · ${decision}`); routes.staffRecord(uid); });

    if ($("srF09")) $("srF09").onclick = async () => {
    $("srF09").textContent="Generating…"; $("srF09").disabled=true;
    const month = today().slice(0,7);
    const monthLabel = new Date(month+"-01").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
    // Fetch attendance and day reports for this person this month
    const from=month+"-01", to=month+"-31";
    const [attSnap,drSnap]=await Promise.all([
      db.collection("attendance").where("uid","==",uid).limit(200).get().catch(()=>({docs:[]})),
      db.collection("dayReports").where("uid","==",uid).limit(200).get().catch(()=>({docs:[]}))
    ]);
    const attM=attSnap.docs.filter(d=>d.data().date>=from&&d.data().date<=to).map(d=>d.data());
    const drM=drSnap.docs.filter(d=>d.data().date>=from&&d.data().date<=to).map(d=>d.data());
    const days=[];
    for(let i=1;i<=31;i++){
      const date=`${month}-${String(i).padStart(2,"0")}`;
      const att=attM.find(a=>a.date===date);
      const dr=drM.find(r=>r.date===date);
      if(att||dr) days[i-1]={date,checkIn:att?.checkIn||"",checkOut:att?.checkOut||"",hours:att?.hours||"",reported:!!dr};
    }
    await downloadFilledForm("F-09","attendance",uid+"-"+month,{
      name:u.name,postTitle:u.postTitle,department:u.department,officeName:officeName(u.officeId),
      month:monthLabel,fy:fyOfDate(month+"-01"),days,
      workingDays:attM.filter(a=>a.checkIn).length,
      present:attM.filter(a=>a.checkIn&&a.checkOut).length,
      absent:"",leaveTaken:"",verifiedByName:userName((u.managerIds||[])[0])
    });
    $("srF09").textContent="↓ F-09 Work sheet"; $("srF09").disabled=false; };
  if ($("skExp")) $("skExp").onclick = async () => {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const byPerson = {};
    bens.forEach(b => { const k = b.personId || b.personCode || b.name; if (!k) return;
      (byPerson[k] = byPerson[k] || { Name: b.name, "Sakhi ID": b.personCode, Village: b.village,
        District: b.district, Services: 0, "What she received": [], "Value ₹": 0 });
      byPerson[k].Services++; byPerson[k]["What she received"].push(b.service); byPerson[k]["Value ₹"] += Number(b.value) || 0; });
    const rows = Object.values(byPerson).map(r => ({ ...r, "What she received": [...new Set(r["What she received"])].join(", ") }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Sakhis");
    XLSX.writeFile(wb, `${(p.code || p.name).replace(/\s+/g, "-")}-sakhis.xlsx`); };
  $("psel").onchange = e => routes.project(e.target.value, tab);
  $("content").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => routes.project(id, b.dataset.tab));
  // At a glance stat block click handlers
  $("content").querySelectorAll("[data-switchtab]").forEach(b => b.onclick = () => routes.project(id, b.dataset.switchtab));
  if ($("eventsCard")) $("eventsCard").onclick = () => {
    const panel = $("eventsPanel");
    if (!panel) return;
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "";
    if (!open) panel.scrollIntoView({behavior:"smooth", block:"start"});
  };
  $("content").querySelectorAll(".act-edit-btn").forEach(b=>b.onclick=()=>{
    const id=b.dataset.editact;
    const row=$("content").querySelector(`.act-edit-row[data-forid="${id}"]`);
    const open=row?.style.display!=="none";
    $("content").querySelectorAll(".act-edit-row").forEach(r=>r.style.display="none");
    $("content").querySelectorAll(".act-edit-btn").forEach(x=>x.textContent="Edit");
    if(row&&!open){row.style.display="";b.textContent="Close";row.scrollIntoView({behavior:"smooth",block:"nearest"});}
  });
  $("content").querySelectorAll(".act-cancel").forEach(b=>b.onclick=()=>{
    $("content").querySelector(`.act-edit-row[data-forid="${b.dataset.cancelid}"]`).style.display="none";
    $("content").querySelector(`[data-editact="${b.dataset.cancelid}"]`).textContent="Edit";
  });
  $("content").querySelectorAll(".act-edit-form").forEach(form=>form.onsubmit=async e=>{
    e.preventDefault(); const aid=form.dataset.actid;
    const fd=new FormData(form); const patch={};
    for(const[k,v] of fd.entries()) patch[k]=k==="target"?(Number(v)||null):v;
    const btn=form.querySelector("[type=submit]"); btn.textContent="Saving…"; btn.disabled=true;
    await db.collection("activities").doc(aid).update(patch);
    audit("update","activities",aid,""); successFlash("Saved");
    btn.textContent="Save"; btn.disabled=false;
    routes.project(id,tab);
  });;
  if ($("reopen")) $("reopen").onclick = async () => { if (!confirm(`Reopen ${p.name}? It will appear again in forms, plans and dashboards.`)) return;
    await db.collection("projects").doc(id).update({ status: "active", reopenedBy: state.user.uid, reopenedOn: today() });
    audit("reopen", "projects", id, p.name); toast("Reopened"); await loadMasters(); routes.project(id, tab); };
  if ($("closeit")) $("closeit").onclick = async () => { if (!confirm(`Close ${p.name}? It stays here in full, but drops out of forms, plans and dashboards.`)) return;
    await db.collection("projects").doc(id).update({ status: "closed", closedBy: state.user.uid, closedOn: today() });
    audit("close", "projects", id, p.name); toast("Closed"); await loadMasters(); routes.project(id, tab); };
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  if ($("tf")) $("tf").onsubmit = async e => { e.preventDefault();
    const team = new FormData(e.target).getAll("team");
    const fd2 = new FormData(e.target); const leadId = fd2.get("leadId") || p.leadId || null;
    const leadUser = leadId ? (state.users||[]).find(u=>u.id===leadId) : null;
    const oldProjTeam = p.team||[];
    await db.collection("projects").doc(id).update({ team, leadId: leadId||null, ...(leadUser?{leadName:leadUser.name}:{}) });
    // Sync projectIds on user profiles
    const addedP = team.filter(u=>!oldProjTeam.includes(u));
    const removedP = oldProjTeam.filter(u=>!team.includes(u));
    await Promise.all([
      ...addedP.map(uid=>db.collection("users").doc(uid).update({projectIds:firebase.firestore.FieldValue.arrayUnion(id)})),
      ...removedP.map(uid=>db.collection("users").doc(uid).update({projectIds:firebase.firestore.FieldValue.arrayRemove(id)}))
    ]);
    await loadMasters(); audit("team", "projects", id, team.length + " members"); toast("Team saved"); await loadMasters(); routes.project(id, "team"); };
  if ($("paddlink")) $("paddlink").onclick = async () => { const link = $("plink").value.trim(); if (!link) return;
    const docs = [...(p.docs || []), { name: link.split("/").pop().slice(0, 40) || "Drive file", link, at: today() }];
    await db.collection("projects").doc(id).update({ docs }); await loadMasters(); toast("Added"); routes.project(id, "docs"); };
  if ($("pdoc")) $("pdoc").onchange = async e => { const f = e.target.files[0]; if (!f) return;
    const s = await uploadToDrive(f,"program",f.name); const docs = [...(p.docs || []), ...(s ? [{ ...s, name: f.name }] : [])];
    await db.collection("projects").doc(id).update({ docs }); await loadMasters(); successFlash("Uploaded"); routes.project(id, "docs"); };
};

/* ================= UNALLOCATED POOL ================= */
routes.unalloc = async () => {
  setTitle("Unallocated");
  const rows = (await db.collection("expenses").get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.projectId);
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN"); const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const byCat = {}; rows.forEach(r => { const k = r.category || "Other"; byCat[k] = (byCat[k] || 0) + (Number(r.amount) || 0); });
  html(`<div class="grid"><div class="card stat"><span class="muted small">Unallocated spend</span><b>${inr(total)}</b></div>
    <div class="card stat"><span class="muted small">Entries</span><b>${rows.length}</b></div></div>
    <div class="card"><h2>By category</h2><table class="table">${Object.entries(byCat).map(([k, v]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${inr(v)}</td></tr>`).join("") || `<tr><td class="empty">Nothing unallocated</td></tr>`}</table></div>
    <div class="card"><h2>Entries</h2><p class="small muted">Expenses with no project yet — organisation-borne costs, or spending to be moved to a project or split across salaries.</p>
    <div class="tablewrap"><table class="table"><tr><th>Date</th><th>Particulars</th><th>Category</th><th>Payee</th><th>₹</th><th></th></tr>
      ${rows.map(r => `<tr><td>${fmtD(r.date)}</td><td>${esc(r.particulars || "")}</td><td>${esc(r.category || "")}</td><td>${esc(r.payee || "")}</td><td>${inr(r.amount || 0)}</td>
        <td style="white-space:nowrap"><button class="btn small quiet" data-mv="${r.id}">Move to project</button> <button class="btn small quiet" data-sp="${r.id}">Split</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Nothing here</td></tr>`}</table></div></div>`);
  $("content").querySelectorAll("[data-mv]").forEach(b => b.onclick = async () => {
    const name = prompt("Move to which project?\n" + activeProjects().map(p => "· " + p.name).join("\n")); if (!name) return;
    const p = state.projects.find(x => x.name.toLowerCase().includes(name.toLowerCase())); if (!p) return toast("Not found");
    const head = prompt("Budget head code (optional):") || "";
    await db.collection("expenses").doc(b.dataset.mv).update({ projectId: p.id, head, fcra: p.fundType || "" }); audit("allocate", "expenses", b.dataset.mv, p.name); toast("Moved"); routes.unalloc(); });
  $("content").querySelectorAll("[data-sp]").forEach(b => b.onclick = async () => { const r = rows.find(x => x.id === b.dataset.sp);
    const spec = prompt(`Split ${inr(r.amount)} across projects.\nFormat: Project name=amount; Project name=amount`); if (!spec) return;
    const parts = spec.split(";").map(s => s.trim()).filter(Boolean).map(s => { const [n, a] = s.split("="); const p = state.projects.find(x => x.name.toLowerCase().includes((n || "").trim().toLowerCase())); return p ? { p, amount: Number(a) } : null; }).filter(Boolean);
    if (!parts.length) return toast("Nothing matched");
    const batch = db.batch(); parts.forEach(({ p, amount }) => batch.set(db.collection("expenses").doc(), { ...r, id: undefined, projectId: p.id, amount, particulars: r.particulars + " (split)", splitFrom: r.id, createdBy: state.user.uid }));
    batch.delete(db.collection("expenses").doc(r.id)); await batch.commit(); audit("split", "expenses", r.id, spec); toast("Split"); routes.unalloc(); });
};

/* ================= CALENDAR (everything with a date, one grid) ================= */
routes.calendar = async (ym) => {
  const base = ym || state.calMonth || today().slice(0, 7); state.calMonth = base;
  setTitle("Calendar");
  const uid = viewUid();
  const g = c => db.collection(c).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [meet, stat, obl, regs, trav, jour, appt, acts, leaves, asg, reqs, orgHols, orgEvts] = await Promise.all(
    ["meetings", "statutory", "obligations", "registrations", "travelRequests", "journeys", "appointments", "activities", "leaveRequests", "assignments", "requisitions", "holidays", "orgEvents"].map(g));

  // National / bank holidays — fixed dates for 2026 & 2027
  const NATIONAL_HOLIDAYS = [
    {date:"2026-01-26",name:"Republic Day"}, {date:"2026-03-25",name:"Holi"},
    {date:"2026-04-03",name:"Good Friday"}, {date:"2026-04-14",name:"Dr. Ambedkar Jayanti"},
    {date:"2026-04-14",name:"Baisakhi"}, {date:"2026-05-23",name:"Buddha Purnima"},
    {date:"2026-06-07",name:"Eid ul-Adha"}, {date:"2026-07-27",name:"Muharram"},
    {date:"2026-08-15",name:"Independence Day"}, {date:"2026-09-24",name:"Milad-un-Nabi"},
    {date:"2026-10-02",name:"Gandhi Jayanti"}, {date:"2026-10-21",name:"Dussehra"},
    {date:"2026-11-01",name:"Diwali"}, {date:"2026-11-02",name:"Govardhan Puja"},
    {date:"2026-11-15",name:"Guru Nanak Jayanti"}, {date:"2026-12-25",name:"Christmas Day"},
    {date:"2027-01-01",name:"New Year's Day"}, {date:"2027-01-26",name:"Republic Day"},
    {date:"2027-03-14",name:"Holi"}, {date:"2027-03-26",name:"Eid ul-Fitr"},
    {date:"2027-04-02",name:"Good Friday"}, {date:"2027-04-14",name:"Dr. Ambedkar Jayanti"},
    {date:"2027-08-15",name:"Independence Day"}, {date:"2027-10-02",name:"Gandhi Jayanti"},
  ];

  /* What belongs on your calendar: your own things, your team's things, and
     the organisation-wide dates your post is responsible for. */
  const mineOrTeam = r => isVolunteerOnly()
    ? [r.uid, r.assigneeId, r.travellerId, r.supervisorId].filter(Boolean).includes(uid)
    : inMyLine(r);
  const may = r => mayOpen(r);
  const myProjects = state.projects.filter(p => seesWholeOrg() || has("director_acf", "program_officer", "program_coord", "fundraising", "admin")
    || p.leadId === uid || (p.team || []).includes(uid)).map(p => p.id);
  const onMyProject = pid => !pid || myProjects.includes(pid);

  const items = [
    // National holidays
    ...NATIONAL_HOLIDAYS.map(h => ({ date: h.date, kind: "National holiday", what: h.name, route: "calendar", c: "#6B2E6B" })),
    // Org-specific holidays — org-wide or matching my office
    ...orgHols.filter(h=>!h.officeId||h.officeId===state.me?.officeId||seesWholeOrg()).map(h => { const oN=h.officeId&&seesWholeOrg()?(" ("+((state.offices||[]).find(o=>o.id===h.officeId)?.name||"office")+")"):""; return { date: h.date, kind: h.type||"Holiday", what: h.name+oN, route: "holidays", c: "#8C3A1F" }; }),
    // Planned events
    ...orgEvts.map(e => ({ date: e.date, kind: "Event", what: `📅 ${e.title}${e.location?" · "+e.location:""}`, route: "holidays", c: "#1F4D8C" })),
    // governance and compliance — only for the posts that answer for them
    ...(may("board") ? meet.map(m => ({ date: m.date, kind: "Meeting", what: `${m.body}: ${m.title}`, route: "board", c: "#6B2E6B" })) : []),
    ...(may("statutory") ? stat.filter(s => s.status !== "Filed").map(s => ({ date: s.due, kind: "Filing", what: `${s.filing}${s.authority ? " · " + s.authority : ""}`, route: "statutory", c: "#8C3A1F" })) : []),
    ...(may("registrations") ? regs.filter(r => r.validTill).map(r => ({ date: r.validTill, kind: "Renewal", what: `${r.name} expires`, route: "registrations", c: "#8C3A1F" })) : []),
    // donor reports — fund raising, finance and the project's own team
    ...(may("frObligations") || myProjects.length ? obl.filter(o => !o.done && (may("frObligations") || onMyProject(o.projectId))).map(o => ({ date: o.due, kind: "Donor report", what: `${o.what} — ${projectName(o.projectId)}`, route: "frObligations", c: "#1F4D8C" })) : []),
    // work: mine and my team's
    ...trav.filter(mineOrTeam).map(t => ({ date: t.from, kind: "Travel", what: `${userName(t.travellerId)}: ${t.purpose}`, route: "itinerary", c: "#2E6B4F" })),
    ...jour.filter(mineOrTeam).map(j => ({ date: j.date, kind: "Journey", what: `${userName(j.travellerId)}: ${j.fromPlace} → ${j.toPlace}`, route: "travelog", c: "#2E6B4F" })),
    ...appt.filter(a => a.status !== "cancelled" && (mineOrTeam(a) || a.withWhom === state.me.postTitle)).map(a => ({ date: a.date, kind: "Appointment", what: `${a.slot || ""} ${userName(a.uid)} with ${a.withWhom}`, route: "appointment", c: "#7A5230" })),
    ...leaves.filter(l => l.status === "approved" && mineOrTeam(l)).flatMap(l => {
      const name = userName(l.uid); const isWFH = /work from home/i.test(l.type||"");
      const kind = isWFH ? "WFH" : "On leave"; const c = isWFH ? "#2E6B4F" : "#C06A1A";
      const what = `${name} — ${l.type||"leave"}`;
      // Expand across all days from l.from to l.to
      const days = []; let cur = l.from;
      while (cur && cur <= (l.to||l.from)) {
        days.push({ date: cur, kind, what, route: "leaveRegister", c });
        const d = new Date(cur); d.setDate(d.getDate()+1);
        cur = d.toISOString().slice(0,10);
        if (days.length > 60) break; // safety cap
      }
      return days;
    }),
    ...asg.filter(a => a.status !== "verified" && (a.assigneeId === uid || a.assignerId === uid || mineOrTeam(a))).map(a => ({ date: a.due, kind: "Task", what: `${a.title}${a.assigneeId === uid ? "" : " — " + userName(a.assigneeId)}`, route: "assignments", c: "#C8922F" })),
    ...reqs.filter(r => !/Closed|Declined/.test(r.status || "") && (r.uid === uid || mineOrTeam(r))).map(r => ({ date: r.neededBy, kind: "Requisition", what: `${r.item} — ${r.status}`, route: "requisition", c: "#7A5230" })),
    // activities and milestones of projects I am on
    ...acts.filter(a => a.end && onMyProject(a.projectId)).map(a => ({ date: a.end, kind: "Activity ends", what: `${a.code || ""} ${a.name}`.trim(), route: "plan", c: "#1F4D8C" })),
    ...acts.filter(a => onMyProject(a.projectId)).flatMap(a => (a.milestones || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => { const [d, ...t] = l.split("·"); return { date: (d || "").trim(), kind: "Milestone", what: t.join("·").trim() || a.name, route: "plan", c: "#C8922F" }; }))
  ].filter(i => i.date && (!i.route || mayOpen(i.route)));

  const [Y, M] = base.split("-").map(Number); const first = new Date(Y, M - 1, 1), days = new Date(Y, M, 0).getDate(), lead = (first.getDay() + 6) % 7;
  const byDay = {}; items.filter(i => i.date.startsWith(base)).forEach(i => (byDay[Number(i.date.slice(8, 10))] = byDay[Number(i.date.slice(8, 10))] || []).push(i));
  const monthName = first.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const shift = n => { const d = new Date(Y, M - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const upcoming = items.filter(i => i.date >= today()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  const kinds = [...new Set(items.map(i => i.kind))];
  html(`<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:6px;align-items:center"><button class="btn small quiet" id="prev">‹</button><b style="min-width:150px;text-align:center">${monthName}</b><button class="btn small quiet" id="next">›</button><button class="btn small quiet" id="tod">Today</button></div>
      <div class="small muted">${kinds.join(" · ") || "nothing yet"}</div></div>
    <p class="small muted" style="margin-top:6px">${seesWholeOrg() ? "You see the whole organisation's calendar." : "Your own dates, your team's, and the dates your post answers for."}</p>
    <div class="calgrid" style="margin-top:10px">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="calhead">${d}</div>`).join("")}
      ${Array(lead).fill(`<div class="calcell empty-cell"></div>`).join("")}
      ${Array.from({ length: days }, (_, i) => { const d = i + 1; const iso = `${base}-${String(d).padStart(2, "0")}`; const list = byDay[d] || [];
        return `<div class="calcell ${iso === today() ? "today" : ""}"><div class="caldate">${d}</div>
          ${list.slice(0, 4).map(x => `<div class="calitem" style="border-left:3px solid ${x.c}" data-go="${x.route}" title="${esc(x.kind + ": " + x.what)}">${esc(x.what.slice(0, 26))}</div>`).join("")}
          ${list.length > 4 ? `<div class="small muted">+${list.length - 4} more</div>` : ""}</div>`; }).join("")}
    </div></div>
    <div class="card"><h2>Coming up</h2><div class="list">
      ${upcoming.map(i => `<div class="item"><div class="grow"><div class="t">${esc(i.what)}</div><div class="s">${esc(i.kind)} · ${fmtD(i.date)}</div></div>
        <span class="tag ${new Date(i.date) < new Date() ? "bad" : (new Date(i.date) - Date.now()) / 86400000 <= 7 ? "warn" : ""}">${Math.ceil((new Date(i.date) - Date.now()) / 86400000)}d</span>
        <button class="btn small quiet" data-go="${i.route}">Open</button></div>`).join("") || `<div class="empty">Nothing scheduled for you</div>`}</div></div>`);
  $("prev").onclick = () => routes.calendar(shift(-1)); $("next").onclick = () => routes.calendar(shift(1)); $("tod").onclick = () => routes.calendar(today().slice(0, 7));
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => {
    if (b.dataset.go === "project" && state.reportProjectId) { state.projectId = state.reportProjectId; state.projectTab = "reports"; }
    go(b.dataset.go); });
};

/* ================= UNIFIED APPROVALS INBOX ================= */
/* What each kind of record is called, and how it travels — said once at the top. */
const TYPES = { requisitions: "Requisition", expenseClaims: "Expense claim", advances: "Advance",
  travelRequests: "Travel request", leaveRequests: "Leave", dayReports: "Day report",
  assignments: "Task", grievances: "Complaint", postClaims: "Post claim" };
const CHAIN = {
  requisitions: "the person asks \u2192 their department head verifies \u2192 the Director ACF approves \u2192 above \u20B950,000 the Founder & General Secretary authorises \u2192 given to someone to arrange. A volunteer request goes straight to Project Development, Research & Innovations.",
  expenseClaims: "claimed \u2192 verified \u2192 approved by the Director ACF \u2192 paid, with the bank or UPI reference recorded.",
  advances: "asked for \u2192 verified \u2192 approved \u2192 issued \u2192 settled within 30 days with bills, or deducted from salary (FP \u00A75B).",
  travelRequests: "asked for \u2192 approved \u2192 Administration books it \u2192 journey recorded on return.",
  leaveRequests: "applied for \u2192 the line manager decides \u2192 Administration records it in the leave register.",
  dayReports: "written by the person \u2192 read and verified by their line manager."
};
routes.inbox = async () => {
  setTitle("Approvals & verification");
  const uid = viewUid(); const team = state.users.filter(u => mgrs(u).includes(uid)).map(u => u.id);
  /* An item appears in the inbox of whoever has to act on it, and nobody else.
     The General Secretary is not a reserve approver for every stage — that was the
     point of giving the Director ACF the approvals. */
  const big = r => (Number(r.amount) || Number(r.estimate) || 0) > 50000;
  const myLine = r => team.includes(r.uid) || team.includes(r.travellerId) || team.includes(r.assigneeId);
  const mine = (r) => {
    if (r._c === "users") return isAdmin() || has("super_admin");          // profiles and post claims
    const st = String(r.status || "");
    if (r._c === "requisitions") {
      if (/awaiting department head/i.test(st)) {
        const d = String(r.forDept || "");
        if (/^Administration/.test(d)) return has("admin");
        if (/^Programmes/.test(d)) return has("program_officer", "program_coord");
        if (/^Accounts/.test(d)) return has("director_acf");
        if (/^Project Development/.test(d)) return has("fundraising");
        if (/^Governance/.test(d)) return has("super_admin");
        return lineUids().has(r.uid);           // nothing said: fall back to the line manager
      }
      if (/awaiting the general secretary/i.test(st)) return has("super_admin");
      if (/awaiting executive committee/i.test(st)) return has("super_admin");
      return has("director_acf") || (big(r) && has("super_admin"));
    }
    // director-approved expense claims → accountant processes payment only
    if (/^approved$/i.test(st) && r._c === "expenseClaims") return has("accountant");
    // director-approved advances → accountant issues payment only
    if (/^approved$/i.test(st) && (r._c === "advances" || r._c === "travelRequests")) return has("accountant");
    // verified and waiting for director ACF approval
    if (/verified|manager.?approved|awaiting director acf/i.test(st))
      return has("director_acf") || (big(r) && has("super_admin"));
    // not yet verified: the person's own line manager
    // super_admin (GS) sees all pending leave as HR, matching the home screen count
    if (r._c === "leaveRequests") {
      // Once decided, it is no longer pending — never show it to anyone for action
      if (/approved|rejected|cancelled/i.test(st)) return false;
      // GS only approves Bhumish's (Director ACF's) own leave
      if (has("super_admin","founder")) {
        return (state.users||[]).find(u=>u.id===r.uid)?.roles?.includes("director_acf");
      }
      // Director ACF approves leave for his own direct reports AND GS direct reports at HQ
      if (has("director_acf")) {
        const leaveOwner = (state.users||[]).find(u=>u.id===r.uid);
        // Merge user record managerIds with the managerIds stored on the leave at submission
        const ownerMgrs = [...new Set([...(leaveOwner?.managerIds||[]), ...(r.managerIds||[])])];
        // His own direct reports
        if (ownerMgrs.includes(state.user.uid)) return true;
        // Also: GS direct reports at HQ are routed through the Director ACF
        const gsId = (state.users||[]).find(u=>(u.roles||[]).includes("super_admin") || (u.roles||[]).includes("founder"))?.id;
        if (gsId && ownerMgrs.includes(gsId)) return true;
      }
      // HR/admin sees all leave for recording only (not approval)
    }
    // Event reports: submitted → line manager verifies; verified → program_officer approves
    if (r._c === "eventReports") {
      if (/^verified$/i.test(st)) return has("program_officer","super_admin","founder");
      return myLine(r);
    }
    // Salary slips — staff acknowledge → director ACF approves payment → accountant pays
    if (r._c === "salarySheets") {
      if (/awaiting payment/i.test(st)) return has("accountant","director_acf","super_admin","founder");
      if (/acknowledged/i.test(st)) return has("director_acf","super_admin","founder");
      return false;
    }
    // Expense claims already approved → waiting for accountant to pay; only accountant sees
    if (r._c === "expenseClaims" && /^approved$/i.test(st)) return has("accountant");
    // Cash box spending — director ACF approves, then accountant processes
    // Exception: if the submitter IS the director ACF, escalate to Founder/GS for approval
    if (r._c === "pettyCash") {
      if (/awaiting accountant/i.test(st)) return has("accountant","director_acf");
      if (/awaiting director|waiting to be accepted/i.test(st)) {
        const submitter = (state.users||[]).find(u => u.id === r.by);
        const submitterIsDirector = (submitter?.roles||[]).includes("director_acf");
        if (submitterIsDirector) return has("super_admin","founder");
        return has("director_acf"); // only Bhumish sees staff entries, not Shafiq
      }
      return false;
    }
    // Assignments: assigner verifies their own; system-assigned auto-close (no manager verification needed)
    if (r._c === "assignments") {
      const asgner = r.assignerId || "";
      if (asgner && asgner !== "system") return asgner === uid; // assigner verifies their own task
      return false; // system-assigned: auto-verify, never route to any manager
    }
    // Day reports: auto-submitted, no approval chain — line managers only add observations
    if (r._c === "dayReports") return false;
    // Delhi HQ staff reporting to GS → route to Director ACF, not GS
    const submitter = (state.users||[]).find(u=>u.id===r.uid);
    const submitterMgrs = [...new Set([...(submitter?.managerIds||[]), ...(r.managerIds||[])])];
    const mgrIsGS = submitterMgrs.some(mid=>(state.users||[]).find(u=>u.id===mid)?.roles?.some(role=>["super_admin","founder"].includes(role)));
    if (mgrIsGS) {
      const gsOffice = (state.offices||[]).find(o=>/delhi|headquarter|head.*office/i.test(o.name||"") || o.isHQ);
      const submitterAtHQ = submitter?.officeId && gsOffice && submitter.officeId === gsOffice.id;
      if (submitterAtHQ) {
        if (has("director_acf")) return true;
        if (has("super_admin","founder")) return false; // GS doesn't handle HQ staff submissions
      }
    }
    return myLine(r);
  };
  const g = (c, where) => { let q = db.collection(c); if (where) q = q.where(where[0], where[1], where[2]); return q.limit(200).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data(), _c: c }))).catch(() => []); };
  const [lv, ec, adv, trav, asg, ev, pet, inc, appt, reqs, prof, pcy, sal, ackAdv] = await Promise.all([
    g("leaveRequests", ["status", "==", "pending"]), g("expenseClaims", ["status", "in", ["submitted", "manager_approved", "approved"]]),
    g("advances", ["status", "in", ["submitted", "verified", "approved"]]), g("travelRequests", ["status", "in", ["submitted", "verified"]]),
    g("assignments", ["status", "==", "done – to verify"]), g("eventReports", ["status", "in", ["submitted", "verified"]]),
    g("expenses", ["status", "in", ["needs 2nd approver", "needs EC approval"]]), g("incidents", ["status", "==", "open"]), g("appointments", ["status", "==", "requested"]),
    g("requisitions", ["status", "in", ["Awaiting department head", "Verified — awaiting Director ACF", "Awaiting Director ACF", "Awaiting the General Secretary", "Awaiting General Secretary"]]),
    db.collection("users").where("active", "==", false).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data(), _c: "users" })).filter(u => u.status === "pending")).catch(() => []),
    g("pettyCash", ["status", "in", ["awaiting director", "no bill — awaiting director", "waiting to be accepted", "no bill — waiting to be accepted", "awaiting accountant"]]),
    g("salarySheets", ["status", "in", ["acknowledged", "awaiting payment"]]),
    db.collection("advances").where("uid","==",uid).where("ackStatus","==","pending").get().then(s=>s.docs.map(d=>({id:d.id,...d.data(),_c:"advances",_needsAck:true}))).catch(()=>[])]);
  const chain = { salarySheets: "Director ACF approves payment → Accountant pays", pettyCash: "Director ACF approves → Accountant processes", leaveRequests: "your line manager approves — done", expenseClaims: "your manager verifies → the Director ACF approves → paid (above ₹50,000 the General Secretary authorises)", advances: "your manager verifies → the Director ACF approves", travelRequests: "your manager verifies → the Director ACF approves", assignments: "assigner verifies", dayReports: "manager verifies", eventReports: "your manager verifies → the Program Officer", expenses: "second approver (FP §3) / General Secretary above ₹50,000", incidents: "Program Officer & General Secretary", appointments: "the person asked", requisitions: "asked for → the department it is for verifies → the Director ACF approves, or the General Secretary above ₹50,000 → somebody arranges it and records what they did → the person who asked says they got it and what came of it → it is read and closed", users: "General Secretary" };
  const label = r => r._c === "leaveRequests" ? `${userName(r.uid)} · ${r.type} ${r.days || ""} day(s) from ${fmtD(r.from)}`
    : r._c === "expenseClaims" ? `${userName(r.uid)} · ₹${Number(r.amount || 0).toLocaleString("en-IN")} · ${r.category || r.description || ""}`
    : r._c === "advances" ? `${userName(r.uid)} · ₹${Number(r.amount || 0).toLocaleString("en-IN")} · ${r.purpose || ""}`
    : r._c === "travelRequests" ? `${userName(r.travellerId)} · ${r.purpose}` : r._c === "assignments" ? `${r.title} — ${userName(r.assigneeId)}`
    : r._c === "dayReports" ? `Day report · ${userName(r.uid)} · ${fmtD(r.date)}` : r._c === "eventReports" ? `Event · ${r.heading} · ${userName(r.uid)}`
    : r._c === "expenses" ? `Voucher ₹${Number(r.amount || 0).toLocaleString("en-IN")} · ${r.particulars} · ${r.payee || ""}`
    : r._c === "salarySheets" ? `${esc(r.staffName||userName(r.staffId))} · ₹${Number(r.earned||0).toLocaleString("en-IN")} net · ${r.month||""}`
    : r._c === "pettyCash" ? `${userName(r.by)} · ₹${Number(r.outAmt||0).toLocaleString("en-IN")} · ${r.particulars||""}${r.payee?" → "+r.payee:""}${r.bill?" 📎":!r.accepted?" (no bill)":""}`
    : r._c === "incidents" ? `Incident · ${r.nature || r.type} · ${r.location || ""}` : r._c === "appointments" ? `${userName(r.uid)} wants ${r.slot} on ${fmtD(r.date)}`
    : r._c === "requisitions" ? `${r.item} × ${r.qty || 1} · ₹${Number(r.estimate || 0).toLocaleString("en-IN")} · ${userName(r.uid)}`
    : r._c === "users" ? `New profile · ${r.name} · "${r.designation || ""}"` : r.name || r.title || "";
  const all = [...prof, ...lv, ...ec, ...adv, ...trav, ...asg, ...ev, ...pet, ...inc, ...appt, ...reqs, ...pcy, ...sal, ...ackAdv].filter(r => r._c === "users" ? isAdmin() || has("super_admin") : r._needsAck ? true : mine(r));
  const typeName = { salarySheets: "Salary slip", pettyCash: "Cash box entry", users: "Profile", leaveRequests: "Leave", expenseClaims: "Expense claim", advances: "Advance", travelRequests: "Travel", assignments: "Assignment", requisitions: "Requisition", dayReports: "Day report", eventReports: "Event report", expenses: "Voucher", incidents: "Incident", appointments: "Appointment" };
  const filter = state.inboxFilter || "all";
  const shown = filter === "all" ? all : all.filter(r => r._c === filter);
  const counts = {}; all.forEach(r => counts[r._c] = (counts[r._c] || 0) + 1);
  const unowned = (await db.collection("requisitions").where("status", "==", "With the team").limit(50).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() })).filter(r => !r.ownerId && (has("super_admin", "director_acf", "admin", "procurement", "fundraising")));
  const chains = [...new Set(all.map(r => CHAIN[r._c]).filter(Boolean))];
  html(`<div class="card"><h2>${all.length} item${all.length === 1 ? "" : "s"} waiting for you</h2>
      <p class="small muted">Only things that need a decision. Day reports are not decisions —
        read them under <button class="btn small quiet" onclick="go('teamReports')">Reports from my team</button>
        or a month at a time under <button class="btn small quiet" onclick="go('monthlyReports')">Monthly reports</button>.</p>
    ${chains.length ? `<details class="small muted"><summary>How these are approved</summary>
      <ul style="margin:6px 0 0 16px;line-height:1.7">${[...new Set(all.map(r => r._c))].filter(c2 => CHAIN[c2]).map(c2 => `<li><b>${esc(TYPES[c2] || c2)}</b> — ${esc(CHAIN[c2])}</li>`).join("")}</ul></details>` : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn small ${filter === "all" ? "" : "quiet"}" data-f="all">All (${all.length})</button>
      ${Object.entries(counts).map(([k, v]) => `<button class="btn small ${filter === k ? "" : "quiet"}" data-f="${k}">${typeName[k] || k} (${v})</button>`).join("")}</div></div>
    <div class="card"><div class="list">
      ${shown.map(r => `<div class="item"><div class="grow"><div class="t">${esc(label(r))}${r.bill && typeof r.bill === "object" && r.bill.link ? ` <a href="${r.bill.link}" target="_blank" rel="noopener" style="font-size:12px">🧾 view bill</a>` : r.bill && typeof r.bill === "string" && r.bill.startsWith("http") ? ` <a href="${r.bill}" target="_blank" rel="noopener" style="font-size:12px">🧾 view bill</a>` : r.bill ? " 🧾" : ""}</div>
        <div class="s">${esc(typeName[r._c] || r._c)} · chain: ${esc(chain[r._c] || "")}${r.status ? " · now: " + esc(r.status) : ""}${r.reason ? " · " + esc(r.reason) : ""}${r.description ? " · " + esc(r.description) : ""}</div></div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${r._needsAck ? `<div class="s" style="margin-bottom:4px">⚠ ${esc(userName(r.issuedBy||r.paidBy||""))} recorded a payment of ₹${Number(r.amount||0).toLocaleString("en-IN")} on your behalf. Please confirm you received it.</div>${r.supportingDoc?`<a href="${esc(r.supportingDoc.url||r.supportingDoc.link||"")}" target="_blank" rel="noopener" style="font-size:12px">📎 supporting document</a><br>`:""}
          <button class="btn small" data-adv-ack-inbox="${r.id}">✓ I received this</button>` :
        r._c === "users" ? `<button class="btn small" data-go="profileApprovals">Review</button>`
        : (() => { /* The button says what this person is actually doing, and the line
             beneath says where it goes next. Pressing "Approve" when you are only the
             verifier is how a request gets waved through by mistake. */
            const st = String(r.status || "");
            const isLeave = r._c === "leaveRequests";
            if (isLeave && /approved|rejected|cancelled/i.test(st)) return `<span class="tag ${/approved/i.test(st) ? "ok" : "bad"}">${esc(st)}</span>`;
            const isPaid = /^approved$/i.test(st) && (r._c==="expenseClaims"||r._c==="advances"||r._c==="travelRequests");
            if (isPaid && !has("accountant")) return `<span class="tag">With accountant</span>`; // only accountant marks paid
            const verifying = isLeave ? !has("director_acf","super_admin","founder") : !isPaid && r._c !== "pettyCash" && !/verified|manager.?approved|awaiting director acf/i.test(st);
            const label = isPaid ? "Mark paid" : verifying ? "Verify" : "Approve";
            const next = verifying
              ? (r._c === "assignments" ? "Done — the assignment is closed."
                : big(r) || /^Accounts|^Governance/.test(r.forDept||'') ? "It then goes to the Founder & General Secretary to approve."
                        : "It then goes to the Director ACF to approve.")
              : isLeave ? "Done — leave is approved."
              : r._c === "pettyCash" ? "It then goes to the accountant to process."
              : "It is then arranged or paid, and comes back to the person who asked.";
            return `${r.needsQuotes && !String(r.quotes || "").trim()
              ? `<div class="s" style="color:var(--bad);margin-bottom:3px">Above ₹10,000 with no quotations attached — §7.3 asks for three.</div>` : ""}
              <div class="s" style="margin-bottom:4px">You are <b>${isPaid ? "marking as paid" : verifying ? "verifying" : "approving"}</b> this as ${esc(isPaid ? "Accounts" : verifying ? (r._c==="assignments" ? "the assigner" : "the line manager") : (big(r) || /^Accounts|^Governance/.test(r.forDept||'') || /awaiting the general secretary/i.test(String(r.status||''))) ? "the Founder & General Secretary" : has("director_acf") ? "the Director ACF" : has("super_admin","founder") ? "the Founder & General Secretary" : "the Director ACF")}. ${esc(next)}</div>
              <button class="btn small" data-ok="${r._c}|${r.id}">${label}</button><button class="btn small quiet" data-ret="${r._c}|${r.id}">Return</button><button class="btn small danger" data-no="${r._c}|${r.id}">Reject</button>`; })()}</div></div>`).join("") || `<div class="empty">Nothing waiting — all clear</div>`}</div></div>`);
  $("content").querySelectorAll("[data-adv-ack-inbox]").forEach(b => b.onclick = async () => {
    if (!confirm("Confirm you received this payment?")) return;
    await db.collection("advances").doc(b.dataset.advAckInbox).update({ ackStatus:"acknowledged", ackedBy:state.user.uid, ackedAt:today() });
    successFlash("Acknowledged ✓"); routes.inbox();
  });
  if ($("toReq")) $("toReq").onclick = e => { e.preventDefault(); go("requisition"); };
  $("content").querySelectorAll("[data-f]").forEach(b => b.onclick = () => { state.inboxFilter = b.dataset.f; routes.inbox(); });
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  const act = async (spec, kind) => { const [col, id] = spec.split("|"); const ref = db.collection(col).doc(id);
    const snap = await ref.get(); const cur = snap.data()?.status || "";
    // Status-aware approval: the next state depends on who is acting and what stage we are at
    let nextSt;
    if (kind === "approve") {
      if (col === "leaveRequests") nextSt = "approved";
      else if (col === "expenseClaims") {
        if (/^approved$/i.test(cur)) nextSt = "paid";                      // accountant marks paid
        else if (/manager.?approved|verified|awaiting director/i.test(cur)) nextSt = "approved"; // director ACF approves
        else nextSt = "manager_approved";                                   // line manager verifies
      }
      else if (col === "advances" || col === "travelRequests") {
        if (/^approved$/i.test(cur)) nextSt = "issued";                     // accountant issues cash
        else if (/verified|manager.?approved/i.test(cur)) nextSt = "approved"; // director ACF approves
        else nextSt = "verified";                                            // line manager verifies
      }
      else if (col === "salarySheets") {
        if (/awaiting payment/i.test(cur)) nextSt = "paid"; // accountant marks paid
        else nextSt = "awaiting payment"; // director approves → goes to accountant for payment
      }
      else if (col === "pettyCash") {
        if (/awaiting accountant/i.test(cur) && !has("accountant")) return; // only accountant can accept
        if (/awaiting accountant/i.test(cur)) nextSt = "accepted"; // accountant accepts
        else nextSt = "awaiting accountant"; // director approves → goes to accountant
      }
      else { const approveMap = { assignments: "verified", dayReports: "verified", eventReports: "verified", expenses: "approved", incidents: "under follow-up", appointments: "confirmed" }; nextSt = approveMap[col] || "approved"; }
    if(col==="travelRequests"){try{await downloadFilledForm("F-06","travelRequests",r.id,r);}catch(_e6){console.warn("F-06 failed",_e6);}}
} else if (kind === "return") {
      const returnMap = { leaveRequests: "pending", expenseClaims: "returned", advances: "submitted", travelRequests: "submitted", assignments: "assigned", dayReports: "returned", eventReports: "returned", expenses: "returned", incidents: "open", appointments: "rescheduled" };
      nextSt = returnMap[col] || "returned";
    } else {
      const rejectMap = { leaveRequests: "rejected", expenseClaims: "rejected", advances: "rejected", travelRequests: "rejected", assignments: "assigned", dayReports: "returned", eventReports: "returned", expenses: "rejected", incidents: "closed", appointments: "cancelled" };
      nextSt = rejectMap[col] || "rejected";
    }
    const note = kind === "approve" ? "" : (prompt("Note for them:") ?? ""); if (kind !== "approve" && note === null) return;
    await ref.update({ status: nextSt, [kind + "dBy"]: uid, [kind + "Note"]: note, [kind + "At"]: today() }); audit(kind, col, id, nextSt);
    // Expense claim final approval → generate voucher and upload to Drive
    if(col === "expenseClaims" && nextSt === "approved") {
      try {
        const _ec = (await db.collection("expenseClaims").doc(id).get()).data() || {};
        const _claimant = (state.users||[]).find(u=>u.id===_ec.uid);
        const _vText = "EXPENSE CLAIM VOUCHER\n====================\n"+
          "Ref: "+id+"\nDate: "+today()+"\nClaimant: "+(_claimant?.name||_ec.uid||"")+"\n"+
          "Department: "+(_ec.department||_ec.byDept||"")+"\nProject: "+(_ec.projectName||"")+"\n"+
          "Period: "+(_ec.period||"")+"\nAmount: \u20b9"+Number(_ec.amount||_ec.total||0).toLocaleString("en-IN")+"\n"+
          "Purpose: "+(_ec.purpose||_ec.description||"")+"\n"+
          "Approved by: "+state.me.name+"\nOn: "+today();
        uploadToDrive(new File([_vText],"voucher-"+id+"-"+today()+".txt",{type:"text/plain"}),"accounts","voucher-"+id+".txt")
          .then(function(_vr){if(_vr&&_vr.link)db.collection("expenseClaims").doc(id).update({voucherUrl:_vr.link}).catch(function(){});})
          .catch(function(){});
      } catch(_ve){ console.warn("Expense voucher:",_ve&&_ve.message); }
    }
    // Auto-LWP: if approving a leave and the person exceeds entitlement, tag excess as LWP
    if (kind === "approve" && col === "leaveRequests") {
      const ld = snap.data();
      if (ld && ld.type && !/work from home|lwp|without pay/i.test(ld.type)) {
        const owner = (state.users||[]).find(u => u.id === ld.uid);
        if (owner) {
          const ent = leaveEntitlement(owner);
          const cap = ent[ld.type];
          if (cap !== undefined) {
            const prev = (await db.collection("leaveRequests")
              .where("uid","==",ld.uid).where("type","==",ld.type).where("status","==","approved").get())
              .docs.filter(d => d.id !== id).reduce((a,d) => a + (Number(d.data().days)||0), 0);
            const excess = (prev + (Number(ld.days)||0)) - cap;
            if (excess > 0) {
              await db.collection("leaveRequests").add({
                uid: ld.uid, byName: owner.name, byPerson: ld.uid,
                type: "Leave without pay", from: ld.from, to: ld.to,
                days: excess, status: "approved", autoLwp: true,
                reason: `Auto-LWP: ${ld.type} entitlement of ${cap} day(s) exceeded by ${excess} day(s)`,
                managerIds: ld.managerIds || [], parentLeaveId: id,
                approvedBy: uid, approvedAt: today(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              });
              toast(`Approved ✓ — ${excess} day(s) auto-tagged as LWP (entitlement exceeded)`);
              return routes.inbox();
            }
          }
        }
      }
    }
    // Flag record so Apps Script notifies accountant on next run (every 30 min)
    if (kind === "approve" && nextSt === "approved" && (col === "advances" || col === "pettyCash" || col === "expenseClaims")) {
      db.collection(col).doc(id).update({ accountantNotified: false }).catch(() => {});
    }
    toast(kind === "approve" ? "Approved ✓" : kind === "return" ? "Returned" : "Rejected"); routes.inbox(); };
  $("content").querySelectorAll("[data-ok]").forEach(b => b.onclick = () => act(b.dataset.ok, "approve"));
  $("content").querySelectorAll("[data-ret]").forEach(b => b.onclick = () => act(b.dataset.ret, "return"));
  $("content").querySelectorAll("[data-form]").forEach(b => b.onclick = () => printRequisitionForm(all.find(x => x.id === b.dataset.form)));
  $("content").querySelectorAll("[data-no]").forEach(b => b.onclick = () => act(b.dataset.no, "reject"));
};

/* ================= HR DOCUMENTS: appointment letters, contracts, certificates ================= */
const LETTER_TYPES = {
  appointment: { title: "Letter of Appointment", body: d => `We are pleased to appoint you as <b>${d.post}</b> in the ${d.department} department of Empower People, with effect from <b>${d.from}</b>.

You will be based at ${d.office} and will report to ${d.reportsTo}. Your appointment is on a ${d.engagement} basis${d.till ? ` for the period ending ${d.till}` : ""}.

Your consolidated remuneration will be ${d.salary || "as per the organisation's approved salary structure"}, payable monthly on the 5th of the following month, subject to statutory deductions.

The purpose of your post, your responsibilities and the limits of your authority are set out in the Terms of Reference for this post, which forms part of this appointment and may be revised from time to time in consultation with you. You will be governed by the Organization Policy Manual, the HR Policy, the Child Protection Policy and the Policy on Prevention of Sexual Harassment, each of which forms part of this appointment.

This appointment is subject to a probation period of ${d.probation || "three months"}, satisfactory references and background verification. Either party may end this engagement with ${d.notice || "30 days"} written notice. On exit you will return all organisational property and complete handover of files and assets.

You are required to maintain strict confidentiality regarding Sakhis, communities and the internal affairs of the organisation, during and after your engagement, and to sign the Non-Disclosure Agreement and the Commitment Statement.

We look forward to your contribution to the mission of enabling Sakhis of trafficking and marginalised communities to lead lives of dignity.` },
  contract: { title: "Contract of Engagement", body: d => `This contract is made between Empower People, 5 Dreams Apartments, A-4 Abulfazal Enclave, Jamia Nagar, Delhi-110025 (the Organisation) and <b>${d.name}</b> (the Consultant).

<b>1. Engagement.</b> The Organisation engages the Consultant as ${d.post} for the period ${d.from}${d.till ? ` to ${d.till}` : ""}, reporting to ${d.reportsTo}.

<b>2. Scope.</b> ${d.scope || "As set out in the terms of reference agreed between the parties."}

<b>3. Fees.</b> ${d.salary || "As agreed in the terms of reference"}, payable on submission of deliverables and an invoice, subject to deduction of tax at source.

<b>4. Expenses.</b> Travel and other approved expenses will be reimbursed at the Organisation's rates on submission of bills within 30 days.

<b>5. Conduct and safeguarding.</b> The Consultant will abide by the Organization Policy Manual, the Child Protection Policy and the Policy on Prevention of Sexual Harassment, and will report any safeguarding concern immediately.

<b>6. Confidentiality and data.</b> All information relating to Sakhis, communities and the Organisation is confidential and will not be disclosed or used for any other purpose, during or after this engagement.

<b>7. Intellectual property.</b> All work produced under this contract belongs to the Organisation.

<b>8. Termination.</b> Either party may terminate this contract with ${d.notice || "30 days"} written notice; the Organisation may terminate immediately for breach of safeguarding or confidentiality.` },
  volunteer: { title: "Volunteer Agreement", body: d => `Thank you for offering your time to Empower People as a volunteer in the role of <b>${d.post}</b>, from <b>${d.from}</b>${d.till ? ` to ${d.till}` : ""}, working with ${d.reportsTo} at ${d.office}.

Volunteering with us is not an employment relationship and carries no salary. ${d.salary ? `You will receive ${d.salary} towards expenses.` : "Approved travel and material expenses will be reimbursed on production of bills."}

As a volunteer you agree to abide by the Organization Policy Manual, the Child Protection Policy and the Policy on Prevention of Sexual Harassment, to maintain the confidentiality and dignity of every Sakhi and community member you meet, and to report any concern for someone's safety immediately.

We ask that you give reasonable notice if you are unable to continue, and return any organisational property and records in your care.` },
  experience: { title: "Experience Certificate", body: d => `This is to certify that <b>${d.name}</b> was engaged with Empower People as <b>${d.post}</b> in the ${d.department} department from <b>${d.from}</b> to <b>${d.till || "date"}</b>, based at ${d.office}.

During this period ${d.name.split(" ")[0]} worked on ${d.scope || "the organisation's programmes with Sakhis of trafficking and marginalised communities"}, and was found to be sincere and committed to the values of the organisation.

We wish ${d.name.split(" ")[0]} every success in future endeavours.` }
};
routes.letters = registerScreen({
  route: "letters", col: "letters", title: "Appointment letters & contracts", orderBy: "createdAt", nameKey: "name", canEdit: () => has("super_admin", "admin"),
  intro: "Generate an appointment letter, contract, volunteer agreement or experience certificate from the post. The letter is saved to the person's profile, where they can read and download it; upload the signed copy back here.",
  fields: [{ k: "staffId", l: "Person", t: "users", w: "half" }, { k: "type", l: "Document", t: "select", o: ["appointment", "contract", "volunteer", "experience"], w: "half" },
    { k: "post", l: "Post / designation", req: true, w: "half" }, { k: "department", l: "Department", t: "select", o: ["Program", "Admin", "Accounts", "Fund raising", "Compliance"], w: "half" },
    { k: "reportsTo", l: "Reports to", w: "half" }, { k: "officeId", l: "Office", t: "offices", w: "half" },
    { k: "engagement", l: "Engagement", t: "select", o: ["Full Time Staff", "Part Time Staff", "Consultant", "Intern", "Volunteer", "Sakhi Leader"], w: "half" }, { k: "from", l: "With effect from", t: "date", w: "half" },
    { k: "till", l: "Until (blank = open)", t: "date", w: "half" }, { k: "salary", l: "Remuneration (as it should read)", ph: "₹30,000 per month consolidated", w: "half" },
    { k: "probation", l: "Probation", d: "three months", w: "half" }, { k: "notice", l: "Notice period", d: "30 days", w: "half" },
    { k: "scope", l: "Scope / responsibilities (contracts & certificates)", t: "textarea" }, { k: "ref", l: "Reference number", ph: "EP/HR/2026-27/014", w: "half" }, { k: "signedCopy", l: "Signed copy (upload)", t: "file", w: "half" }],
  before: d => { d.name = userName(d.staffId) || d.name || ""; d.office = officeName(d.officeId) || "the organisation's office"; d.title = LETTER_TYPES[d.type].title; d.issuedBy = state.me.name; },
  after: async (id, d) => { if (d.staffId) { const u = (await db.collection("users").doc(d.staffId).get()).data() || {};
      await db.collection("users").doc(d.staffId).update({ letters: [...(u.letters || []), { id, type: d.type, title: d.title, at: today() }] }); } },
  cols: [{ k: "name", l: "Person" }, { k: "title", l: "Document" }, { k: "post", l: "Post" }, { k: "from", l: "From", t: "date" }, { k: "till", l: "Until", t: "date" }, { k: "ref", l: "Reference" }, { k: "issuedBy", l: "Issued by" }, { k: "signedCopy", l: "Signed", f: v => v ? "✓" : `<span class="tag warn">awaited</span>` }],
  actions: [{ k: "view", l: "Open", run: async r => { state.letter = r; go("letter"); } }]
});
routes.letter = async () => {
  const d = state.letter; if (!d) return go("letters");
  setTitle(d.title || "Letter");
  const fmt = s => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  html(`<div class="card" style="max-width:820px;margin:0 auto">
    <div id="sheet" style="background:#fff;padding:34px 38px;font-size:13.5px;line-height:1.75;color:#111">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--green);padding-bottom:10px;margin-bottom:18px">
        <img src="logo.png" alt="Empower People" style="height:46px">
        <div style="text-align:right;font-size:10.5px;color:#555;line-height:1.5">5 Dreams Apartments, A-4 Abulfazal Enclave<br>Jamia Nagar, Delhi-110025<br>post@empowerpeople.in · 011-40671714<br>Reg. SRA 1860/Delhi · FCRA 231661880</div></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#444"><span>${esc(d.ref || "")}</span><span>${fmt(d.createdAt?.seconds ? d.createdAt.seconds * 1000 : Date.now())}</span></div>
      <h2 style="text-align:center;margin:18px 0 4px;font-size:17px;letter-spacing:.3px">${esc(d.title)}</h2>
      <p style="margin:18px 0 6px"><b>${esc(d.name)}</b><br>${esc(d.post)}${d.officeId ? `<br>${esc(officeName(d.officeId))}` : ""}</p>
      <p>Dear ${esc((d.name || "").split(" ")[0] || "Colleague")},</p>
      <div>${LETTER_TYPES[d.type].body({ ...d, from: d.from ? fmt(d.from) : "the date of joining", till: d.till ? fmt(d.till) : "" }).split("\n\n").map(p => `<p>${p}</p>`).join("")}</div>
      <p style="margin-top:28px">Yours sincerely,</p>
      <p style="margin-top:34px"><b>Mohd. Shafiqur Rahman Khan</b><br>Founder &amp; General Secretary<br>Empower People</p>
      <div style="margin-top:28px;border-top:1px dashed #bbb;padding-top:10px;font-size:11.5px;color:#444">
        I accept the terms set out above.<br><br>Signature: ______________________   Name: ${esc(d.name)}   Date: ____________</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn small" id="pdf">Download PDF</button><button class="btn small quiet" onclick="window.print()">Print</button>
      <button class="btn small quiet" onclick="go('letters')">Back</button></div></div>`);
  $("pdf").onclick = async () => { if (!window.html2canvas) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const c = await html2canvas($("sheet"), { scale: 2, backgroundColor: "#fff" });
    const pdf = new jspdf.jsPDF({ unit: "mm", format: "a4" }); const w = 210, h = w * c.height / c.width;
    pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, w, h); pdf.save(`${(d.title || "letter").replace(/\s+/g, "-")}-${(d.name || "").replace(/\s+/g, "-")}.pdf`); };
};


/* ================= IMPLEMENTATION PLAN: activities with dates, quarters, milestones ================= */
const QTRS = ["Q1 (Apr-Jun)", "Q2 (Jul-Sep)", "Q3 (Oct-Dec)", "Q4 (Jan-Mar)"];
const fyOf = d => { const x = new Date(d || today()); const y = x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1; return `${y}-${String(y + 1).slice(2)}`; };
const qOf = d => { const mo = new Date(d || today()).getMonth(); return mo >= 3 && mo <= 5 ? 0 : mo >= 6 && mo <= 8 ? 1 : mo >= 9 && mo <= 11 ? 2 : 3; };
routes.activities = registerScreen({
  route: "activities", col: "activities", title: "Activities & implementation plan", orderBy: "code", dir: "asc", canEdit: () => isProgramDept() || has("super_admin","founder","program_officer"),
  intro: "The work plan as it will be implemented and reported: each activity with its period, quarterly targets and milestones. Achievement is counted from benefits, events and verified assignments linked to the activity; the Plan view shows the year as a timeline.",
  fields: [{ k: "projectId", l: "Project", t: "projects", w: "half" }, { k: "code", l: "Activity code", ph: "A1.2", w: "half" },
    { k: "name", l: "Activity", req: true }, { k: "objective", l: "Objective / outcome it serves", w: "half" }, { k: "head", l: "Budget head", w: "half" },
    { k: "start", l: "Starts", t: "date", w: "half" }, { k: "end", l: "Ends", t: "date", w: "half" },
    { k: "target", l: "Total target", t: "number", w: "half" }, { k: "unit", l: "Unit", ph: "women, meetings, cases, kits", w: "half" },
    { k: "q1", l: "Q1 (Apr-Jun) target", t: "number", w: "half" }, { k: "q2", l: "Q2 (Jul-Sep) target", t: "number", w: "half" },
    { k: "q3", l: "Q3 (Oct-Dec) target", t: "number", w: "half" }, { k: "q4", l: "Q4 (Jan-Mar) target", t: "number", w: "half" },
    { k: "leadId", l: "Lead", t: "users", w: "half" }, { k: "officeId", l: "Where", t: "offices", w: "half" },
    { k: "depends", l: "Depends on (activity code)", w: "half" }, { k: "status", l: "Status", t: "select", o: ["Planned", "In progress", "Completed", "Delayed", "Dropped"], w: "half" },
    { k: "milestones", l: "Milestones (one per line: date · milestone)", t: "textarea", ph: "2026-11-15 · 4 Sakhi Mandal meetings held\n2027-01-31 · 60 women linked to schemes" },
    { k: "means", l: "Means of verification", ph: "attendance sheets, photographs, benefit entries" }, { k: "notes", l: "Notes" }],
  before: d => { d.fy = fyOf(d.start); },
  cols: [{ k: "code", l: "Code" }, { k: "name", l: "Activity" }, { k: "projectId", l: "Project", t: "projects" }, { k: "start", l: "Starts", t: "date" }, { k: "end", l: "Ends", t: "date" },
    { k: "target", l: "Target" }, { k: "unit", l: "Unit" }, { k: "leadId", l: "Lead", t: "users" }, { k: "status", l: "Status", f: statusTag }],
  extraButtons: `<button class="btn small quiet" onclick="go('plan')">Implementation plan (timeline)</button>` });

/* Who may hand out the lines of a plan: the project's own coordinator or finance
   person, programme leadership, or an administrator. */
const readOnly = () => has("board", "observer") && !has("super_admin", "admin", "director_acf", "program_officer");
const canAssignPlan = p => !readOnly() && !!p && (p.leadId === state.user.uid || p.financeId === state.user.uid
  || has("super_admin", "admin", "program_officer", "program_coord", "director_acf"));
/* A project's detail is open to the people working on it and to anyone posted at the
   headquarters, who carry the organisation's accounts, compliance and reporting.
   Field staff see the projects they are on, and no others. */
const canSeeMoney = () => has("super_admin", "director_acf", "accountant", "program_officer");
const atHeadquarters = () => { const o = (state.offices || []).find(x => x.id === state.me.officeId) || {};
  return /delhi|headquarter|head office/i.test(o.name || "") || o.isHQ === true; };
const myProject = p => !!p && (p.leadId === state.user.uid || p.financeId === state.user.uid
  || (p.team || []).includes(state.user.uid)
  || (state.activities || []).some(a => a.projectId === p.id && a.leadId === state.user.uid));
const leadsProgramme = g => {
  const ids = g.leadPostIds || [];
  if (ids.includes(state.me.postId)) return true;
  const leads = (state.users || []).filter(u => ids.includes(u.postId));
  return leads.some(l => mgrs(state.me).includes(l.id));
};
const myProgramme = g => !!g && (leadsProgramme(g)
  || (state.projects || []).some(p => (p.programmeIds || []).includes(g.id) && myProject(p))
  || (g.team || []).includes(state.user.uid) || g.leadId === state.user.uid);
const officeProject = p => {
  if (!has("field_staff")) return false;
  const uid = viewUid();
  const user = (state.users||[]).find(u=>u.id===uid);
  return !!(user?.officeId && (p.primaryOffice===user.officeId || (p.offices||[]).includes(user.officeId)));
};
const canSeeProgramme = g => has("super_admin","board","observer","program_officer","program_coord","director_acf","admin","fundraising","accountant") || myProgramme(g);
const visibleProgrammes = () => (state.programmes || []).filter(canSeeProgramme);
const canSeeProject = p => has("super_admin","board","observer","program_officer","program_coord","director_acf","admin","fundraising","accountant") || myProject(p) || officeProject(p);
const visibleProjects = () => (state.projects || []).filter(canSeeProject);
routes.plan = async (pid) => {
  const open = visibleProjects().filter(isLiveProject);
  pid = pid || state.planProject || (open[0] || {}).id; state.planProject = pid;
  if (!open.length) return html(`<div class="card"><h2>Implementation plan</h2>
    <div class="empty">You are not on a project, so there is no plan to show.
      Work that is not project-funded does not appear here — it is in your day reports and event reports.</div></div>`);
  if (pid && !open.some(p => p.id === pid)) return html(`<div class="card"><div class="empty">
    This project is not one of yours. Ask the project coordinator to add you to the team, or to assign you an activity.</div></div>`);
  setTitle("Implementation plan");
  const [acts, bens, evs, heads, exps] = await Promise.all([
    db.collection("activities").get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("benefits").get().then(s => s.docs.map(d => d.data())).catch(() => []),
    db.collection("eventReports").get().then(s => s.docs.map(d => d.data())).catch(() => []),
    db.collection("budgetHeads").limit(500).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("expenses").limit(900).get().then(s => s.docs.map(d => d.data())).catch(() => [])]);
  const mine = acts.filter(a => !pid || a.projectId === pid);
  const proj = (state.projects || []).find(p => p.id === pid) || {};
  /* Counted from the benefits and events actually linked to the activity. Where nothing
     is linked yet but a figure was reported from the project tracker, that figure is
     shown instead, so an imported work plan is not left reading zero. */
  const ok = r => r.status === "verified";
  const linked = a => bens.filter(b => b.activityId === a.id && ok(b)).length + evs.filter(e => e.activityId === a.id && ok(e)).length;
  const waiting = a => bens.filter(b => b.activityId === a.id && !ok(b)).length + evs.filter(e => e.activityId === a.id && !ok(e)).length;
  /* Only what the team has filed and the coordinator has verified. Figures copied from
     a tracker are not counted — the records are the record. */
  const achieved = a => linked(a);
  /* Month by month, counted from the records themselves — a benefit or an event report
     verified against this line. The months shown are those the project runs across. */
  const recsFor = a => [...bens.filter(b => b.activityId === a.id && ok(b)), ...evs.filter(e => e.activityId === a.id && ok(e))];
  const planMonths = (() => {
    const all = mine.flatMap(a => recsFor(a).map(r => String(r.date || "").slice(0, 7))).filter(Boolean);
    const from = proj.start ? String(proj.start).slice(0, 7) : null, to = proj.end ? String(proj.end).slice(0, 7) : null;
    const set = new Set(all);
    if (from && to) { let d = new Date(from + "-01"); const end = new Date(to + "-01");
      while (d <= end && set.size < 30) { set.add(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } }
    return [...set].sort().slice(-14);
  })();
  const inMonth = (a, m) => recsFor(a).filter(r => String(r.date || "").startsWith(m)).length;
  const mLabel = m => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  const achievedQ = (a, q) => bens.filter(b => b.activityId === a.id && qOf(b.date) === q).length + evs.filter(e => e.activityId === a.id && qOf(e.date) === q).length;
  /* The chart spans the project's own start and end, as recorded in the project
     register — not the financial year. A project running Jan–Dec is shown Jan–Dec. */
  const span = (() => {
    const s = proj.start ? new Date(proj.start) : null, e = proj.end ? new Date(proj.end) : null;
    if (!s || !e || e < s) { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
      return { from: new Date(y, 3, 1), count: 12 }; }
    const n = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
    return { from: new Date(s.getFullYear(), s.getMonth(), 1), count: Math.max(1, Math.min(n, 36)) };
  })();
  const months = Array.from({ length: span.count }, (_, i) => {
    const d = new Date(span.from.getFullYear(), span.from.getMonth() + i, 1);
    return d.toLocaleDateString("en-IN", { month: "short" }) + (span.count > 12 ? " " + String(d.getFullYear()).slice(2) : ""); });
  const fyStart = span.from;
  const col = d => { if (!d) return null; const x = new Date(d); let i = (x.getFullYear() - fyStart.getFullYear()) * 12 + x.getMonth() - 3; return i < 0 ? 0 : i > 11 ? 11 : i; };
  const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
  /* No grand total: adding "20 counsellors" to "200 women supported" produces a figure
     that means nothing. What can honestly be totalled is how many indicators are at or
     past target, how many distinct women were reached, and how many services were given. */
  const withTarget = mine.filter(a => Number(a.target));
  const metLines = withTarget.filter(a => achieved(a) >= Number(a.target)).length;
  const onTrack = withTarget.length ? Math.round(metLines / withTarget.length * 100) : 0;
  /* What each line of the plan has to spend, and what is left. The allocation comes from
     the budget head the activity is tied to; spending from the vouchers booked against
     that head, plus the value of any support given under the activity. */
  const headOf = a => heads.find(h => h.id === a.headId || (a.head && (h.code === a.head || h.line === a.head)));
  const allocated = a => { const h = headOf(a); return h ? Number(h.total) || 0 : 0; };
  const spentOn = a => { const h = headOf(a); if (!h) return 0;
    const vouchers = exps.filter(e => (e.headId === h.id || e.head === h.code || e.head === h.line)
      && (!pid || e.projectId === pid)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const given = bens.filter(b => b.activityId === a.id).reduce((s, b) => s + (Number(b.value) || 0), 0);
    return vouchers + given || Number(h.spentReported) || 0; };
  const projBens = bens.filter(b => !pid || b.projectId === pid);
  const womenReached = new Set(projBens.map(b => b.personId).filter(Boolean)).size;
  const servicesGiven = projBens.length;
  const milestones = mine.flatMap(a => (a.milestones || "").split("\n").map(l => l.trim()).filter(Boolean).map(l => { const [d, ...t] = l.split("·"); return { date: (d || "").trim(), what: t.join("·").trim(), act: a.name }; })).sort((x, y) => x.date.localeCompare(y.date));
  html(`<div class="card"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="psel" style="width:auto;padding:6px 10px;border-radius:9px;font-weight:600">${open.map(p => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.code || p.name)}</option>`).join("")}</select>
      ${open.length < (state.projects || []).filter(isLiveProject).length ? `<span class="small muted">· you see ${open.length} of ${(state.projects || []).filter(isLiveProject).length} running projects</span>` : ""}
      ${proj.start && proj.end ? `<span class="small muted">· ${fmtD(proj.start)} to ${fmtD(proj.end)}</span>` : `<span class="small muted" style="color:#8A5A00">· no start and end on the project record</span>`}
      <span class="small muted">Financial year ${fyOf()}</span>
      <span class="tag">${mine.filter(a => Number(a.target)).length} indicators · ${mine.filter(a => !Number(a.target)).length} activities</span>
      <span class="tag ${onTrack >= 60 ? "ok" : onTrack >= 30 ? "warn" : "bad"}">${metLines} of ${mine.filter(a => Number(a.target)).length} indicators at or past target</span>
      <span class="tag">${womenReached.toLocaleString("en-IN")} women reached</span>
      <span class="tag">${servicesGiven.toLocaleString("en-IN")} services delivered</span>
      <p class="small muted" style="margin:8px 0 0">Indicator targets are not added together: they count different things —
        sessions, women, enterprises — and the same woman appears under several. Each line is shown against its own target.</p>
      <button class="btn small quiet" onclick="go('activities')">Edit activities</button><button class="btn small quiet" id="exp">Export plan</button></div></div>

    <div class="card"><h2>Month by month, from the records</h2>
      <p class="small muted">Each figure is the number of verified records filed against that line in that month —
        a benefit recorded for a woman, or an event report. Nothing here is typed in as a total.</p>
      <div class="tablewrap"><table class="table">
      <tr><th style="min-width:230px">Activity</th>${planMonths.map(m => `<th style="text-align:center;font-size:11px">${mLabel(m)}</th>`).join("")}<th style="text-align:center">Total</th><th style="text-align:center">Target</th><th>Who is doing it</th></tr>
      ${mine.map(a => `<tr><td>${esc(a.code && a.code !== "IND" ? a.code + " " : "")}${esc(a.name)}</td>
        ${planMonths.map(m => { const n = inMonth(a, m);
          return `<td style="text-align:center">${n ? `<b>${n}</b>` : `<span class="muted">·</span>`}</td>`; }).join("")}
        <td style="text-align:center"><b>${recsFor(a).length}</b>${waiting(a) ? `<div class="s" style="color:#8A5A00">${waiting(a)} unverified</div>` : ""}</td>
        <td style="text-align:center">${a.target ? `${a.target}<div class="s">${pct(recsFor(a).length, a.target)}%</div>` : a.percentDone != null ? `${a.percentDone}%` : "—"}</td>
        <td>${a.leadId ? esc(userName(a.leadId)) : `<span class="muted small">nobody</span>`}
          ${canAssignPlan(proj) ? `<br><button class="btn small quiet" data-own="${a.id}">${a.leadId ? "Change" : "Assign"}</button>` : ""}</td></tr>
        ${linked(a) || waiting(a) ? `<tr class="hidden" id="recs_${a.id}"><td colspan="${planMonths.length + 4}" style="background:var(--bg)">
          <div class="list">${[...bens.filter(b => b.activityId === a.id).map(b => ({ d: b.date, t: `${maskName(b.name, b.personCode)} · ${b.service || ""}`, s: b.description || "" })),
            ...evs.filter(e => e.activityId === a.id).map(e => ({ d: e.date, t: e.heading || "", s: `${e.participants || 0} present${e.women ? `, ${e.women} women` : ""}` }))]
            .sort((x, y) => String(y.d).localeCompare(String(x.d)))
            .map(r => `<div class="item"><div class="grow"><div class="t">${esc(r.t)}</div><div class="s">${esc(r.s)}</div></div>
              <span class="meta small muted">${fmtD(r.d)}</span></div>`).join("")}</div></td></tr>` : ""}`).join("")
        || `<tr><td colspan="${planMonths.length + 4}" class="empty">No activities in this project's work plan yet</td></tr>`}
      </table></div>
      <p class="small muted">Open a line to see the records behind it.</p></div>

    <div class="card"><h2>Milestones</h2><div class="list">
      ${milestones.map(m => { const d = Math.ceil((new Date(m.date) - Date.now()) / 86400000);
        return `<div class="item"><div class="grow"><div class="t">${esc(m.what)}</div><div class="s">${esc(m.act)} · ${fmtD(m.date)}</div></div>
        <span class="tag ${isNaN(d) ? "" : d < 0 ? "bad" : d <= 30 ? "warn" : "ok"}">${isNaN(d) ? "" : d < 0 ? `${-d}d late` : `in ${d}d`}</span></div>`; }).join("") || `<div class="empty">No milestones — add them per activity, one per line as "date · milestone"</div>`}</div></div>`);
  $("psel").onchange = e => routes.plan(e.target.value);
  /* The project's owner hands each line of the plan to whoever will carry it out —
     their own team, or a colleague in another department. */
  $("content").querySelectorAll("[data-head]").forEach(b => b.onclick = async () => {
    const a = mine.find(x => x.id === b.dataset.head);
    const mineHeads = heads.filter(h => h.projectId === a.projectId);
    if (!mineHeads.length) return alert("This project has no budget heads yet. Add them under Budget heads first.");
    const pickTxt = prompt(`Which budget head pays for "${a.name}"?\n\n`
      + mineHeads.map((h, i) => `${i + 1} — ${h.code ? h.code + " · " : ""}${h.line} (${inr(h.total || 0)})`).join("\n")
      + "\n\nType the number.");
    const n = Number(pickTxt); const h = mineHeads[n - 1]; if (!h) return;
    await db.collection("activities").doc(a.id).update({ headId: h.id, head: h.code || h.line });
    audit("link_head", "activities", a.id, h.line || ""); toast("Linked to " + (h.code || h.line)); routes.plan(pid); });
  $("content").querySelectorAll("[data-recs]").forEach(b => b.onclick = () => {
    const row = document.getElementById("recs_" + b.dataset.recs);
    row.classList.toggle("hidden"); b.textContent = row.classList.contains("hidden") ? "See them" : "Hide"; });
  $("content").querySelectorAll("[data-own]").forEach(b => b.onclick = async () => {
    const a = mine.find(x => x.id === b.dataset.own);
    const team = state.users.filter(u => u.active && isStaff(u));
    const pick = await askWhoDoes({ title: `Activity: ${a.name}`, due: a.end || null }, team);
    if (!pick || !pick.id) return;
    const who = state.users.find(u => u.id === pick.id) || {};
    await db.collection("activities").doc(a.id).update({ leadId: who.id, leadName: who.name,
      assignedBy: state.user.uid, assignedOn: today(), assignNote: pick.note || null });
    await db.collection("assignments").add({ title: `Activity: ${a.name}`,
      assigneeId: who.id, assigneePostId: who.postId || null, assignerId: state.user.uid,
      due: pick.due || a.end || null, status: "assigned", from: "activities", fromId: a.id,
      target: pick.target || (Number(a.target)||null), targetUnit: pick.targetUnit || a.unit || null,
      instructions: `${projectName(a.projectId)} · target ${a.target || "—"} ${a.unit || ""}${pick.note ? "\n" + pick.note : ""}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    audit("assign", "activities", a.id, who.name || ""); toast("Given to " + (who.name || "them")); routes.plan(pid); });
  $("exp").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mine.map(a => ({ Code: a.code, Activity: a.name, Project: projectName(a.projectId), Objective: a.objective, Head: a.head, Starts: a.start, Ends: a.end,
      Target: a.target, Unit: a.unit, Q1: a.q1, Q2: a.q2, Q3: a.q3, Q4: a.q4, "Q1 done": achievedQ(a, 0), "Q2 done": achievedQ(a, 1), "Q3 done": achievedQ(a, 2), "Q4 done": achievedQ(a, 3),
      "Total done": achieved(a), Lead: userName(a.leadId), Status: a.status, Verification: a.means }))), "Implementation plan");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(milestones.map(m => ({ Date: m.date, Milestone: m.what, Activity: m.act }))), "Milestones");
    XLSX.writeFile(wb, `implementation-plan-${today()}.xlsx`); };
};


/* ================= MY WORK (staff) and TEAM WORKLOAD (managers) ================= */
routes.mywork = async (tab) => {
  tab = tab || state.myworkTab || "tasks"; state.myworkTab = tab;
  setTitle("My work");
  if (tab === "summary") { await routes.performance(state.user.uid); return; }
  const uid = viewUid();
  const [asg, acts, dr] = await Promise.all([
    Promise.all([
      db.collection("assignments").where("assigneeId","==",uid).get().catch(()=>({docs:[]})),
      db.collection("assignments").where("accountableId","==",uid).get().catch(()=>({docs:[]}))
    ]).then(([s1,s2])=>{
      const seen=new Set(); const all=[];
      [...s1.docs,...s2.docs].forEach(d=>{ if(!seen.has(d.id)){seen.add(d.id);all.push({id:d.id,...d.data()});}});
      return all;
    }),
    db.collection("activities").get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("dayReports").where("uid", "==", uid).orderBy("date", "desc").limit(5).get().then(s => s.docs.map(d => d.data())).catch(() => [])]);
  const myProjects = state.projects.filter(p => p.leadId === uid || (p.team || []).includes(uid));
  const myActs = acts.filter(a =>
    a.leadId === uid ||
    (state.projects||[]).find(p=>p.id===a.projectId)?.team?.includes(uid) ||
    (state.programmes||[]).find(p=>p.id===a.programmeId)?.team?.includes(uid)
  );
  const open = asg.filter(a => a.status !== "verified");
  const days = d => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null;
  const group = { overdue: open.filter(a => days(a.due) < 0), today: open.filter(a => days(a.due) === 0), week: open.filter(a => days(a.due) > 0 && days(a.due) <= 7), later: open.filter(a => days(a.due) > 7 || !a.due) };
  const card = (title, list, kind) => list.length ? `<div class="card"><h2>${title} (${list.length})</h2><div class="list">
    ${list.map(a => `<div class="item" style="flex-direction:column;align-items:flex-start;gap:6px">
      <div style="display:flex;width:100%;align-items:flex-start;gap:8px">
        <div class="grow">
          <div class="t">${esc(a.title)}</div>
          <div class="s">${
  a.assigneeId !== uid && a.accountableId === uid ? `<span class="tag warn">Passed on to ${esc(userName(a.assigneeId))}</span> ` :
  a.forwardedBy ? `forwarded by ${esc(userName(a.forwardedBy))} · ` :
  a.assignerId === state.user.uid ? "my own task · " : "from " + esc(userName(a.assignerId)) + " · "
}${a.due ? "due " + fmtD(a.due) : ""}${a.priority?.startsWith("1") ? ' · <span class="tag bad">high</span>' : ""}</div>
          ${a.instructions ? `<div class="s muted" style="margin-top:2px">${esc(a.instructions)}</div>` : ""}
          ${a.returnNote ? `<div class="s" style="color:var(--bad)">Returned: ${esc(a.returnNote)}</div>` : ""}
        </div>
        <span class="tag ${a.status==="in progress"?"warn":""}">${esc(a.status==="in progress"?"In progress":a.status==="done – to verify"?"Waiting verification":"Assigned")}</span>
      </div>
      ${(a.updates||[]).length ? `<div style="border-left:3px solid var(--line);padding-left:8px;width:100%">${(a.updates||[]).map(u=>`<div class="small" style="margin-bottom:4px"><span class="muted">${fmtD(u.at||"")}</span> ${esc(u.text||"")}</div>`).join("")}</div>` : ""}
      ${a.status !== "done – to verify" && a.status !== "verified" ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
        ${a.status === "assigned" ? `<button class="btn small quiet" data-start="${a.id}">Start</button>` : ""}
        <button class="btn small quiet" data-update="${a.id}">Add update</button>
        ${a.assigneeId === uid && a.accountableId !== uid ? `` : a.assigneeId === uid ? `<button class="btn small quiet" data-forward="${a.id}">Forward to team</button>` : ""}
        ${a.accountableId === uid && a.assigneeId !== uid ? `<button class="btn small quiet" data-recall="${a.id}">Recall</button>` : ""}
        ${a.assigneeId === uid ? `<button class="btn small" data-done="${a.id}">Mark done</button>` : ""}
      </div>` : a.status === "done – to verify" ? `<span class="small muted">Waiting for verification</span>` : ""}
    </div>`).join("")}</div></div>` : "";
  html(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn small ${tab==="tasks"?"":"quiet"}" onclick="routes.mywork('tasks')">Tasks</button>
      ${has("program_lead","field_staff","program_coord","program_officer","super_admin","admin") ? `<button class="btn small ${tab==="summary"?"":"quiet"}" onclick="routes.mywork('summary')">Activity summary</button>` : ""}
    </div>
    <div class="grid">
      <div class="card stat"><span class="muted small">Open tasks</span><b>${open.length}</b></div>
      <div class="card stat"><span class="muted small">Set by me</span><b>${open.filter(a => a.assignerId === uid).length}</b></div>
      <div class="card stat"><span class="muted small">Passed on, still mine</span><b>${open.filter(a => a.accountableId === uid && a.assigneeId !== uid).length}</b></div>
      <div class="card stat"><span class="muted small">Overdue</span><b>${group.overdue.length}</b></div>
      <div class="card stat"><span class="muted small">My projects</span><b>${myProjects.length}</b></div>
      <div class="card stat"><span class="muted small">Activities I lead</span><b>${myActs.length}</b></div></div>
    ${card("Overdue", group.overdue)}${card("Due today", group.today)}${card("This week", group.week)}${card("Later", group.later)}
    ${open.length ? "" : `<div class="card"><div class="empty">Nothing assigned to you right now</div></div>`}
    ${myProjects.length ? `<div class="card"><h2>My projects</h2><div class="list">${myProjects.map(p => `<div class="item"><div class="grow"><div class="t">${esc(p.name)}${p.leadId === state.user.uid ? ' <span class="tag ok">lead</span>' : ""}</div><div class="s">${esc(p.donor || "")} · ${esc(p.geography || "")}</div></div><button class="btn small quiet" data-p="${p.id}">Open</button></div>`).join("")}</div></div>` : ""}
    ${myActs.length ? `<div class="card"><h2>My project activities</h2><div class="tablewrap"><table class="table"><tr><th>Code</th><th>Activity</th><th>Project</th><th>Ends</th><th>Target</th><th>Status</th></tr>
      ${myActs.map(a => `<tr><td>${esc(a.code || "")}</td><td>${esc(a.name)}</td><td>${esc(projectName(a.projectId))}</td><td>${fmtD(a.end)}</td><td>${esc(a.target || "")} ${esc(a.unit || "")}</td><td>${statusTag(a.status)}</td></tr>`).join("")}</table></div>
      <button class="btn small quiet" style="margin-top:8px" onclick="go('plan')">Implementation plan</button></div>` : ""}
    <div class="card"><h2>My last day reports</h2><div class="list">${dr.map(r => `<div class="item"><div class="grow"><div class="t">${fmtD(r.date)}</div><div class="s">${esc((r.text || r.report || "").slice(0, 110))}</div></div><span class="tag ${r.status === "verified" ? "ok" : "warn"}">${esc(r.status || "submitted")}</span></div>`).join("") || `<div class="empty">None yet</div>`}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn small" onclick="go('dayreport')">Write today's report</button><button class="btn small quiet" onclick="go('assignments')">Add a task for myself</button></div></div>`);
  $("content").querySelectorAll("[data-view]").forEach(b => b.onclick = () => { state.planView = b.dataset.view; state.planOffset = 0; routes.myPlan(); });
  $("content").querySelectorAll("[data-shift]").forEach(b => b.onclick = () => {
    const n = Number(b.dataset.shift);
    state.planOffset = n === 0 ? 0 : (state.planOffset || 0) + n; routes.myPlan(); });
  $("content").querySelectorAll("[data-add]").forEach(b => b.onclick = async () => {
    const what = prompt(`What do you mean to do on ${fmtD(b.dataset.add)}?`);
    if (!what || !what.trim()) return;
    await db.collection("myPlan").add({ uid, what: what.trim(), by: b.dataset.add,
      createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    routes.myPlan(); });
  // Start task
  $("content").querySelectorAll("[data-start]").forEach(b => b.onclick = async () => {
    await db.collection("assignments").doc(b.dataset.start).update({ status: "in progress", startedAt: today() });
    toast("Started"); routes.mywork(); });

  // Add progress update
  $("content").querySelectorAll("[data-update]").forEach(b => b.onclick = async () => {
    const text = prompt("What have you done on this so far?");
    if (!text?.trim()) return;
    const snap = await db.collection("assignments").doc(b.dataset.update).get();
    const existing = snap.data()?.updates || [];
    await db.collection("assignments").doc(b.dataset.update).update({
      status: "in progress",
      updates: [...existing, { text: text.trim(), by: state.user.uid, at: today() }]
    });
    toast("Update saved"); routes.mywork(); });


// ── System task auto-verification ────────────────────────────────────────────
async function _verifySystemTask(r) {
  const title = r.title || "";
  const createdAt = r.createdAt?.seconds ? new Date(r.createdAt.seconds*1000) : new Date();
  const weekAgo = new Date(Date.now() - 7*24*60*60*1000);

  // "Add activities to Programme: X" — check programme was updated after assignment created
  if (/^Add activities to Programme:/i.test(title)) {
    const progName = title.replace(/^Add activities to Programme:\s*/i,"").trim();
    const snap = await db.collection("programmes").where("name","==",progName).limit(1).get().catch(()=>({docs:[]}));
    if (!snap.docs.length) return {ok:true};
    const prog = snap.docs[0].data();
    const updAt = prog.updatedAt?.seconds ? new Date(prog.updatedAt.seconds*1000)
                : prog.changedAt ? new Date(prog.changedAt) : null;
    if (!updAt || updAt <= createdAt) return {ok:false, msg:`"${progName}" hasn't been updated since this task was created. Go to the programme's Activities tab and add your planned activities, then mark this done.`};
    return {ok:true};
  }

  // "Programme not updated for a week: X" — check programme updated in last 7 days
  if (/^Programme not updated for a week:/i.test(title)) {
    const code = title.replace(/^Programme not updated for a week:\s*/i,"").trim();
    const snap = await db.collection("programmes").where("code","==",code).limit(1).get().catch(()=>({docs:[]}));
    if (!snap.docs.length) return {ok:true};
    const prog = snap.docs[0].data();
    const updAt = prog.updatedAt?.seconds ? new Date(prog.updatedAt.seconds*1000)
                : prog.changedAt ? new Date(prog.changedAt) : null;
    if (!updAt || updAt < weekAgo) return {ok:false, msg:`Programme "${code}" still hasn't been updated. File an event report or programme update first, then mark this done.`};
    return {ok:true};
  }

  // "Benefits below target — only X of Y recorded" — recount benefits for that week
  if (/Benefits below target/i.test(title)) {
    const targetMatch = title.match(/of (\d+) recorded/i);
    const target = targetMatch ? parseInt(targetMatch[1]) : 30;
    const weekMatch = (r.instructions||"").match(/(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/);
    if (!weekMatch) return {ok:true};
    const [,wStart, wEnd] = weekMatch;
    // Count benefits for assignee's team that week
    const teamIds = (state.users||[]).filter(u=>(u.managerIds||[]).includes(r.assigneeId)).map(u=>u.id);
    const allIds = [...new Set([r.assigneeId, ...teamIds])].slice(0,8);
    let total = 0;
    for (const uid of allIds) {
      const s = await db.collection("benefits").where("recordedBy","==",uid).where("date",">=",wStart).where("date","<=",wEnd).limit(100).get().catch(()=>({docs:[]}));
      total += s.docs.length;
    }
    if (total < target) return {ok:false, msg:`Still only ${total} of ${target} benefits recorded for the week ${wStart} to ${wEnd}. Ensure your team records all benefits in the app before marking this done.`};
    return {ok:true};
  }

  // "Hold team meeting and plan next week" — check for day report this week mentioning meeting/plan
  if (/Hold team meeting/i.test(title)) {
    const today_ = typeof today==="function" ? today() : new Date().toISOString().slice(0,10);
    const d = new Date(today_); const dow = d.getDay()||7;
    const wStart = new Date(d - (dow-1)*86400000).toISOString().slice(0,10);
    const snap = await db.collection("dayReports").where("uid","==",r.assigneeId).where("date",">=",wStart).limit(10).get().catch(()=>({docs:[]}));
    if (!snap.docs.length) return {ok:false, msg:"No day report found for this week. File a day report describing the team meeting and your plan for next week, then mark this done."};
    const hasMention = snap.docs.some(d=>{
      const txt = JSON.stringify(d.data()).toLowerCase();
      return /meet|plan|agenda|discuss/i.test(txt);
    });
    if (!hasMention) return {ok:false, msg:"Your day report doesn't mention a team meeting or plan. Update your day report with what was discussed and planned, then mark this done."};
    return {ok:true};
  }

  // ── Audit checks ─────────────────────────────────────────────────────────

  // "assetPhotos" — did you upload photos for assets?
  if(r.checkType==="assetPhotos"){
    const snap=await db.collection("assets").get().catch(()=>({docs:[]}));
    const noPhoto=snap.docs.filter(d=>!d.data().photo).length;
    if(noPhoto>0) return {ok:false, msg:`${noPhoto} assets still have no photo. Open each asset in Procurement → Office assets, tap Attach photo and upload a clear image.`};
    return {ok:true};
  }

  // "assetVerification" — did you physically verify assets?
  if(r.checkType==="assetVerification"){
    const weekAgoStr=weekAgo.toISOString().slice(0,10);
    const snap=await db.collection("assets").get().catch(()=>({docs:[]}));
    const unverified=snap.docs.filter(d=>{const v=d.data().verifiedAt||""; return !v||v<weekAgoStr;}).length;
    if(unverified>0) return {ok:false, msg:`${unverified} assets have not been physically verified yet. Open each asset and tap Mark verified today after checking it is present.`};
    return {ok:true};
  }

  // "missingBills" — did you chase and attach the bills?
  if(r.checkType==="missingBills"){
    const snap=await db.collection("pettyCash").where("outAmt",">",2000).limit(50).get().catch(()=>({docs:[]}));
    const noBill=snap.docs.filter(d=>{const x=d.data(); return !x.bill&&!x.billUrl&&!(x.attachments||[]).length;}).length;
    if(noBill>0) return {ok:false, msg:`${noBill} cash entries above ₹2,000 still have no bill attached. Contact each person and attach the original bill in EP Office before marking this done.`};
    return {ok:true};
  }

  // "signature" — did the person upload their signature?
  if(r.checkType==="signature"){
    const uid=r.assigneeId||state.user.uid;
    const uSnap=await db.collection("users").doc(uid).get().catch(()=>null);
    if(!uSnap?.data()?.signature) return {ok:false, msg:"Your signature is still missing. Go to My own work → Profile → scroll to Signature → photograph your signature on plain white paper and upload it."};
    return {ok:true};
  }

  // ── Monthly target checks ─────────────────────────────────────────────────

  // "proposals" — count proposals logged in the given month
  if(r.checkType==="proposals"){
    const period=r.checkPeriod||new Date().toISOString().slice(0,7);
    const target=r.checkTarget||4;
    const snap=await db.collection("proposals").where("loggedBy","==",r.assigneeId).where("sentOn",">=",period+"-01").where("sentOn","<=",period+"-31").get().catch(()=>({docs:[]}));
    if(snap.docs.length<target) return {ok:false, msg:`Only ${snap.docs.length} of ${target} proposals recorded in ${period}. Log the remaining proposals in Fundraising → Proposals before marking done.`};
    return {ok:true};
  }

  // "outreach" — count outreach contacts logged in the given month
  if(r.checkType==="outreach"){
    const period=r.checkPeriod||new Date().toISOString().slice(0,7);
    const target=r.checkTarget||10;
    const snap=await db.collection("outreach").where("addedBy","==",r.assigneeId).where("sentOn",">=",period+"-01").where("sentOn","<=",period+"-31").get().catch(()=>({docs:[]}));
    if(snap.docs.length<target) return {ok:false, msg:`Only ${snap.docs.length} of ${target} outreach contacts recorded in ${period}. Log the remaining contacts in Fundraising → Outreach before marking done.`};
    return {ok:true};
  }

  // "socialMedia" — count social media obligations logged in the given month
  if(r.checkType==="socialMedia"){
    const period=r.checkPeriod||new Date().toISOString().slice(0,7);
    const target=r.checkTarget||15;
    const snap=await db.collection("obligations").where("owner","==",r.assigneeId).where("type","==","Social media").where("due",">=",period+"-01").where("due","<=",period+"-31").get().catch(()=>({docs:[]}));
    if(snap.docs.length<target) return {ok:false, msg:`Only ${snap.docs.length} of ${target} social media posts recorded in ${period}. Log each post in Fundraising → Obligations (type: Social media) before marking done.`};
    return {ok:true};
  }

  // "coordination" — check a day report with coordination narrative exists this month
  if(r.checkType==="coordination"){
    const period=r.checkPeriod||new Date().toISOString().slice(0,7);
    const snap=await db.collection("dayReports").where("uid","==",r.assigneeId).where("date",">=",period+"-01").where("date","<=",period+"-31").limit(50).get().catch(()=>({docs:[]}));
    const hasCoord=snap.docs.some(d=>/coordinat|partner|meet|follow.?up|communicat/i.test(d.data().narrative||""));
    if(!hasCoord) return {ok:false, msg:"No coordination summary found in your day reports for this month. File a day report describing key meetings, partnerships, and follow-ups, then mark this done."};
    return {ok:true};
  }

  return {ok:true}; // unknown type — pass through
}

  // Mark done
  $("content").querySelectorAll("[data-done]").forEach(b => b.onclick = async () => {
    const note = prompt("What did you do? (this goes to your manager)"); if (note === null) return;
    const _asgDoc = await db.collection("assignments").doc(b.dataset.done).get();
    const _asgData = _asgDoc.data()||{};
    const _isSystem = (_asgData.assignerId||"")==="system";
    if (_isSystem) {
      toast("Checking…");
      const _chk = await _verifySystemTask({..._asgData, assigneeId:_asgData.assigneeId||state.user.uid});
      if (!_chk.ok) { alert("Not verified: "+_chk.msg); return; }
    }
    await db.collection("assignments").doc(b.dataset.done).update({ status: _isSystem ? "verified" : "done – to verify", doneNote: note, doneAt: today(), ...(_isSystem?{verifiedAt:today(),verifiedBy:"system"}:{}) });
    toast(_isSystem ? "✓ Verified — well done!" : "Sent for verification"); routes.mywork(); });
  // Forward task to a team member
  $("content").querySelectorAll("[data-forward]").forEach(b => b.onclick = async () => {
    const asgId = b.dataset.forward;
    const asgDoc = await db.collection("assignments").doc(asgId).get();
    const r = asgDoc.data()||{};
    // Build team: direct reports of current user
    const myTeam = (state.users||[]).filter(u => u.active !== false && (u.managerIds||[]).includes(uid));
    if(!myTeam.length){ toast("No team members to forward to"); return; }
    const names = myTeam.map((u,i)=>(i+1)+". "+u.name).join(String.fromCharCode(10));
    const sep=String.fromCharCode(10); const pick = prompt("Forward to team:"+sep+names+sep+sep+"Enter number:");
    const idx = parseInt(pick)-1;
    if(isNaN(idx)||idx<0||idx>=myTeam.length) return;
    const whom = myTeam[idx];
    await db.collection("assignments").doc(asgId).update({
      assigneeId: whom.id,
      accountableId: uid,
      forwardedBy: uid,
      forwardedAt: today(),
      history: [...(r.history||[]), {what:`Forwarded to ${whom.name}`, by:uid, at:today()}]
    });
    toast(`Forwarded to ${whom.name}`); routes.mywork();
  });
  // Recall a forwarded task
  $("content").querySelectorAll("[data-recall]").forEach(b => b.onclick = async () => {
    const asgId = b.dataset.recall;
    const asgDoc = await db.collection("assignments").doc(asgId).get();
    const r = asgDoc.data()||{};
    if(!confirm(`Recall this task from ${userName(r.assigneeId)}?`)) return;
    await db.collection("assignments").doc(asgId).update({
      assigneeId: uid,
      accountableId: firebase.firestore.FieldValue.delete(),
      forwardedBy: firebase.firestore.FieldValue.delete(),
      history: [...(r.history||[]), {what:`Recalled from ${userName(r.assigneeId)}`, by:uid, at:today()}]
    });
    toast("Task recalled"); routes.mywork();
  });
  $("content").querySelectorAll("[data-p]").forEach(b => b.onclick = () => { state.projectId = b.dataset.p; go("project"); });
};

routes.team = async () => {
  setTitle("My team");
  const uid = viewUid();
  const mine = state.users.filter(u => u.active && u.id !== uid && mgrs(u).includes(uid));
  const everyone = (isAdmin() || has("super_admin")) && !viewingAs();
  const team = everyone ? state.users.filter(u => u.active && u.id !== uid) : mine;
  const [asg, dr] = await Promise.all([
    db.collection("assignments").limit(400).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("dayReports").orderBy("date", "desc").limit(300).get().then(s => s.docs.map(d => d.data())).catch(() => [])]);
  const days = d => d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null;
  html(`<div class="card"><h2>${everyone ? `All staff (${team.length})` : `${team.length} ${team.length === 1 ? "person reports" : "people report"} to you`}</h2>
    ${everyone ? `<p class="small muted">You see everyone because you administer the app. ${mine.length} ${mine.length === 1 ? "person reports" : "report"} to you directly.</p>` : ""}
    ${!everyone && !team.length ? `<p class="small muted">Nobody reports to you, so there is nothing here.</p>` : ""}<div class="tablewrap"><table class="table">
      <tr><th>Name</th><th>Post</th><th>Open</th><th>Overdue</th><th>Awaiting your verification</th><th>Last day report</th><th>Projects</th><th></th></tr>
      ${team.map(u => { const mine = asg.filter(a => a.assigneeId === u.id && a.status !== "verified");
        const od = mine.filter(a => days(a.due) < 0).length, wait = mine.filter(a => a.status === "done – to verify").length;
        const last = dr.find(r => r.uid === u.id); const projs = state.projects.filter(p => p.leadId === u.id || (p.team || []).includes(u.id)).length;
        const starBadge = (() => { if(!u.starredAt) return ""; const days = Math.floor((new Date(today()) - new Date(u.starredAt)) / 86400000); return days <= 10 ? ` ⭐${u.streakWeeks>1?`<sup style="font-size:10px">${u.streakWeeks}</sup>`:""}` : ""; })();
        return `<tr><td>${esc(u.name)}${starBadge}</td><td class="small">${esc(u.postTitle || u.designation || "")}</td><td>${mine.length}</td>
          <td>${od ? `<span class="tag bad">${od}</span>` : "—"}</td><td>${wait ? `<span class="tag warn">${wait}</span>` : "—"}</td>
          <td class="small">${last ? fmtD(last.date) : `<span class="tag warn">none</span>`}</td><td>${projs}</td><td><button class="btn small quiet" onclick="routes.performance('${u.id}')">📋 Notes</button></td></tr>`; }).join("") || `<tr><td colspan="8" class="empty">Nobody reports to you yet</td></tr>`}</table></div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" onclick="go('assignments')">Assign work</button><button class="btn small quiet" onclick="go('inbox')">Approvals</button></div></div>`);
};

/* ================= STAFF ACTIVITY SUMMARY & PERFORMANCE NOTES ================= */
const PERIODS = { week: ["This week", 7], fortnight: ["Last 2 weeks", 14], month: ["This month", 30], q: ["3 months", 91], half: ["6 months", 182], year: ["1 year", 365] };
// Calendar-aware since date — "This month" = from 1st of current month, "This week" = from Monday
const periodSince = pk => {
  const now = new Date(); const t = now.toISOString().slice(0,10);
  if(pk==="month") return `${t.slice(0,7)}-01`;
  if(pk==="week") { const d=new Date(now); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d.toISOString().slice(0,10); }
  if(pk==="fortnight") { const d=new Date(now); d.setDate(d.getDate()-14); return d.toISOString().slice(0,10); }
  const pdays = PERIODS[pk]?.[1]||30; const d=new Date(now); d.setDate(d.getDate()-pdays); return d.toISOString().slice(0,10);
};
routes.teamfeedback = async () => {
  setTitle("Performance notes");
  const uid = viewUid();
  const mine = state.users.filter(u => u.active && u.id !== uid && mgrs(u).includes(uid));
  const everyone = (isAdmin() || has("super_admin","admin")) && !viewingAs();
  const team = everyone ? state.users.filter(u => u.active && u.id !== uid) : mine;
  if (!team.length) { html(`<div class="card"><div class="empty">Nobody reports to you yet.</div></div>`); return; }
  // Load recent notes for all team members
  const recentNotes = {};
  await Promise.all(team.map(async u => {
    const snap = await db.collection("performanceNotes").where("staffId","==",u.id).orderBy("at","desc").limit(5).get().catch(()=>({docs:[]}));
    recentNotes[u.id] = snap.docs.map(d=>({id:d.id,...d.data()}));
  }));
  html(`<div class="card"><h2>Performance notes · ${team.length} ${team.length===1?"person":"people"}</h2>
    <p class="small muted">Click a person to open their full performance file and add a note.</p></div>
    ${team.map(u => {
      const notes = recentNotes[u.id] || [];
      const lastNote = notes[0];
      return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div><strong>${esc(u.name||"")}</strong><span class="small muted" style="margin-left:8px">${esc(u.title||"")}</span></div>
        <button class="btn small" onclick="routes.performance('${u.id}')">Open file →</button></div>
        ${notes.length ? `<div class="small muted" style="margin-bottom:6px">${notes.length} note${notes.length===1?"":"s"} on file · latest: <strong>${esc(lastNote.kind||"")}</strong> · ${esc(lastNote.at||"")}${lastNote.selfAssessment?" (self)":""}</div>
        <div style="font-size:13px;color:#555;white-space:pre-wrap">${esc((lastNote.note||"").slice(0,150))}${(lastNote.note||"").length>150?"…":""}</div>` 
        : `<div class="small muted">No notes yet.</div>`}</div>`;
    }).join("")}`);
};

function statBlock(id, label, value, sub, color) {
  const col = color==="bad"?"var(--bad)":"var(--text)";
  return `<div class="card stat" style="cursor:pointer;user-select:none" data-stat="${id}"
    onmouseover="this.style.boxShadow='0 2px 10px rgba(0,0,0,.1)'" onmouseout="this.style.boxShadow=''">
    <span class="muted small">${label}</span>
    <b style="color:${col}">${value}</b>
    ${sub?`<span class="small muted">${sub}</span>`:""}
    <span class="small" style="color:var(--muted);margin-top:2px">tap to see ▾</span>
  </div>`;
}

routes.performance = async (uid) => {
  uid = uid || state.perfUid || state.user.uid; state.perfUid = uid;
  const pk = state.perfPeriod || "month"; const [plabel, pdays] = PERIODS[pk];
  const since = periodSince(pk);
  const person = state.users.find(u => u.id === uid) || state.me;
  const isMine = uid === state.user.uid;
  const canSee = isMine || mgrs(person).includes(state.user.uid) || isAdmin() || has("super_admin", "admin", "board");
  if (!canSee) return html(`<div class="card"><div class="empty">You can see your own summary and that of people who report to you.</div></div>`);
  setTitle("Activity summary · " + (person.name || ""));
  const q = (c, f, extra) => db.collection(c).where(f, "==", uid).limit(600).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [dr, att, asg, ev, ben, jour, lv, exp, cases, notes, caseUpdates] = await Promise.all([
    q("dayReports", "uid"), q("attendance", "uid"), q("assignments", "assigneeId"), q("eventReports", "uid"),
    db.collection("benefits").where("recordedBy", "==", uid).limit(600).get().then(s => s.docs.map(d => d.data())).catch(() => []),
    q("journeys", "travellerId"), q("leaveRequests", "uid"), q("expenseClaims", "uid"),
    db.collection("persons").where("registeredBy", "==", uid).limit(600).get().then(s => s.docs.map(d => d.data())).catch(() => []),
    db.collection("performanceNotes").where("staffId", "==", uid).orderBy("at", "desc").limit(50).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("caseUpdates").where("by", "==", uid).limit(300).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => [])]);
  const inP = d => d && String(d).slice(0, 10) >= since;
  const dayR = dr.filter(r => inP(r.date)), attD = att.filter(r => inP(r.date));
  const asgP = asg.filter(a => inP(a.doneAt) || inP(a.due) || inP(a.createdAt?.seconds ? new Date(a.createdAt.seconds * 1000).toISOString() : null));
  const done = asg.filter(a => a.status === "verified" && inP(a.doneAt)).length;
  const late = asg.filter(a => a.doneAt && a.due && a.doneAt > a.due && inP(a.doneAt)).length;
  const openOverdue = asg.filter(a => a.status !== "verified" && a.due && a.due < today()).length;
  const evP = ev.filter(e => inP(e.date)), benP = ben.filter(b => inP(b.date)), jourP = jour.filter(j => inP(j.date));
  const casesP = cases.filter(c => inP(c.registeredOn)), lvP = lv.filter(l => inP(l.from) && l.status === "approved");
  const expP = exp.filter(e => inP(e.date));
  const workdays = Math.round(pdays * 6 / 7);
  const reportRate = Math.min(100, Math.round(dayR.length / Math.max(1, workdays) * 100));
  const onTime = asgP.length ? Math.round((asgP.filter(a => a.status === "verified" && (!a.due || !a.doneAt || a.doneAt <= a.due)).length) / Math.max(1, done + late) * 100) : null;
  const team = staffList().filter(u => mgrs(u).includes(state.user.uid) || isAdmin() || has("super_admin"));
  const spark = (arr, getDate) => { const weeks = 8; const buckets = Array(weeks).fill(0);
    arr.forEach(x => { const d = getDate(x); if (!d) return; const w = Math.floor((Date.now() - new Date(d)) / (7 * 86400000)); if (w >= 0 && w < weeks) buckets[weeks - 1 - w]++; });
    const mx = Math.max(1, ...buckets);
    return `<div style="display:flex;gap:2px;align-items:flex-end;height:30px">${buckets.map(b => `<div title="${b}" style="flex:1;height:${Math.max(3, b / mx * 30)}px;background:var(--green);opacity:${b ? 1 : .25};border-radius:2px"></div>`).join("")}</div><div class="small muted">last 8 weeks</div>`; };
  html(`<div class="card"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      ${person.photo ? `<img src="${(m=>(m?'https://lh3.googleusercontent.com/d/'+m[1]:person.photo))(person.photo.match(/\/file\/d\/([^\/\?]+)/))||person.photo}" style="width:48px;height:48px;border-radius:50%;object-fit:cover">` : ""}
      <div><b style="font-size:17px">${esc(person.name)}</b><div class="small muted">${esc(person.postTitle || person.designation || "")}${person.department ? " · " + esc(person.department) : ""} · ${esc(officeName(person.officeId))}</div></div>
      ${team.length > 1 || !isMine ? `<select id="who" style="margin-left:auto;width:auto;padding:5px 9px;border-radius:9px">${[state.me, ...team.filter(u => u.id !== state.user.uid)].map(u => `<option value="${u.id}" ${u.id === uid ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>` : ""}</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">${Object.entries(PERIODS).map(([k, [l]]) => `<button class="btn small ${k === pk ? "" : "quiet"}" data-p="${k}">${l}</button>`).join("")}</div>
    <p class="small muted" style="margin-top:6px">${plabel} · since ${fmtD(since)}</p></div>

  <div class="grid" id="perfStats">
    ${statBlock("st_dr","Day reports",dayR.length,reportRate+"% of "+workdays+" working days")}
    ${statBlock("st_att","Days present",attD.length,"")}
    ${statBlock("st_cu","Case updates",(caseUpdates||[]).filter(c=>inP(c.date)).length,"")}
    ${statBlock("st_asg","Assignments completed",done,late?late+" late":"")}
    ${statBlock("st_ov","Still overdue",openOverdue,"","bad")}
    ${statBlock("st_ev","Field events",evP.length,"")}
    ${statBlock("st_cas","Sakhis registered",casesP.length,"")}
    ${statBlock("st_ben","Benefits recorded",benP.length,"")}
    ${statBlock("st_jny","Journeys",jourP.length,"")}
    ${statBlock("st_lv","Leave taken",lvP.reduce((a,l)=>a+(Number(l.days)||0),0),"days")}
    ${statBlock("st_exp","Claims filed",expP.length,"₹"+expP.reduce((a,e)=>a+(Number(e.amount)||0),0).toLocaleString("en-IN"))}
  </div>

  <!-- Expandable detail panels — hidden until stat block clicked -->
  <div id="st_dr_detail" class="hidden"></div>
  <div id="st_att_detail" class="hidden"></div>
  <div id="st_cu_detail" class="hidden"></div>
  <div id="st_asg_detail" class="hidden"></div>
  <div id="st_ov_detail" class="hidden"></div>
  <div id="st_ev_detail" class="hidden"></div>
  <div id="st_cas_detail" class="hidden"></div>
  <div id="st_ben_detail" class="hidden"></div>
  <div id="st_jny_detail" class="hidden"></div>
  <div id="st_lv_detail" class="hidden"></div>
  <div id="st_exp_detail" class="hidden"></div>

  <div class="grid">
    <div class="card"><h2>Day reports</h2>${spark(dr, r => r.date)}</div>
    <div class="card"><h2>Field events</h2>${spark(ev, r => r.date)}</div>
    <div class="card"><h2>Assignments completed</h2>${spark(asg.filter(a => a.doneAt), a => a.doneAt)}</div>
    <div class="card"><h2>Benefits recorded</h2>${spark(ben, b => b.date)}</div></div>

  <div class="card"><h2>What they did · ${plabel}</h2><div class="list">
    ${[...dayR.map(r => {
        const summary = r.narrative || (r.items||[]).join(" · ") || r.text || "";
        return { d: r.date, t: "Day report" + (r.location ? " · " + r.location : "") + (r.checkIn ? " · in " + r.checkIn : ""), s: summary, tag: r.status, full: r.items||[], narrative: r.narrative||"" };
      }),
       ...evP.map(e => ({ d: e.date, t: "Event: " + (e.heading || e.activity || ""), s: e.report || e.summary || "", tag: e.status })),
       ...asg.filter(a => inP(a.doneAt)).map(a => ({ d: a.doneAt, t: "✓ Completed: " + a.title, s: a.doneNote || "", tag: a.status })),
       ...(caseUpdates||[]).filter(c=>inP(c.date)).map(c=>({ d: c.date, t: "Case update: " + (c.kind||""), s: c.notes||c.note||"", tag: "case update" })),
       ...casesP.map(c => ({ d: c.registeredOn, t: "Registered Sakhi: " + (c.code || ""), s: c.name || "", tag: "case" }))]
      .sort((a, b) => (b.d || "").localeCompare(a.d || "")).slice(0, 60)
      .map(x => `<div class="item" style="flex-direction:column;gap:4px">
        <div style="display:flex;gap:8px;align-items:flex-start">
          <div class="grow"><div class="t">${esc(x.t)}</div><div class="s">${fmtD(x.d)}</div></div>
          <span class="tag ${/verified|case/.test(x.tag || "") ? "ok" : "warn"}">${esc(x.tag || "")}</span>
        </div>
        ${x.narrative ? `<p style="margin:0;font-style:italic;color:var(--muted);line-height:1.4">"${esc(x.narrative.slice(0,300))}${x.narrative.length>300?"…":""}"</p>` : ""}
        ${(x.full||[]).length ? `<ul style="margin:0;padding-left:16px;line-height:1.6">${(x.full).map(i=>`<li class="small">${esc(i)}</li>`).join("")}</ul>` : x.s ? `<p class="small muted" style="margin:0;white-space:pre-wrap">${esc(x.s.slice(0,300))}${x.s.length>300?"…":""}</p>` : ""}
      </div>`).join("") || `<div class="empty">Nothing recorded in this period</div>`}</div>
    <button class="btn small quiet" style="margin-top:8px" id="expP">Export summary</button></div>

  ${isMine ? `
  <div class="card"><h2>Write a self-assessment</h2><p class="small muted">A record of your own view of your work in this period — saved to your performance file and visible to your manager.</p><form id="sa">
    <label class="field"><span>Period it covers</span><input name="period" value="${plabel}"></label>
    <label class="field full"><span>What have you done well?</span><textarea name="strengths" rows="3" placeholder="Contributions, outcomes, skills used..."></textarea></label>
    <label class="field full"><span>What would you like to improve or learn?</span><textarea name="growth" rows="3" placeholder="Challenges, gaps, development areas..."></textarea></label>
    <label class="field full"><span>What support do you need from your manager?</span><textarea name="support" rows="2" placeholder="Anything you need to do your job better..."></textarea></label>
    <button class="btn" type="submit">Save self-assessment</button></form></div>` : ""}

  ${!isMine && (mgrs(person).includes(state.user.uid) || isAdmin() || has("super_admin", "admin")) ? `
  <div class="card"><h2>Add a note on performance</h2><form id="nf">
    <div class="two"><label class="field"><span>Kind</span><select name="kind">${["Observation", "Appreciation", "Concern", "One-to-one", "Mid-year review", "Annual appraisal", "Training need"].map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="field"><span>Period it covers</span><input name="period" value="${plabel}"></label></div>
    <div class="two"><label class="field"><span>Quality of work</span><select name="quality">${["—", "Outstanding", "Good", "Meets expectations", "Needs support"].map(x => `<option>${x}</option>`).join("")}</select></label>
      <label class="field"><span>Reporting discipline</span><select name="discipline">${["—", "Consistent", "Mostly on time", "Irregular"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
    <label class="field"><span>Comment</span><textarea name="text" required placeholder="What went well, what needs support, what was agreed"></textarea></label>
    <label class="field"><span>Agreed next steps</span><input name="next" placeholder="Training, change of task, follow-up date"></label>
    <label class="check"><input type="checkbox" name="shared" checked> Share with ${esc(person.name.split(" ")[0])} (they see it on their own summary)</label>
    <button class="btn small" type="submit">Save note</button></form></div>` : ""}

  <div class="card"><h2>Performance notes${isMine ? " about me" : ""}</h2><div class="list">
    ${notes.filter(n => isMine ? n.shared : true).map(n => `<div class="item"><div class="grow">
      <div class="t">${esc(n.kind)}${n.period ? " · " + esc(n.period) : ""} ${n.selfAssessment ? `<span class="tag">self-written</span>` : ""} ${n.shared ? "" : `<span class="tag warn">private to managers</span>`}</div>
      <div class="s">${esc(n.text || n.note || "")}</div>
      <div class="s muted">${esc(userName(n.by))} · ${esc(n.at)}${n.quality && n.quality !== "—" ? " · quality: " + esc(n.quality) : ""}${n.discipline && n.discipline !== "—" ? " · reporting: " + esc(n.discipline) : ""}${n.next ? " · next: " + esc(n.next) : ""}</div>
      ${n.ack ? `<div class="s" style="color:var(--green)">Acknowledged by staff on ${esc(n.ack)}</div>` : ""}</div>
      ${isMine && n.shared && !n.ack ? `<button class="btn small quiet" data-ack="${n.id}">Acknowledge</button>` : ""}</div>`).join("") || `<div class="empty">No notes yet</div>`}</div></div>`);
  if ($("who")) $("who").onchange = e => { state.perfUid = e.target.value; routes.performance(e.target.value); };
  $("content").querySelectorAll("[data-p]").forEach(b => b.onclick = () => { state.perfPeriod = b.dataset.p; routes.performance(uid); });

  // Stat block click → expand detail panel inline
  const statusColor = st => st==="verified"?"var(--green)":st==="submitted"?"var(--blue)":st==="auto"?"var(--muted)":"var(--bad)";
  const statDetails = {
    st_dr: () => !dayR.length ? "<div class='empty'>No day reports in this period</div>" :
      `<div class='list'>${dayR.sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{
        const st=r.status||"missing"; const items=r.items||[];
        return `<div class='item' style='flex-direction:column;gap:6px'>
          <div style='display:flex;gap:8px;align-items:flex-start'>
            <div class='grow'><div class='t'>${fmtD(r.date)}${r.location?" · "+esc(r.location):""}${r.checkIn?" · in "+r.checkIn:""}</div></div>
            <div style='display:flex;gap:6px;align-items:center'>
              <span style='color:${statusColor(st)};font-weight:500;font-size:12px'>${esc(st)}</span>
              ${(st==="submitted"||st==="auto")&&!isMine?`<button class='btn small' data-verify-perf='${r.id}'>✓ Verify</button>`:""}
            </div>
          </div>
          ${r.narrative?`<p style='margin:0;font-style:italic;line-height:1.5'>"${esc(r.narrative)}"</p>`:""}
          ${items.length?`<ul style='margin:0;padding-left:16px;line-height:1.7'>${items.map(i=>`<li class='small'>${esc(i)}</li>`).join("")}</ul>`:""}
        </div>`;}).join("")}</div>`,
    st_att: () => !attD.length ? "<div class='empty'>No check-ins in this period</div>" :
      `<div class='list'>${attD.sort((a,b)=>b.date.localeCompare(a.date)).map(a=>
        `<div class='item'><div class='grow'><div class='t'>${fmtD(a.date)}</div><div class='s'>${a.checkIn?"In: "+a.checkIn:""}${a.checkOut?" · Out: "+a.checkOut:""}${a.location?" · "+esc(a.location):""}</div></div>${a.hours?`<span class='tag'>${a.hours}h</span>`:""}</div>`
      ).join("")}</div>`,
    st_cu: () => { const cuInP=(caseUpdates||[]).filter(c=>inP(c.date)); return !cuInP.length?"<div class='empty'>No case updates in this period</div>":
      `<div class='list'>${cuInP.sort((a,b)=>b.date.localeCompare(a.date)).map(c=>
        `<div class='item' style='flex-direction:column;gap:4px'>
          <div class='t'>${esc(c.kind||"Update")} · ${fmtD(c.date)}</div>
          <div class='small' style='white-space:pre-wrap;line-height:1.5'>${esc(c.notes||c.note||"")}</div>
        </div>`).join("")}</div>`; },
    st_asg: () => { const doneAsg=asg.filter(a=>a.status==="verified"&&inP(a.doneAt)); return !doneAsg.length?"<div class='empty'>No completed assignments in this period</div>":
      `<div class='list'>${doneAsg.map(a=>`<div class='item'><div class='grow'><div class='t'>${esc(a.title||"Task")}</div><div class='s'>Done ${fmtD(a.doneAt)}${a.doneNote?" · "+esc(a.doneNote):""}</div></div><span class='tag ok'>done</span></div>`).join("")}</div>`; },
    st_ov: () => { const ov=asg.filter(a=>a.status!=="verified"&&a.due&&a.due<today()); return !ov.length?"<div class='empty'>No overdue tasks ✓</div>":
      `<div class='list'>${ov.map(a=>{const days=Math.floor((new Date(today())-new Date(a.due))/86400000);return `<div class='item'><div class='grow'><div class='t' style='color:var(--bad)'>${esc(a.title||"Task")}</div><div class='s'>Due ${fmtD(a.due)} · <b style='color:var(--bad)'>${days}d overdue</b></div></div></div>`;}).join("")}</div>`; },
    st_ev: () => !evP.length?"<div class='empty'>No field events in this period</div>":
      `<div class='list'>${evP.map(e=>`<div class='item' style='flex-direction:column;gap:4px'><div class='t'>${esc(e.heading||e.activity||"Event")} · ${fmtD(e.date)}</div><div class='s'>${e.place?"@ "+esc(e.place):""}${e.participants?" · "+e.participants+" participants":""}</div>${e.report||e.summary?`<div class='small muted' style='white-space:pre-wrap'>${esc((e.report||e.summary).slice(0,200))}</div>`:""}</div>`).join("")}</div>`,
    st_cas: () => !casesP.length?"<div class='empty'>No Sakhis registered in this period</div>":
      `<div class='list'>${casesP.map(c=>`<div class='item'><div class='grow'><div class='t'>${esc(c.name||"")} <span class='tag'>${esc(c.code||"")}</span></div><div class='s'>${fmtD(c.registeredOn)}${c.district?" · "+esc(c.district):""}</div></div></div>`).join("")}</div>`,
    st_ben: () => !benP.length?"<div class='empty'>No benefits recorded in this period</div>":
      `<div class='list'>${benP.map(b=>`<div class='item'><div class='grow'><div class='t'>${esc(b.service||b.type||"Benefit")}${b.personCode?" · "+esc(b.personCode):""}</div><div class='s'>${fmtD(b.date)}${b.value?" · ₹"+b.value:""}${b.name?" · "+esc(b.name):""}</div></div></div>`).join("")}</div>`,
    st_jny: () => !jourP.length?"<div class='empty'>No journeys in this period</div>":
      `<div class='list'>${jourP.map(j=>`<div class='item'><div class='grow'><div class='t'>${esc(j.fromPlace||"")} → ${esc(j.toPlace||"")}</div><div class='s'>${fmtD(j.date)} · ${esc(j.purpose||"")}${j.km?" · "+j.km+"km":""}</div></div></div>`).join("")}</div>`,
    st_lv: () => !lvP.length?"<div class='empty'>No leave in this period</div>":
      `<div class='list'>${lvP.map(l=>`<div class='item'><div class='grow'><div class='t'>${esc(l.type||"Leave")}</div><div class='s'>${fmtD(l.from)} – ${fmtD(l.to)} · ${l.days||0} days · ${esc(l.status||"")}</div></div></div>`).join("")}</div>`,
    st_exp: () => !expP.length?"<div class='empty'>No claims in this period</div>":
      `<div class='list'>${expP.map(e=>`<div class='item'><div class='grow'><div class='t'>${esc(e.description||e.particulars||"Claim")}</div><div class='s'>${fmtD(e.date)} · ₹${e.amount||0} · ${esc(e.status||"")}</div></div></div>`).join("")}</div>`
  };

  $("content").querySelectorAll("[data-stat]").forEach(card => {
    card.onclick = () => {
      const id = card.dataset.stat;
      const panel = document.getElementById(id+"_detail");
      if (!panel) return;
      const isOpen = !panel.classList.contains("hidden");
      $("content").querySelectorAll("[id$='_detail']").forEach(p=>p.classList.add("hidden"));
      $("content").querySelectorAll("[data-stat] span:last-child").forEach(s=>{if(s.textContent.includes("▴"))s.textContent="tap to see ▾";});
      if (isOpen) return;
      if (!panel.dataset.built) {
        panel.innerHTML = `<div class="card"><h2>${card.querySelector(".muted").textContent}</h2>${(statDetails[id]&&statDetails[id]())||"<div class='empty'>Nothing to show</div>"}</div>`;
        panel.dataset.built = "1";
      }
      panel.classList.remove("hidden");
      card.querySelector("span:last-child").textContent = "tap to close ▴";
      panel.scrollIntoView({behavior:"smooth",block:"nearest"});
    };
  });

  $("content").addEventListener("click", async e => {
    const btn = e.target.closest("[data-verify-perf]");
    if (!btn) return;
    btn.disabled=true; btn.textContent="Saving…";
    await db.collection("dayReports").doc(btn.dataset.verifyPerf).update({verified:true,verifiedBy:state.user.uid,verifiedAt:today(),status:"verified"});
    audit("verify","dayReports",btn.dataset.verifyPerf,"performance screen");
    toast("Verified ✓");
    const panel = document.getElementById("st_dr_detail");
    if (panel) { delete panel.dataset.built; panel.classList.add("hidden"); }
  });

  if ($("nf")) $("nf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); d.shared = fd.get("shared") === "on";
    await db.collection("performanceNotes").add({ ...d, staffId: uid, by: state.user.uid, at: today(), createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    // Notify staff member
    await db.collection("notifications").add({ type: "performanceNote", toUids: [uid], fromUid: state.user.uid, staffId: uid, kind: d.kind, preview: (d.note || d.text || "").slice(0, 100), at: today(), read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    audit("create", "performanceNotes", uid, d.kind); toast("Note saved"); routes.performance(uid); };
    // Self-assessment submit
  const saForm = document.getElementById("sa");
  if (saForm) saForm.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(saForm).entries());
    if (!d.strengths?.trim() && !d.growth?.trim()) { toast("Please fill in at least one field"); return; }
    const noteText = [d.strengths && `Well: ${d.strengths}`, d.growth && `Improve: ${d.growth}`, d.support && `Support needed: ${d.support}`].filter(Boolean).join("\n\n");
    await db.collection("performanceNotes").add({ staffId: uid, by: uid, at: today(), kind: "Self-assessment", period: d.period || plabel, text: noteText, selfAssessment: true, shared: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    // Notify manager
    const managers = mgrs(person); if (managers.length) await db.collection("notifications").add({ type: "performanceNote", toUids: managers, fromUid: uid, staffId: uid, kind: "Self-assessment", preview: noteText.slice(0, 100), at: today(), read: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast("Self-assessment saved"); routes.performance(uid); };

  $("content").querySelectorAll("[data-ack]").forEach(b => b.onclick = async () => { await db.collection("performanceNotes").doc(b.dataset.ack).update({ ack: today() }); toast("Acknowledged"); routes.performance(uid); });
  $("expP").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Staff: person.name, Post: person.postTitle || "", Period: plabel, Since: since,
      "Day reports": dayR.length, "Reporting rate %": reportRate, "Days present": attD.length, "Assignments completed": done, Late: late, "Still overdue": openOverdue,
      Events: evP.length, "Cases registered": casesP.length, "Benefits recorded": benP.length, Journeys: jourP.length, "Leave days": lvP.reduce((a, l) => a + (Number(l.days) || 0), 0), Claims: expP.length }]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dayR.map(r => ({ Date: r.date, Where: r.location, Report: r.text, Status: r.status }))), "Day reports");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notes.map(n => ({ Date: n.at, Kind: n.kind, By: userName(n.by), Comment: n.text, Quality: n.quality, Next: n.next })) ), "Performance notes");
    XLSX.writeFile(wb, `${(person.name || "staff").replace(/\s+/g, "-")}-summary-${today()}.xlsx`); };
};

routes.teamsummary = async () => {
  setTitle("Team activity summary");
  const pk = state.perfPeriod || "month"; const [plabel, pdays] = PERIODS[pk];
  const since = periodSince(pk);
  const elapsedDays = Math.round((Date.now() - new Date(since).getTime()) / 86400000) + 1;
  const team = staffList().filter(u => mgrs(u).includes(state.user.uid) || isAdmin() || has("super_admin"));
  const [dr, asg, ev, ben, att] = await Promise.all(["dayReports", "assignments", "eventReports", "benefits", "attendance"].map(c =>
    db.collection(c).limit(2000).get().then(s => s.docs.map(d => d.data())).catch(() => [])));
  const inP = d => d && String(d).slice(0, 10) >= since;
  // Count actual Mon–Sat days in the period (exclude Sundays)
  const workdays = (() => {
    let count = 0;
    const d = new Date(since);
    const end = new Date();
    while(d <= end) { if(d.getDay() !== 0) count++; d.setDate(d.getDate()+1); }
    return Math.max(1, count);
  })();
  html(`<div class="card"><div style="display:flex;gap:5px;flex-wrap:wrap">${Object.entries(PERIODS).map(([k, [l]]) => `<button class="btn small ${k === pk ? "" : "quiet"}" data-p="${k}">${l}</button>`).join("")}</div>
    <p class="small muted" style="margin-top:6px">${plabel} · ${team.length} people</p></div>
  <div class="card"><div class="tablewrap"><table class="table"><tr><th>Name</th><th>Post</th><th>Day reports</th><th>Rate</th><th>Present</th><th>Done</th><th>Overdue</th><th>Events</th><th>Benefits</th><th></th></tr>
    ${team.map(u => { const d = dr.filter(x => x.uid === u.id && inP(x.date) && new Date(x.date+'T00:00:00').getDay()!==0).length; const rate = Math.min(100, Math.round(d / Math.max(1, workdays) * 100));
      const done = asg.filter(a => a.assigneeId === u.id && a.status === "verified" && inP(a.doneAt)).length;
      const od = asg.filter(a => a.assigneeId === u.id && a.status !== "verified" && a.due && a.due < today()).length;
      return `<tr><td>${esc(u.name)}</td><td class="small">${esc(u.postTitle || u.designation || "")}</td><td>${d}</td>
        <td>${rate >= 70 ? `<span class="tag ok">${rate}%</span>` : rate >= 40 ? `<span class="tag warn">${rate}%</span>` : `<span class="tag bad">${rate}%</span>`}</td>
        <td>${att.filter(x => x.uid === u.id && inP(x.date)).length}</td><td>${done}</td><td>${od ? `<span class="tag bad">${od}</span>` : "—"}</td>
        <td>${ev.filter(x => x.uid === u.id && inP(x.date)).length}</td><td>${ben.filter(x => x.recordedBy === u.id && inP(x.date)).length}</td>
        <td><button class="btn small quiet" data-u="${u.id}">Open</button></td></tr>`; }).join("") || `<tr><td colspan="10" class="empty">Nobody reports to you yet</td></tr>`}</table></div></div>`);
  $("content").querySelectorAll("[data-p]").forEach(b => b.onclick = () => { state.perfPeriod = b.dataset.p; routes.teamsummary(); });
  $("content").querySelectorAll("[data-u]").forEach(b => b.onclick = () => { state.perfUid = b.dataset.u; go("performance"); });
};

/* ================= BENEFICIARY LIST (standalone register) ================= */
const BENEFIT_TYPES = ["Government scheme", "Documentation", "Health", "Financial / material", "Food & lodging", "Information & access", "Counselling", "Skilling / livelihood", "Legal aid", "Education support", "Other"];
routes.beneficiaryNew = async () => {
  setTitle("Register a beneficiary");
  const prefill = state.benPrefill || {}; state.benPrefill = null;
  html(`<div class="card">
    <h2>Register a beneficiary</h2>
    ${prefill.personCode ? `<div class="card" style="border-left:4px solid var(--green);margin-bottom:0"><p class="small" style="margin:0">Recording benefit for <b>${esc(prefill.name||"")}</b> <span class="muted">${esc(prefill.personCode||"")}</span> — linked to her case file.</p></div>` : ""}
    <p class="small muted">Record a service or benefit delivered to someone. If she is a Sakhi with a case file, link her below — the entry will also appear on her profile. Leave blank if she is a new contact.</p>
    <form id="bf">
      <div class="two"><label class="field"><span>State</span><select name="state" data-geo="state">${stateOptions(prefill.state||state.me?.states?.[0]||"Haryana")}</select></label>
        <label class="field"><span>District</span><select name="district" data-geo="district">${districtOptions(prefill.state||state.me?.states?.[0]||"Haryana", prefill.district)}</select></label></div>
      <div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
        <label class="field"><span>Village / block</span><input name="village" value="${esc(prefill.village||"")}"></label></div>
      <label class="field"><span>Name</span><input name="name" required placeholder="Full name" value="${esc(prefill.name||"")}"></label>
      <input type="hidden" name="personId" value="${esc(prefill.personId||"")}">
      <input type="hidden" name="personCode" id="benCode2" value="${esc(prefill.personCode||"")}">
      <div class="two"><label class="field"><span>Type of benefit</span><select name="service" required><option value="">— select —</option>${BENEFIT_TYPES.map(x=>`<option>${x}</option>`).join("")}</select></label>
        <label class="field"><span>Value ₹ (if any)</span><input type="number" step="any" inputmode="decimal" name="value"></label></div>
      <label class="field"><span>Description</span><textarea name="description" required placeholder="What was provided and the outcome…"></textarea></label>
      <div class="two"><label class="field"><span>Programme / Project</span><select name="projectId">${programmeProjectOptions("")}</select></label>
        ${!prefill.personCode ? `<label class="field"><span>Link to Sakhi profile (optional)</span>
          <input id="benFind2" autocomplete="off" placeholder="Start typing name or Sakhi ID…">
          <div id="benHits2" class="list hidden" style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin-top:4px"></div>
          <span class="small muted" id="benPicked2">Leave blank to create a new contact.</span></label>` : ""}</div>
      <div class="two"><label class="field"><span>Age</span><input type="number" step="any" inputmode="decimal" name="age"></label>
        <label class="field"><span>Gender</span><select name="sex">${["Female","Male","Other"].map(x=>`<option>${x}</option>`).join("")}</select></label></div>
      <label class="field"><span>Phone number</span><input type="tel" inputmode="tel" name="phone"></label>
      <button class="btn" type="submit">Register beneficiary</button>
    </form></div>`);
  autoLinkGeo($("content"));
  // Sakhi search
  const bf2 = $("benFind2");
  if(bf2) bf2.oninput = () => {
    const q = bf2.value.trim().toLowerCase(); const box = $("benHits2");
    if(q.length<2){box.classList.add("hidden");return;}
    const hits=(state.persons||[]).filter(p=>(p.name||"").toLowerCase().includes(q)||(p.code||"").toLowerCase().includes(q)).slice(0,8);
    if(!hits.length){box.classList.add("hidden");return;}
    box.innerHTML=hits.map(p=>`<div class="item" style="cursor:pointer" data-pid="${p.id}" data-pname="${esc(p.name)}" data-pcode="${esc(p.code||"")}">${esc(p.name)}<span class="small muted" style="margin-left:6px">${esc(p.code||"")}</span></div>`).join("");
    box.classList.remove("hidden");
    box.querySelectorAll("[data-pid]").forEach(el=>el.onclick=()=>{
      $("benCode2").value=el.dataset.pcode;
      bf2.value=el.dataset.pname+(el.dataset.pcode?" · "+el.dataset.pcode:"");
      $("benPicked2").textContent="Linked to "+el.dataset.pcode;
      box.classList.add("hidden");
    });
  };
  $("bf").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]"); btn.disabled=true; btn.textContent="Saving…";
    try {
      const d = Object.fromEntries(new FormData(e.target));
      d.amount = d.value ? Number(d.value) : null; delete d.value;
      if(d.age) d.age=Number(d.age); else delete d.age;
      const r = await db.collection("benefits").add({officeId:state.me?.officeId||null,...d,
        funding:[{projectId:d.projectId,amount:d.amount||0}],
        recordedBy:state.user.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      audit("create","benefits",r.id,d.name);
      const logText = d.date&&d.date<today()?`Recorded benefit for ${d.name||"a beneficiary"} dated ${fmtD(d.date)} (entered today — backdated)`:`Recorded a benefit for ${d.name||"a beneficiary"}${d.service?" · "+d.service:""}`;
      autoLogActivity(logText).catch(()=>{});
      successFlash("Registered"); window.scrollTo({top:0,behavior:"smooth"}); setTimeout(()=>routes.beneficiaryNew(),600);
    } catch(err){ btn.disabled=false; btn.textContent="Register beneficiary"; toast("Could not save — "+(err.message||err.code||err)); }
  };
};

routes.beneficiaries = async (editId) => {
  setTitle("Beneficiary list");
  const canEdit = has("super_admin", "admin", "program_officer", "program_coord", "program_lead", "field_staff");
  const canSeeDetails = has("super_admin", "founder", "admin") || atHeadquarters();
  const snap = await db.collection("benefits").orderBy("date", "desc").get().catch(() => ({ docs: [] }));
  const allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const st = myStates();
  let rows = st ? allRows.filter(r => !r.state || st.includes(r.state)) : allRows;
  rows = rows.filter(inMyLine);
  const editing = editId ? rows.find(r => r.id === editId) : (state.benPrefill ? { ...state.benPrefill } : null);
  const prefilled = !editId && !!state.benPrefill; state.benPrefill = null;
  const f = state.benFilter || {};
  // Period boundaries
  const now = new Date(); const nd = today();
  const weekStart = new Date(now); weekStart.setDate(now.getDate()-now.getDay()+1); const ws = weekStart.toISOString().slice(0,10);
  const monthStart = nd.slice(0,7)+"-01";
  const fyStart = (now.getMonth()>=3?now.getFullYear():now.getFullYear()-1)+"-04-01";
  const periodFrom = f.period==="week"?ws:f.period==="month"?monthStart:f.period==="year"?fyStart:f.period==="custom"?(f.from||""):null;
  const periodTo = f.period==="custom"?(f.to||nd):nd;
  const shown = rows.filter(r => (!f.district || r.district === f.district) && (!f.service || r.service === f.service) && (!f.project || r.projectId === f.project)
    && (!f.q || JSON.stringify(r).toLowerCase().includes(f.q.toLowerCase()))
    && (!periodFrom || (r.date >= periodFrom && r.date <= periodTo)));
  const fy = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const inr = n => "₹" + Math.round(n || 0).toLocaleString("en-IN");
  const byService = {}; shown.forEach(r => byService[r.service || "—"] = (byService[r.service || "—"] || 0) + 1);
  html(`<div class="grid">
      <div class="card stat"><span class="muted small">Entries</span><b>${rows.length}</b></div>
      <div class="card stat"><span class="muted small">This financial year</span><b>${rows.filter(r => (r.date || "") >= fy).length}</b></div>
      <div class="card stat"><span class="muted small">People reached</span><b>${new Set(rows.map(r => r.personId || r.name)).size}</b>
        <span class="small muted">${rows.filter(r => r.personId).length} of ${rows.length} linked to a case file</span></div>
      <div class="card stat"><span class="muted small">Value recorded</span><b>${inr(rows.reduce((a, r) => a + (Number(r.value) || 0), 0))}</b></div></div>
    ${canSeeDetails ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px">
      <button class="btn small quiet" id="bexp">⬇ Export CSV</button>
      <button class="btn small quiet" id="bxl">⬇ Export Excel</button>
    </div>` : `<div class="card" style="border-left:4px solid var(--muted)"><p class="small muted" style="margin:0">Full details and export are available to the Delhi office.</p></div>`}

    ${(() => {
    const myOffice = state.me?.officeId;
    const officeName = myOffice ? (state.offices||[]).find(o=>o.id===myOffice)?.name || "" : "";
    if (myOffice && !atHeadquarters() && !has("super_admin","founder")) {
      return `<div class="card"><p class="small muted">Showing entries for <b>${esc(officeName||"your office")}</b>. Contact Delhi HQ to see other offices.</p></div>`;
    }
    return st ? `<div class="card"><p class="small muted">You see entries from ${esc(st.join(", ") || "your own state")}. Leadership sees every state.</p></div>` : "";
  })()}


    <div class="card"><h2>Register (${shown.length})</h2>
      <div class="two"><label class="field"><span>Search</span><input id="bq" value="${esc(f.q || "")}" placeholder="name, village, description"></label>
        <label class="field"><span>Period</span><select id="bperiod">
          <option value="">All time</option>
          <option ${f.period==="week"?"selected":""} value="week">This week</option>
          <option ${f.period==="month"?"selected":""} value="month">This month</option>
          <option ${f.period==="year"?"selected":""} value="year">This financial year</option>
          <option ${f.period==="custom"?"selected":""} value="custom">Custom range</option>
        </select></label></div>
      ${f.period==="custom"?`<div class="two"><label class="field"><span>From</span><input type="date" id="bfrom" value="${esc(f.from||"")}"></label><label class="field"><span>To</span><input type="date" id="bto" value="${esc(f.to||"")}"></label></div>`:""}
      <div class="two"><label class="field"><span>Type of benefit</span><select id="bsvc"><option value="">All</option>${BENEFIT_TYPES.map(x => `<option ${x === f.service ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="field"><span>District</span><select id="bdist"><option value="">All</option>${[...new Set(rows.map(r => r.district).filter(Boolean))].sort().map(d => `<option ${d === f.district ? "selected" : ""}>${d}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Programme / Project</span><select id="bproj"><option value="">All</option>
        ${(() => {
          const myOffice = state.me?.officeId;
          const isHQ = !myOffice || atHeadquarters() || has("super_admin","founder");
          const progs = (state.programmes||[]).filter(p=>p.status==="live"||p.status==="active"||!p.status);
          const myOfficeObj2 = (state.offices||[]).find(o=>o.id===myOffice);
          const myState2 = myOfficeObj2?.state || state.me?.state;
          const pm2 = p => { if(!myOffice&&!myState2)return true; if(p.officeId)return p.officeId===myOffice||(p.offices||[]).includes(myOffice); return myState2&&p.statesText?p.statesText.toLowerCase().includes(myState2.toLowerCase()):true; };
          const filtProgs = isHQ ? progs : progs.filter(pm2);
          const projs = activeProjects();
          const filtProjs = isHQ ? projs : projs.filter(p=>{ if(!myOffice&&!myState2)return true; if(p.officeId)return p.officeId===myOffice; if((p.team||[]).includes(state.user.uid))return true; const pids=p.programmeIds||(p.programmeId?[p.programmeId]:[]); return pids.some(pid=>{const g=(state.programmes||[]).find(x=>x.id===pid);return g&&pm2(g);}); });
          return [
            filtProgs.length ? `<optgroup label="Programmes">${filtProgs.map(p=>`<option value="prog:${p.id}" ${"prog:"+p.id===f.project?"selected":""}>${esc(p.name)}</option>`).join("")}</optgroup>` : "",
            filtProjs.length ? `<optgroup label="Projects">${filtProjs.map(p=>`<option value="${p.id}" ${p.id===f.project?"selected":""}>${esc(p.name)}</option>`).join("")}</optgroup>` : ""
          ].join("");
        })()}
      </select></label></div>
      <div class="tablewrap"><table class="table"><tr><th>Date</th><th>Name</th><th>Age</th><th>Gender</th><th>District</th><th>Village</th><th>Phone</th><th>Benefit</th><th>Description</th><th>₹</th><th>Project</th><th>By</th>${canEdit ? "<th></th>" : ""}</tr>
        ${shown.map(r => `<tr><td>${fmtD(r.date)}</td><td>${esc(!canSeeDetails ? (r.personCode ? String(r.personCode).split("/").pop() : "Beneficiary") : (r.name || ""))}${r.personCode && canSeeDetails ? `<div class="s">${esc(r.personCode)}</div>` : ""}</td><td>${r.age || ""}</td><td>${esc(r.sex || "")}</td>
          <td>${esc(r.district || "")}</td><td>${esc(r.village || "")}</td><td>${esc(canSeeDetails ? (r.phone || "") : "")}</td><td>${esc(r.service || "")}</td><td>${esc(String(r.description || "").slice(0, 60))}</td>
          <td>${r.value ? Number(r.value).toLocaleString("en-IN") : ""}</td><td>${esc(projectName(r.projectId))}</td><td class="small">${esc(r.recordedByName || userName(r.recordedBy))}</td>
          ${canEdit ? `<td style="white-space:nowrap"><button class="btn small quiet" data-edit="${r.id}">Edit</button>${has("super_admin") ? ` <button class="btn small danger" data-del="${r.id}">✕</button>` : ""}</td>` : ""}</tr>`).join("") || `<tr><td colspan="13" class="empty">No entries yet</td></tr>`}</table></div>
      </div>

${canEdit && editId ? `<div class="card" id="benForm"><h2>${editing ? "Edit entry" : "Add a beneficiary entry"}</h2>
      ${prefilled ? `<p class="small muted">Her details are filled in from her case file ${esc(editing.personCode || "")}. Just say what she received.</p>` : ""}<form id="bf">
      <div class="two"><label class="field"><span>State</span><select name="state" data-geo="state">${stateOptions(editing?.state || "Haryana")}</select></label>
        <label class="field"><span>District</span><select name="district" data-geo="district" data-selected="${esc(editing?.district || "")}">${districtOptions(editing?.state || "Haryana", editing?.district)}</select></label></div>
      <div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${editing?.date || today()}" required></label>
        <label class="field"><span>Village / block</span><input name="village" value="${esc(editing?.village || "")}"></label></div>
      <div class="two"><label class="field"><span>Name</span><input name="name" value="${esc(editing?.name || "")}" required></label>
        <label class="field"><span>Funded by (programme or project)</span>
          <select name="projectId" id="benProj"><option value="">— none —</option>
            ${(() => {
              const myOffice = state.me?.officeId;
              const isHQ = !myOffice || atHeadquarters() || has("super_admin","founder");
              // Filter programmes
              const progs = (state.programmes||[]).filter(p=>!p.status||["live","active","running","Running","ongoing"].includes(p.status));
              // Get user's office state for fallback matching
              const myOfficeObj = (state.offices||[]).find(o=>o.id===myOffice);
              const myState = myOfficeObj?.state || state.me?.state;
              const progMatch = p => {
                if(!myOffice && !myState) return true;
                if(p.officeId) return p.officeId===myOffice||(p.offices||[]).includes(myOffice);
                // Fallback: match by state text
                if(myState && p.statesText) return p.statesText.toLowerCase().includes(myState.toLowerCase());
                return true; // no filtering possible
              };
              // Field staff see only their assigned programmes/projects, with office fallback
              const isFieldOnly = has("field_staff") || isVolunteerOnly();
              let filteredProgs;
              if(isFieldOnly) {
                filteredProgs = visibleProgrammes();
                if(filteredProgs.length === 0) filteredProgs = progs.filter(progMatch); // office fallback
              } else {
                filteredProgs = isHQ ? progs : progs.filter(progMatch);
              }
              // Filter projects
              const projs = (state.projects||[]).filter(isLiveProject);
              const projMatch = p => {
                if(!myOffice && !myState) return true;
                if(p.officeId) return p.officeId===myOffice;
                // Fallback: team membership
                if((p.team||[]).includes(state.user.uid)) return true;
                // Fallback: programme state match
                const progIds = p.programmeIds || (p.programmeId ? [p.programmeId] : []);
                return progIds.some(pid => {const prog=(state.programmes||[]).find(g=>g.id===pid); return prog && progMatch(prog);});
              };
              const filteredProjs = isFieldOnly ? visibleProjects() : (isHQ ? projs : projs.filter(projMatch));
              return [
                filteredProgs.length ? `<optgroup label="Programmes">${filteredProgs.map(p=>`<option value="prog:${p.id}" ${editing?.projectId==="prog:"+p.id?"selected":""}>${esc(p.code||p.name)}</option>`).join("")}</optgroup>` : "",
                filteredProjs.length ? `<optgroup label="Projects">${filteredProjs.map(p=>`<option value="${p.id}" ${editing?.projectId===p.id?"selected":""}>${esc(p.code||p.name)}</option>`).join("")}</optgroup>` : ""
              ].join("");
            })()}
          </select></label>
        <label class="field"><span>Which activity in the work plan?</span>
          <select name="activityId" id="benAct"><option value="">— choose the project first —</option></select>
          <span class="small muted">Only the activities of the project chosen above are listed.</span></label>
        <label class="field"><span>Which Sakhi? (type a name or village)</span>
          <input id="benFind" autocomplete="off" placeholder="Start typing — Sunita, Khijri, 99915…" value="${esc(editing?.personCode ? (editing.name || "") + " · " + editing.personCode : "")}">
          <input type="hidden" name="personCode" id="benCode" value="${esc(editing?.personCode || "")}">
          <div id="benHits" class="list hidden" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin-top:4px"></div>
          <span class="small muted" id="benPicked">${editing?.personCode ? "Linked to " + esc(editing.personCode) : "Leave blank and a case file will be opened for her."}</span></label></div>
      <div class="two"><label class="field"><span>Age</span><input type="number" step="any" inputmode="decimal" name="age" value="${editing?.age || ""}"></label>
        <label class="field"><span>Gender</span><select name="sex">${["Female", "Male", "Other"].map(x => `<option ${x === editing?.sex ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <div class="two"><label class="field"><span>Phone number</span><input name="phone" inputmode="tel" value="${esc(editing?.phone || "")}"></label>
        <label class="field"><span>Marital status</span><select name="marital">${["Married", "Divorced", "Single", "Other"].map(x => `<option ${x === editing?.marital ? "selected" : ""}>${x}</option>`).join("")}</select></label></div>
      <label class="field"><span>Present address</span><textarea name="address">${esc(editing?.address || "")}</textarea></label>
      <div class="two"><label class="field"><span>Type of benefit</span><select name="service">${BENEFIT_TYPES.map(x => `<option ${x === editing?.service ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="field"><span>Value ₹ (if any)</span><input type="number" step="any" inputmode="decimal" name="value" value="${editing?.value || ""}"></label></div>
      <label class="field"><span>Description</span><textarea name="description" required>${esc(editing?.description || "")}</textarea></label>
      <div class="two"></div>
      <label class="field"><span>Photo / document</span><input type="file" name="file" accept="image/*,.pdf"></label>
      <div style="display:flex;gap:8px"><button class="btn small" type="submit">${editing ? "Save changes" : "Register beneficiary"}</button>${editing ? `<button class="btn small quiet" type="button" id="bcancel">Cancel</button>` : ""}</div>
      <p class="small muted" style="margin-top:6px">Entries linked to a case also appear on that Sakhi's page; entries with a project count toward its activity targets.</p></form></div>` : ""}

    <div class="card"><h2>By type of benefit</h2>${Object.entries(byService).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const w = Math.round(v / Math.max(...Object.values(byService)) * 100);
      return `<div style="margin:5px 0"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${esc(k)}</span><b>${v}</b></div>
        <div style="height:7px;background:var(--bg);border-radius:4px"><div style="width:${w}%;height:100%;background:var(--green);border-radius:4px"></div></div></div>`; }).join("") || `<div class="empty">—</div>`}</div>`);
  const setF = (k, v) => { state.benFilter = { ...(state.benFilter || {}), [k]: v }; routes.beneficiaries(); };
  $("bq").onchange = e => setF("q", e.target.value); $("bsvc").onchange = e => setF("service", e.target.value);
  $("bdist").onchange = e => setF("district", e.target.value); $("bproj").onchange = e => setF("project", e.target.value);
  $("bperiod").onchange = e => setF("period", e.target.value);
  if ($("bfrom")) $("bfrom").onchange = e => setF("from", e.target.value);
  if ($("bto")) $("bto").onchange = e => setF("to", e.target.value);
  $("content").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { routes.beneficiaries(b.dataset.edit); setTimeout(() => $("benForm")?.scrollIntoView({ behavior: "smooth" }), 60); });
  $("content").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { if (!confirm("Delete this entry?")) return; await db.collection("benefits").doc(b.dataset.del).delete(); audit("delete", "benefits", b.dataset.del, ""); routes.beneficiaries(); });
  if ($("bcancel")) $("bcancel").onclick = () => routes.beneficiaries();
  /* Project first, then its own activities — so support is never filed against
     an activity belonging to another project. */
  const fillActs = () => {
    const sel = $("benAct"); if (!sel) return;
    const pid = $("benProj") ? $("benProj").value : "";
    const list = (state.activities || []).filter(a => !pid || a.projectId === pid);
    sel.innerHTML = `<option value="">${pid ? "— not tied to an activity —" : "— choose the project first —"}</option>`
      + list.map(a => `<option value="${a.id}" ${(editing?.activityId || state.reportFor?.activityId) === a.id ? "selected" : ""}>${esc(a.name || "")}${a.target ? ` (target ${a.target})` : ""}</option>`).join("");
  };
  if ($("benProj")) $("benProj").onchange = fillActs;
  if (state.reportFor && $("bf")) {
    const f = $("bf");
    if ($("benProj")) $("benProj").value = state.reportFor.projectId || "";
    if (f.elements.programmeId && state.reportFor.programmeId) f.elements.programmeId.value = state.reportFor.programmeId;
  }
  fillActs();
  if (state.reportFor && $("benAct")) { $("benAct").value = state.reportFor.activityId || ""; state.reportFor = null; }
  if ($("benFind")) {
    let pool = null, timer = null;
    const hits = $("benHits"), picked = $("benPicked");
    const load = async () => { if (pool) return pool;
      const snap = await db.collection("persons").limit(900).get().catch(() => ({ docs: [] }));
      pool = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(canOpenCase);
      return pool; };
    const search = async q => {
      const all = await load();
      const k = q.toLowerCase().replace(/\s+/g, " ").trim();
      if (k.length < 2) { hits.classList.add("hidden"); return; }
      const digits = k.replace(/\D/g, "");
      const found = all.filter(p => {
        const hay = `${p.name || ""} ${p.firstName || ""} ${p.lastName || ""} ${p.code || ""} ${p.block || ""} ${p.district || ""} ${p.guardian || ""}`.toLowerCase();
        return hay.includes(k) || (digits.length >= 4 && String(p.phone || "").includes(digits));
      }).slice(0, 25);
      hits.innerHTML = found.length ? found.map(p => `<div class="item" data-pick="${p.id}" style="cursor:pointer">
          <div class="grow"><div class="t">${esc(maskName(p.name, p.code))}${p.age ? " · " + p.age : ""}</div>
            <div class="s">${esc(p.code || "")}${p.block ? " · " + esc(p.block) : ""}${p.district ? " · " + esc(p.district) : ""}${p.phone ? " · " + esc(p.phone) : ""}</div></div></div>`).join("")
        : `<div class="item"><div class="s muted">Nobody found — leave it blank and a new case file will be opened.</div></div>`;
      hits.classList.remove("hidden");
      hits.querySelectorAll("[data-pick]").forEach(el => el.onclick = () => {
        const p = found.find(x => x.id === el.dataset.pick);
        $("benFind").value = `${p.name || ""} · ${p.code || ""}`;
        $("benCode").value = p.code || "";
        picked.textContent = `Her support will be added to ${p.code}${p.block ? " · " + p.block : ""}.`;
        // fill in what we already know about her, so it is not typed again
        const form = $("bf");
        const set = (n, v) => { const f = form.elements[n]; if (f && !f.value && v) f.value = v; };
        set("name", p.name); set("age", p.age); set("phone", p.phone);
        set("village", p.block); set("address", p.presentAddress);
        if (form.elements.sex && p.sex) form.elements.sex.value = p.sex;
        if (form.elements.district && p.district) form.elements.district.value = p.district;
        hits.classList.add("hidden");
      });
    };
    $("benFind").oninput = e => { clearTimeout(timer); const q = e.target.value;
      if (!q.trim()) { $("benCode").value = ""; picked.textContent = "Leave blank and a case file will be opened for her."; }
      timer = setTimeout(() => search(q), 220); };
    $("benFind").onfocus = () => { if ($("benFind").value.trim().length > 1) search($("benFind").value); };
  }
  if ($("bf")) $("bf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd); delete d.file;
    const file = fd.get("file"); if (file && file.size) { try { d.file = await uploadToDrive(file,"admin",file.name); } catch(e) { toast("File upload failed — " + e.message); return; } }
    d.age = d.age ? Number(d.age) : null; d.value = d.value ? Number(d.value) : null;
    /* Every beneficiary is a person with a case file. If the Sakhi ID is given we attach
       to it; if the name, village and phone match an existing file we attach to that;
       otherwise a new case file is opened, so support is never recorded against nobody. */
    let linked = null;
    if (d.personCode) {
      const m = await db.collection("persons").where("code", "==", String(d.personCode).trim()).limit(1).get().catch(() => null);
      if (m && !m.empty) { linked = { id: m.docs[0].id, ...m.docs[0].data() }; }
      else if (!confirm(`No case file has the ID ${d.personCode}.\n\nOpen a new case file for ${d.name}?`)) return;
    }
    if (!linked) {
      const same = await db.collection("persons").where("district", "==", d.district || "~").limit(400).get().catch(() => ({ docs: [] }));
      const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const phone = String(d.phone || "").replace(/\D/g, "").slice(-10);
      const hit = same.docs.map(x => ({ id: x.id, ...x.data() })).find(p =>
        key(p.name) === key(d.name) && (
          (phone && String(p.phone || "").replace(/\D/g, "").slice(-10) === phone) ||
          (d.village && key(p.block) === key(d.village))));
      if (hit) {
        if (confirm(`${d.name} already has a case file — ${hit.code}${hit.block ? " · " + hit.block : ""}.\n\nAdd this support to that file?`)) linked = hit;
      }
    }
    if (!linked && !editing) {
      const serial = await nextCode("EP-BEN");
      autoLogActivity(d.registeredOn && d.registeredOn < today() ? `Registered Sakhi ${d.name||"unnamed"} dated ${fmtD(d.registeredOn)} (entered today — backdated)` : `Registered a Sakhi: ${d.name||"unnamed"}`).catch(()=>{});
      const ref = await db.collection("persons").add({
        code: `EP-${(d.district || "XX").slice(0, 2).toUpperCase()}/BEN/${String(serial).split("-").pop()}-${new Date().getFullYear()}`,
        name: d.name, age: d.age || null, sex: d.sex || "Female", marital: d.marital || "", phone: d.phone || "",
        state: d.state || null, district: d.district || null, block: d.village || "", presentAddress: d.address || "",
        slaveryType: "", status: "open", openedFromBenefit: true, registeredOn: d.date || today(),
        registeredBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      linked = { id: ref.id };
      toast("A case file was opened for " + d.name);
    }
    if (linked) { d.personId = linked.id; d.personCode = linked.code || d.personCode || null; }
    try {
      if (editing) { await db.collection("benefits").doc(editing.id).update(d); audit("update", "benefits", editing.id, d.name); }
      else { const r = await db.collection("benefits").add({ officeId: state.me?.officeId || state.user?.officeId || null, ...d, funding: [{ projectId: d.projectId, amount: d.value || 0 }], recordedBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); audit("create", "benefits", r.id, d.name);
      const benLogText = d.date && d.date < today() ? `Recorded benefit for ${d.name||"a beneficiary"} dated ${fmtD(d.date)} (entered today — backdated)` : `Recorded a benefit for ${d.name||"a beneficiary"}${d.service?" · "+d.service:""}`;
      autoLogActivity(benLogText).catch(()=>{}); }
      successFlash("Saved"); window.scrollTo({top:0,behavior:"smooth"}); setTimeout(()=>routes.beneficiaries(), 600);
    } catch(e) { toast("Could not save — " + e.message); } };
  const cols = ["date", "name", "personCode", "age", "sex", "marital", "phone", "state", "district", "village", "address", "service", "description", "value", "projectId", "activityCode"];
  $("bexp").onclick = () => {
    const safeVal = (c, r) => { let v = c === "projectId" ? projectName(r[c]) : (r[c] ?? ""); if (!canSeeDetails && (c==="name"||c==="phone"||c==="address")) v=""; return `"${String(v).replace(/"/g,'""')}"`; };
    const csv = [cols.join(",")].concat(shown.map(r => cols.map(c => safeVal(c,r)).join(","))).join("\n");
    download(`beneficiary-list-${today()}.csv`, new Blob([csv], { type: "text/csv" })); };
  $("bxl").onclick = async () => { if (!window.XLSX) { toast("Building report…"); await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); }
    toast("Building report…");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shown.map(r => ({ Date: r.date, Name: canSeeDetails ? (r.name||"") : "", Case: r.personCode, Age: r.age, Gender: r.sex, Marital: r.marital, Phone: canSeeDetails ? (r.phone||"") : "",
      State: r.state, District: r.district, Village: r.village, Address: r.address, "Type of benefit": r.service, Description: r.description, Value: r.value, Project: projectName(r.projectId), Activity: r.activityCode, "Recorded by": r.recordedByName || userName(r.recordedBy) }))), "Beneficiary list");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(byService).map(([Type, Count]) => ({ Type, Count }))), "By type");
    XLSX.writeFile(wb, `beneficiary-list-${today()}.xlsx`); };
};

/* ================= INTERNAL REQUESTS: volunteers and requisitions ================= */
const DEPTS3 = {
  fac: { name: "Finance, Administration & Compliance", head: "Director ACF",
    units: ["Accounts", "Procurement & Logistics", "Administration & Communication", "Compliance"] },
  programmes: { name: "Programmes", head: "Program Officer",
    units: ["Sakhi Mandal", "Nari Nusrat", "Field Operations", "Bihar Programmes"] },
  pdri: { name: "Project Development, Research & Innovations", head: "Coordinator – Fundraising, Research & Innovation",
    units: ["Fundraising & Partnerships", "Research & Innovation", "Donor Relations", "Communications & Media", "Volunteers"] }
};
const isPDRI = () => has("super_admin", "fundraising");
const isFACdept = () => has("super_admin", "director_acf", "accountant", "admin", "procurement");




/* ================= CLAIM A POST (person → post, approved by the Founder) ================= */
routes.claimPost = async () => {
  setTitle("Claim a post");
  const posts = (await db.collection("posts").orderBy("department").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const mine = (await db.collection("postClaims").where("uid", "==", state.user.uid).orderBy("at", "desc").limit(5).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
  const held = posts.find(p => p.holderId === state.user.uid);
  html(`<div class="card"><h2>Posts, not people</h2><p class="small muted">Everything in the app hangs on the post, not the person: reporting lines, approval limits, who sees what. You claim the post you hold; the Founder & General Secretary approves the claim and the post becomes yours. When you leave it, the post stays and the next holder claims it.</p>
      ${held ? `<p><span class="tag ok">You currently hold: ${esc(held.title)}</span></p>`
        : standingOf(state.me) ? `<p><span class="tag">${esc(standingOf(state.me))}</span></p>` : ""}</div>
    <div class="card"><h2>Claim a post</h2><form id="cf">
      <label class="field"><span>Which post do you hold?</span><select name="postId" required>${posts.map(p => `<option value="${p.id}">${esc(p.title)} — ${p.holderId ? "held by " + esc(userName(p.holderId)) : p.holderName ? "listed: " + esc(p.holderName) : "Vacant post"}</option>`).join("")}</select></label>
      <label class="field"><span>From when</span><input type="date" name="from" value="${today()}"></label>
      <label class="field"><span>Anything the Founder should know</span><textarea name="note" placeholder="Taking over from someone, acting in the post, new appointment…"></textarea></label>
      <button class="btn small" type="submit">Send claim for approval</button></form></div>
    <div class="card"><h2>My claims</h2><div class="list">
      ${mine.map(c => `<div class="item"><div class="grow"><div class="t">${esc(c.postTitle)}</div><div class="s">${esc(c.at)}${c.note ? " · " + esc(c.note) : ""}${c.decidedNote ? " · " + esc(c.decidedNote) : ""}</div></div>
        <span class="tag ${c.status === "approved" ? "ok" : c.status === "declined" ? "bad" : "warn"}">${esc(c.status)}</span></div>`).join("") || `<div class="empty">No claims yet</div>`}</div></div>`);
  $("cf").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    const p = posts.find(x => x.id === d.postId);
    await db.collection("postClaims").add({ ...d, postTitle: p.title, uid: state.user.uid, name: state.me.name, status: "pending", at: today(), createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit("claim", "posts", d.postId, p.title); toast("Sent to the Founder & General Secretary"); routes.claimPost(); };
};
routes.postClaims = async () => {
  if (!has("super_admin")) return html(`<div class="card"><div class="empty">Only the Founder & General Secretary decides post claims.</div></div>`);
  setTitle("Post claims");
  const claims = (await db.collection("postClaims").where("status", "==", "pending").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const posts = (await db.collection("posts").get()).docs.map(d => ({ id: d.id, ...d.data() }));
  html(`<div class="card"><h2>People claiming a post (${claims.length})</h2>
    <p class="small muted">Approving a claim makes the post theirs, sets their reporting line from the post, and vacates the post for whoever held it before.</p><div class="list">
    ${claims.map(c => { const p = posts.find(x => x.id === c.postId) || {};
      return `<div class="item"><div class="grow"><div class="t">${esc(c.name)} → ${esc(c.postTitle)}</div>
        <div class="s">from ${esc(c.from || c.at)}${p.holderId ? ` · currently held by ${esc(userName(p.holderId))}` : p.holderName ? ` · listed as ${esc(p.holderName)}` : " · vacant"}${c.note ? ` · "${esc(c.note)}"` : ""}</div>
        <div class="s muted">${esc(p.department || "")}${p.reportsTo ? " · reports to " + esc(p.reportsTo) : ""}${p.limit ? " · approves up to ₹" + Number(p.limit).toLocaleString("en-IN") : ""}</div></div>
        <button class="btn small" data-ok="${c.id}">Approve</button><button class="btn small quiet" data-no="${c.id}">Decline</button></div>`; }).join("") || `<div class="empty">Nobody is waiting</div>`}</div></div>`);
  $("content").querySelectorAll("[data-ok]").forEach(b => b.onclick = async () => {
    const c = claims.find(x => x.id === b.dataset.ok); const p = posts.find(x => x.id === c.postId);
    const prev = p.holderId;
    if (prev && prev !== c.uid) await db.collection("users").doc(prev).update({ postId: null, postTitle: null }).catch(() => {});
    const mgrPost = posts.find(x => x.title === p.reportsTo);
    await db.collection("posts").doc(p.id).update({ holderId: c.uid, holderName: c.name,
      history: [...(p.history || []), { what: `${c.name} claimed the post`, by: state.me.name, from: c.from || today(), reason: c.note || "Post claim approved" }] });
    await db.collection("users").doc(c.uid).update({ postId: p.id, postTitle: p.title, department: p.department || null,
      managerIds: mgrPost?.holderId ? [mgrPost.holderId] : [] });
    await db.collection("postClaims").doc(c.id).update({ status: "approved", decidedBy: state.user.uid, decidedOn: today() });
    audit("approve_claim", "posts", p.id, `${c.name} → ${p.title}`); toast("Approved"); await loadMasters(); routes.postClaims(); });
  $("content").querySelectorAll("[data-form]").forEach(b => b.onclick = () => printRequisitionForm(all.find(x => x.id === b.dataset.form)));
  $("content").querySelectorAll("[data-no]").forEach(b => b.onclick = async () => { const why = prompt("Why is the claim declined?") || "";
    await db.collection("postClaims").doc(b.dataset.no).update({ status: "declined", decidedNote: why, decidedBy: state.user.uid }); routes.postClaims(); });
};

/* ---- One request screen: supplies, equipment, people ---- */
const REQ_ROUTE = {
  "Cash payment / disbursement": "Accounts",
  "Office supplies & stationery": "Administration & Communication",
  "Printing & IEC material": "Administration & Communication",
  "Office facilities & repairs": "Administration & Communication",
  "Travel & accommodation booking": "Administration & Communication",
  "Equipment (camera, mic, computer)": "Procurement",
  "Furniture": "Procurement",
  "Vehicle & transport": "Procurement",
  "Programme materials & kits": "Procurement",
  "A volunteer": "Project Development, Research & Innovations",
  "Other": "Procurement"
};
const WRITTEN_ORDER = 1000;   // FP §1: a written order is required at ₹1,000 and above
const isVolReq = r => r.category === "A volunteer";
/* A request must always reach a person, never only a department.
   Try the post that owns the work, then anyone holding that role, then the Director ACF. */
function fulfillerFor(goesTo) {
  const roleFor = { "Administration & Communication": ["admin", "admin_assistant", "procurement"],
    "Procurement": ["procurement", "admin", "admin_assistant"],
    "Project Development, Research & Innovations": ["fundraising"] }[goesTo] || ["admin", "procurement"];
  for (const r of roleFor) {
    const who = state.users.find(u => u.active && (u.roles || []).map(x => ROLE_ALIAS[x] || x).includes(r));
    if (who) return { id: who.id, name: who.name, why: r };
  }
  const fac = state.users.find(u => u.active && (u.roles || []).map(x => ROLE_ALIAS[x] || x).includes("director_acf"));
  return fac ? { id: fac.id, name: fac.name, why: "nobody holds that post — sent to the Director ACF" } : null;
}
/* Who the approver can hand the work to: their own team first, then the team that
   normally does this kind of work, so the choice is theirs rather than the app's. */
function handOnChoices(goesTo) {
  const line = lineUids();
  const roles = { "Administration & Communication": ["admin", "admin_assistant"], "Procurement": ["procurement"],
    "Project Development, Research & Innovations": ["fundraising"] }[goesTo] || [];
  const mine = state.users.filter(u => u.active && u.id !== state.user.uid && line.has(u.id));
  const team = state.users.filter(u => u.active && (u.roles || []).map(r => ROLE_ALIAS[r] || r).some(r => roles.includes(r)) && !mine.some(m => m.id === u.id));
  return { mine, team };
}
/* Ask the approver who will carry it out. Returns the chosen person, or null if they cancel. */
function askWhoWillDoIt(r, suggested) {
  return new Promise(resolve => {
    const { mine, team } = handOnChoices(r.goesTo);
    const opt = u => `<option value="${u.id}" ${suggested && u.id === suggested.id ? "selected" : ""}>${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`;
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>Who will carry this out?</h2>
      <p class="small muted">${esc(r.item || r.purpose || "")}${r.estimate ? " · about ₹" + Number(r.estimate).toLocaleString("en-IN") : ""}${r.neededBy ? " · needed by " + fmtD(r.neededBy) : ""}</p>
      <label class="field"><span>Give it to</span><select id="hoWho">
        ${mine.length ? `<optgroup label="My team">${mine.map(opt).join("")}</optgroup>` : ""}
        ${team.length ? `<optgroup label="${esc(r.goesTo || "The team that does this")}">${team.map(opt).join("")}</optgroup>` : ""}
        <option value="">— approve without giving it to anyone yet —</option></select></label>
      <label class="field"><span>Anything they should know</span><textarea id="hoNote" rows="2" placeholder="Book the same guest house as last time; confirm by Friday"></textarea></label>
      <label class="field"><span>Do it by</span><input type="date" id="hoDue" value="${r.neededBy || ""}"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn small quiet" id="hoCancel">Cancel</button>
        <button class="btn small" id="hoOk">Approve and assign</button></div></div>`;
    document.body.appendChild(box);
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#hoCancel").onclick = () => close(undefined);
    box.querySelector("#hoOk").onclick = () => { const id = box.querySelector("#hoWho").value;
      close({ id, note: box.querySelector("#hoNote").value, due: box.querySelector("#hoDue").value }); };
    box.onclick = e => { if (e.target === box) close(undefined); };
  });
}
/* Give the owner a task so it appears on their work screen, not only in a list. */
async function raiseFulfilTask(r, owner) {
  if (!owner) return;
  const who = state.users.find(u => u.id === owner.id) || {};
  await db.collection("assignments").add({
    title: (isVolReq(r) ? "Find a volunteer: " : "Arrange: ") + (r.item || ""),
    assigneeId: owner.id, assigneePostId: who.postId || null, assigneePostTitle: who.postTitle || null,
    assignerId: state.user.uid, assignerPostId: (state.me || {}).postId || null,
    due: r.neededBy || null, priority: r.urgent ? "1 – High" : "2 – Normal",
    instructions: `${r.purpose || ""}\nAsked for by ${userName(r.uid)}${r.estimate ? ` · about ₹${Number(r.estimate).toLocaleString("en-IN")}` : ""}`,
    fromRequisition: r.id, status: "assigned", createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(() => {});
}
routes.supportRequest = async () => {
  setTitle("Support requests");
  const uid = state.user.uid;
  const isACF = has("super_admin","director_acf","founder");
  const isMgr = isManager() || isACF;
  const snap = await db.collection("supportRequests").orderBy("createdAt","desc").limit(200).get().catch(()=>({docs:[]}));
  const all = snap.docs.map(d=>({id:d.id,...d.data()}));
  const myTeamUids = (state.users||[]).filter(u=>u.active&&((u.managerIds||[]).includes(uid)||u.managerId===uid)).map(u=>u.id||u.uid);

  // What each role sees
  const visible = all.filter(r => {
    if (has("super_admin","founder","director_acf")) return true;
    if (r.uid === uid) return true;                           // own requests
    if (isMgr && myTeamUids.includes(r.uid)) return true;    // team's requests
    return false;
  });

  // Pending for manager to approve
  const awaitingMe = isMgr && !isACF ? visible.filter(r=>r.status==="pending") : [];
  // Pending for Director ACF
  const awaitingACF = isACF ? all.filter(r=>r.status==="manager_approved") : [];

  const statusColor = s => s==="fulfilled"?"var(--green)":s==="declined"?"var(--bad)":s==="acf_approved"?"var(--blue)":"var(--muted)";
  const statusLabel = s => ({pending:"Awaiting manager",manager_approved:"Awaiting Director ACF",acf_approved:"Approved — to be fulfilled",fulfilled:"Fulfilled",declined:"Declined"})[s]||s;

  html(`<div class="card"><h2>Request support for a Sakhi</h2>
    <p class="small muted">Use this when a Sakhi or beneficiary needs support — medical, legal, travel, training or financial. The request goes to your line manager and then to the Director ACF for approval. When fulfilled, it is recorded as a service on her profile.</p>
    <form id="srf">
      <label class="field"><span>Sakhi / beneficiary</span>
        <input name="personSearch" id="srPersonSearch" placeholder="Type name or Sakhi ID…" autocomplete="off">
        <input type="hidden" name="personId" id="srPersonId">
        <input type="hidden" name="personName" id="srPersonName">
        <input type="hidden" name="personCode" id="srPersonCode">
        <div id="srSuggestions" style="position:absolute;z-index:10;background:var(--card);border:1px solid var(--line);border-radius:8px;max-height:200px;overflow-y:auto;width:280px;display:none"></div>
      </label>
      <div class="two">
        <label class="field"><span>Type of support</span>
          <select name="type" required>
            ${["Medical","Legal aid","Travel","Food & essentials","Training & skills","Financial assistance","Counselling","Other"].map(t=>`<option>${t}</option>`).join("")}
          </select></label>
        <label class="field"><span>Estimated amount ₹ (if any)</span>
          <input type="number" name="amount" inputmode="decimal" placeholder="Leave blank if not known"></label>
      </div>
      <label class="field"><span>What is needed and why</span>
        <textarea name="description" rows="3" required placeholder="Describe what support is needed and the reason…"></textarea></label>
      <div class="two">
        <label class="field"><span>Programme / Project</span>
          <select name="projectId">${programmeProjectOptions("")}</select></label>
        <label class="field"><span>Needed by</span>
          <input type="date" name="neededBy"></label>
      </div>
      <label class="check"><input type="checkbox" name="urgent"> Urgent</label>
      <button class="btn" type="submit">Submit request</button>
    </form></div>

    ${awaitingACF.length ? `<div class="card"><h2>Awaiting your approval (${awaitingACF.length})</h2>
      <div class="list">${awaitingACF.map(r=>`<div class="item" style="flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><div class="t">${esc(r.personName||"")} <span class="tag">${esc(r.personCode||"")}</span></div>
            <div class="s">${esc(r.type||"")} · ${esc(r.description||"").slice(0,80)}${(r.description||"").length>80?"…":""}</div>
            <div class="s">${r.amount?"₹"+Number(r.amount).toLocaleString("en-IN")+" · ":""}Requested by ${esc(userName(r.uid))} · ${fmtD(r.date)}</div></div>
          ${r.urgent?`<span class="tag bad">Urgent</span>`:""}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn small" data-srapprove="${r.id}">✓ Approve</button>
          <button class="btn small quiet bad" data-srdecline="${r.id}">Decline</button>
        </div></div>`).join("")}</div></div>` : ""}

    ${awaitingMe.length ? `<div class="card"><h2>Your team's requests awaiting you (${awaitingMe.length})</h2>
      <div class="list">${awaitingMe.map(r=>`<div class="item" style="flex-direction:column;gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><div class="t">${esc(r.personName||"")} <span class="tag">${esc(r.personCode||"")}</span></div>
            <div class="s">${esc(r.type||"")} · ${esc(r.description||"").slice(0,80)}${(r.description||"").length>80?"…":""}</div>
            <div class="s">${r.amount?"₹"+Number(r.amount).toLocaleString("en-IN")+" · ":""}Requested by ${esc(userName(r.uid))} · ${fmtD(r.date)}</div></div>
          ${r.urgent?`<span class="tag bad">Urgent</span>`:""}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn small" data-srmgrapprove="${r.id}">✓ Forward to Director ACF</button>
          <button class="btn small quiet bad" data-srdecline="${r.id}">Decline</button>
        </div></div>`).join("")}</div></div>` : ""}

    ${visible.length ? `<div class="card"><h2>All requests</h2>
      <div class="list">${visible.map(r=>`<div class="item">
        <div class="grow">
          <div class="t">${esc(r.personName||"")} <span class="tag">${esc(r.personCode||"")}</span></div>
          <div class="s">${esc(r.type||"")} · ${esc(r.description||"").slice(0,60)}${(r.description||"").length>60?"…":""}</div>
          <div class="s">${r.amount?"₹"+Number(r.amount).toLocaleString("en-IN")+" · ":""}${esc(userName(r.uid))} · ${fmtD(r.date)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span class="tag" style="color:${statusColor(r.status)}">${statusLabel(r.status)}</span>
          ${r.status==="acf_approved"&&isACF ? `<button class="btn small" data-srfulfil="${r.id}">Mark fulfilled</button>` : ""}
        </div></div>`).join("")}</div></div>` : ""}
  `);

  // Person search
  const srSearch = $("srPersonSearch");
  if (srSearch) {
    srSearch.oninput = async () => {
      const q = srSearch.value.trim().toLowerCase();
      const box = $("srSuggestions");
      if (q.length < 2) { box.style.display="none"; return; }
      const persons = (state.persons||[]).filter(p=>(p.name||"").toLowerCase().includes(q)||(p.code||"").toLowerCase().includes(q)).slice(0,8);
      if (!persons.length) { box.style.display="none"; return; }
      box.innerHTML = persons.map(p=>`<div style="padding:8px 12px;cursor:pointer;font-size:14px" data-pid="${p.id}" data-pname="${esc(p.name)}" data-pcode="${esc(p.code||"")}">${esc(p.name)} <span style="color:var(--muted);font-size:12px">${esc(p.code||"")}</span></div>`).join("");
      box.style.display="block";
      box.querySelectorAll("[data-pid]").forEach(el=>el.onclick=()=>{
        $("srPersonId").value=el.dataset.pid;
        $("srPersonName").value=el.dataset.pname;
        $("srPersonCode").value=el.dataset.pcode;
        srSearch.value=el.dataset.pname+(el.dataset.pcode?" ("+el.dataset.pcode+")":"");
        box.style.display="none";
      });
    };
    document.addEventListener("click", e=>{ if (!srSearch.contains(e.target)) $("srSuggestions").style.display="none"; }, {once:true});
  }

  // Submit new request
  if ($("srf")) $("srf").onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (!d.personId) { toast("Please select a Sakhi first"); return; }
    d.urgent = d.urgent === "on";
    d.amount = d.amount ? Number(d.amount) : null;
    delete d.personSearch;
    await db.collection("supportRequests").add({
      ...d, uid, status:"pending", date: today(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    audit("create","supportRequests",null,d.personName);
    autoLogActivity(`Raised support request for ${d.personName||"a Sakhi"} · ${d.type}`).catch(()=>{});
    toast("Request submitted ✓"); routes.supportRequest();
  };

  // Manager forwards to ACF
  $("content").querySelectorAll("[data-srmgrapprove]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    await db.collection("supportRequests").doc(b.dataset.srmgrapprove).update({status:"manager_approved",managerApprovedBy:uid,managerApprovedAt:today()});
    audit("approve","supportRequests",b.dataset.srmgrapprove,"manager");
    toast("Forwarded to Director ACF ✓"); routes.supportRequest();
  });

  // Director ACF approves
  $("content").querySelectorAll("[data-srapprove]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    await db.collection("supportRequests").doc(b.dataset.srapprove).update({status:"acf_approved",acfApprovedBy:uid,acfApprovedAt:today()});
    audit("approve","supportRequests",b.dataset.srapprove,"acf");
    toast("Approved ✓"); routes.supportRequest();
  });

  // Mark fulfilled — auto-creates benefit record
  $("content").querySelectorAll("[data-srfulfil]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    const reqId = b.dataset.srfulfil;
    const req = visible.find(r=>r.id===reqId);
    if (!req) return;
    // Create benefit record on the Sakhi's profile
    const benRef = await db.collection("benefits").add({
      personId: req.personId, personCode: req.personCode, name: req.personName,
      service: req.type, description: req.description,
      value: req.amount||null, date: today(),
      projectId: req.projectId||null, officeId: req.officeId||null,
      recordedBy: uid, source:"supportRequest", supportRequestId: reqId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection("supportRequests").doc(reqId).update({status:"fulfilled",fulfilledBy:uid,fulfilledAt:today(),benefitId:benRef.id});
    audit("fulfil","supportRequests",reqId,req.personName);
    toast("Fulfilled — benefit recorded on Sakhi's profile ✓"); routes.supportRequest();
  });

  // Decline (manager or ACF)
  $("content").querySelectorAll("[data-srdecline]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    await db.collection("supportRequests").doc(b.dataset.srdecline).update({status:"declined",declinedBy:uid,declinedAt:today()});
    audit("decline","supportRequests",b.dataset.srdecline,"");
    toast("Declined"); routes.supportRequest();
  });
};

routes.requisition = async (editId) => {
  setTitle("Requisitions");
  const snap = await db.collection("requisitions").orderBy("createdAt", "desc").limit(300).get().catch(() => ({ docs: [] }));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const f = state.reqFilter || "open";
  const isPDRI = () => has("super_admin", "fundraising");
  const isFulfiller = () => has("super_admin", "admin", "procurement");
  /* Approving belongs to the Director ACF, the Program Officer for programme matters,
     and the General Secretary. Administration carries out what it is given. */
  const canApprove = () => has("super_admin", "director_acf", "program_officer", "fundraising");
  const mineOrLine = r => r.ownerId === state.user.uid ? true
    : isVolunteerOnly() ? r.uid === state.user.uid
    : seesWholeOrg() || has("director_acf") || inMyLine(r)
    || (isFulfiller() && /Procurement|Administration/.test(r.goesTo || ""))
    || (has("admin_assistant") && /Procurement|Administration/.test(r.goesTo || "") && ofMyOffice(r))
    || (isPDRI() && isVolReq(r));
  const all2 = all.filter(mineOrLine);
  const rows = all2.filter(r => f === "all" || (f === "open" && !/Closed|Declined/.test(r.status || ""))
    || (f === "mine" && r.uid === state.user.uid) || (f === "volunteers" && isVolReq(r))
    || (f === "waiting" && /Awaiting/.test(r.status || "")) || (f === "tofill" && (r.status === "With the team" || r.ownerId === state.user.uid)));
  const editing = editId ? all.find(r => r.id === editId) : null;
  const inr = n => "₹" + Number(n || 0).toLocaleString("en-IN");
  const canAsk = !has("procurement","director_acf","admin_assistant") || !!editing;
  html(`<div class="grid">
      <div class="card stat"><span class="muted small">Open requests</span><b>${all2.filter(r => !/Closed|Declined/.test(r.status || "")).length}</b></div>
      <div class="card stat"><span class="muted small">With the department head</span><b>${all2.filter(r => r.status === "Awaiting department head").length}</b></div>
      <div class="card stat"><span class="muted small">With the Director ACF</span><b>${all2.filter(r => /Director ACF|General Secretary/.test(r.status || "")).length}</b></div>
      <div class="card stat"><span class="muted small">With the team to fulfil</span><b>${all2.filter(r => r.status === "With the team").length}</b></div>
      <div class="card stat"><span class="muted small">Nobody to action</span><b>${all2.filter(r => /With the team|Sourcing/.test(r.status || "") && !r.ownerId).length}</b></div>
      <div class="card stat"><span class="muted small">Volunteers asked for</span><b>${all2.filter(isVolReq).filter(r => !/Closed|Declined/.test(r.status || "")).length}</b></div>
      <div class="card stat"><span class="muted small">Value of open requests</span><b>${inr(all2.filter(r => !/Closed|Declined/.test(r.status || "")).reduce((a, r) => a + (Number(r.estimate) || 0), 0))}</b></div></div>

    <div class="card" id="reqForm"><h2>${editing ? "Edit the request" : "Ask for something"}</h2>
      <p class="small muted">Supplies, printing and facilities are fulfilled by Administration &amp; Communication; equipment, furniture, vehicles and programme materials by Procurement. Your department head verifies the request and the Director ACF approves it; above ₹50,000 the Founder &amp; General Secretary authorises the payment. Ask for a volunteer and it goes straight to Project Development, Research &amp; Innovations with no approval.</p>
      <form id="rf">
      <label class="field"><span>Who is it for?</span>
        <select name="forDept" id="rdept">
          ${["Administration — office, kitchen, facilities, printing",
             "Programmes — field work, training, materials for the women",
             "Accounts & compliance",
             "Project Development, Research & Innovations",
             "Governance"].map(x => `<option ${x === editing?.forDept ? "selected" : ""}>${x}</option>`).join("")}</select>
        <span class="small muted" id="whoVerifies"></span></label>
      <div class="two"><label class="field"><span>What do you need?</span><select name="category" id="rcat">${Object.keys(REQ_ROUTE).map(k => `<option ${k === editing?.category ? "selected" : ""}>${k}</option>`).join("")}</select></label>
        <label class="field"><span>Needed by</span><input type="date" name="neededBy" value="${editing?.neededBy || ""}"></label></div>
      <label class="field"><span id="itemLabel">Item</span><input name="item" value="${esc(editing?.item || "")}" required placeholder="A4 paper, tripod mic, laptop, teaching volunteer…"></label>
      <div id="cashPayFields" class="hidden two"><label class="field"><span>Pay to (name of person / vendor)</span><input name="payTo" value="${esc(editing?.payTo || "")}" placeholder="Name of person or organisation to be paid"></label>
        <label class="field"><span>Amount ₹</span><input type="number" step="any" inputmode="decimal" name="amount" value="${editing?.amount || ""}"></label></div>
      <div class="two"><label class="field"><span id="qtyLabel">How many</span><input type="number" step="any" inputmode="decimal" name="qty" value="${editing?.qty || 1}"></label>
        <label class="field" id="costField"><span>Estimated cost ₹</span><input type="number" step="any" inputmode="decimal" name="estimate" value="${editing?.estimate || ""}">
          <span class="small muted" id="quoteRule"></span></label></div>
      <div id="quoteBox" class="hidden">
        <label class="field"><span>Three written quotations (Policy §7.3)</span>
          <textarea name="quotes" rows="3" placeholder="Sharma Travels · ₹4,200 · quoted 14 Oct&#10;Gupta Tours · ₹4,800 · quoted 14 Oct&#10;Khan Cabs · ₹5,100 · quoted 15 Oct">${esc(editing?.quotes || "")}</textarea>
          <span class="small muted">Name, amount and date for each. Keep the papers for audit.</span></label>
        <label class="field"><span>Which one, and why</span>
          <input name="quoteChosen" value="${esc(editing?.quoteChosen || "")}" placeholder="Sharma Travels — lowest, and has carried our teams before"></label>
        <label class="field"><span>The quotations, photographed</span><input type="file" id="quoteFile" accept="image/*,.pdf"></label>
      </div>
      <div class="two"><label class="field"><span>Project</span><select name="projectId" id="rproj"><option value="">—</option>${activeProjects().map(p => `<option value="${p.id}" ${p.id === editing?.projectId ? "selected" : ""}>${esc(p.code || p.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Budget head it comes from</span><select name="headId" id="rhead"><option value="">— choose the project first —</option></select>
          <span class="small muted" id="rbal"></span></label></div>
      <div class="two"><label class="field"><span>Which activity, if it is for one</span><select name="activityId" id="ract"><option value="">—</option></select></label>
        <label class="field"><span id="whereLabel">Deliver to</span><select name="officeId">${state.offices.map(o => `<option value="${o.id}" ${o.id === editing?.officeId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label></div>
      <div id="volFields" class="hidden">
        <div class="two"><label class="field"><span>Skills or language needed</span><input name="skills" value="${esc(editing?.skills || "")}" placeholder="Assamese, teaching, photography"></label>
          <label class="field"><span>Days or hours a week</span><input name="days" value="${esc(editing?.days || "")}"></label></div>
        <div class="two"><label class="field"><span>Until</span><input type="date" name="till" value="${editing?.till || ""}"></label>
          <label class="field"><span>Who will supervise them</span><select name="supervisorId"><option value="">—</option>${state.users.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === editing?.supervisorId ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></label></div></div>
      <label class="field"><span>What it is for</span><textarea name="purpose" required>${esc(editing?.purpose || "")}</textarea></label>
      <label class="check"><input type="checkbox" name="urgent" ${editing?.urgent ? "checked" : ""}> Urgent</label>
      <div style="display:flex;gap:8px"><button class="btn small" type="submit">${editing ? "Save" : "Send request"}</button>${editing ? `<button class="btn small quiet" type="button" id="rcancel">Cancel</button>` : ""}</div>
      <p class="small muted" id="routeNote" style="margin-top:6px"></p></form></div>

    <div class="card"><h2>Requests</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${[
        ["open", "Open"],
        ["mine", "Mine"],
        ...(has("super_admin","director_acf","program_officer","admin","fundraising") || isManager() ? [["waiting", "Waiting for approval"]] : []),
        ...(isFulfiller()||has("admin_assistant") ? [["tofill", "To fulfil"]] : []),
        ...(isPDRI() ? [["volunteers", "Volunteers"]] : []),
        ...(isActive() ? [["travel", "Travel & journeys"]] : []),
        ...(has("super_admin","director_acf","admin","program_officer") ? [["all", "All"]] : []),
      ].map(([k, l]) => `<button class="btn small ${f === k ? "" : "quiet"}" data-f="${k}">${l}</button>`).join("")}</div>
      <div class="tablewrap"><table class="table"><tr><th>Raised</th><th>What</th><th>Qty</th><th>Kind</th><th>Est. ₹</th><th>Needed by</th><th>Asked by</th><th>Goes to</th><th>With whom</th><th>Status</th><th></th></tr>
      ${rows.map(r => `<tr><td>${r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString("en-IN") : ""}</td>
        <td><b>${esc(r.item)}</b>${r.urgent ? ' <span class="tag bad">urgent</span>' : ""}<div class="s">${esc(String(r.purpose || "").slice(0, 70))}</div>${r.volunteerName ? `<div class="s" style="color:var(--green)">placed: ${esc(r.volunteerName)}</div>` : ""}</td>
        <td>${r.qty || 1}</td><td>${esc(r.category || "")}</td><td>${r.estimate ? Number(r.estimate).toLocaleString("en-IN") : "—"}</td><td>${fmtD(r.neededBy)}</td>
        <td class="small">${esc(userName(r.uid))}<div class="s">${esc(r.byDept || "")}</div></td><td class="small">${esc(r.goesTo || "")}</td>
        <td class="small">${r.ownerName ? esc(r.ownerName) + (r.ownerNote && /nobody/.test(r.ownerNote) ? ` <span class="tag warn">no holder</span>` : "")
          : r.willGoTo ? `<span class="muted">will go to ${esc(r.willGoTo)}</span>`
          : (/With the team|Sourcing/.test(r.status || "") ? `<span class="tag bad">nobody</span>` : "—")}</td>
        <td>${statusTag(r.status)}</td>
        <td style="white-space:nowrap">
          ${/^with |to arrange|ordered|assigned/i.test(r.status || "")
            && (r.ownerId === state.user.uid || isProcurement() || isAdmin() || has("super_admin"))
            ? `<button class="btn small" data-acted="${r.id}">It is done — what I did</button> ` : ""}
          ${/^arranged/i.test(r.status || "") && r.uid === state.user.uid
            ? `<button class="btn small" data-got="${r.id}">Did you get it?</button> ` : ""}
          ${/^reported/i.test(r.status || "") && (r.headVerifiedBy === state.user.uid || canApprove())
            ? `<button class="btn small" data-close="${r.id}">Read it and close</button> ` : ""}
          ${r.status === "Awaiting department head" && canApprove() ? `<button class="btn small" data-ok="${r.id}">Verify</button> ` : ""}
          ${/awaiting director acf|verified — awaiting/i.test(r.status || "")
            && ((Number(r.estimate) || 0) > 50000 ? has("super_admin") : has("director_acf", "super_admin"))
            ? `<button class="btn small" data-fac="${r.id}">Approve and give it to someone</button> ` : ""}
          ${r.status === "With the team" && isVolReq(r) && isPDRI() ? `<button class="btn small" data-src="${r.id}">Sourcing</button> ` : ""}
          ${r.status === "Sourcing" && isPDRI() ? `<button class="btn small" data-place="${r.id}">Placed</button> ` : ""}
          ${r.status === "With the team" && !r.ownerId && (isFulfiller() || has("super_admin")) ? `<button class="btn small" data-claim="${r.id}">I will do it</button> ` : ""}
          ${r.status === "With the team" && !isVolReq(r) && isFulfiller() ? `<button class="btn small" data-ord="${r.id}">Ordered</button> ` : ""}
          ${r.status === "Ordered" && (isFulfiller() || r.uid === state.user.uid) ? `<button class="btn small" data-del="${r.id}">Delivered</button> ` : ""}
          ${/Delivered|Placed/.test(r.status || "") ? `<button class="btn small quiet" data-cls="${r.id}">Close</button> ` : ""}
          ${r.status === "With accountant" && fnAccounts() ? `<button class="btn small" data-pay="${r.id}">Pay</button> ` : ""}
          ${r.status === "Paid — awaiting acknowledgement" && r.uid === state.user.uid ? `<button class="btn small" data-ack="${r.id}">Acknowledge receipt</button> ` : ""}
          <button class="btn small quiet" data-form="${r.id}">Form</button>
          ${/Closed|Delivered|Placed/.test(r.status||"") ? `<button class="btn small quiet" data-dlf01="${r.id}">↓ F-01</button>` : ""}
          ${!/Closed|Declined/.test(r.status || "") && (canApprove() || r.uid === state.user.uid) ? `<button class="btn small quiet" data-no="${r.id}">Decline</button>` : ""}
        </td></tr>`).join("") || `<tr><td colspan="11" class="empty">Nothing here</td></tr>`}</table></div></div>`);
  const syncType = () => { const v = $("rcat").value, vol = v === "A volunteer";
    const cash = v === "Cash payment / disbursement";
    $("volFields").classList.toggle("hidden", !vol);
    $("costField").classList.toggle("hidden", vol || cash);
    if ($("cashPayFields")) $("cashPayFields").classList.toggle("hidden", !cash);
    $("itemLabel").textContent = vol ? "What should the volunteer do?" : cash ? "Purpose / what the payment is for" : "Item";
    $("qtyLabel").textContent = vol ? "How many volunteers" : "How many";
    $("whereLabel").textContent = vol ? "Where they will work" : "Deliver to";
    const _myPost = (state.posts||[]).find(p => p.holderId === (state.user&&state.user.uid));
    const _authority = Number(_myPost?.limit || (state.me&&state.me.spendLimit) || 0);
    $("routeNote").textContent = "This goes to: " + (REQ_ROUTE[v] || "Procurement") +
      (vol ? " — no approval needed first." : cash && _authority > 0 ? " · up to ₹" + _authority.toLocaleString("en-IN") + " goes straight to the accountant (your authority limit)." : ""); };
  // Fix route description for Accounts & Governance (Founder approves these)
if (!canAsk && !editing) { var _rf = $("reqForm"); if(_rf) _rf.style.display="none"; }
const _rdept = $("rdept"); const _rnote = $("routeNote");
if(_rdept && _rnote) {
  const _fixNote = () => {
    const d = _rdept.value||'';
    const _wv = $("whoVerifies");
    if(/^Accounts/.test(d) || /^Governance/.test(d)) {
      const _msg = "It goes to the Director ACF to verify, then to the Founder & General Secretary to approve.";
      _rnote.textContent = _msg; if(_wv) _wv.textContent = _msg;
    }
  };
  _rdept.addEventListener('change', _fixNote);
  _fixNote();
}
/* What the chosen head has left, so nobody asks for money that is not there. */
  (async () => {
    if (!$("rhead")) return;
    const heads = (await db.collection("budgetHeads").limit(500).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
    const exps = (await db.collection("expenses").limit(900).get().catch(() => ({ docs: [] }))).docs.map(d => d.data());
    const reqs = (await db.collection("requisitions").limit(300).get().catch(() => ({ docs: [] }))).docs.map(d => d.data());
    const fill = () => {
      const pid = $("rproj").value;
      const mine = heads.filter(h => h.projectId === pid);
      $("rhead").innerHTML = `<option value="">${pid ? "— none —" : "— choose the project first —"}</option>`
        + mine.map(h => `<option value="${h.id}" ${editing?.headId === h.id ? "selected" : ""}>${esc(h.code ? h.code + " · " : "")}${esc(h.line || "")}</option>`).join("");
      $("ract").innerHTML = `<option value="">—</option>`
        + (state.activities || []).filter(a => a.projectId === pid)
          .map(a => `<option value="${a.id}" ${editing?.activityId === a.id ? "selected" : ""}>${esc(a.name || "")}</option>`).join("");
      show();
    };
    const show = () => {
      const h = heads.find(x => x.id === $("rhead").value);
      if (!h) { $("rbal").textContent = ""; return; }
      const spent = exps.filter(e => e.headId === h.id || e.head === h.code).reduce((s, e) => s + (Number(e.amount) || 0), 0)
        || Number(h.spentReported) || 0;
      const committed = reqs.filter(r => r.headId === h.id && !/Closed|Declined|Rejected/i.test(r.status || ""))
        .reduce((s, r) => s + (Number(r.estimate) || 0), 0);
      const left = (Number(h.total) || 0) - spent - committed;
      const ask = Number(($("rf").elements.estimate || {}).value) || 0;
      $("rbal").innerHTML = `Allocated ${inr(h.total || 0)} · used ${inr(spent)}${committed ? ` · ${inr(committed)} already asked for` : ""}
        · <b style="color:${left < 0 ? "var(--bad)" : "inherit"}">${inr(left)} left</b>`
        + (ask > left ? `<br><b style="color:var(--bad)">This request is ${inr(ask - left)} more than the head has left.</b>` : "");
    };
    $("rproj").onchange = fill;
    $("rhead").onchange = show;
    if ($("rf").elements.estimate) $("rf").elements.estimate.oninput = show;
    fill();
  })();
  $("rcat").onchange = syncType; syncType();
  /* The policy asks for a written order above ₹1,000 and three quotations above
     ₹10,000. Saying so as the amount is typed is kinder than refusing it later. */
  const quoteRule = () => {
    const f = $("rf") || $("content").querySelector("form");
    const v = Number((f && f.elements.estimate ? f.elements.estimate.value : 0)) || 0;
    const box = $("quoteBox"), note = $("quoteRule");
    if (box) box.classList.toggle("hidden", v < 10000);
    if (note) note.textContent = v >= 10000
      ? "Above ₹10,000 — three written quotations are needed (Policy §7.3)."
      : v > 1000 ? "Above ₹1,000 — a written purchase order is needed (Policy §7.3)." : "";
  };
  const estF = ($("rf") || {}).elements && $("rf").elements.estimate;
  if (estF) { estF.oninput = quoteRule; quoteRule(); }
  /* Say plainly whose agreement it needs, before it is sent. */
  const deptHead = d => /^Administration/.test(d) ? "the Coordinator – Administration & Communication"
    : /^Programmes/.test(d) ? "the Program Officer"
    : /^Accounts/.test(d) ? "the Director ACF"
    : /^Governance/.test(d) ? "the Director ACF"
    : /^Project Development/.test(d) ? "the Coordinator – PDRI" : "the Founder & General Secretary";
  const sayWho = () => { const el = $("whoVerifies"); if (!el) return;
    el.textContent = `It goes to ${deptHead($("rdept").value)} to verify, then to the Director ACF to approve.`; };
  if ($("rdept")) { $("rdept").onchange = sayWho; sayWho(); }
  $("content").querySelectorAll("[data-dlf01]").forEach(b => b.onclick = async () => {
    const r = rows.find(x=>x.id===b.dataset.dlf01); if(!r) return;
    b.textContent="Generating…"; b.disabled=true;
    await downloadFilledForm("F-01","requisitions",r.id,{...r,byName:userName(r.uid),projectName:projectName(r.projectId),officeName:officeName(r.officeId)});
    b.textContent="↓ F-01"; b.disabled=false; });
  $("content").querySelectorAll("[data-f]").forEach(b => b.onclick = () => { state.reqFilter = b.dataset.f; routes.requisition(); });
  if (state.reqFilter === "travel") { _loadTravelTab(); }
  if (f === "travel") {
    const [trav, jours] = await Promise.all([
      db.collection("travelRequests").where("uid", "==", state.user.uid).orderBy("createdAt", "desc").limit(50).get().catch(() => ({docs:[]})),
      db.collection("journeys").where("travellerId", "==", state.user.uid).orderBy("createdAt", "desc").limit(50).get().catch(() => ({docs:[]}))
    ]);
    const travList = trav.docs.map(d => ({id: d.id, ...d.data()}));
    const jourList = jours.docs.map(d => ({id: d.id, ...d.data()}));
    const el = $("content");
    el.innerHTML += `<div class="card"><h2>Travel requests (${travList.length})</h2>
      <div class="list">${travList.map(r => `<div class="item"><div class="grow">
        <div class="t">${esc(r.purpose || "Travel request")}</div>
        <div class="s">${fmtD(r.date || r.from || "")} · ${esc(r.destination || "")} · ${esc(r.mode || "")}</div></div>
        <span class="tag ${r.status === "approved" ? "ok" : "warn"}">${esc(r.status || "submitted")}</span></div>`).join("") || "<div class=\"empty\">No travel requests yet</div>"}</div>
      <button class="btn small" style="margin-top:8px" onclick="go('itinerary')">New travel request ↗</button></div>
    <div class="card"><h2>My journeys (${jourList.length})</h2>
      <div class="list">${jourList.map(j => `<div class="item"><div class="grow">
        <div class="t">${esc(j.purpose || "Journey")}</div>
        <div class="s">${fmtD(j.date || "")} · ${esc(j.from || "")} → ${esc(j.to || "")} · ${esc(j.mode || "")}</div></div></div>`).join("") || "<div class=\"empty\">No journeys logged yet</div>"}</div>
      <button class="btn small" style="margin-top:8px" onclick="go('travelog')">Log a journey ↗</button></div>`;
  }
  if (state.reqFilter === "travel") {
    const [trav, jours] = await Promise.all([
      db.collection("travelRequests").where("uid", "==", state.user.uid).orderBy("createdAt", "desc").limit(50).get().catch(() => ({docs:[]})),
      db.collection("journeys").where("travellerId", "==", state.user.uid).orderBy("createdAt", "desc").limit(50).get().catch(() => ({docs:[]}))
    ]);
    const travList = trav.docs.map(d => ({id: d.id, ...d.data()}));
    const jourList = jours.docs.map(d => ({id: d.id, ...d.data()}));
    document.getElementById("content").insertAdjacentHTML("beforeend",
      `<div class="card"><h2>Travel requests (${travList.length})</h2>
        <div class="list">${travList.map(r => `<div class="item"><div class="grow">
          <div class="t">${esc(r.purpose || r.from || "Travel request")}</div>
          <div class="s">${fmtD(r.date || r.from)} · ${esc(r.destination || "")} · ${esc(r.mode || "")}</div></div>
          <span class="tag ${r.status === "approved" ? "ok" : "warn"}">${esc(r.status || "submitted")}</span></div>`).join("") || "<div class='empty'>No travel requests yet</div>"}</div>
        <button class="btn small" style="margin-top:8px" onclick="go('itinerary')">New travel request</button></div>
      <div class="card"><h2>My journeys (${jourList.length})</h2>
        <div class="list">${jourList.map(j => `<div class="item"><div class="grow">
          <div class="t">${esc(j.purpose || "Journey")}</div>
          <div class="s">${fmtD(j.date)} · ${esc(j.from || "")} → ${esc(j.to || "")} · ${esc(j.mode || "")}</div></div></div>`).join("") || "<div class='empty'>No journeys logged yet</div>"}</div>
        <button class="btn small" style="margin-top:8px" onclick="go('travelog')">Log a journey</button></div>`);
  }
  if ($("rcancel")) $("rcancel").onclick = () => routes.requisition();
  $("rf").onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target); const d = Object.fromEntries(fd);
    d.urgent = fd.get("urgent") === "on"; d.qty = Number(d.qty) || 1; d.estimate = d.estimate ? Number(d.estimate) : null;
    /* Policy §7.3 — a written order above ₹1,000, three written quotations above ₹10,000. */
    if ((d.estimate || 0) >= 10000 && !String(d.quotes || "").trim()
      && !confirm("Above ₹10,000 the policy asks for three written quotations (§7.3).\n\nSend it without them?")) return;
    d.needsQuotes = (d.estimate || 0) >= 10000;
    d.needsPurchaseOrder = (d.estimate || 0) > 1000;
    d.goesTo = REQ_ROUTE[d.category] || "Procurement";
    const isCashPay = d.category === "Cash payment / disbursement";
    if (isCashPay) { d.amount = Number(d.amount) || 0; d.estimate = d.amount; }
    // Cash payment within the requester's spend limit goes straight to the accountant
    if (isCashPay && d.amount > 0) {
      const _post = (state.posts||[]).find(p => p.holderId === state.user.uid);
      const _auth = Number(_post?.limit || state.me.spendLimit || 0);
      if (_auth > 0 && d.amount <= _auth) {
        const _acc = (state.users||[]).find(u => u.active && (u.roles||[]).includes("accountant"));
        d.status = "With accountant"; d.withinAuthority = true;
        d.ownerId = _acc?.id || null; d.ownerName = _acc?.name || "Accountant";
      } else {
        d.status = "Awaiting department head";
      }
    } else {
    // Volunteers go straight to Project Development, Research & Innovations.
    // Everything else: department head first, then the Director ACF.
    d.status = isVolReq(d) ? "With the team" : "Awaiting department head"; }
    d.byDept = state.me.department || ""; d.uid = editing ? editing.uid : state.user.uid;
    if (editing) await db.collection("requisitions").doc(editing.id).update(d);
    else {
      /* A department head verifies their own department's requests, so their own
         request needs no second verification — it goes straight to the Director ACF.
         Everyone else is verified by their head first. */
      const isHead = has("program_officer", "admin", "fundraising", "compliance_head", "program_coord");
      if (d.status === "Awaiting department head" && isHead && !has("super_admin", "director_acf")) {
        d.status = "Verified — awaiting Director ACF";
        d.headVerifiedBy = state.user.uid; d.headVerifiedAt = today();
        d.verifyNote = "Raised by a department head — verification is their own.";
      }
      /* Nobody approves their own spending. The Director ACF approves everyone else's,
         so his own request goes to the Founder & General Secretary, whatever the amount. */
      if (d.status === "Awaiting department head" && has("director_acf") && !has("super_admin")) {
        d.status = "Awaiting the General Secretary";
        d.headVerifiedBy = state.user.uid; d.headVerifiedAt = today();
        d.ownRequest = true;
        d.verifyNote = "Raised by the Director ACF — he cannot approve his own, so it goes to the General Secretary.";
      }
      if (d.status === "With the team") { const own = fulfillerFor(d.goesTo);
        if (own) { d.ownerId = own.id; d.ownerName = own.name; d.ownerNote = own.why; } else d.unclaimed = true; }
      const qf = $("quoteFile"); if (qf?.files?.[0]) { try { const up = await uploadToDrive(qf.files[0], "accounts", "Quotation — " + (d.item||"")); if (up) { d.quotes = (d.quotes||"") + "\nDrive: " + up.link; d.quoteDriveId = up.id; } } catch(e) { toast("Quote file not uploaded: " + e.message); } }
      const r = await db.collection("requisitions").add({ ...d, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      audit("create", "requisitions", r.id, d.item);
      if (d.ownerId) await raiseFulfilTask({ ...d, id: r.id }, { id: d.ownerId, name: d.ownerName });
    }
    toast(isVolReq(d) ? "Sent to Project Development, Research & Innovations" : (d.ownerName ? "Sent to " + d.ownerName : "Request sent")); routes.requisition(); };
  const upd = async (id, patch, label) => { await db.collection("requisitions").doc(id).update(patch); audit(label, "requisitions", id, patch.status || ""); routes.requisition(); };
  $("content").querySelectorAll("[data-ok]").forEach(b => b.onclick = async () => { const r = all.find(x => x.id === b.dataset.ok);
    const pick = await askWhoWillDoIt(r, fulfillerFor(r.goesTo));
    if (pick === undefined) return;
    const who = pick.id ? state.users.find(u => u.id === pick.id) : null;
    upd(r.id, { status: "Verified — awaiting Director ACF", headVerifiedBy: state.user.uid, headVerifiedAt: today(),
      suggestedId: who ? who.id : null, willGoTo: who ? who.name : null, handNote: pick.note || null }, "verify");
    toast(who ? "Verified — suggested to the Director ACF that " + who.name + " does it" : "Verified"); });
  $("content").querySelectorAll("[data-acted]").forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.acted);
    if (await recordActionTaken("requisitions", r)) routes.requisition(); });
  $("content").querySelectorAll("[data-got]").forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.got);
    if (await confirmAndReport("requisitions", r)) routes.requisition(); });
  $("content").querySelectorAll("[data-close]").forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.close);
    if (await closeTheMatter("requisitions", r)) routes.requisition(); });
  $("content").querySelectorAll("[data-fac]").forEach(b => b.onclick = async () => { const r = all.find(x => x.id === b.dataset.fac);
    const amt = Number(r.estimate) || 0;
    if (amt > 50000 && r.status !== "Awaiting General Secretary")
      return upd(r.id, { status: "Awaiting General Secretary", facApprovedBy: state.user.uid, facApprovedAt: today() }, "approve");
    const suggested = r.suggestedId ? state.users.find(u => u.id === r.suggestedId) : fulfillerFor(r.goesTo);
    const pick = await askWhoWillDoIt(r, suggested);
    if (pick === undefined) return;                       // they closed it; nothing changes
    const who = pick.id ? state.users.find(u => u.id === pick.id) : null;
    if (who) await raiseFulfilTask({ ...r, purpose: pick.note || r.purpose, neededBy: pick.due || r.neededBy }, { id: who.id, name: who.name });
    upd(r.id, { status: "With the team", facApprovedBy: state.user.uid, facApprovedAt: today(),
      ownerId: who ? who.id : null, ownerName: who ? who.name : null, ownerNote: who ? "chosen by " + state.me.name : null,
      handNote: pick.note || null, unclaimed: !who }, "approve");
    toast(who ? "Approved and given to " + who.name : "Approved — nobody assigned yet"); });
  $("content").querySelectorAll("[data-src]").forEach(b => b.onclick = () => upd(b.dataset.src, { status: "Sourcing", takenBy: state.user.uid }, "sourcing"));
  $("content").querySelectorAll("[data-place]").forEach(b => b.onclick = async () => { const r = all.find(x => x.id === b.dataset.place);
    const who = prompt("Volunteer's name:"); if (!who) return;
    await db.collection("volunteers").add({ name: who, projectId: r.projectId || null, officeId: r.officeId || null, supervisorId: r.supervisorId || null,
      since: today(), status: "Active", fromRequest: r.id, createdBy: state.user.uid }).catch(() => {});
    upd(r.id, { status: "Placed", volunteerName: who, placedOn: today() }, "place"); });
  $("content").querySelectorAll("[data-claim]").forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.claim);
    await raiseFulfilTask(r, { id: state.user.uid, name: state.me.name });
    upd(r.id, { ownerId: state.user.uid, ownerName: state.me.name, unclaimed: false }, "claim"); });
  $("content").querySelectorAll("[data-ord]").forEach(b => b.onclick = async () => { const note = prompt("Vendor and expected delivery (optional):") || "";
    upd(b.dataset.ord, { status: "Ordered", orderNote: note, orderedBy: state.user.uid, orderedOn: today() }, "order"); });
  $("content").querySelectorAll("[data-del]").forEach(b => b.onclick = () => upd(b.dataset.del, { status: "Delivered", deliveredOn: today() }, "deliver"));
  $("content").querySelectorAll("[data-cls]").forEach(b => b.onclick = () => upd(b.dataset.cls, { status: "Closed", closedOn: today() }, "close"));
  $("content").querySelectorAll("[data-form]").forEach(b => b.onclick = () => printRequisitionForm(all.find(x => x.id === b.dataset.form)));
  $("content").querySelectorAll("[data-no]").forEach(b => b.onclick = async () => { const why = prompt("Why is it declined?") || "";
    upd(b.dataset.no, { status: "Declined", declineNote: why, declinedBy: state.user.uid }, "decline"); });
  // Cash payment: accountant records payment → generates F-04
  $("content").querySelectorAll("[data-pay]").forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.pay); if (!r) return;
    const p = await askPaymentRef({ ...r, particulars: (r.item||r.purpose||"") + (r.payTo ? " · " + r.payTo : ""), amount: Number(r.amount||r.estimate||0), valueDate: today() });
    if (!p) return;
    await db.collection("requisitions").doc(r.id).update({ status: "Paid — awaiting acknowledgement",
      paidOn: p.valueDate||today(), paidBy: state.user.uid, paidByName: state.me.name, paymentRef: p });
    try { await downloadFilledForm("F-04","requisitions",r.id,{ ...r, ...p,
      particulars: (r.item||r.purpose||"") + (r.payTo ? " · to " + r.payTo : ""),
      payee: r.payTo||"", voucher: p.ref||"", date: p.valueDate||today(),
      preparedBy: state.user.uid, approvedBy: r.facApprovedBy||r.headVerifiedBy||state.user.uid,
      byName: userName(r.uid), projectName: projectName(r.projectId) }); } catch(e) { console.warn("F-04", e); }
    audit("pay","requisitions",r.id,`₹${r.amount||r.estimate||0} · ${r.payTo||""}`);
    successFlash("Payment recorded"); routes.requisition();
  });
  // Cash payment: requester acknowledges receipt — circle closed
  $("content").querySelectorAll("[data-ack]").forEach(b => b.onclick = async () => {
    const r = all.find(x => x.id === b.dataset.ack); if (!r) return;
    const amt = Number(r.amount||r.estimate||0).toLocaleString("en-IN");
    if (!confirm("Confirm you have received ₹" + amt + " for: " + (r.item||r.purpose||""))) return;
    await db.collection("requisitions").doc(r.id).update({ status: "Closed",
      acknowledgedBy: state.user.uid, acknowledgedOn: today(), closedOn: today() });
    audit("acknowledge","requisitions",r.id,userName(r.uid));
    successFlash("Acknowledged\nCircle closed ✓"); routes.requisition();
  });
};


/* ---- Leave register (Administration, HR & Communication) ---- */
/* ═══════════════════ MY SALARY SLIP ═══════════════════
   Each staff member sees their own slip for the month,
   acknowledges it, and it becomes a salary requisition. */
routes.mySlip = async () => {
  setTitle("My salary slip");
  const m = (state.slipMonth || today().slice(0,7));
  const uid2 = viewUid();

  // Load this person's generated slip from salarySheets
  const snap = await db.collection("salarySheets")
    .where("month","==",m).where("staffId","==",uid2).limit(1).get();

  if (snap.empty) {
    html(`<div class="card"><h2>My salary slip</h2>
      <div class="two"><label class="field"><span>Month</span>
        <input type="month" id="slipMon" value="${m}"></div>
      <div class="empty" style="margin-top:16px">No salary slip has been generated for ${m} yet. Accounts will generate slips on the 3rd of each month.</div></div>`);
    $("slipMon").onchange = e => { state.slipMonth = e.target.value; routes.mySlip(); };
    return;
  }

  const slip = { id: snap.docs[0].id, ...snap.docs[0].data() };
  const monthLabel = new Date(m+"-15").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const pct = slip.totalDays ? Math.round(slip.payableDays/slip.totalDays*100) : 100;
  const ackd = slip.status === "acknowledged" || slip.status === "paid";

  html(`<div class="card"><h2>My salary slip</h2>
    <div class="two"><label class="field"><span>Month</span>
      <input type="month" id="slipMon" value="${m}"></label></div>
    <div class="card" style="margin-top:0;background:var(--surface2)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b>${esc(slip.staffName)}</b><br><span class="small muted">${esc(slip.postTitle||"")}</span></div>
        <div style="text-align:right"><span class="small muted">Month</span><br><b>${esc(monthLabel)}</b></div>
      </div>
      <table class="table" style="margin-top:12px">
        <tr><th colspan="2">Earnings</th></tr>
        <tr><td>Basic salary</td><td style="text-align:right">₹${(slip.basic||0).toLocaleString("en-IN")}</td></tr>
        <tr><td>Special allowance</td><td style="text-align:right">₹${(slip.special||0).toLocaleString("en-IN")}</td></tr>
        <tr><td>Conveyance allowance</td><td style="text-align:right">₹${(slip.conveyance||0).toLocaleString("en-IN")}</td></tr>
        <tr style="font-weight:bold"><td>Gross salary</td><td style="text-align:right">₹${(slip.gross||0).toLocaleString("en-IN")}</td></tr>
        <tr><th colspan="2">Attendance</th></tr>
        <tr><td>Total days in month</td><td style="text-align:right">${slip.totalDays}</td></tr>
        <tr><td>Leave without pay</td><td style="text-align:right">${slip.lwpDays||0}</td></tr>
        <tr><td>Payable days</td><td style="text-align:right">${slip.payableDays} (${pct}%)</td></tr>
        <tr style="font-weight:bold;font-size:1.1em"><td>Net payable</td>
          <td style="text-align:right;color:var(--ok)">₹${(slip.earned||0).toLocaleString("en-IN")}</td></tr>
      </table>
      ${slip.lwpDays ? `<p class="small muted" style="margin-top:8px">₹${((slip.gross-slip.earned)||0).toLocaleString("en-IN")} deducted for ${slip.lwpDays} LWP day(s).</p>` : ""}
    </div>
    ${ackd
      ? `<div class="tag ok" style="margin-top:8px">✓ Acknowledged${slip.acknowledgedAt ? " on " + fmtD(slip.acknowledgedAt) : ""} — salary requisition submitted</div>`
      : `<div style="margin-top:12px">
          <p class="small muted">By acknowledging, you confirm receipt of ₹${(slip.earned||0).toLocaleString("en-IN")} for ${esc(monthLabel)} and authorise a salary payment requisition on your behalf.</p>
          <button class="btn" id="ackSlip">I acknowledge — submit for payment</button>
        </div>`}
    <button class="btn small quiet" id="printSlip" style="margin-top:8px">Print slip</button>
  </div>`);

  $("slipMon").onchange = e => { state.slipMonth = e.target.value; routes.mySlip(); };

  if ($("ackSlip")) $("ackSlip").onclick = async () => {
    $("ackSlip").disabled = true; $("ackSlip").textContent = "Submitting…";
    await db.collection("salarySheets").doc(slip.id).update({
      status: "acknowledged", acknowledgedAt: today(), acknowledgedByUid: uid2,
    });
    // Create salary requisition in advances collection so it goes through payment flow
    await db.collection("advances").add({
      uid: uid2, byName: slip.staffName, byPerson: uid2,
      purpose: `Salary for ${monthLabel}`, amount: slip.earned,
      month: m, type: "salary", salarySheetId: slip.id,
      status: "submitted",
      managerIds: (state.users||[]).find(u=>u.id===uid2)?.managerIds || [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("Acknowledged — salary requisition submitted ✓");
    routes.mySlip();
  };

  if ($("printSlip")) $("printSlip").onclick = () => {
    openForm("Salary Slip", `${formHead("SALARY SLIP — " + monthLabel.toUpperCase(), "F-10")}
      <div class="meta">
        <div><b>Name:</b> ${esc(slip.staffName)}</div>
        <div><b>Post:</b> ${esc(slip.postTitle||"")}</div>
        <div><b>Month:</b> ${esc(monthLabel)}</div>
        <div><b>Staff No.:</b> ${esc(slip.staffNo||"—")}</div>
      </div>
      <table class="t">
        <tr><th>Particulars</th><th class="n">Amount ₹</th></tr>
        <tr><td>Basic Salary</td><td class="n">${(slip.basic||0).toLocaleString("en-IN")}</td></tr>
        <tr><td>Special Allowance</td><td class="n">${(slip.special||0).toLocaleString("en-IN")}</td></tr>
        <tr><td>Conveyance Allowance</td><td class="n">${(slip.conveyance||0).toLocaleString("en-IN")}</td></tr>
        <tr class="tot"><td>Gross Salary</td><td class="n">${(slip.gross||0).toLocaleString("en-IN")}</td></tr>
        <tr><td>Total days in month</td><td class="n">${slip.totalDays}</td></tr>
        <tr><td>Leave Without Pay (LWP)</td><td class="n">${slip.lwpDays||0}</td></tr>
        <tr><td>Payable days</td><td class="n">${slip.payableDays}</td></tr>
        <tr class="tot"><td><b>Net Payable</b></td><td class="n"><b>₹${(slip.earned||0).toLocaleString("en-IN")}</b></td></tr>
      </table>
      <p class="words"><b>Amount in words:</b> ${esc(inWords(slip.earned||0))}</p>
      <div style="margin-top:24px;display:flex;justify-content:space-between">
        <div>Employee signature<br><br><br>___________________<br>${esc(slip.staffName)}</div>
        <div>Authorised by<br><br><br>___________________<br>Director ACF</div>
      </div>`);
  };
};

/* ═══════════════════ SALARY SLIPS — ACCOUNTS ═══════════════════
   Bhumish or Jitendra generates slips on the 3rd; tracks status. */
routes.salarySlips = async () => {
  if (!isAccounts()) {
    // Staff see their own slips
    setTitle("My salary slips");
    const mySlips = (await db.collection("salarySheets")
      .where("staffId","==",viewUid()).get()
      .catch(()=>({docs:[]}))).docs
      .map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>String(b.month||"").localeCompare(String(a.month||"")));
    if (!mySlips.length) return html(`<div class="card"><div class="empty">No salary slips yet — they are generated by Accounts on the 3rd of each month.</div></div>`);
    const fmtM = m => { try { return new Date(m+"-15").toLocaleDateString("en-IN",{month:"long",year:"numeric"}); } catch { return m; } };
    html(`<div class="card"><h2>My salary slips</h2>
      <div class="list">${mySlips.map(sl=>`<div class="item">
        <div class="grow">
          <div class="t" style="font-weight:600">${esc(fmtM(sl.month))}</div>
          <div class="s">Basic ₹${(sl.basic||0).toLocaleString("en-IN")} · Special ₹${(sl.special||0).toLocaleString("en-IN")} · Conveyance ₹${(sl.conveyance||0).toLocaleString("en-IN")}</div>
          <div class="s">Gross ₹${(sl.gross||0).toLocaleString("en-IN")} · ${sl.lwpDays?`LWP ${sl.lwpDays} day(s) · `:""}Payable days ${sl.payableDays||sl.totalDays}</div>
          <div class="t" style="color:var(--green);margin-top:4px">Net payable ₹${(sl.earned||0).toLocaleString("en-IN")}</div>
          ${sl.acknowledgedAt?`<div class="s muted">Acknowledged on ${fmtD(sl.acknowledgedAt)}</div>`:""}
        </div>
        <div style="flex-shrink:0;text-align:right">
          ${sl.status==="acknowledged"||sl.status==="paid"
            ? `<span class="tag ok">Acknowledged ✓</span>`
            : `<button class="btn small" data-ack="${sl.id}">Acknowledge</button>`}
        </div>
      </div>`).join("")}
      </div></div>`);
    $("content").querySelectorAll("[data-ack]").forEach(btn => btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "…";
      try {
        await db.collection("salarySheets").doc(btn.dataset.ack).update({
          status:"acknowledged", acknowledgedAt:today(), acknowledgedBy:viewUid()
        });
        toast("Acknowledged ✓");
        routes.salarySlips();
      } catch(e) { btn.disabled=false; btn.textContent="Acknowledge"; toast("Error: "+e.message); }
    });
    return;
  }
  setTitle("Salary slips");
  const day = parseInt(today().slice(8,10));
  const defaultMonth = (() => { const d = new Date(); if(d.getDate()<25){d.setDate(1);d.setMonth(d.getMonth()-1);} return d.toISOString().slice(0,7); })();
  const m = (state.slipMonth || defaultMonth);
  const monthLabel = new Date(m+"-15").toLocaleDateString("en-IN",{month:"long",year:"numeric"});
  const canGenerate = m < today().slice(0,7) || day >= 25;

  // Load existing slips for the month
  const slipSnap = await db.collection("salarySheets").where("month","==",m).get();
  const existing = {}; slipSnap.docs.forEach(d => { existing[d.data().staffId] = { id: d.id, ...d.data() }; });

  // Load salary structures
  const structs = (await db.collection("salaryStructures").get()).docs.map(d=>d.data());
  const staffWithSalary = staffList().filter(u => structs.some(s => s.staffId === u.id));

  // Working days = Mon–Sat in the month
  const totalDays = (() => { const yr=+m.slice(0,4),mo=+m.slice(5,7),last=new Date(yr,mo,0).getDate(); let c=0; for(let d=1;d<=last;d++) if(new Date(yr,mo-1,d).getDay()!==0)c++; return c; })();

  const statusTag = s => {
    if (!s) return `<span class="tag muted">Not generated</span>`;
    if (s.status === "paid") return `<span class="tag ok">Paid ✓</span>`;
    if (s.status === "acknowledged") return `<span class="tag ok">Acknowledged ✓</span>${has("accountant") ? ` <button class="btn small" data-markpaid="${s.id}">Mark paid</button>` : ""}`;
    return `<span class="tag warn">Generated — awaiting staff</span>`;
  };

  html(`<div class="card"><h2>Salary slips</h2>
    <div class="two"><label class="field"><span>Month</span>
      <input type="month" id="slipMon" value="${m}"></label></div>
    <p class="small muted">Slips are generated on the 3rd of each month after monthly reports are verified. Staff acknowledge their slip and a salary requisition is created automatically.</p>
    ${!canGenerate ? `<div class="tag warn" style="margin-bottom:12px">Available from the 25th of the month</div>` : ""}
    <button class="btn" id="genSlips" ${canGenerate?"":"disabled"}>Generate slips for ${esc(monthLabel)}</button>
    <span style="margin-left:8px;font-size:.85em;color:var(--muted)">${slipSnap.size} slip(s) generated so far</span>
    </div>
  <div class="card"><h2>Status — ${esc(monthLabel)}</h2>
    <div class="tablewrap"><table class="table">
      <tr><th>Name</th><th>Post</th><th>Gross ₹</th><th>Present</th><th>Leave</th><th>LWP</th><th>Deduction ₹</th><th>Net ₹</th><th>Status</th></tr>
      ${staffWithSalary.map(u => {
        const sl = existing[u.id];
        const st = structs.find(s=>s.staffId===u.id);
        return `<tr>
          <td>${esc(u.name)}</td>
          <td class="small">${esc(u.postTitle||"")}</td>
          <td>${sl ? (sl.gross||0).toLocaleString("en-IN") : (st?st.total||0:0).toLocaleString("en-IN")}</td>
          <td style="text-align:center">${sl ? (sl.presentDays??"-") : "—"}</td>
          <td style="text-align:center">${sl ? (sl.leaveDays||0) : "—"}</td>
          <td style="text-align:center;color:${sl?.lwpDays?'var(--red)':'inherit'}">${sl ? (sl.lwpDays||0) : "—"}</td>
          <td style="text-align:right;color:var(--red)">${sl?.lwpDeduction ? `−₹${sl.lwpDeduction.toLocaleString("en-IN")}` : "—"}</td>
          <td>${sl ? `<b>₹${(sl.earned||0).toLocaleString("en-IN")}</b>` : "—"}</td>
          <td>${statusTag(sl)}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="9" class="empty">No salary structures set up yet</td></tr>`}
    </table></div>
    <button class="btn small quiet" style="margin-top:8px" id="dlAll">Download all as Excel</button>
  </div>`);

  $("slipMon").onchange = e => { state.slipMonth = e.target.value; routes.salarySlips(); };

  // Mark as paid handler
  $("content").querySelectorAll("[data-markpaid]").forEach(btn => btn.onclick = async () => {
    if (!confirm("Mark this salary as paid?")) return;
    btn.disabled = true; btn.textContent = "…";
    try {
      await db.collection("salarySheets").doc(btn.dataset.markpaid).update({
        status: "paid", paidAt: today(), paidBy: viewUid()
      });
      toast("Marked as paid ✓");
      routes.salarySlips();
    } catch(e) { btn.disabled = false; btn.textContent = "Mark paid"; toast("Error: " + e.message); }
  });

  $("dlAll").onclick = async () => {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const rows = staffWithSalary.map(u => {
      const sl = existing[u.id];
      const st = structs.find(s=>s.staffId===u.id);
      return {
        "Name": u.name, "Post": u.postTitle||"",
        "Basic ₹": sl?.basic||st?.basic||0, "Special ₹": sl?.special||st?.special||0,
        "Conveyance ₹": sl?.conveyance||st?.conveyance||0,
        "Gross ₹": sl?.gross||st?.total||0, "Total Days": sl?.totalDays||totalDays,
        "LWP Days": sl?.lwpDays||0, "Payable Days": sl?.payableDays||totalDays,
        "Net Payable ₹": sl?.earned||0, "Status": sl?.status||"not generated",
        "Acknowledged": sl?.acknowledgedAt||"",
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `Salary ${m}`);
    XLSX.writeFile(wb, `salary-slips-${m}.xlsx`);
  };

  if ($("genSlips")) $("genSlips").onclick = async () => {
    if (!confirm(`Generate salary slips for all ${staffWithSalary.length} staff for ${monthLabel}? Existing slips will be updated.`)) return;
    $("genSlips").disabled = true; $("genSlips").textContent = "Generating…";

    // Load attendance check-ins and all approved leave for this month
    const mStart = m+"-01", mEnd = m+"-31";
    const [attSnap, lvSnap] = await Promise.all([
      db.collection("attendance").where("date",">=",mStart).where("date","<=",mEnd).get(),
      db.collection("leaveRequests").where("status","==","approved").get()
    ]);

    // Present days per staff (from check-ins)
    const presentByStaff = {};
    attSnap.docs.forEach(d => { const uid=d.data().uid; if(uid) presentByStaff[uid]=(presentByStaff[uid]||0)+1; });

    // Approved leave days per staff that fall in this month (Mon-Sat only)
    const leaveByStaff = {};
    const [mYr,mMo] = [+m.slice(0,4), +m.slice(5,7)];
    const mS = new Date(mYr,mMo-1,1), mE = new Date(mYr,mMo,0);
    lvSnap.docs.forEach(d => {
      const r = d.data(); if(!r.uid||!r.from||!r.to) return;
      const ls=new Date(r.from), le=new Date(r.to);
      const start=ls<mS?mS:ls, end=le>mE?mE:le;
      if(start>end) return;
      let days=0; const cur=new Date(start);
      while(cur<=end){if(cur.getDay()!==0)days++;cur.setDate(cur.getDate()+1);}
      leaveByStaff[r.uid]=(leaveByStaff[r.uid]||0)+days;
    });

    const batch = db.batch();
    for (const u of staffWithSalary) {
      const st = structs.find(s => s.staffId === u.id);
      if (!st) continue;
      const gross = (st.basic||0) + (st.special||0) + (st.conveyance||0);
      const presentDays = presentByStaff[u.id] || 0;
      const leaveDays = leaveByStaff[u.id] || 0;
      const lwpDays = Math.max(0, totalDays - presentDays - leaveDays);
      const payableDays = totalDays - lwpDays;
      const perDay = gross / totalDays;
      const lwpDeduction = Math.round(perDay * lwpDays);
      const earned = gross - lwpDeduction;
      const slipData = {
        month: m, staffId: u.id, staffName: u.name,
        postTitle: u.postTitle||"", staffNo: u.staffNo||"",
        basic: st.basic||0, special: st.special||0, conveyance: st.conveyance||0,
        gross, totalDays, presentDays, leaveDays, lwpDays, lwpDeduction, payableDays, earned,
        generatedAt: today(), generatedBy: viewUid(),
        status: existing[u.id]?.status === "acknowledged" ? "acknowledged" : "generated",
        acknowledgedAt: existing[u.id]?.acknowledgedAt || null,
      };
      if (existing[u.id]) {
        batch.update(db.collection("salarySheets").doc(existing[u.id].id), slipData);
      } else {
        batch.set(db.collection("salarySheets").doc(), slipData);
      }
    }
    await batch.commit();
    toast(`Salary slips generated for ${staffWithSalary.length} staff ✓`);
    routes.salarySlips();
  };
};

routes.manual = async () => {
  setTitle("My guide to this app");
  const roles = state.me?.roles || [];
  const role = (() => {
    if(has("super_admin","founder")) return "admin";
    if(has("director_acf")) return "director";
    if(has("accountant")) return "accountant";
    if(has("fundraising","cpo")) return "fundraising";
    if(has("program_officer","program_coord")) return "programme_officer";
    if(has("program_lead","field_staff")) return "field";
    if(has("admin_assistant","admin")) return "admin_assistant";
    if(has("procurement")) return "procurement";
    if(has("board")) return "board";
    if(has("counsellor")) return "counsellor";
    return "general";
  })();

  const sections = {
    admin: [
      ["Home", "Shows Employee of the Month, your karma score, and unresolved app errors. The error widget shows any problems staff are hitting — resolve them once addressed."],
      ["Approvals & verification", "Expense claims above ₹50,000 need your authorisation after Director ACF. Requisitions above ₹50,000 come to you after Director ACF. Items waiting for someone else are shown as labels — no action needed from you."],
      ["Staff records", "Full profiles for all 28 staff — reporting lines, leave history, documents, tasks, karma. Leave status shows on each profile header."],
      ["Karma & Employee of Month", "You declare the EOM when you open the home screen — your view of all staff karma is used as the universal result. Others see your result."],
      ["Calendar", "Full org calendar — everyone\'s leaves, all holidays and observances, tasks, activities, donor reports, compliance filings."],
      ["Accounts nav", "Entry desk → Monthly account → Payments → Staff advances → Salary → Fund Tracker → Fund position → Receipts → Expenses → Unallocated → Budget heads → Financial trail."],
    ],
    director: [
      ["Approvals & verification", "Cash box entries, expense claims, advances, and requisitions route to you. No-bill petty cash always comes here first. Above ₹50,000 goes to GS after you approve."],
      ["Team reports", "Verify your team\'s day reports here — not in Approvals. Day reports auto-fill from app activity."],
      ["Staff advances", "Issue new advances, mark paid, settle with bills. Full voucher trail on each advance."],
      ["Leave register", "Full year view of all staff leave taken vs entitlement."],
      ["Who is where today", "See who is in, on leave, or WFH each day."],
    ],
    accountant: [
      ["Cash box", "Your primary screen. See your ledger of advances received and expenses. Use \'I spent\' to record cash spending."],
      ["Entry desk", "For project-level accounting: expenses against budget heads, unallocated payments, income receipts. NOT for petty cash — use Cash box."],
      ["Approvals & verification", "Items awaiting accountant appear here — expense claims approved by manager and director, petty cash entries within limit with bill. Mark paid to close."],
      ["Staff advances", "Issue advances, mark paid after disbursement, settle when bills are submitted."],
      ["Monthly account", "Month\'s spending as the office form — print and sign."],
      ["Fund Tracker", "Full project financial dashboard — receipts, expenses, budget heads, monthly flow."],
    ],
    fundraising: [
      ["Opportunity calendar", "Track upcoming grant deadlines and partnership opportunities."],
      ["Proposals sent & status", "All proposals submitted — status, funder, amount, outcome."],
      ["Partnerships & outreach", "Manage funder relationships and outreach pipeline."],
      ["Donor relations & reporting", "Track donor reports due — submit and mark done from here."],
      ["Volunteers", "Register and manage volunteers. Verify profiles before they get access."],
      ["Project register", "All active and closed projects with donor, budget and timeline."],
    ],
    programme_officer: [
      ["Sakhis", "Register new Sakhis and browse the full list by district. Each registration counts in the field staff\'s karma."],
      ["Beneficiary list", "All services recorded — filter by district, service type, project."],
      ["Programmes overview", "All programmes, activities, and targets in one view."],
      ["Implementation plan", "Project activities with start/end dates, milestones, and assigned staff."],
      ["Duplicates", "Possible duplicate Sakhi records to review and merge."],
      ["Event reports", "All event reports from your team — verify them here."],
      ["Team reports", "Day reports from your team — verify work done each day."],
      ["Approvals & verification", "Leave requests, expense claims, assignments from your team."],
    ],
    field: [
      ["Day report", "Your report fills automatically as you work — registering a Sakhi, recording a benefit, filing an event report all add entries instantly. Add a note for field visits or anything outside the app. Your assignments show until your manager verifies them."],
      ["Register a Sakhi", "Register new Sakhis from Field work → Register a Sakhi. Each registration auto-logs to your day report and counts in your karma (×4 points each)."],
      ["Beneficiary list", "Record services and support given to beneficiaries. Each benefit auto-logs to your day report."],
      ["Event report", "File event and activity reports — auto-logged to your day report."],
      ["Cases assigned to me", "Cases where you are the assigned worker — record updates here."],
      ["Karma", "Your score = Attendance & reports (30%) + Work outputs (70%). Productive day = checked in AND recorded app activity. Sakhi registrations ×4, benefits ×2, event reports ×3."],
    ],
    admin_assistant: [
      ["Dak register", "Log all inward and outward correspondence."],
      ["Documents & certificates", "Organisation\'s registration documents, policies, certificates."],
      ["Offices", "Office locations and details."],
      ["Drive & attachments", "Uploaded files and Google Drive links."],
    ],
    procurement: [
      ["Requisitions to fulfil", "Procurement requests assigned to you — get quotes, raise POs, fulfil. Mark closed when done."],
      ["Office assets", "Register newly purchased assets, assign to staff, track condition."],
      ["Vendors", "Manage supplier/vendor list."],
      ["Cash box", "Record cash spending via \'I spent\' — entries go to Director ACF for approval, then accountant."],
    ],
    board: [
      ["Fund Tracker", "Project-wise fund position — received, spent, balance per project."],
      ["Fund position", "High-level summary across all projects and fund types."],
      ["Statutory calendar", "Compliance filing deadlines — returns, renewals, registrations."],
      ["Board & meetings", "Board meeting schedule and minutes."],
      ["Documents & certificates", "Organisation\'s registration and legal documents."],
    ],
    counsellor: [
      ["My cases", "Cases assigned to you as counsellor — record session notes and updates here."],
      ["All Sakhis (read)", "Read-only view of all Sakhi records — search and browse without editing."],
      ["My profile", "Update your contact details and personal information."],
    ],
    general: [
      ["Day report", "Your work is recorded automatically as you use the app. Add a note for anything done outside it."],
      ["My work", "Your assignments, leave requests, expense claims, and advances in one place."],
    ],
  };

  const common = [
    ["Calendar", "Your own dates, your team\'s, and organisation-wide deadlines. National holidays and office-specific holidays shown. Click any date to see details."],
    ["Holidays", "Upcoming holidays and observances on your home screen — next 30 days. Full list in Administration → Holidays."],
    ["Leave", "Apply from My work → Leave. Casual, sick, earned, WFH, and special leave. Working days are calculated excluding public holidays. Your leave appears on your profile and the calendar."],
    ["Expense claim", roles.includes("super_admin")||roles.includes("founder") ? "Submit from My work → Expense claim. Attach the bill. Goes directly to accountant for payment — no approval needed from your staff." : roles.includes("director_acf") ? "Submit from My work → Expense claim. Attach the bill. Goes to General Secretary for approval, then accountant." : "Submit from My work → Expense claim. Attach the bill. Goes to your manager, then Director ACF, then accountant."],
    ["Cash box", "See your advances received and expenses. Use \'I spend\' to record cash you spent."],
    ["Ask for something", "Raise a procurement request from the home screen. Goes to your department head, then Director ACF, then procurement arranges it."],
    ["Report a concern", "Incident report and harassment complaint always accessible — separate from everyday work."],
    ["Chat", "Chat and calls with any staff member."],
  ];

  const mySection = sections[role] || sections.general;
  const sec = arr => arr.map(([title,desc])=>`<details style="margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:12px"><summary style="cursor:pointer;font-weight:600;font-size:15px">${esc(title)}</summary><p class="small" style="margin-top:8px;line-height:1.6">${esc(desc)}</p></details>`).join("");
  html(`<div class="card"><h2>Your guide · ${esc(state.me?.name||"")}</h2>
    <p class="muted" style="margin-top:4px">Role: <b>${esc((state.me?.roles||[]).map(r=>ROLES[r]||r).join(", "))}</b></p>
    <p class="small muted">Tap any item to expand. This covers what this app does for your role.</p></div>
    <div class="card"><h2>Your main screens</h2>${sec(mySection)}</div>
    <div class="card"><h2>Common features</h2>${sec(common)}</div>
    <div class="card"><p class="small muted">Questions or something not working? Contact shafiq@empowerpeople.in</p></div>`);
};


routes.holidays = async () => {
  setTitle("Holidays");
  const snap = await db.collection("holidays").orderBy("date").get().catch(()=>({docs:[]}));
  const allHols = snap.docs.map(d=>({id:d.id,...d.data()}));
  const myOfficeId = state.me?.officeId;
  // Show: national (no officeId), org-wide (officeId===null), and this office's holidays
  const canEdit = has("super_admin","admin","director_acf","program_officer","program_lead","program_coord");
  const canEditAll = has("super_admin","admin","director_acf");
  // Offices for the select
  const offices = state.offices||[];
  const myOffice = offices.find(o=>o.id===myOfficeId);

  // Group by office
  const orgWide = allHols.filter(h=>!h.officeId);
  const myOfficeHols = allHols.filter(h=>h.officeId===myOfficeId);
  const otherOfficeHols = canEditAll ? allHols.filter(h=>h.officeId&&h.officeId!==myOfficeId) : [];

  html(`<div class="card"><h2>Organisation holidays</h2>
    <p class="small muted">Holidays appear on the calendar alongside national holidays. Programme officers can add holidays for their own office. Org-wide holidays apply everywhere.</p>
    ${canEdit?`<form id="holForm" style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--line)">
      <div class="two">
        <label class="field"><span>Date</span><input type="date" name="date" required></label>
        <label class="field"><span>Type</span><select name="type"><option>Gazetted holiday</option><option>Regional holiday</option><option>Office closure</option><option>Restricted holiday</option><option>Programme observance</option><option>Campaign / awareness day</option></select></label>
      </div>
      <label class="field"><span>Name</span><input name="name" placeholder="e.g. Eid ul-Fitr, Durga Puja, office closed" required></label>
      ${canEditAll?`<label class="field"><span>Office (leave blank for org-wide)</span>
        <select name="officeId"><option value="">— Org-wide (all offices) —</option>
        ${offices.map(o=>`<option value="${o.id}" ${o.id===myOfficeId?"selected":""}>${esc(o.name)}</option>`).join("")}
        </select></label>`:`<input type="hidden" name="officeId" value="${myOfficeId||""}">
        <p class="small muted">This holiday will be added for <b>${esc(myOffice?.name||"your office")}</b>.</p>`}
      <button class="btn small" type="submit">Add holiday</button>
    </form>`:""}
    ${orgWide.length?`<h3 class="small muted" style="margin:8px 0 4px">Org-wide</h3>
    <div class="list">${orgWide.map(h=>`<div class="item">
      <div class="grow"><div class="t">${esc(h.name)}</div><div class="s">${fmtD(h.date)} · ${esc(h.type||"Holiday")}</div></div>
      ${canEditAll?`<button class="btn small danger" data-delh="${h.id}">Remove</button>`:""}
    </div>`).join("")}</div>`:""}
    ${myOfficeHols.length?`<h3 class="small muted" style="margin:12px 0 4px">${esc(myOffice?.name||"Your office")}</h3>
    <div class="list">${myOfficeHols.map(h=>`<div class="item">
      <div class="grow"><div class="t">${esc(h.name)}</div><div class="s">${fmtD(h.date)} · ${esc(h.type||"Holiday")}</div></div>
      ${canEdit?`<button class="btn small danger" data-delh="${h.id}">Remove</button>`:""}
    </div>`).join("")}</div>`:""}
    ${otherOfficeHols.length?`<h3 class="small muted" style="margin:12px 0 4px">Other offices</h3>
    <div class="list">${otherOfficeHols.map(h=>`<div class="item">
      <div class="grow"><div class="t">${esc(h.name)}</div>
        <div class="s">${fmtD(h.date)} · ${esc(offices.find(o=>o.id===h.officeId)?.name||"Other")} · ${esc(h.type||"Holiday")}</div></div>
      ${canEditAll?`<button class="btn small danger" data-delh="${h.id}">Remove</button>`:""}
    </div>`).join("")}</div>`:""}
    ${!orgWide.length&&!myOfficeHols.length?`<div class="empty">No org holidays added yet.</div>`:""}
    </div>`);
  // Events section
  const evSnap = await db.collection("orgEvents").orderBy("date").get().catch(()=>({docs:[]}));
  const events = evSnap.docs.map(d=>({id:d.id,...d.data()}));
  const upcomingEvts = events.filter(e=>e.date>=today());
  const pastEvts = events.filter(e=>e.date<today()).slice(-5).reverse();
  const canEditEvt = has("super_admin","admin","director_acf","program_officer","program_lead","program_coord");
  $("content").insertAdjacentHTML("beforeend", `<div class="card" id="eventsCard"><h2>Planned events</h2>
    <p class="small muted">Events appear on the calendar and can be linked to event reports when filing. Programme officers can add events for their programmes.</p>
    ${canEditEvt?`<form id="evtForm" style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--line)">
      <div class="two">
        <label class="field"><span>Date</span><input type="date" name="date" required></label>
        <label class="field"><span>Programme</span><select name="projectId"><option value="">— none —</option>
        ${activeProjects().map(p=>`<option value="${p.id}">${esc(p.code||p.name)}</option>`).join("")}</select></label>
      </div>
      <label class="field"><span>Event name</span><input name="title" placeholder="e.g. Community meeting, Awareness camp, Training workshop" required></label>
      <div class="two">
        <label class="field"><span>Location</span><input name="location" placeholder="Village, block, district"></label>
        <label class="field"><span>Expected participants</span><input type="number" name="expectedParticipants" placeholder="0" min="0"></label>
      </div>
      <label class="field"><span>Description (optional)</span><textarea name="description" rows="2" placeholder="What will happen, who will attend…"></textarea></label>
      <button class="btn small" type="submit">Add event</button>
    </form>`:""}
    ${upcomingEvts.length?`<h3 class="small muted" style="margin:8px 0 4px">Upcoming</h3>
    <div class="list">${upcomingEvts.map(e=>`<div class="item">
      <div class="grow"><div class="t">📅 ${esc(e.title)}</div>
        <div class="s">${fmtD(e.date)}${e.location?" · "+esc(e.location):""}${e.projectId?" · "+esc(projectName(e.projectId)):""}</div>
        ${e.description?`<div class="s muted">${esc(e.description)}</div>`:""}
      </div>
      ${canEditEvt?`<button class="btn small danger" data-delet="${e.id}">Remove</button>`:""}
    </div>`).join("")}</div>`:"<div class='empty'>No upcoming events added yet.</div>"}
    ${pastEvts.length?`<h3 class="small muted" style="margin:12px 0 4px">Recent (last 5)</h3>
    <div class="list">${pastEvts.map(e=>`<div class="item">
      <div class="grow"><div class="t">📅 ${esc(e.title)}</div>
        <div class="s">${fmtD(e.date)}${e.location?" · "+esc(e.location):""}</div></div>
    </div>`).join("")}</div>`:""}
  </div>`);

  if($("evtForm")) $("evtForm").onsubmit = async e => { e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if(d.expectedParticipants) d.expectedParticipants = Number(d.expectedParticipants);
    await db.collection("orgEvents").add({...d, addedBy:state.user.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    successFlash("Event added"); routes.holidays(); };
  $("content").querySelectorAll("[data-delet]").forEach(b=>b.onclick=async()=>{
    if(!confirm("Remove this event?")) return;
    await db.collection("orgEvents").doc(b.dataset.delet).delete();
    successFlash("Removed"); routes.holidays(); });

  if($("holForm")) $("holForm").onsubmit = async e => { e.preventDefault();
    const fd = new FormData(e.target); const d = Object.fromEntries(fd);
    await db.collection("holidays").add({...d, addedBy:state.user.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    successFlash("Holiday added"); routes.holidays(); };
  $("content").querySelectorAll("[data-delh]").forEach(b=>b.onclick=async()=>{
    if(!confirm("Remove this holiday?"))return;
    await db.collection("holidays").doc(b.dataset.delh).delete();
    successFlash("Removed"); routes.holidays(); });
};

routes.leaveRegister = async () => {
  if (!has("super_admin", "director_acf", "admin")) return html(`<div class="card"><div class="empty">Staff records are kept by Administration, HR &amp; Communication.</div></div>`);
  setTitle("Leave register");
  const fyFrom = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; })();
  const lv = (await db.collection("leaveRequests").get()).docs.map(d => ({ id: d.id, ...d.data() })).filter(l => (l.from || "") >= fyFrom);
  /* Each person's entitlement is their own: it depends on when they joined and whether
     they have opted in to menstrual leave. Days taken before the app was in use are
     recorded on the person, not as requests, so they are counted separately. */
  const entOf = u => leaveEntitlement(u);
  const before = u => Number(u.leaveTakenBefore) || 0;
  const ENT = leaveEntitlement(state.me);
  const notLeave = r => /work from home/i.test(r.type || "");
  const staff = staffList();
  const taken = (uid, t) => lv.filter(l => l.uid === uid && l.type === t && l.status === "approved").reduce((a, l) => a + (Number(l.days) || 0), 0);
  const takenAll = u => Object.keys(entOf(u)).reduce((a, t) => a + taken(u.id, t), 0) + before(u);
  html(`<div class="card"><h2>Leave taken this financial year</h2><p class="small muted">Staff only. Entitlements are from the HR Policy §7.2 and §7.3, counted for the months each person is on the rolls this year —
        so somebody who joined in October has half a year's leave. <b>Taken before</b> is what was taken this year before the app was in use, which is not split by kind.
        Menstrual leave shows only for those who have opted in. Leave without pay feeds the salary sheet.</p>
    <div class="tablewrap"><table class="table"><tr><th>Staff</th><th>Post</th>
      ${["Casual leave", "Sick leave", "Menstrual leave (opt-in)", "Trauma / emotional health leave"]
        .map(k => `<th style="text-align:center">${esc(k.split(" (")[0])}</th>`).join("")}
      <th style="text-align:center" title="taken this year before the app was in use">Taken before</th>
      <th style="text-align:center">All told</th>
      <th style="text-align:center">LWP</th><th style="text-align:center">WFH</th><th style="text-align:center">Pending</th></tr>
    ${staff.map(u => `<tr><td>${esc(u.name)}</td><td class="small">${esc(u.postTitle || "")}</td>
      ${["Casual leave", "Sick leave", "Menstrual leave (opt-in)", "Trauma / emotional health leave"].map(k => {
        const e = entOf(u), max = e[k];
        if (max === undefined) return `<td class="small muted" title="not applicable">—</td>`;
        const t = taken(u.id, k);
        return `<td>${t ? `${t}/${max}` : `0/${max}`}${t >= max && max ? ' <span class="tag bad">full</span>' : t > max * 0.7 ? ' <span class="tag warn">nearly</span>' : ""}</td>`; }).join("")}
      <td style="text-align:center">${before(u) || "—"}</td>
      <td style="text-align:center"><b>${takenAll(u) || "—"}</b></td>
      <td>${taken(u.id, "Leave without pay") || "—"}</td>
      <td>${lv.filter(l => l.uid === u.id && l.type === "Work from home" && l.status === "approved").length || "—"}</td>
      <td>${lv.filter(l => l.uid === u.id && l.status === "pending").length || "—"}</td></tr>`).join("") || `<tr><td colspan="10" class="empty">No staff yet</td></tr>`}</table></div>
    <button class="btn small quiet" style="margin-top:8px" id="lexp">Export</button>
    <button class="btn small" style="margin-top:8px;margin-left:8px" id="lrecord">+ Record absence for staff</button></div>`);
  $("lexp").onclick = async () => { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const rows = staff.map(u => { const r = { Staff: u.name, Post: u.postTitle || "" };
      Object.keys(ENT).forEach(k => r[k] = taken(u.id, k)); r["Leave without pay"] = taken(u.id, "Leave without pay"); return r; });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Leave register");
    XLSX.writeFile(wb, `leave-register-${today()}.xlsx`); };

  $("lrecord").onclick = () => {
    const box = document.createElement("div"); box.className = "modal";
    const leaveTypes = ["Casual leave","Sick leave","Menstrual leave (opt-in)","Trauma / emotional health leave","Leave without pay","Work from home","Absent without leave"];
    box.innerHTML = `<div class="modal-card"><h2>Record absence or leave</h2>
      <p class="small muted">Use this when a staff member has not applied through the app. The entry is recorded as approved and counts in their leave balance.</p>
      <label class="field"><span>Staff member</span><select id="rabStaff"><option value="">— select —</option>${staff.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label>
      <label class="field"><span>Type</span><select id="rabType">${leaveTypes.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}</select></label>
      <label class="field"><span>From</span><input type="date" id="rabFrom" value="${today()}"></label>
      <label class="field"><span>To</span><input type="date" id="rabTo" value="${today()}"></label>
      <label class="field"><span>Reason / note</span><input type="text" id="rabReason" placeholder="e.g. informed verbally, family emergency"></label>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn" id="rabSave">Save</button>
        <button class="btn quiet" id="rabCancel">Cancel</button>
      </div>
      <div id="rabErr" class="small" style="color:#c0392b;margin-top:6px"></div>
    </div>`;
    document.body.appendChild(box);
    $("rabCancel").onclick = () => document.body.removeChild(box);
    $("rabSave").onclick = async () => {
      const uid = $("rabStaff").value;
      const type = $("rabType").value;
      const from = $("rabFrom").value;
      const to = $("rabTo").value;
      const reason = $("rabReason").value.trim();
      if (!uid) { $("rabErr").textContent = "Select a staff member"; return; }
      if (!from || !to || from > to) { $("rabErr").textContent = "Check the dates"; return; }
      const u = staff.find(s=>s.id===uid);
      // Calculate days (simple count including weekends — leave policy counts calendar days)
      const msPerDay = 86400000;
      const days = Math.round((new Date(to)-new Date(from))/msPerDay)+1;
      $("rabSave").disabled = true; $("rabSave").textContent = "Saving…";
      await db.collection("leaveRequests").add({
        uid, name: u?.name||"", type, from, to, days,
        reason: reason || "Recorded by " + state.me.name,
        status: "approved", approvedBy: state.user.uid,
        approveNote: "Recorded on staff member's behalf by " + state.me.name,
        approveAt: today(), markedBy: state.user.uid,
        managerIds: mgrs(u)||[], fromTime:"09:00", toTime:"18:00",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      audit("leave_recorded", "leaveRequests", null, (u?.name||uid)+" "+type+" "+from);
      toast(`${days} day${days>1?"s":""} of ${type} recorded for ${u?.name||uid}`);
      document.body.removeChild(box);
      routes.leaveRegister();
    };
  };
};

/* ================= UPLOADS STRAIGHT INTO THE SHARED DRIVE =================
   Files go into the department's own folder and the record keeps the link.
   Needs a Google sign-in; anyone signed in by email keeps the older behaviour. */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
let _driveToken = null, _driveTokenAt = 0;
async function driveToken(interactive) {
  // Pick up token captured at sign-in time (set on window by the sign-in handler)
  if (window._driveToken && window._driveTokenAt) { _driveToken = window._driveToken; _driveTokenAt = window._driveTokenAt; }
  if (_driveToken && Date.now() - _driveTokenAt < 55 * 60000) return _driveToken;
  if (!interactive) return null;
  // Token expired or missing — try a fresh popup
  try {
    const p = new firebase.auth.GoogleAuthProvider();
    p.addScope(DRIVE_SCOPE);
    if (state.me && state.me.email) p.setCustomParameters({ login_hint: state.me.email, prompt: "none" });
    const res = await auth.signInWithPopup(p);
    _driveToken = window._driveToken = res.credential && res.credential.accessToken;
    _driveTokenAt = window._driveTokenAt = Date.now();
    return _driveToken;
  } catch (e) {
    // Popup blocked or phone-auth user — surface a clear message
    if (/popup|cancelled|dismissed/i.test(e.code || e.message || "")) {
      toast("Drive access expired — sign out and sign in again with Google to re-connect.");
      return null;
    }
    throw e;
  }
}
const DRIVE_FOLDERS = {
  // Folders inside "Empower People Office" → in EP APP shared drive (0ANenMPwxCflkUk9PVA)
  program:     "1WEJ7mOEcpKAxcotLUw8D66mo0Q3G6u3S",  // 01 Programmes
  accounts:    "1DmAVENmcXHC_XHMwazMzDEus5Q5AE5_I",   // 02 Accounts
  admin:       "1WZPYFAy-S-BgpM_sJLPsaJbxzC2veyj_",   // 03 Administration, HR & Communication
  fundraising: "1f6rpPIy74iWTDT-HAlLvchIIKuLobHnI",   // 04 Project Development, Research & Innovations
  compliance:  "1yYadc2j1UA7VjJ6RKy3FmnrxgShI8_Qz",   // 05 Compliance
  governance:  "1jwB3spX-SM_M4FO_J2ZKs3xj4v57o-A4",   // 06 Governance
  chat:        "1ChLd-CxNXnBtp1Vi0tN5DzMdtarXe6sQ",   // 08 Chat files
  root:        "1vjzxS6_unZyhAL2ZsHczgJY2yFAddu86",   // Empower People Office (root)
};
const folderIdFor = key => {
  const saved = (state.drive || {})[key] || "";
  const m = String(saved).match(/folders\/([A-Za-z0-9_-]{20,})/);
  return (m && m[1]) || DRIVE_FOLDERS[key] || DRIVE_FOLDERS.root;
};
/** Put a file in the shared drive and return { name, link, id }. */
async function uploadToDrive(file, folderKey, nameHint) {
  // Apps Script proxy — notification@empowerpeople.in — no user sign-in needed
  const _r = await fileToStore(file, 1400, 0.65, folderKey);
  if (!_r) throw new Error("Upload failed — try again or check Drive connection");
  return { name: _r.name, link: _r.link, webViewLink: _r.link, url: _r.link, id: _r.id };
}
/** A file input that puts the file in the drive, with a plain fallback. */
function driveFileField(id, label, folderKey) {
  return `<label class="field"><span>${esc(label)}</span>
    <input type="file" id="${id}"><span class="small muted" id="${id}_s"></span></label>`;
}
function wireDriveField(id, folderKey, nameHint, onDone) {
  const el = $(id); if (!el) return;
  el.onchange = async () => { const f = el.files[0]; if (!f) return;
    const note = $(id + "_s"); note.textContent = "Putting it in the shared drive…";
    try { const up = await uploadToDrive(f, folderKey, nameHint);
      note.innerHTML = `saved to the drive — <a href="${up.link}" target="_blank" rel="noopener">open</a>`;
      await onDone(up); }
    catch (e) { note.textContent = e.message; }
  };
}

/* ================= EXIT HANDOVER ================= */
routes.handoverPost = async (uid) => {
  if (!has("super_admin", "admin", "director_acf")) return html(`<div class="card"><div class="empty">A handover is run by the Founder &amp; General Secretary or Administration.</div></div>`);
  uid = uid || state.handoverUid;
  setTitle("Exit handover");
  const staff = staffList();
  if (!uid) return html(`<div class="card"><h2>Who is leaving the post?</h2>
      <p class="small muted">The app lists everything their post holds, so the next person starts with a full desk rather than a search.</p>
      <div class="list">${staff.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.name)}</div><div class="s">${esc(standingOf(u) || "—")} · ${esc(officeName(u.officeId))}</div></div>
        <button class="btn small" data-pick="${u.id}">Start the handover</button></div>`).join("") || `<div class="empty">No staff yet</div>`}</div></div>`) ||
    $("content").querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { state.handoverUid = b.dataset.pick; routes.handoverPost(b.dataset.pick); });
  const person = state.users.find(u => u.id === uid) || {};
  const postId = person.postId || null;
  const g = (c, f, v) => db.collection(c).where(f, "==", v).limit(300).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [tasks, cases, dakIn, reqs, assets, volunteers, handovers] = await Promise.all([
    g("assignments", "assigneeId", uid), g("persons", "caseWorkerId", uid), g("dak", "forWhomId", uid),
    g("requisitions", "uid", uid), g("assets", "assignedTo", uid), g("volunteers", "supervisorId", uid), g("handovers", "fromId", uid)]);
  const openTasks = tasks.filter(t => t.status !== "verified");
  const openDak = dakIn.filter(d => !/Closed/.test(d.status || ""));
  const openReqs = reqs.filter(r => !/Closed|Declined/.test(r.status || ""));
  const openCases = cases.filter(c => (c.status || "open") === "open");
  const successor = state.users.filter(u => u.active && u.id !== uid);
  const row = (what, n, note) => `<div class="item"><div class="grow"><div class="t">${esc(what)}</div><div class="s">${esc(note)}</div></div>
      <span class="tag ${n ? "warn" : "ok"}">${n}</span></div>`;
  html(`<div class="card"><h2>${esc(person.name)} · ${esc(person.postTitle || "no post")}</h2>
      <p class="small muted">The post stays; the person leaves it. Anything owned by the post moves to whoever takes it. Personal things — leave, claims, day reports, the ID card — go with the person and are not transferred.</p>
      ${!postId ? `<p><span class="tag bad">They hold no post, so nothing can be transferred by post. Reassign each item by hand.</span></p>` : ""}</div>
    <div class="card"><h2>What they are holding</h2><div class="list">
      ${row("Open tasks", openTasks.length, openTasks.slice(0, 3).map(t => t.title).join(" · ") || "none")}
      ${row("Open cases", openCases.length, "Sakhis they are the case worker for")}
      ${row("Dak awaiting action", openDak.length, openDak.slice(0, 3).map(d => d.subject).join(" · ") || "none")}
      ${row("Requisitions in flight", openReqs.length, openReqs.slice(0, 3).map(r => r.item).join(" · ") || "none")}
      ${row("Assets issued to them", assets.length, assets.slice(0, 4).map(a => a.item).join(" · ") || "none")}
      ${row("Volunteers they supervise", volunteers.length, volunteers.slice(0, 4).map(v => v.name).join(" · ") || "none")}
      ${row("Files handed to them, not yet returned", handovers.filter(h => h.status !== "received").length, "file handovers")}
    </div></div>
    <div class="card"><h2>Hand it over</h2>
      <label class="field"><span>Who takes the post</span><select id="to"><option value="">— choose —</option>${successor.map(u => `<option value="${u.id}">${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select></label>
      <label class="field"><span>Note for them — what the records do not say</span><textarea id="note" rows="3" placeholder="Who to call about the Yamunanagar lease; the FCRA renewal needs the auditor's letter first…"></textarea></label>
      <label class="check"><input type="checkbox" id="suspend" checked> Close ${esc((person.name || "").split(" ")[0])}'s account when the handover is done</label>
      <button class="btn" id="go" style="margin-top:8px">Transfer everything to them</button>
      <p class="small muted" style="margin-top:6px">Cases arrive marked “came to you with the post”, so the new person speaks to her before visiting. Nothing moves silently.</p>
      <div class="err" id="hErr"></div></div>`);
  $("go").onclick = async () => {
    const to = $("to").value; if (!to) return toast("Choose who takes the post");
    const target = state.users.find(u => u.id === to) || {};
    if (!confirm(`Transfer ${openTasks.length} tasks, ${openCases.length} cases, ${openDak.length} dak items, ${openReqs.length} requisitions, ${assets.length} assets and ${volunteers.length} volunteers to ${target.name}?`)) return;
    $("go").disabled = true; $("go").textContent = "Transferring…";
    const note = $("note").value || "";
    try {
      const b1 = db.batch();
      openTasks.forEach(t => b1.update(db.collection("assignments").doc(t.id), { assigneeId: to, assigneePostId: target.postId || postId, handedFrom: uid, handedAt: today() }));
      openDak.forEach(d => b1.update(db.collection("dak").doc(d.id), { forWhomId: to, handedFrom: uid }));
      openReqs.forEach(r => b1.update(db.collection("requisitions").doc(r.id), { uid: to, handedFrom: uid }));
      await b1.commit();
      const b2 = db.batch();
      openCases.forEach(c => b2.update(db.collection("persons").doc(c.id), { caseWorkerPostId: target.postId || postId, handoverFrom: uid, handoverAt: today() }));
      assets.forEach(a => b2.update(db.collection("assets").doc(a.id), { assignedTo: to, history: [...(a.history || []), { what: `Reissued from ${person.name} to ${target.name}`, at: today(), by: state.user.uid }] }));
      volunteers.forEach(v => b2.update(db.collection("volunteers").doc(v.id), { supervisorId: to }));
      await b2.commit();
      if (postId) { await db.collection("posts").doc(postId).update({ holderId: to, holderName: target.name,
        history: [...((await db.collection("posts").doc(postId).get()).data().history || []), { what: `${person.name} handed the post to ${target.name}`, by: state.me.name, from: today(), reason: note || "Exit handover" }] });
        await db.collection("users").doc(to).update({ postId, postTitle: person.postTitle || null, department: person.department || null }); }
      await db.collection("handovers").add({ file: `Post: ${person.postTitle || "—"}`, type: "Post handover", fromId: uid, toId: to, date: today(),
        reason: "Exit from post", notes: note, status: "awaiting receipt", createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      if ($("suspend").checked) await db.collection("users").doc(uid).update({ active: false, status: "left", leftOn: today(), postId: null, postTitle: null });
      audit("post_handover", "posts", postId, `${person.name} → ${target.name}`);
      toast("Handed over"); await loadMasters(); state.handoverUid = null; routes.handoverPost();
    } catch (e) { $("hErr").textContent = e.message; $("go").disabled = false; $("go").textContent = "Try again"; }
  };
};

/* ================= PROGRAMMES =================
   A programme outlives any one grant: Sakhi Mandal, Nari Nusrat, the Coaching Centre.
   It holds its own groups, activities, updates and the projects that fund it. */
routes.programmes = registerScreen({
  route: "programmes", col: "programmes", orgWide: true, title: "Programmes", orderBy: "name", dir: "asc",
  canEdit: () => has("super_admin", "program_officer", "program_coord"),
  intro: "The continuing work of the organisation. A project is funded and ends; a programme carries on. Groups, activities and updates belong to a programme, so each one can be followed on its own.",
  fields: [{ k: "name", l: "Programme", req: true, w: "half" }, { k: "code", l: "Short code", ph: "SM, NN, CC", w: "half" },
    { k: "aim", l: "What it is for", t: "textarea" },
    { k: "leadId", l: "Programme lead", t: "users", w: "half" },
    { k: "statesText", l: "States it runs in", ph: "Haryana, Assam", w: "half" },
    { k: "officeId", l: "Primary office", t: "offices", w: "half" },
    { k: "startedOn", l: "Running since", t: "date", w: "half" },
    { k: "status", l: "Status", t: "select", o: ["Running", "Paused", "Closed"], w: "half" },
    { k: "notes", l: "Notes" }],
  cols: [{ k: "name", l: "Programme" }, { k: "code", l: "Code" },
    { k: "leadId", l: "Lead", f: v => v ? esc(userName(v)) : `<span class="tag warn">no lead</span>` },
    { k: "statesText", l: "States" }, { k: "startedOn", l: "Since", t: "date" }, { k: "status", l: "Status", f: statusTag }],
  actions: [{ k: "open", l: "Open", run: async r => { state.programmeId = r.id; go("programme"); } }],
  filter: rows => {
    // programme_leads and team members only see their own programme
    if (has("super_admin","program_officer","program_coord","director_acf","admin")) return rows;
    return rows.filter(r => r.leadId === state.user.uid || (r.team||[]).some(function(m){return m.id === state.user.uid;}));
  },
  stats: rows => [["Programmes", rows.filter(r => r.status !== "Closed").length], ["Closed", rows.filter(r => r.status === "Closed").length]]
});

routes.programme = async (id, tab) => {
  id = id || state.programmeId; state.programmeId = id; tab = tab || state.progTab || "overview"; state.progTab = tab;
  const snap = await db.collection("programmes").doc(id).get().catch(() => null);
  if (!snap || !snap.exists) return routes.programmes();
  const p = snap.data(); p.id = snap.id; // hoisted before gate check
  // programme_leads can only open their own programme
  if (!has("super_admin","program_officer","program_coord","director_acf","admin") &&
      p.leadId !== state.user.uid &&
      !(p.team||[]).some(function(m){return m.id === state.user.uid;})) {
    toast("You can only access your own programme");
    return routes.programmes();
  }
    // p already declared above (hoisted before gate check)
  setTitle(p.name || "Programme");
  const allBens = (await db.collection("benefits").get().catch(() => ({ docs: [] }))).docs.map(d => d.data());
  const onProgTeam = p.leadId === state.user.uid ||
    (p.leadIds || []).includes(state.user.uid) ||
    (p.team || []).some(function(m){ return (m.id || m) === state.user.uid; });
  const canEdit = has("super_admin", "program_officer", "program_coord", "director_acf", "program_lead", "admin") || onProgTeam;
  const q = (c, f) => db.collection(c).where(f, "==", id).limit(400).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [groups, acts, ups] = await Promise.all([q("groups", "programmeId"), q("activities", "programmeId"), q("programmeUpdates", "programmeId")]);
  // Load group members for all groups in this programme (they are the beneficiaries)
  const allGrpMembers = groups.length
    ? (await Promise.all(groups.map(g =>
        db.collection("groupMembers").where("groupId","==",g.id).limit(400).get().catch(()=>({docs:[]}))
      ))).flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
    : [];
  const visible = groups.filter(inMyArea);
  const members = visible.reduce((a, g) => a + (g.memberCount || 0), 0);
  const savings = visible.reduce((a, g) => a + (Number(g.savings) || 0), 0);
  const byState = {};
  visible.forEach(g => { const s = g.state || "—"; byState[s] = (byState[s] || 0) + 1; });
  const inr = n => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
  const recent = [...ups].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  // Split activities into work activities and indicators
  const actItems = acts.filter(a => !/^IND/i.test(a.code||""));
  const indItems = acts.filter(a => /^IND/i.test(a.code||""));
  const overviewOnly = has("board") || isVolunteerOnly();
  if (overviewOnly) tab = "overview";
  const TABS = overviewOnly
    ? [["overview", "Overview"]]
    : [["overview", "Overview"], ["groups", "Groups / CC"], ["activities", "Activities"],
       ["beneficiaries", "Beneficiaries"], ["updates", "Updates"],
       ...(canEdit ? [["team", "Team"]] : [])];
  const body = {
    overview: () => `<div class="grid">
        <div class="card stat"><span class="muted small">Groups / CC</span><b>${visible.length}</b></div>
        <div class="card stat"><span class="muted small">Members</span><b>${members}</b></div>
        <div class="card stat"><span class="muted small">Group savings</span><b>${inr(savings)}</b></div>
        <div class="card stat"><span class="muted small">Activities</span><b>${acts.length}</b></div>
        <div class="card stat" style="cursor:pointer" onclick="routes.programme('${p.id||id}','beneficiaries')"><span class="muted small">Beneficiaries</span><b>${(() => { const direct = new Set(allBens.filter(b=>b.programmeId===p.id).map(b=>b.personId||b.personCode||b.name).filter(Boolean)); allGrpMembers.forEach(m=>{const k=m.personId||m.personCode||m.name;if(k)direct.add(k);}); return direct.size; })()}</b><span class="small muted">tap to view</span></div>
        <div class="card stat"><span class="muted small">Updates this year</span><b>${ups.filter(u => (u.date || "") >= new Date().getFullYear() + "-01-01").length}</b></div></div>
      ${p.aim ? `<div class="card"><h2>What it is for</h2><p class="small">${esc(p.aim)}</p></div>` : ""}
      <div class="card"><h2>Where it runs</h2><table class="table">
        ${Object.entries(byState).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<tr><td>${esc(s)}</td><td>${n} group${n > 1 ? "s" : ""}</td></tr>`).join("") || `<tr><td class="empty">No groups yet</td></tr>`}</table>
        <p class="small muted" style="margin-top:8px">${p.leadId ? "Led by <b>" + esc(userName(p.leadId)) + "</b>" : `<span class="tag warn">No lead named</span>`}${p.startedOn ? " · running since " + fmtD(p.startedOn) : ""}</p></div>
      ${recent.length ? `<div class="card"><h2>Latest update</h2>
        <p class="small muted">${fmtD(recent[0].date)} · ${esc(userName(recent[0].by))}</p>
        <p>${esc(recent[0].text)}</p></div>` : ""}`,
    groups: () => `<div class="card"><h2>Groups / CC in this programme (${visible.length})</h2>
        <div class="tablewrap"><table class="table"><tr><th>Group</th><th>Village</th><th>District</th><th>State</th><th>Leader</th><th>Members</th><th>Savings</th><th></th></tr>
        ${visible.map(g => `<tr><td>${esc(g.name)}</td><td>${esc(g.village || "")}</td><td>${esc(g.district || "")}</td><td>${esc(g.state || "")}</td>
          <td>${esc(g.leaderName || "")}</td><td>${g.memberCount || 0}</td><td>${g.savings ? inr(g.savings) : ""}</td>
          <td><button class="btn small quiet" data-g="${g.id}">Open</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty">No groups yet in your area</td></tr>`}</table></div>
        <button class="btn small" style="margin-top:8px" onclick="go('groups')">Add a group / CC</button></div>`,
    activities: () => `<div class="card"><h2>Activities (${acts.length})</h2>
        <div class="tablewrap"><table class="table"><tr><th>Code</th><th>Activity</th><th>Target</th><th>Period</th><th>Lead</th><th>Status</th></tr>
        ${acts.map(a => `<tr><td>${esc(a.code || "")}</td><td>${esc(a.name)}</td><td>${a.target || ""} ${esc(a.unit || "")}</td>
          <td>${esc(a.period || "")}</td><td class="small">${esc(userName(a.leadId))}</td><td>${statusTag(a.status)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">Nothing planned yet</td></tr>`}</table></div>
        <button class="btn small" style="margin-top:8px" onclick="go('activities')">Add an activity</button></div>`,
    beneficiaries: () => {
      // Start with group members — they are the primary beneficiaries of group-based programmes
      const byPerson = {};
      allGrpMembers.forEach(m => {
        const k = m.personId || m.personCode || m.name; if (!k) return;
        const grp = groups.find(g => g.id === m.groupId);
        if (!byPerson[k]) byPerson[k] = { id: m.personId, code: m.personCode || m.personId, name: m.name,
          village: m.village || m.address || "", district: m.district || "", group: grp ? grp.name : "",
          services: ["Group member"], last: m.joinedOn || m.joined || "" };
        else if (!byPerson[k].group && grp) byPerson[k].group = grp.name;
      });
      // Also include anyone with a direct benefit recorded against this programme
      const mine = allBens.filter(b => b.programmeId === p.id);
      mine.forEach(b => { const k = b.personId || b.personCode || b.name; if (!k) return;
        if (!byPerson[k]) byPerson[k] = { id: b.personId, code: b.personCode, name: b.name,
          village: b.village || "", district: b.district || "", group: "", services: [], last: "" };
        if (!byPerson[k].services.includes(b.service) && b.service) byPerson[k].services.push(b.service);
        if (String(b.date || "") > byPerson[k].last) byPerson[k].last = b.date; });
      const rows = Object.values(byPerson).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      return `<div class="card"><h2>Beneficiaries (${rows.length})</h2>
        <p class="small muted">Group members and everyone this programme has directly helped.</p>
        <div class="tablewrap"><table class="table">
          <tr><th>Name</th><th>Sakhi ID</th><th>Group</th><th>District</th><th>Services / role</th><th>Since</th><th></th></tr>
          ${rows.map(r => `<tr>
            <td>${esc(maskName(r.name, r.code))}</td>
            <td class="small">${esc(r.code || "")}</td>
            <td class="small">${esc(r.group || "")}</td>
            <td>${esc(r.district || "")}</td>
            <td class="small">${r.services.map(s => `<span class="tag" style="margin:1px">${esc(s)}</span>`).join(" ")}</td>
            <td class="small">${fmtD(r.last)}</td>
            <td>${r.id ? `<button class="btn small quiet" data-sk="${r.id}">Open</button>` : ""}</td>
          </tr>`).join("")
          || `<tr><td colspan="7" class="empty">No members or beneficiaries yet</td></tr>`}
        </table></div></div>`; },
    team: () => {
      const currentTeam = p.team || [];
      const activeStaff = (state.users || []).filter(u => u.active && isStaff(u));
      return `<div class="card"><h2>Team assigned to this programme</h2>
        <p class="small muted">Staff on this list can see the programme in their nav and their work counts toward it. Programme leads are set separately on the programme record.</p>
        ${canEdit ? `<form id="progTeam">
          ${has("program_officer","super_admin","founder","director_acf") ? `<label class="field" style="margin-bottom:8px"><span>Programme lead</span>
            <select name="leadId"><option value="">— unassigned —</option>
            ${activeStaff.filter(u=>currentTeam.includes(u.id)).map(u=>`<option value="${u.id}" ${u.id===p.leadId?"selected":""}>${esc(u.name)}</option>`).join("")}
            </select></label>` : ""}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:4px;margin-bottom:10px">
            ${activeStaff.map(u => `<label class="check"><input type="checkbox" name="team" value="${u.id}" ${currentTeam.includes(u.id)?"checked":""}> ${esc(u.name)}</label>`).join("")}
          </div>
          <button class="btn small" type="submit">Save team & lead</button>
        </form>` : `<div class="list">${currentTeam.map(uid=>`<div class="item"><div class="grow"><div class="t">${esc(userName(uid))}</div></div></div>`).join("") || `<div class="empty">No staff assigned yet</div>`}</div>`}
      </div>`; },
    updates: () => `${canEdit ? `<div class="card"><h2>Add an update</h2>
        <p class="small muted">What happened, what changed, what is stuck. Written for whoever reads this a year from now.</p>
        <form id="pu"><div class="two"><label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
          <label class="field"><span>Kind</span><select name="kind">${["Progress", "Meeting", "Milestone", "Problem", "Change of plan", "Visit", "Learning"].map(x => `<option>${x}</option>`).join("")}</select></label></div>
        <div class="two"><label class="field"><span>State</span><select name="state" data-geo="state">${stateOptions((myStates() || ["Haryana"])[0])}</select></label>
          <label class="field"><span>Women reached, if counted</span><input type="number" step="any" inputmode="decimal" name="reached"></label></div>
        <label class="field"><span>The update</span><textarea name="text" rows="4" required></textarea></label>
        <button class="btn small" type="submit">Save</button></form></div>` : ""}
      <div class="card"><h2>What has happened (${ups.length})</h2><div class="list">
        ${recent.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.kind || "Update")} · ${fmtD(u.date)}${u.state ? " · " + esc(u.state) : ""}</div>
          <div class="s">${esc(u.text)}</div><div class="s muted">${esc(userName(u.by))}${u.reached ? " · " + u.reached + " women reached" : ""}</div></div></div>`).join("")
          || `<div class="empty">No updates yet</div>`}</div></div>`
  };
  html(`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div><h2 style="margin:0">${esc(p.name)}${p.code ? ` <span class="tag">${esc(p.code)}</span>` : ""}</h2>
        <p class="small muted" style="margin:3px 0">${esc(p.statesText || "")}${p.status ? " · " + esc(p.status) : ""}</p></div>
      <button class="btn small quiet" onclick="go('programmes')">All programmes</button></div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:10px">${TABS.map(([k, l]) => `<button class="btn small ${k === tab ? "" : "quiet"}" data-pt="${k}">${l}</button>`).join("")}</div></div>
    ${body[tab]()}`);
  $("content").querySelectorAll("[data-pt]").forEach(b => b.onclick = () => routes.programme(id, b.dataset.pt));
  $("content").querySelectorAll("[data-g]").forEach(b => b.onclick = () => { state.groupId = b.dataset.g; go("group"); });
  if ($("progTeam")) $("progTeam").onsubmit = async e => { e.preventDefault();
    const fd3 = new FormData(e.target); const team = fd3.getAll("team");
    const newLeadId = fd3.get("leadId") || p.leadId || null;
    const leadU = newLeadId ? (state.users||[]).find(u=>u.id===newLeadId) : null;
    const oldTeam = p.team||[];
    await db.collection("programmes").doc(id).update({ team, leadId: newLeadId||null, ...(leadU?{leadName:leadU.name}:{}) });
    // Sync programmeIds on user profiles
    const added = team.filter(u=>!oldTeam.includes(u));
    const removed = oldTeam.filter(u=>!team.includes(u));
    await Promise.all([
      ...added.map(uid=>db.collection("users").doc(uid).update({programmeIds:firebase.firestore.FieldValue.arrayUnion(id)})),
      ...removed.map(uid=>db.collection("users").doc(uid).update({programmeIds:firebase.firestore.FieldValue.arrayRemove(id)}))
    ]);
    await loadMasters(); audit("team", "programmes", id, team.length + " members"); toast("Team & lead saved"); routes.programme(id, "team"); };
  if ($("pu")) $("pu").onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
    d.reached = d.reached ? Number(d.reached) : null;
    try {
      await db.collection("programmeUpdates").add({ ...d, programmeId: id, programmeName: p.name, by: state.user.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    audit("create", "programmeUpdates", null, p.name); successFlash("Saved"); routes.programme(id, "updates");
    } catch(err) { toast("Could not save — " + (err.code==="permission-denied"?"speak to admin":err.message)); } };
};

/* One-off: the programmes Empower People runs, ready to load. */
const EP_PROGRAMMES = [
  { name: "Sakhi Mandal", code: "SM", aim: "Sakhi-led collectives building leadership, savings and livelihoods.", statesText: "Haryana", status: "Running" },
  { name: "Nari Nusrat", code: "NN", aim: "Community mobilisation and women's leadership in Assam.", statesText: "Assam", status: "Running" },
  { name: "Azaad Women Enterprise", code: "AWE", aim: "Women-led enterprise, market linkage and economic agency — about 200 members.", statesText: "Haryana", status: "Running" },
  { name: "Coaching Centre", code: "CC", aim: "Education support for the children and young people of Sakhis.", statesText: "Assam", status: "Running" },
  { name: "Paro Voice & Community Media", code: "PV", aim: "Sakhi-led storytelling, awareness and community media.", statesText: "Haryana, Assam", status: "Running" }
];
routes.seedProgrammes = async () => {
  if (!has("super_admin", "program_officer")) return html(`<div class="card"><div class="empty">Programmes are set up by the Program Officer.</div></div>`);
  setTitle("Load our programmes");
  const have = (await db.collection("programmes").get()).docs.map(d => (d.data().name || "").toLowerCase());
  const add = EP_PROGRAMMES.filter(p => !have.includes(p.name.toLowerCase()));
  html(`<div class="card"><h2>The programmes we run</h2>
    <p class="small muted">Loads them as records so each can carry its own groups, activities and updates. You can edit or add more afterwards.</p>
    <p><span class="tag">${EP_PROGRAMMES.length} in the list</span> <span class="tag ok">${add.length} would be added</span></p>
    ${add.length ? `<button class="btn" id="load">Load ${add.length}</button>` : `<div class="empty">All of them are already there.</div>`}
    <button class="btn small quiet" onclick="go('programmes')">Open programmes</button></div>
    <div class="card"><div class="list">${EP_PROGRAMMES.map(p => `<div class="item"><div class="grow"><div class="t">${esc(p.name)} <span class="tag">${esc(p.code)}</span></div>
      <div class="s">${esc(p.aim)} · ${esc(p.statesText)}</div></div></div>`).join("")}</div></div>`);
  if ($("load")) $("load").onclick = async () => { $("load").disabled = true;
    const b = db.batch();
    add.forEach(p => b.set(db.collection("programmes").doc(), { ...p, createdBy: state.user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
    await b.commit(); audit("seed", "programmes", null, add.length + " programmes"); toast("Loaded"); go("programmes"); };
};

/* Ask who a task is being passed to. Returns { id, note, due } or null. */
function askWhoDoes(task, team) {
  return new Promise(resolve => {
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>Pass this on for execution</h2>
      <p class="small muted">${esc(task.title || "")}${task.due ? " · due " + fmtD(task.due) : ""}</p>
      <label class="field"><span>Who will do it</span><select id="pwWho">
        ${team.map(u => `<option value="${u.id}">${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}</select></label>
      <label class="field"><span>What they need to know</span><textarea id="pwNote" rows="2"></textarea></label>
      <div class="two">
        <label class="field"><span>Quantity target (optional)</span><input type="number" id="pwTarget" placeholder="e.g. 20" min="0"></label>
        <label class="field"><span>Unit</span><select id="pwUnit">
          <option value="">— none —</option>
          <option>Sakhis</option><option>Events</option><option>Camps</option>
          <option>Cases</option><option>Benefits</option><option>Journeys</option>
          <option>Visits</option><option>Documents</option><option>Other</option>
        </select></label>
      </div>
      <label class="field"><span>Do it by</span><input type="date" id="pwDue" value="${task.due || ""}"></label>
      <p class="small muted">You stay answerable for it. When they mark it done it comes back to you, and the person who set it can see the whole chain.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button class="btn small quiet" id="pwCancel">Cancel</button>
        <button class="btn small" id="pwOk">Pass it on</button></div></div>`;
    document.body.appendChild(box);
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#pwCancel").onclick = () => close(null);
    box.querySelector("#pwOk").onclick = () => close({ id: box.querySelector("#pwWho").value,
      note: box.querySelector("#pwNote").value, due: box.querySelector("#pwDue").value,
      target: Number(box.querySelector("#pwTarget").value)||null,
      targetUnit: box.querySelector("#pwUnit").value||null });
    box.onclick = e => { if (e.target === box) close(null); };
  });
}


/* ================= THE BELL =================
   Worked out from the records themselves, so nothing extra is stored and
   anything that arrived while someone was away still shows. */
async function newForMe() {
  const uid = viewUid(), seen = state.me.lastSeen || "2000-01-01";
  const g = (c, f, v) => db.collection(c).where(f, "==", v).limit(80).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []);
  const [tasks, answer, cases, reqs] = await Promise.all([
    g("assignments", "assigneeId", uid),
    g("assignments", "accountableId", uid),
    g("persons", "caseWorkerId", uid),
    db.collection("requisitions").where("ownerId", "==", uid).limit(60).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => [])
  ]);
  const when = r => (r.createdAt && r.createdAt.seconds ? new Date(r.createdAt.seconds * 1000).toISOString() : (r.assignedAt || r.at || r.date || ""));
  const out = [];
  tasks.filter(t => t.status === "assigned" && when(t) > seen && t.assignerId !== uid)
    .forEach(t => out.push({ at: when(t), kind: "A task for you", what: t.title, who: userName(t.assignerId), go: "assignments" }));
  answer.filter(t => t.status === "done – to verify" && (t.doneAt || "") > seen)
    .forEach(t => out.push({ at: t.doneAt, kind: "Done — needs your check", what: t.title, who: userName(t.assigneeId), go: "assignments" }));
  tasks.filter(t => t.status === "done – to verify" && t.assignerId === uid && (t.doneAt || "") > seen)
    .forEach(t => out.push({ at: t.doneAt, kind: "Done — needs your check", what: t.title, who: userName(t.doneBy || t.assigneeId), go: "assignments" }));
  cases.filter(p => (p.assignedAt || "") > seen)
    .forEach(p => out.push({ at: p.assignedAt, kind: "A case for you", what: maskName(p.name, p.code), who: userName(p.assignedBy), go: "mycases" }));
  reqs.filter(r => (r.facApprovedAt || r.headApprovedAt || "") > seen)
    .forEach(r => out.push({ at: r.facApprovedAt || r.headApprovedAt, kind: "Approved — yours to arrange", what: r.item, who: userName(r.facApprovedBy || r.headApprovedBy), go: "requisition" }));
  if (isManager() || has("super_admin", "director_acf", "admin", "program_officer", "program_coord", "fundraising")) {
    try {
      const p = await pendingForMe();
      if (p.length) {
        // Group by kind for readable bell items
        const lv = p.filter(x=>x.kind==="leave");
        const ec = p.filter(x=>x.kind==="expense");
        const other = p.filter(x=>x.kind!=="leave"&&x.kind!=="expense");
        if (lv.length) out.push({ at: today(), kind: "Leave to approve", what: lv.map(x=>userName(x.uid)+(x.type?" · "+x.type:"")).join("; "), who: "", go: "inbox", standing: true });
        if (ec.length) out.push({ at: today(), kind: "Expense claims to approve", what: ec.map(x=>userName(x.uid)+(x.amount?" · ₹"+x.amount:"")).join("; "), who: "", go: "inbox", standing: true });
        if (other.length) out.push({ at: today(), kind: "Pending approvals", what: other.length+" item"+(other.length>1?"s":""), who: "", go: "inbox", standing: true });
      }
    } catch { }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
async function paintBell() {
  const el = $("bell"); if (!el) return;
  try {
    const items = await newForMe();
    state.bellItems = items;
    let n = items.filter(i => !i.standing).length + (items.some(i => i.standing) ? 1 : 0);
    // Add unresolved app errors for super_admin/founder
    if (has("super_admin","founder")) {
      const since = new Date(Date.now() - 24*3600000);
      const errSnap = await db.collection("appLogs").where("resolved","==",false).limit(50).get().catch(()=>({docs:[]}));
      const recentErrs = errSnap.docs.filter(d=>d.data().createdAt?.toDate?.()>=since).length;
      if (recentErrs) n += recentErrs;
      state.recentErrorCount = recentErrs;
    }
    el.innerHTML = `🔔${n ? `<span class="belldot">${n > 9 ? "9+" : n}</span>` : ""}`;
    el.classList.toggle("hasnew", !!n);
  } catch { }
}
routes.whatsNew = async () => {
  setTitle("What's new");
  const items = state.bellItems || await newForMe();
  html(`<div class="card"><h2>Since you last looked</h2>
    ${items.length ? `<div class="list">${items.map((i, k) => `<div class="item"><div class="grow">
        <div class="t">${esc(i.kind)}</div><div class="s">${esc(i.what || "")}${i.who ? " · " + esc(i.who) : ""}${i.at && !i.standing ? " · " + fmtD(i.at) : ""}</div></div>
        <button class="btn small quiet" data-go="${i.go}">Open</button></div>`).join("")}</div>
      <button class="btn small" style="margin-top:10px" id="markread">Mark all as seen</button>`
    : `<div class="empty">Nothing new. Anything waiting for you shows here.</div>`}</div>`);
  $("content").querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(b.dataset.go));
  if ($("markread")) $("markread").onclick = async () => {
    const now = new Date().toISOString();
    await db.collection("users").doc(state.user.uid).update({ lastSeen: now }).catch(() => {});
    state.me.lastSeen = now; await paintBell(); toast("Marked as seen"); routes.whatsNew();
  };
};

/* Settling an advance: what was spent, what comes back, and the bills. */
function askSettlement(adv) {
  return new Promise(resolve => {
    const amount = Number(adv.amount) || 0;
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>Settle this advance</h2>
      <p class="small muted">${esc(adv.purpose || "")} · taken by ${esc(userName(adv.uid))} · <b>₹${amount.toLocaleString("en-IN")}</b> issued${adv.neededBy ? " for " + fmtD(adv.neededBy) : ""}</p>
      <span class="small" style="font-weight:700">What the money went on</span>
      <div id="stLines" style="margin:4px 0 8px"></div>
      <button type="button" class="btn small quiet" id="stAdd" style="margin-bottom:8px">Add a line</button>
      <label class="field"><span>Total actually spent ₹</span><input type="number" step="any" inputmode="decimal" id="stSpent" value="${amount}"></label>
      <div class="small" id="stCalc" style="margin:-4px 0 10px"></div>
      <label class="field"><span>Bills attached</span><select id="stBills"><option>Yes</option><option>Partly</option><option>No</option></select></label>
      <label class="field"><span>Date of settlement</span><input type="date" id="stDate" value="${today()}"></label>
      <label class="field"><span>Note</span><textarea id="stNote" rows="2" placeholder="What the money went on, anything unusual"></textarea></label>
      <p class="small muted">An advance must be settled within 30 days of the period it was taken for, or it is deducted from salary (Financial Procedures §5B).</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="stCancel">Cancel</button>
        <button class="btn small" id="stOk">Settle</button></div></div>`;
    document.body.appendChild(box);
    const linesBox = box.querySelector("#stLines");
    const seed = String(adv.items || "").split("\n").map(s => s.trim()).filter(Boolean).map(l => l.split("·")[0].trim());
    const addLine = (what = "", amt = "") => { const row = document.createElement("div"); row.className = "two"; row.style.marginBottom = "4px";
      row.innerHTML = `<input class="stWhat" placeholder="What it was spent on" value="${esc(what)}">
        <input class="stAmt" type="number" placeholder="₹" value="${esc(amt)}" style="max-width:110px">`;
      linesBox.appendChild(row); row.querySelector(".stAmt").oninput = sumLines; };
    const sumLines = () => { const tot = [...linesBox.querySelectorAll(".stAmt")].reduce((a2, i) => a2 + (Number(i.value) || 0), 0);
      if (tot) { box.querySelector("#stSpent").value = tot; paint(); } };
    (seed.length ? seed : [""]).forEach(s => addLine(s));
    box.querySelector("#stAdd").onclick = () => addLine();
    const spent = box.querySelector("#stSpent"), calc = box.querySelector("#stCalc");
    const paint = () => { const s = Number(spent.value) || 0, bal = amount - s;
      calc.innerHTML = bal > 0 ? `<span class="tag ok">₹${bal.toLocaleString("en-IN")} to return to the office</span>`
        : bal < 0 ? `<span class="tag warn">₹${Math.abs(bal).toLocaleString("en-IN")} to be reimbursed to them</span>`
        : `<span class="tag">nothing to return</span>`; };
    spent.oninput = paint; paint();
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#stCancel").onclick = () => close(null);
    box.querySelector("#stOk").onclick = () => { const s = Number(spent.value) || 0;
      if (s < 0) return alert("That cannot be a negative amount.");
      const items = [...linesBox.children].map(r => ({ d: r.querySelector(".stWhat").value, a: Number(r.querySelector(".stAmt").value) || 0 }))
        .filter(x => x.d || x.a);
      close({ spent: s, returned: amount - s, bills: box.querySelector("#stBills").value, items,
        date: box.querySelector("#stDate").value, note: box.querySelector("#stNote").value }); };
    box.onclick = e => { if (e.target === box) close(null); };
  });
}

/* Attach bills — one per line of a claim, or several against a voucher.
   Small photographs stay with the record; larger files go to the shared drive. */
function askBills(rec) {
  return new Promise(resolve => {
    const lines = String(rec.items || "").split("\n").map(s => s.trim()).filter(Boolean);
    const slots = lines.length ? lines : [rec.description || rec.particulars || "The bill"];
    const have = rec.files || [];
    const box = document.createElement("div"); box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>Attach the bills</h2>
      <p class="small muted">One for each line. Photograph the bill, or pick a file. Large files go into <b>02 Accounts / Vouchers &amp; bills</b> in the shared drive; small photographs stay with the record.</p>
      ${slots.map((l, i) => `<label class="field"><span>${i + 1}. ${esc(String(l).split("·")[0])}</span>
        <input type="file" accept="image/*,video/*,.pdf,.doc,.docx" data-slot="${i}">
        <span class="small muted" id="bs${i}">${have[i] ? (have[i].link ? `attached — <a href="${have[i].link}" target="_blank" rel="noopener">open</a>` : "attached") : ""}</span></label>`).join("")}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="blCancel">Cancel</button><button class="btn small" id="blOk">Done</button></div></div>`;
    document.body.appendChild(box);
    const files = [...have];
    box.querySelectorAll("[data-slot]").forEach(inp => inp.onchange = async () => {
      const i = Number(inp.dataset.slot), f = inp.files[0]; if (!f) return;
      const note = box.querySelector("#bs" + i); note.textContent = "Saving…";
      try {
        if (f.size < 700000 && /^image\//.test(f.type)) {
          const sf2544 = await uploadToDrive(f,'accounts',f.name); if(sf2544) files[i] = sf2544;
          note.textContent = "attached";
        } else {
          const up = await uploadToDrive(f, "accounts", `${rec.voucher || rec.description || "bill"}`);
          files[i] = { name: up.name, at: today(), link: up.link, driveId: up.id };
          note.innerHTML = `attached — <a href="${up.link}" target="_blank" rel="noopener">open</a>`;
        }
      } catch (e) { note.textContent = e.message; }
    });
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#blCancel").onclick = () => close(null);
    box.querySelector("#blOk").onclick = () => close(files.filter(Boolean));
    box.onclick = e => { if (e.target === box) close(null); };
  });
}

/* After approving, the Director ACF either pays it himself or hands it to someone
   to execute — the payment-preparation stage of the payment process. */
function askHowToPay(rec, label) {
  return new Promise(resolve => {
    const payers = state.users.filter(u => u.active && u.id !== state.user.uid &&
      (u.roles || []).map(r => ROLE_ALIAS[r] || r).some(r => ["accountant", "director_acf", "admin", "procurement"].includes(r)));
    const others = state.users.filter(u => u.active && u.id !== state.user.uid && !payers.some(p => p.id === u.id));
    const box = document.createElement("div"); box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>Approved — what happens next?</h2>
      <p class="small muted">${esc(label || "")}${rec.amount ? " · ₹" + Number(rec.amount).toLocaleString("en-IN") : ""}</p>
      <label class="check"><input type="radio" name="howpay" value="self" checked> I have paid it myself — record how</label>
      <label class="check"><input type="radio" name="howpay" value="hand"> Send it to the Accountant to pay</label>
      <label class="field" id="whoWrap" style="display:none"><span>Who will make the payment</span>
        <select id="payWho">${payers.map(u => `<option value="${u.id}">${esc(u.name)}${u.postTitle ? " · " + esc(u.postTitle) : ""}</option>`).join("")}
          ${others.length ? `<optgroup label="Anyone else">${others.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join("")}</optgroup>` : ""}</select></label>
      <label class="field" id="noteWrap" style="display:none"><span>Anything they should know</span><textarea id="payNote" rows="2" placeholder="Pay by UPI today; bills to follow"></textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="hpCancel">Cancel</button><button class="btn small" id="hpOk">Done</button></div></div>`;
    document.body.appendChild(box);
    const sync = () => { const hand = box.querySelector('input[value="hand"]').checked;
      box.querySelector("#whoWrap").style.display = hand ? "" : "none";
      box.querySelector("#noteWrap").style.display = hand ? "" : "none"; };
    box.querySelectorAll('input[name="howpay"]').forEach(r => r.onchange = sync);
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#hpCancel").onclick = () => close(null);
    box.querySelector("#hpOk").onclick = () => {
      const hand = box.querySelector('input[value="hand"]').checked;
      close(hand ? { mode: "hand", id: box.querySelector("#payWho").value, note: box.querySelector("#payNote").value }
                 : { mode: "self" });
    };
    box.onclick = e => { if (e.target === box) close(null); };
  });
}
/* Approve, then either record the payment or pass it on. */
async function approveAndRoute(col, r, ref, label) {
  const choice = await askHowToPay(r, label);
  if (!choice) return false;
  if (choice.mode === "self") {
    const p = await askPaymentRef({ ...r, particulars: label });
    if (!p) return false;
    await ref.update({ ...p, status: col === "advances" ? "issued" : "paid",
      approvedBy: state.user.uid, approvedAt: today(),
      issuedOn: p.valueDate || today(), issuedBy: state.user.uid, paidOn: p.valueDate || today() });
    if(col==="advances"){try{await downloadFilledForm("F-08","advances",r.id,{...r,...p});}catch(_e8){console.warn("F-08 failed",_e8);}} audit("paid", col, r.id, paidByLine(p));
    toast("Recorded as paid");
  } else {
    const who = state.users.find(u => u.id === choice.id) || {};
    await ref.update({ status: "approved — with " + (who.name || "someone") + " to pay",
      approvedBy: state.user.uid, approvedAt: today(),
      payerId: who.id, payerName: who.name, payNote: choice.note || null });
    await db.collection("assignments").add({
      title: `Make the payment: ${label}`,
      assigneeId: who.id, assigneePostId: who.postId || null, assigneePostTitle: who.postTitle || null,
      assignerId: state.user.uid, due: r.neededBy || null, status: "assigned",
      instructions: `${r.amount ? "₹" + Number(r.amount).toLocaleString("en-IN") + " · " : ""}Approved by ${state.me.name} on ${fmtD(today())}.${choice.note ? "\n" + choice.note : ""}`,
      from: col, fromId: r.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    audit("hand_to_pay", col, r.id, who.name || "");
    toast("Handed to " + (who.name || "them") + " to pay");
  }
  return true;
}



/* ================= MY ACTIVITIES =================
   What this person has been given to carry out. Choosing one opens the right form
   with the project, programme and activity already set, so nothing is typed twice
   and nothing lands against the wrong line. */
routes.myActivities = async () => {
  setTitle("My activities");
  const uid = viewUid();
  const acts = (await db.collection("activities").limit(400).get().catch(() => ({ docs: [] })))
    .docs.map(d => ({ id: d.id, ...d.data() }));
  const mineProjects = (state.projects || []).filter(p => p.leadId === uid || (p.team || []).includes(uid)).map(p => p.id);
  const mine = acts.filter(a =>
    a.leadId === uid ||
    (state.projects||[]).find(p=>p.id===a.projectId)?.team?.includes(uid) ||
    (state.programmes||[]).find(p=>p.id===a.programmeId)?.team?.includes(uid)
  );
  const onMyProjects = acts.filter(a => !a.leadId && mineProjects.includes(a.projectId));
  const bens = (await db.collection("benefits").get().catch(() => ({ docs: [] }))).docs.map(d => d.data());
  const evs = (await db.collection("eventReports").limit(300).get().catch(() => ({ docs: [] }))).docs.map(d => d.data());
  const done = a => bens.filter(b => b.activityId === a.id).length + evs.filter(e => e.activityId === a.id).length;
  const mineWaiting = [...bens, ...evs].filter(r => r.uid === uid && r.status !== "verified").length;
  const row = (a, handed) => `<div class="item" style="flex-wrap:wrap">
      <div class="grow"><div class="t">${esc(a.name || "")}</div>
        <div class="s">${esc(projectName(a.projectId))}${a.code && a.code !== "IND" ? " · " + esc(a.code) : ""}${a.target ? ` · target ${a.target} ${esc(a.unit || "")}` : ""}${a.end ? " · by " + fmtD(a.end) : ""}</div>
        ${a.assignNote ? `<div class="s" style="color:#8A5A00">${esc(a.assignNote)}</div>` : ""}
        <div class="s">${done(a)} record${done(a) === 1 ? "" : "s"} filed against it${handed ? "" : " · nobody is named on this line"}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn small" data-ev="${a.id}">Report an event</button>
        <button class="btn small quiet" data-bn="${a.id}">Record support</button></div></div>`;
  html(`<div class="card"><h2>My activities</h2>
      <p class="small muted">Pick the activity you are reporting on. The project, programme and activity are filled in for you;
        what you file goes to the project coordinator to verify, and the plan moves once it is verified.</p>
      ${mineWaiting ? `<p><span class="tag warn">${mineWaiting} of yours waiting to be verified</span></p>` : ""}</div>
    <div class="card"><h2>Given to me (${mine.length})</h2>
      <div class="list">${mine.map(a => row(a, true)).join("") || `<div class="empty">Nothing has been assigned to you yet.
        ${mineProjects.length ? "Your project coordinator assigns activities from the implementation plan."
          : "You are not on a project. Much of the organisation's work is not project-funded — file an event report or record support with <b>organisation work</b> chosen instead of a project, and it is still recorded."}</div>`}</div></div>
    ${onMyProjects.length ? `<div class="card"><h2>On my projects, nobody named (${onMyProjects.length})</h2>
      <p class="small muted">You are on these projects and these lines have no one against them. You may still report on one.</p>
      <div class="list">${onMyProjects.slice(0, 20).map(a => row(a, false)).join("")}</div></div>` : ""}`);
  const start = (id, where) => { const a = acts.find(x => x.id === id);
    state.reportFor = { activityId: a.id, activityName: a.name, projectId: a.projectId, programmeId: a.programmeId || null };
    go(where); };
  $("content").querySelectorAll("[data-ev]").forEach(b => b.onclick = () => start(b.dataset.ev, "events"));
  $("content").querySelectorAll("[data-bn]").forEach(b => b.onclick = () => start(b.dataset.bn, "beneficiaries"));
};

/* ================= MONTHLY REPORTS =================
   A month of work as a workbook — for one project, for one person, or for the whole
   organisation. Built from the records themselves, so it matches what the plan shows. */
routes.monthlyReports = async () => {
  setTitle("Reports");
  const _rTab = state.reportsTab || "monthly";

  // Week: pick any past Mon–Sun
  const _selWeek = state.mrWeek || (() => {
    const d = new Date(); const dow = d.getDay();
    const ms = new Date(d); ms.setDate(d.getDate()-(dow===0?6:dow-1));
    return ms.toISOString().slice(0,10);
  })();
  const _wEnd = (() => { const d = new Date(_selWeek); d.setDate(d.getDate()+6); return d.toISOString().slice(0,10); })();

  // Financial year: pick any past FY
  const _selFY = state.mrFY || (() => {
    const n = new Date(); const yr = n.getFullYear();
    return n.getMonth() >= 3 ? yr : yr - 1; // April=month 3
  })();
  const _aprFirst = `${_selFY}-04-01`;
  const _marLast  = `${_selFY+1}-03-31`;
  const _fyLabel  = `FY ${_selFY}-${String(_selFY+1).slice(2)}`;

  // Build week options (last 12 weeks)
  const _weekOpts = (() => {
    const opts = []; const d = new Date(); const dow = d.getDay();
    const cur = new Date(d); cur.setDate(d.getDate()-(dow===0?6:dow-1));
    for (let i = 0; i < 12; i++) {
      const ms = new Date(cur); ms.setDate(cur.getDate() - i*7);
      const me = new Date(ms); me.setDate(ms.getDate()+6);
      const vs = ms.toISOString().slice(0,10);
      opts.push(`<option value="${vs}" ${vs===_selWeek?"selected":""}>${fmtD(vs)} – ${fmtD(me.toISOString().slice(0,10))}</option>`);
    }
    return opts.join("");
  })();

  // Build FY options (FY 2006-07 to current)
  const _fyOpts = (() => {
    const opts = []; const curFY = new Date().getMonth()>=3?new Date().getFullYear():new Date().getFullYear()-1;
    for (let y = curFY; y >= 2006; y--) {
      opts.push(`<option value="${y}" ${y===_selFY?"selected":""}>FY ${y}-${String(y+1).slice(2)}</option>`);
    }
    return opts.join("");
  })();

  // Effective date range
  const _effFrom = _rTab==="weekly" ? _selWeek : _rTab==="annual" ? _aprFirst : null;
  const _effTo   = _rTab==="weekly" ? _wEnd    : _rTab==="annual" ? _marLast  : null;

  const month = _rTab==="annual" ? _aprFirst.slice(0,7) : _rTab==="weekly" ? _selWeek.slice(0,7) : (state.mrMonth || today().slice(0, 7));
  const label = _rTab==="weekly" ? `${fmtD(_selWeek)} – ${fmtD(_wEnd)}` : _rTab==="annual" ? _fyLabel : new Date(month + "-01").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const open = visibleProjects().filter(isLiveProject);
  const team = (state.users || []).filter(u => u.active && isStaff(u) &&
    (has("super_admin", "admin", "program_officer", "director_acf") || mgrs(u).includes(state.user.uid) || u.id === state.user.uid));
  html(`<div class="card"><h2>Reports</h2>
      <p class="small muted">Everything recorded in the period, as a workbook you can open in Excel and send on.
        Figures come from the records filed — day reports, event reports, support given, vouchers — not from any typed total.</p>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn small ${_rTab==="weekly"?"":"quiet"}" data-mrtab="weekly">This week</button>
        <button class="btn small ${_rTab==="monthly"?"":"quiet"}" data-mrtab="monthly">This month</button>
        <button class="btn small ${_rTab==="annual"?"":"quiet"}" data-mrtab="annual">This year</button>
      </div>
      ${_rTab==="weekly"
        ? `<label class="field" style="max-width:280px"><span>Week</span><select id="mrWeek">${_weekOpts}</select></label>`
        : _rTab==="annual"
        ? `<label class="field" style="max-width:200px"><span>Financial year</span><select id="mrFY">${_fyOpts}</select></label>`
        : `<label class="field" style="max-width:220px"><span>Month</span><input type="month" id="mrMonth" value="${month}"></label>`}
      </div>

    <div class="card"><h2>By project</h2>
      <p class="small muted">Activities and what was delivered against each, the support given, events held, and money spent.</p>
      <div class="list">${open.map(p => `<div class="item"><div class="grow"><div class="t">${esc(p.code || p.name)}</div>
        <div class="s">${esc(p.donor || "")}${p.start ? ` · ${fmtD(p.start)} to ${fmtD(p.end)}` : ""}${(p.programmeIds || []).length ? ` · ${(p.programmeIds || []).map(g => esc(programmeName(g))).join(", ")}` : ""}</div></div>
        <button class="btn small" data-mrp="${p.id}">Download ${esc(label)}</button></div>`).join("")
        || `<div class="empty">No running projects you can see</div>`}</div></div>

    <div class="card"><h2>By person</h2>
      <p class="small muted">What one person did that month — their days, the events they filed, the support they recorded, their tasks and journeys.</p>
      <div class="list">${team.map(u => `<div class="item"><div class="grow"><div class="t">${esc(u.name)}</div>
        <div class="s">${esc(u.postTitle || "")}${u.officeId ? " · " + esc(officeName(u.officeId)) : ""}</div></div>
        <button class="btn small quiet" data-mru="${u.id}">Download</button></div>`).join("")}</div></div>

    ${has("super_admin", "admin", "director_acf", "program_officer") ? `<div class="card"><h2>The whole organisation</h2>
      <p class="small muted">Every register for the month, one sheet each — what Administration needs for the monthly report.</p>
      <button class="btn" id="mrAll">Download everything for ${esc(label)}</button></div>` : ""}`);
  $("content").querySelectorAll("[data-mrtab]").forEach(b => b.onclick = () => { state.reportsTab = b.dataset.mrtab; routes.monthlyReports(); });
  if ($("mrMonth")) $("mrMonth").onchange = e => { state.mrMonth = e.target.value; routes.monthlyReports(); };
  if ($("mrWeek"))  $("mrWeek").onchange  = e => { state.mrWeek  = e.target.value; routes.monthlyReports(); };
  if ($("mrFY"))    $("mrFY").onchange    = e => { state.mrFY    = Number(e.target.value); routes.monthlyReports(); };
  if ($("mrAll")) $("mrAll").onclick = () => exportMonth(month);
  const g = async (c, n = 900) => (await db.collection(c).limit(n).get().catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));
  const sheet = (wb, name, rows) => { if (rows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 28)); };
  const inM = (r, f) => {
    const v = String(r[f]||"");
    if (_effFrom) return v >= _effFrom && v <= _effTo;
    return v.startsWith(month);
  };

  $("content").querySelectorAll("[data-mrp]").forEach(b => b.onclick = async () => {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const p = open.find(x => x.id === b.dataset.mrp); toast("Gathering " + (p.code || p.name) + "…");
    const [acts, bens, evs, exps, heads, drs] = await Promise.all(
      ["activities", "benefits", "eventReports", "expenses", "budgetHeads", "dayReports"].map(c => g(c)));
    const mine = acts.filter(a => a.projectId === p.id);
    const pb = bens.filter(x => x.projectId === p.id && inM(x, "date"));
    const pe = evs.filter(x => x.projectId === p.id && inM(x, "date"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Project: p.name, Code: p.code, Donor: p.donor,
      Month: label, "Prepared by": state.me.name, "Prepared on": today(),
      "Women reached this month": new Set(pb.map(x => x.personId).filter(Boolean)).size,
      "Services given": pb.length, "Events held": pe.length,
      "People at events": pe.reduce((s, e) => s + (Number(e.participants) || 0), 0),
      "of whom women": pe.reduce((s, e) => s + (Number(e.women) || 0), 0) }]), "Cover");
    sheet(wb, "Progress", mine.map(a => ({ Code: a.code, Activity: a.name, Target: a.target, Unit: a.unit,
      "This month": bens.filter(x => x.activityId === a.id && inM(x, "date")).length + evs.filter(x => x.activityId === a.id && inM(x, "date")).length,
      "To date": bens.filter(x => x.activityId === a.id).length + evs.filter(x => x.activityId === a.id).length,
      "Who is doing it": a.leadId ? userName(a.leadId) : "", Status: a.status })));
    sheet(wb, "Support given", pb.map(x => ({ Date: x.date, "Sakhi ID": x.personCode, Name: maskName(x.name, x.personCode),
      Service: x.service, Description: x.description, "Value ₹": x.value, District: x.district, Village: x.village,
      Activity: (mine.find(a => a.id === x.activityId) || {}).name, "Recorded by": (x.recordedByName || userName(x.recordedBy)) })));
    sheet(wb, "Events", pe.map(x => ({ Date: x.date, Heading: x.heading||x.name, Activity: x.activity||"", Place: x.place,
      District: x.district||"", State: x.state||"", Present: x.participants, Women: x.women, "Girls under 18": x.girls||"", Sakhis: x.survivors||"",
      Report: x.report||"", Outcome: x.outcome||"", "Next step": x.nextStep||"",
      "Filed by": x.filedByName || userName(x.uid), Status: x.status,
      "Evidence": fileLink(x.evidenceFile)||fileLink(x.files)||fileLink(x.driveUrl)||(x.evidenceId||"") })));
    sheet(wb, "Budget", heads.filter(h => h.projectId === p.id).map(h => ({ Code: h.code, Line: h.line,
      "Allocated ₹": h.total, "Spent to date ₹": exps.filter(e => e.headId === h.id || e.head === h.code).reduce((s, e) => s + (Number(e.amount) || 0), 0) || h.spentReported || 0 })));
    sheet(wb, "Day reports", drs.filter(x => x.projectId === p.id && inM(x, "date")).map(x => ({ Date: x.date,
      Who: userName(x.uid), Place: x.location, "What was done": x.text||x.narrative||"", "Task progress": x.taskProgress||"", "In the way": x.blockers||"",
      Attachments: (x.attachments||[]).map(a=>fileLink(a)).filter(Boolean).join(" | ") })));
    sheet(wb, "Spending", exps.filter(x => x.projectId === p.id && inM(x, "date")).map(x => ({ Date: x.date,
      Particulars: x.particulars, Payee: x.payee, "₹": x.amount, Head: x.head, Voucher: x.voucher, Status: x.status,
      Bill: fileLink(x.billUrl)||fileLink(x.bill)||"" })));
    XLSX.writeFile(wb, `${(p.code || p.name).replace(/\s+/g, "-")}-${month}.xlsx`);
    try{var _wbo=new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array'}));var _wbf=new File([_wbo],`${(p.code || p.name).replace(/\s+/g, "-")}-${month}.xlsx`,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});var _wdr=await uploadToDrive(_wbf,`Monthly Reports/Projects/${month}`,`${(p.code || p.name).replace(/\s+/g, "-")}-${month}.xlsx`);if(_wdr&&_wdr.url)await db.collection('monthlyArchives').add({type:'project',month,url:_wdr.url,name:_wdr.name,savedBy:state.user.uid,savedAt:today()});}catch(_we){console.warn('Drive save failed',_we);}
    audit("export", "project_month", p.id, month); toast("Downloaded");
  });

  $("content").querySelectorAll("[data-mru]").forEach(b => b.onclick = async () => {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const u = team.find(x => x.id === b.dataset.mru); toast("Gathering " + u.name + "…");
    const [drs, evs, bens, asg, jr, att, cu, per, ec, lv] = await Promise.all(
      ["dayReports", "eventReports", "benefits", "assignments", "journeys", "attendance", "caseUpdates", "persons", "expenseClaims", "leaveRequests"].map(c => g(c)));
    const mineD = drs.filter(x => x.uid === u.id && inM(x, "date"));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Name: u.name, Post: u.postTitle,
      Office: u.officeId ? officeName(u.officeId) : "", Month: label, "Prepared on": today(),
      "Days reported": mineD.length, "Events filed": evs.filter(x => x.uid === u.id && inM(x, "date")).length,
      "Support recorded": bens.filter(x => x.recordedBy === u.id && inM(x, "date")).length,
      "Tasks finished": asg.filter(x => x.assigneeId === u.id && inM(x, "doneAt")).length,
      "Sakhis registered": per.filter(x => x.registeredBy === u.id && inM(x, "registeredOn")).length,
      "Case updates": cu.filter(x => x.by === u.id && inM(x, "date")).length,
      "Days present": att.filter(x => x.uid === u.id && inM(x, "date")).length }]), "Cover");
    sheet(wb, "Day reports", mineD.map(x => ({ Date: x.date, Place: x.location, Project: projectName(x.projectId),
      "What was done": x.text, "Task progress": x.taskProgress, "In the way": x.blockers,
      Read: x.status === "verified" ? "Yes" : "No", "Manager said": x.managerNote , Attachments: (x.attachments||[]).map(a=>a.link||a.url||"").filter(Boolean).join(" | ") })));
    sheet(wb, "Events filed", evs.filter(x => x.uid === u.id && inM(x, "date")).map(x => ({ Date: x.date,
      Heading: x.heading||x.name, Activity: x.activity||"", Place: x.place, District: x.district||"", Present: x.participants, Women: x.women,
      Report: x.report||x.summary||"", Outcome: x.outcome||"", "Next step": x.nextStep||"", Status: x.status,
      Evidence: fileLink(x.evidenceFile)||fileLink(x.files)||fileLink(x.driveUrl)||(x.evidenceId||"") })));
    sheet(wb, "Sakhis registered", per.filter(x => x.registeredBy === u.id && inM(x, "registeredOn")).map(x => ({
      Date: x.registeredOn, "Sakhi ID": x.code, Name: x.name||[x.firstName,x.lastName].filter(Boolean).join(" "),
      Block: x.block, District: x.district, State: x.state, Programme: x.programmeName||"" })));
    sheet(wb, "Case updates", cu.filter(x => x.by === u.id && inM(x, "date")).map(x => ({
      Date: x.date, "Sakhi ID": x.personCode||"", Kind: x.kind, Note: x.note||"",
      Attachment: fileLink(x.file)||fileLink(x.attachment)||"" })));
    sheet(wb, "Expense claims", ec.filter(x => x.uid === u.id && inM(x, "date")).map(x => ({
      Date: x.date, Category: x.category, Description: x.description||x.purpose||"", "₹": x.amount,
      Status: x.status, Bill: fileLink(x.bill)||fileLink(x.billUrl)||"" })));
    sheet(wb, "Leave", lv.filter(x => x.uid === u.id && inM(x, "from")).map(x => ({
      From: x.from, To: x.to, Type: x.type, Days: x.days, Status: x.status })));
    sheet(wb, "Support recorded", bens.filter(x => x.recordedBy === u.id && inM(x, "date")).map(x => ({ Date: x.date,
      "Sakhi ID": x.personCode, Service: x.service, Description: x.description, "Value ₹": x.value })));
    sheet(wb, "Tasks", asg.filter(x => x.assigneeId === u.id && (inM(x, "due") || inM(x, "doneAt"))).map(x => ({
      Title: x.title, "Given by": userName(x.assignerId), Due: x.due, Status: x.status, Done: x.doneAt, "What was done": x.doneNote })));
    sheet(wb, "Journeys", jr.filter(x => x.uid === u.id && inM(x, "date")).map(x => ({ Date: x.date,
      From: x.fromPlace, To: x.toPlace, Purpose: x.purpose, Km: x.km, "Cost ₹": x.cost,
      "Who was met": x.metWhom, "What came of it": x.visitReport })));
    sheet(wb, "Attendance", att.filter(x => x.uid === u.id && inM(x, "date")).map(x => ({ Date: x.date,
      "Checked in": x.checkIn, "Checked out": x.checkOut, Where: x.where || "office", Place: x.place })));
    XLSX.writeFile(wb, `${u.name.replace(/\s+/g, "-")}-${month}.xlsx`);
    try{var _wbo=new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array'}));var _wbf=new File([_wbo],`${u.name.replace(/\s+/g, "-")}-${month}.xlsx`,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});var _wdr=await uploadToDrive(_wbf,`Monthly Reports/Staff/${month}`,`${u.name.replace(/\s+/g, "-")}-${month}.xlsx`);if(_wdr&&_wdr.url)await db.collection('monthlyArchives').add({type:'person',month,url:_wdr.url,name:_wdr.name,savedBy:state.user.uid,savedAt:today()});}catch(_we){console.warn('Drive save failed',_we);}
    audit("export", "person_month", u.id, month); toast("Downloaded");
  });

  
// ── By programme ──────────────────────────────────────────────────────
$("content").insertAdjacentHTML("beforeend",`
<div class="card"><h2>By programme</h2>
<p class="small muted">Everything filed under each programme for the month — day reports from team members, programme updates, support given, and Sakhis newly registered in the programme's states. Drive links to evidence are included in the workbook.</p>
<div class="list">${(state.programmes||[]).filter(p=>p.status==="Running"||p.status==="Active"||p.status==="active").map(p=>`<div class="item"><div class="grow"><div class="t">${esc(p.name)}</div>
<div class="s">${esc(p.statesText||"")} · ${esc(userName(p.leadId)||"")}</div></div>
<button class="btn small" data-mrprog="${p.id}">Download ${label}</button></div>`).join("")||`<div class="empty">No running programmes</div>`}</div></div>`);

$("content").querySelectorAll("[data-mrprog]").forEach(b=>b.onclick=async()=>{
  const progId=b.dataset.mrprog,prog=(state.programmes||[]).find(p=>p.id===progId)||{};
  const origTxt=b.textContent;b.disabled=true;b.textContent="Building…";
  try{
    const progStates=(prog.statesText||"").split(",").map(s=>s.trim()).filter(Boolean);
    const teamUids=[...new Set((prog.team||[]).concat(prog.leadId||[]))];
    const mStart=_effFrom||month+"-01",mEnd=_effTo||month+"-31";
    const dayArr=teamUids.length?(await Promise.all(teamUids.map(uid=>db.collection("dayReports").where("uid","==",uid).where("date",">=",mStart).where("date","<=",mEnd).limit(100).get().catch(()=>({docs:[]}))))).flatMap(s=>s.docs.map(d=>d.data())):[];
    const updArr=(await db.collection("programmeUpdates").where("programmeId","==",progId).where("date",">=",mStart).where("date","<=",mEnd).limit(200).get().catch(()=>({docs:[]}))).docs.map(d=>d.data());
    const benArr=progStates.length?(await Promise.all(progStates.map(st=>db.collection("benefits").where("state","==",st).where("date",">=",mStart).where("date","<=",mEnd).limit(200).get().catch(()=>({docs:[]}))))).flatMap(s=>s.docs.map(d=>d.data())):[];
    const sakArr=progStates.length?(await Promise.all(progStates.map(st=>db.collection("persons").where("state","==",st).where("registeredOn",">=",mStart).where("registeredOn","<=",mEnd).limit(200).get().catch(()=>({docs:[]}))))).flatMap(s=>s.docs.map(d=>d.data())):[];
    if(!window.XLSX)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');const wb=XLSX.utils.book_new();
    const addSheet=(rows,name)=>{if(rows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);};
    const evArr=(await Promise.all(teamUids.map(uid=>db.collection("eventReports").where("uid","==",uid).where("date",">=",mStart).where("date","<=",mEnd).limit(100).get().catch(()=>({docs:[]}))))).flatMap(s=>s.docs.map(d=>d.data()));
    const cuArr=progStates.length?(await Promise.all(progStates.map(st=>db.collection("caseUpdates").where("date",">=",mStart).where("date","<=",mEnd).limit(200).get().catch(()=>({docs:[]}))))).flatMap(s=>s.docs.map(d=>d.data())):[];
    addSheet(dayArr.map(r=>({Date:r.date||"",Staff:r.name||userName(r.uid)||"",Location:r.location||"",Narrative:r.narrative||r.text||"",Items:(r.items||[]).map(i=>i.note||i.label||i.what||"").filter(Boolean).join("; "),"Attachments":(r.attachments||[]).map(a=>fileLink(a)).filter(Boolean).join(" | ")})),"Day reports");
    addSheet(evArr.map(r=>({Date:r.date||"",Heading:r.heading||r.name||"",Activity:r.activity||"",Place:r.place||"",District:r.district||"",State:r.state||"",Participants:r.reached||r.participants||"",Women:r.women||"",Report:r.report||r.summary||"",Outcome:r.outcome||"","Next step":r.nextStep||"",By:userName(r.uid)||"",Status:r.status||"","Evidence":fileLink(r.evidenceFile)||fileLink(r.files)||fileLink(r.driveUrl)||(r.evidenceId||"")})),"Event reports");
    addSheet(updArr.map(r=>({Date:r.date||"",Kind:r.kind||"",State:r.state||"",Reached:r.reached||0,Update:r.text||"",By:userName(r.by)||""})),"Programme updates");
    addSheet(benArr.map(r=>({Date:r.date||"",Name:r.name||"",Service:r.service||"",Description:r.description||"",Value:r.value||"",State:r.state||"",District:r.district||""})),"Support given");
    addSheet(sakArr.map(r=>({Code:r.code||"",Name:r.name||(r.firstName||"")+" "+(r.lastName||""),State:r.state||"",District:r.district||"",Block:r.block||"",Registered:r.registeredOn||"",Type:r.slaveryType||"",Status:r.status||""})),"New Sakhis");
    addSheet(cuArr.map(r=>({Date:r.date||"","Sakhi ID":r.personCode||"",Kind:r.kind||"",Note:r.note||"",By:userName(r.by)||"",Attachment:fileLink(r.file)||fileLink(r.attachment)||""})),"Case updates");
    if(!wb.SheetNames.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{Note:"No data recorded for this programme this month."}]),"Empty");
    XLSX.writeFile(wb,(prog.code||prog.name||progId).replace(/\s+/g,"-")+"-"+month+".xlsx");
    try{var _wbo=new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array'}));var _wbf=new File([_wbo],`${(prog.code||prog.name||progId).replace(/\s+/g,"-")}-${month}.xlsx`,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});var _wdr=await uploadToDrive(_wbf,`Monthly Reports/Programmes/${month}`,`${(prog.code||prog.name||progId).replace(/\s+/g,"-")}-${month}.xlsx`);if(_wdr&&_wdr.url)await db.collection('monthlyArchives').add({type:'programme',month,url:_wdr.url,name:_wdr.name,savedBy:state.user.uid,savedAt:today()});}catch(_we){console.warn('Drive save failed',_we);}
audit("export","programme_month",progId,month);toast("Downloaded");
  }catch(err){toast("Could not build: "+(err.message||err));}
  b.disabled=false;b.textContent=origTxt;
});

// ── Department reports + retention ──────────────────────────────────
  $("content").insertAdjacentHTML("beforeend", `
  <div class="card">
    <h2>By department</h2>
    <p class="small muted">Department-level reports for Programme, Accounts, Administration and Fundraising.
    Each downloads as an Excel file and — if you choose — saves a copy to the shared Drive for the 7-year archive.</p>
    <div class="list">
      <div class="item"><div class="grow"><div class="t">Programme</div>
        <div class="s">Day reports · event reports · support given · case updates · activities · Sakhis registered</div></div>
        <button class="btn small" data-dept="programme">Download ${label}</button>
        <button class="btn small quiet" data-dept-drive="programme" style="margin-left:4px">Save to Drive</button></div>
      <div class="item"><div class="grow"><div class="t">Accounts</div>
        <div class="s">Expenses · petty cash · expense claims · advances · income receipts · requisitions</div></div>
        <button class="btn small" data-dept="accounts">Download ${label}</button>
        <button class="btn small quiet" data-dept-drive="accounts" style="margin-left:4px">Save to Drive</button></div>
      <div class="item"><div class="grow"><div class="t">Administration &amp; HR</div>
        <div class="s">Leave · DAK · journeys · travel requests</div></div>
        <button class="btn small" data-dept="admin">Download ${label}</button>
        <button class="btn small quiet" data-dept-drive="admin" style="margin-left:4px">Save to Drive</button></div>
      <div class="item"><div class="grow"><div class="t">Fundraising</div>
        <div class="s">Proposals · obligations · collaboration outreach</div></div>
        <button class="btn small" data-dept="fundraising">Download ${label}</button>
        <button class="btn small quiet" data-dept-drive="fundraising" style="margin-left:4px">Save to Drive</button></div>
    </div>
  </div>
  <div class="card"><h2>Data retention</h2>
    <p class="small muted">How long each type of record is kept — in the app and in Google Drive.</p>
    <table class="table"><tr><th>Tier</th><th>What</th><th>How long</th><th>Where</th></tr>
    <tr><td><b>Daily</b></td><td>All records (day reports, cases, expenses, events)</td><td>3 months quick access · preserved in monthly archive</td><td>App + nightly Drive backup</td></tr>
    <tr><td><b>Monthly</b></td><td>Monthly workbooks (this screen) + Firestore snapshots</td><td>7 years</td><td>Shared Drive · 04 Project Development / Reports</td></tr>
    <tr><td><b>Yearly</b></td><td>Financial year-end snapshot (31 March)</td><td>Permanent</td><td>Shared Drive · 05 Compliance / Annual records</td></tr>
    </table>
    <p class="small muted" style="margin-top:8px">Nightly backup: 2–3 am. Monthly archive: 1st of each month. Year-end: 31 March and 1 April. All encrypted in the EP APP shared drive.</p>
  </div>`);

  async function _deptXlsx(dept) {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.utils.book_new();
    const _from2=_effFrom||month+"-01", _to2=_effTo||month+"-31"; const gm = (col, f) => db.collection(col).where(f,">=",_from2).where(f,"<=",_to2).get().then(s=>s.docs.map(d=>({id:d.id,...d.data()}))).catch(()=>[]);
    if (dept==="programme") {
      const [drs,evs,bens,cu,pu,acts,pers] = await Promise.all([gm("dayReports","date"),gm("eventReports","date"),gm("benefits","date"),gm("caseUpdates","date"),gm("programmeUpdates","date"),db.collection("activities").limit(300).get().then(s=>s.docs.map(d=>({id:d.id,...d.data()}))).catch(()=>[]),gm("persons","registeredOn")]);
      sheet(wb,"Day reports",drs.map(x=>({Date:x.date,Who:userName(x.uid),Place:x.location,Project:projectName(x.projectId),"What was done":[x.text,x.narrative].filter(Boolean).join(" | "),"Evidence (Drive links)":(x.attachments||[]).map(a=>a.link||a.url||"").filter(Boolean).join(" | ")})));
      sheet(wb,"Events",evs.map(x=>({Date:x.date,Heading:x.heading||x.name||x.title,Activity:x.activity||"",Place:x.place||x.location,District:x.district||"",State:x.state||"",Participants:x.participants,Women:x.women,Report:x.report||x.summary||"",Outcome:x.outcome||"","Next step":x.nextStep||"","Filed by":x.filedByName||userName(x.uid),"Evidence":fileLink(x.evidenceFile)||fileLink(x.files)||fileLink(x.driveUrl)||(x.evidenceId||"")})));
      sheet(wb,"Support given",bens.map(x=>({Date:x.date,"Sakhi ID":x.personCode,Service:x.service,Description:x.description,"Value ₹":x.value,Project:projectName(x.projectId)})));
      sheet(wb,"Case updates",cu.map(x=>({Date:x.date,"Sakhi ID":x.personCode,Kind:x.kind,Note:x.note,By:userName(x.by)})));
      sheet(wb,"Programme updates",pu.map(x=>({Date:x.date,Programme:x.programmeName,State:x.state,"Women reached":x.reached,Update:x.text})));
      sheet(wb,"Activities",acts.map(x=>({Code:x.code,Activity:x.name,Target:x.target,Unit:x.unit,Status:x.status,Lead:userName(x.leadId)})));
      sheet(wb,"Sakhis registered",pers.map(x=>({Date:x.registeredOn,"Sakhi ID":x.code,Name:x.name||[x.firstName,x.lastName].filter(Boolean).join(" "),Block:x.block,District:x.district,State:x.state,Programme:x.programmeName||"","Registered by":userName(x.registeredBy)})));
    } else if (dept==="accounts") {
      const [exps,adv,inc,req,pc,ec] = await Promise.all([gm("expenses","date"),gm("advances","neededBy"),gm("incomeReceipts","date"),gm("requisitions","neededBy"),gm("pettyCash","date"),gm("expenseClaims","date")]);
      sheet(wb,"Expenses",exps.map(x=>({Date:x.date,Particulars:x.particulars,Payee:x.payee,"₹":x.amount,Head:x.head,Project:projectName(x.projectId),Voucher:x.voucher,"Paid by":x.mode,Status:x.status,"Bill":fileLink(x.billUrl)||fileLink(x.bill)||""})));
      sheet(wb,"Petty cash",pc.map(x=>({Date:x.date,Particulars:x.particulars,Payee:x.payee,"In ₹":x.inAmt||0,"Out ₹":x.outAmt||0,Project:projectName(x.projectId),"Bill":fileLink(x.bill)||fileLink(x.billUrl)||"","No-bill note":x.noBillNote||""})));
      sheet(wb,"Expense claims",ec.map(x=>({Date:x.date,Who:x.name||userName(x.uid),Category:x.category,Description:x.description||x.purpose||""," ₹":x.amount,Status:x.status,"Bill":fileLink(x.bill)||fileLink(x.billUrl)||""})));
      sheet(wb,"Advances",adv.map(x=>({Who:userName(x.uid),Purpose:x.purpose,"Advance ₹":x.amount,"Spent ₹":x.spent,"Returned ₹":x.returned,Status:x.status,Settled:x.settledOn})));
      sheet(wb,"Income receipts",inc.map(x=>({Date:x.date,"Receipt no.":x.receiptNo,Remitter:x.remitter,"₹":x.amount,Type:x.type,Purpose:x.purpose,Mode:x.mode,Bank:x.bank,Project:projectName(x.projectId),FCRA:x.fcra?"Yes":"No","Filed by":x.byName||userName(x.createdBy)})));
      sheet(wb,"Requisitions",req.map(x=>({Item:x.item,"₹":x.estimate,For:x.purpose,Asked:userName(x.uid),Status:x.status})));
    } else if (dept==="admin") {
      const [lv,dak,jr,tr] = await Promise.all([gm("leaveRequests","from"),gm("dak","date"),gm("journeys","date"),gm("travelRequests","from")]);
      sheet(wb,"Leave",lv.map(x=>({Who:userName(x.uid),Type:x.type,From:x.from,To:x.to,Days:x.days,Status:x.status})));
      sheet(wb,"DAK",dak.map(x=>({"Dak no.":x.dakNo,Date:x.date,Direction:x.direction,"From/to":x.fromTo,Subject:x.subject,Status:x.status})));
      sheet(wb,"Journeys",jr.map(x=>({Date:x.date,Who:userName(x.uid),From:x.fromPlace,To:x.toPlace,Purpose:x.purpose,Km:x.km,"Cost 20b9":x.cost})));
      sheet(wb,"Travel requests",tr.map(x=>({"From":x.from,"To date":x.to,Who:userName(x.travellerId),Purpose:x.purpose,Advance:x.advance||"",Status:x.status})));
    } else if (dept==="fundraising") {
      const [prop,obl] = await Promise.all([db.collection("proposals").get().then(s=>s.docs.map(d=>d.data())).catch(()=>[]),db.collection("obligations").get().then(s=>s.docs.map(d=>d.data())).catch(()=>[])]);
      sheet(wb,"Proposals",prop.map(x=>({Name:x.name,Org:x.org,Sent:x.sentOn,Status:x.status,Ask:x.ask})));
      sheet(wb,"Obligations",obl.map(x=>({Project:projectName(x.projectId),Type:x.type,Due:x.dueDate,Status:x.done?"Done":"Pending"})));
    }
    return wb;
  }

  $("content").querySelectorAll("[data-dept]").forEach(b => b.onclick = async () => {
    try { const d=b.dataset.dept; toast("Building "+d+" report…");
      const wb=await _deptXlsx(d); XLSX.writeFile(wb,"EP-"+d+"-"+month+".xlsx");
      try{var _wbo=new Uint8Array(XLSX.write(wb,{bookType:'xlsx',type:'array'}));var _wbf=new File([_wbo],`${d}-${month}.xlsx`,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});var _wdr=await uploadToDrive(_wbf,`Monthly Reports/${d.charAt(0).toUpperCase()+d.slice(1)}/${month}`,`${d}-${month}.xlsx`);if(_wdr&&_wdr.url)await db.collection('monthlyArchives').add({type:'dept',month,url:_wdr.url,name:_wdr.name,savedBy:state.user.uid,savedAt:today()});}catch(_we){console.warn('Drive save failed',_we);}
    audit("export","dept_month",null,d+"-"+month); toast("Downloaded"); }
    catch(e){ toast("Error: "+e.message); }
  });

  $("content").querySelectorAll("[data-dept-drive]").forEach(b => b.onclick = async () => {
    try { const d=b.dataset.deptDrive; toast("Saving "+d+" report to Drive…");
      const wb=await _deptXlsx(d);
      const arr=XLSX.write(wb,{bookType:"xlsx",type:"array"});
      const blob=new Blob([arr],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      const fname="EP-"+d+"-"+month+".xlsx";
      const file=new File([blob],fname,{type:blob.type});
      const result=await uploadToDrive(file,"program",file.name);
      if(result&&result.url){
        await db.collection("monthlyArchives").add({dept:d,month,label,url:result.url,name:result.name,savedBy:state.user.uid,savedAt:today()});
        audit("export","dept_month_drive",null,d+"-"+month);
        toast("Saved to Drive — link recorded ✓"); b.textContent="✓ Saved"; b.disabled=true;
      } else { toast("Upload failed — try Download instead"); }
    } catch(e){ toast("Save failed: "+e.message); }
  });
};


/* ================= MY PLAN =================
   A person's own list of what they intend to do. Not tasks given to them and not a
   project's work plan — the things they are holding in their head, written down. */
routes.myPlan = async (whoId, tab) => {
  tab = tab || state.planTab || "plan"; state.planTab = tab;
  const uid = whoId || viewUid();
  const person = (state.users || []).find(u => u.id === uid) || state.me;
  const mineView = uid === viewUid();
  setTitle(mineView ? "My plan" : `${person.name}'s plan`);
  // Ensure programmes are loaded so actRow can show their names
  if (!state.programmes || !state.programmes.length) {
    try { state.programmes = (await db.collection("programmes").get()).docs.map(d=>({id:d.id,...d.data()})); } catch {}
  }
  const [acts, lines, bens, evs, myTasks] = await Promise.all([
    db.collection("activities").limit(400).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("planLines").where("uid", "==", uid).limit(400).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("benefits").get().then(s => s.docs.map(d => d.data())).catch(() => []),
    db.collection("assignments").where("assigneeId", "==", uid).get().then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(() => []),
    db.collection("eventReports").limit(300).get().then(s => s.docs.map(d => d.data())).catch(() => [])]);
  const mine = acts.filter(a =>
    a.leadId === uid ||
    (state.projects||[]).find(p=>p.id===a.projectId)?.team?.includes(uid) ||
    (state.programmes||[]).find(p=>p.id===a.programmeId)?.team?.includes(uid)
  );
  /* The months this person can plan across: from now to the end of the projects they
     are working on, capped so the screen stays readable. */
  const months = (() => {
    const out = []; const n = new Date(); let d = new Date(n.getFullYear(), n.getMonth(), 1);
    const ends = mine.map(a => (state.projects || []).find(p => p.id === a.projectId))
      .filter(Boolean).map(p => p.end).filter(Boolean).sort();
    const last = ends.length ? new Date(ends[ends.length - 1]) : new Date(n.getFullYear(), n.getMonth() + 5, 1);
    while (d <= last && out.length < 12) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); }
    return out;
  })();
  const mLabel = m => new Date(m + "-01").toLocaleDateString("en-IN", { month: "short" });
  const planned = (a, m) => { const l = lines.find(x => x.activityId === a.id && x.month === m); return l ? Number(l.planned) || 0 : ""; };
  const did = (a, m) => bens.filter(b => b.activityId === a.id && String(b.date || "").startsWith(m) && b.status === "verified").length
    + evs.filter(e => e.activityId === a.id && String(e.date || "").startsWith(m) && e.status === "verified").length;
  const noteOf = a => (lines.find(x => x.activityId === a.id && !x.month) || {}).note || "";
  const totalPlanned = a => months.reduce((s, m) => s + (Number(planned(a, m)) || 0), 0);
  const totalDid = a => bens.filter(b => b.activityId === a.id && b.status === "verified").length
    + evs.filter(e => e.activityId === a.id && e.status === "verified").length;
  // Parse period string to YYYY-MM for comparison
  const parsePeriod = p => {
    if (!p) return null;
    const MN = {Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
    const m = String(p).match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
    if (m) return `${m[2]}-${MN[m[1]]}`;
    const q = String(p).match(/Q(\d)\s+(\d{4})-(\d{2})/i);
    if (q) { const starts=[null,"04","07","10","01"]; const qn=Number(q[1]); const yr=qn===4?`20${q[3]}`:q[2]; return `${yr}-${starts[qn]}`; }
    return null;
  };
  const now = today().slice(0,7); // YYYY-MM
  const addMonths = (ym, n) => { const [y,m]=ym.split("-").map(Number); const d=new Date(y,m-1+n,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
  const m3 = addMonths(now,3), m6 = addMonths(now,6);
  const fyStart = now.slice(5)<="03" ? `${Number(now.slice(0,4))-1}-04` : `${now.slice(0,4)}-04`;
  const fyEnd = now.slice(5)<="03" ? `${now.slice(0,4)}-03` : `${Number(now.slice(0,4))+1}-03`;

  // End period: if no endPeriod, activity ends last day of its period month
  const endOfPeriod = p => {
    if (!p) return null;
    const ym = parsePeriod(p);
    if (!ym) return null;
    // Last day of that month
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0); // day 0 of next month = last day of this month
    return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;
  };

  const inHorizon = (a, horizon) => {
    const startYM = parsePeriod(a.period);
    const endYM = parsePeriod(a.endPeriod) || startYM; // end month = start month if no endPeriod
    if (!startYM) return horizon === "year";
    const todayFull = today(); // YYYY-MM-DD
    const endDate = endOfPeriod(a.endPeriod || a.period); // last day of end month
    const isOverdue = endDate && endDate < todayFull && endYM < now;
    if (horizon === "month") return startYM <= now && endYM >= now;
    if (horizon === "3m") return startYM <= m3 && endYM >= now && !isOverdue;
    if (horizon === "6m") return startYM <= m6 && endYM >= now && !isOverdue;
    if (horizon === "year") return startYM >= fyStart && startYM <= fyEnd;
    return false;
  };

  const isOverdue = a => {
    const endYM = parsePeriod(a.endPeriod || a.period);
    return endYM ? endYM < now : false;
  };

  const horizons = [
    { key:"month", label:"This month" },
    { key:"3m",    label:"3 months" },
    { key:"6m",    label:"6 months" },
    { key:"year",  label:"This year" }
  ];
  const planTab = state.planHorizon || "month";
  const filtered = mine.filter(a => inHorizon(a, planTab));

  const actRow = a => {
    const proj = (state.projects||[]).find(p=>p.id===a.projectId) || (state.programmes||[]).find(p=>p.id===a.programmeId) || {};
    const done = totalDid(a);
    const target = a.target ? `${a.target} ${esc(a.unit||"")}` : "—";
    return `<tr>
      <td><b>${esc(a.code||"")}</b></td>
      <td>${esc(a.name)}</td>
      <td class="small muted">${esc(proj.code||proj.name||"").slice(0,30)}</td>
      <td class="small">${esc(a.period||"")}</td>
      <td>${target}</td>
      <td><b style="color:${done>=Number(a.target)&&a.target?"var(--ok)":""}">${done||"—"}</b></td>
      <td>${statusTag(a.status)}</td>
      ${mineView?`<td><button class="btn small quiet" data-planact="${a.id}">Set targets</button></td>`:""}
    </tr>`;
  };

  html(`
    <!-- Header -->
    <div class="card">
      <h2>${mineView ? "My plan" : esc(person.name)+"'s plan"}</h2>
      <p class="small muted">Activities from all your projects and programmes, grouped by when they fall due.</p>
      ${mine.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        <span class="tag">${mine.length} ${mine.length===1?"activity":"activities"} across all horizons</span>
        <span class="tag ok">${mine.reduce((s,a)=>s+totalDid(a),0)} done total</span>
      </div>` : ""}
    </div>

    <!-- Horizon tabs -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
      ${horizons.map(h=>`<button class="btn small ${planTab===h.key?"":"quiet"}" data-horizon="${h.key}">${h.label}
        <span class="small" style="margin-left:4px;opacity:.7">(${mine.filter(a=>inHorizon(a,h.key)).length})</span>
      </button>`).join("")}
    </div>

    <!-- Activities for selected horizon -->
    <div class="card">
      <h2>${horizons.find(h=>h.key===planTab)?.label} · ${filtered.length} ${filtered.length===1?"activity":"activities"}</h2>
      ${filtered.length ? `<div class="tablewrap"><table class="table">
        <tr><th>Code</th><th>Activity</th><th>Project</th><th>Period</th><th>Target</th><th>Done</th><th>Status</th>${mineView?"<th></th>":""}</tr>
        ${filtered.map(actRow).join("")}
      </table></div>` :
      (() => {
        const overdue = mine.filter(a => isOverdue(a) && !inHorizon(a, planTab));
        return `${overdue.length && planTab==="month" ? `<div class="err" style="margin-bottom:8px">
          ${overdue.length} overdue activit${overdue.length===1?"y":"ies"} not shown here — check This year view.
        </div>` : ""}
        <div class="empty">No activities due ${planTab==="month"?"this month":planTab==="3m"?"in the next 3 months":planTab==="6m"?"in the next 6 months":"this financial year"}.</div>`;
      })()}
    </div>

    <!-- Assigned tasks for selected horizon -->
    ${(() => {
      const now2 = today();
      const taskFiltered = (myTasks||[]).filter(a => {
        if (a.status === "verified") return false;
        const due = a.due || "";
        if (planTab === "month") return due.slice(0,7) === now.slice(0,7) || (!due && a.status !== "done – to verify");
        if (planTab === "3m") return (!due || due <= m3) && due >= now2;
        if (planTab === "6m") return (!due || due <= m6) && due >= now2;
        if (planTab === "year") return (!due || (due >= fyStart && due <= fyEnd));
        return false;
      });
      if (!taskFiltered.length) return "";
      return `<div class="card">
        <h2>Tasks assigned to me · ${taskFiltered.length}</h2>
        <div class="list">${taskFiltered.map(a => `<div class="item" style="flex-direction:column;align-items:flex-start;gap:4px">
          <div style="display:flex;width:100%;align-items:center;gap:8px;flex-wrap:wrap">
            <b style="font-size:14px">${esc(a.title)}</b>
            <span class="small muted">from ${esc(userName(a.assignerId))}</span>
            ${a.due ? `<span class="small muted">· due ${fmtD(a.due)}</span>` : ""}
            ${a.priority?.startsWith("1") ? `<span class="tag bad">high</span>` : ""}
            <span class="tag ${a.status==="in progress"?"warn":a.status==="done – to verify"?"ok":""}" style="margin-left:auto">${esc(a.status==="done – to verify"?"done, waiting check":a.status||"assigned")}</span>
          </div>
          ${a.instructions ? `<div class="small muted">${esc(String(a.instructions).slice(0,100))}</div>` : ""}
          ${(a.updates||[]).length ? `<div class="small muted">Last update: ${esc((a.updates[a.updates.length-1].text||"").slice(0,80))}</div>` : ""}
        </div>`).join("")}</div>
        <button class="btn small quiet" style="margin-top:8px" onclick="go('mywork')">Go to My work →</button>
      </div>`;
    })()}

    <!-- Planning detail (hidden, toggled per activity) -->
    ${mineView && filtered.length ? filtered.map(a=>`
      <div id="planDetail_${a.id}" class="hidden">
        <div class="card" style="border:1px solid var(--line)">
          <h3 style="margin:0 0 8px">${esc(a.name)} · ${esc(a.period||"")} · Set monthly targets</h3>
          <div class="tablewrap"><table class="table">
            <tr><th></th>${months.map(m=>`<th style="text-align:center;font-size:11px">${mLabel(m)}</th>`).join("")}</tr>
            <tr><td class="small muted">I plan to</td>
              ${months.map(m=>`<td style="text-align:center"><input type="number" step="1" inputmode="numeric"
                data-plan="${a.id}|${m}" value="${planned(a,m)}"
                style="width:46px;text-align:center;padding:4px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:inherit"></td>`).join("")}</tr>
            <tr><td class="small muted">Done</td>
              ${months.map(m=>{const d=did(a,m),pl=Number(planned(a,m))||0;return`<td style="text-align:center"><b style="color:${d>=pl&&pl?"var(--ok)":d?"":"var(--muted)"}">${d||"·"}</b></td>`;}).join("")}</tr>
          </table></div>
          <button class="btn small" data-save="${a.id}" style="margin-top:8px">Save</button>
        </div>
      </div>`).join("") : ""}
  `);
  // Horizon tab switching
  $("content").querySelectorAll("[data-horizon]").forEach(b => b.onclick = () => {
    state.planHorizon = b.dataset.horizon; routes.myPlan(uid, tab); });

  if (!mineView) return;

  // Set targets toggle
  $("content").querySelectorAll("[data-planact]").forEach(b => b.onclick = () => {
    const box = document.getElementById("planDetail_" + b.dataset.planact);
    if (!box) return;
    box.classList.toggle("hidden");
    b.textContent = box.classList.contains("hidden") ? "Set targets" : "Close";
  });

  const saveLine = async aid => {
    const cells = [...$("content").querySelectorAll(`[data-plan^="${aid}|"]`)];
    for (const el of cells) {
      const [, m] = el.dataset.plan.split("|");
      const v = el.value === "" ? null : Number(el.value) || 0;
      const ex = lines.find(x => x.activityId === aid && x.month === m);
      if (ex) await db.collection("planLines").doc(ex.id).update({ planned: v });
      else if (v !== null) await db.collection("planLines").add({ uid, activityId: aid, month: m, planned: v,
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  };
  $("content").querySelectorAll("[data-save]").forEach(b => b.onclick = async () => {
    b.textContent = "Saving…"; b.disabled = true;
    await saveLine(b.dataset.save);
    b.textContent = "Saved ✓"; setTimeout(() => { b.textContent = "Save"; b.disabled = false; }, 1500);
  });
};



/* ================= WHAT WAS ACTUALLY DONE =================
   An approval is not the end of a request. Somebody books the cab, buys the materials,
   pays the money — and what they did has to come back to the file, or the request is
   approved for ever and nobody knows whether it happened. */
function askActionTaken(rec) {
  return new Promise(resolve => {
    const box = document.createElement("div"); box.className = "modal";
    box.innerHTML = `<div class="modal-card"><h2>What did you do?</h2>
      <p class="small muted">${esc((rec.item || rec.purpose || "").slice(0, 90))}</p>
      <label class="field"><span>What was arranged or bought</span>
        <textarea id="atWhat" rows="2" placeholder="Booked a 5-seater cab with Sharma Travels for 16–17 October"></textarea></label>
      <div class="two">
        <label class="field"><span>From whom</span><input id="atFrom" placeholder="Vendor, shop or driver"></label>
        <label class="field"><span>What it cost ₹</span><input type="number" step="any" inputmode="decimal" id="atCost"></label></div>
      <div class="two">
        <label class="field"><span>When</span><input type="date" id="atDate" value="${today()}"></label>
        <label class="field"><span>Bill or reference</span><input id="atRef" placeholder="Bill no., UPI or UTR"></label></div>
      <label class="field"><span>Bill, if you have it</span><input type="file" id="atBill" accept="image/*,.pdf"></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="atCancel">Cancel</button><button class="btn small" id="atOk">Done</button></div></div>`;
    document.body.appendChild(box);
    let bill = null;
    box.querySelector("#atBill").onchange = async e => { const f = e.target.files[0]; if (!f) return;
      try { bill = f.size < 700000 && /^image\//.test(f.type)
        ? (await uploadToDrive(f,'accounts',f.name))
        : await uploadToDrive(f, "accounts", rec.item || rec.purpose || "bill"); } catch (err) { toast("⚠ Upload failed — " + err.message); } };
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#atCancel").onclick = () => close(null);
    box.querySelector("#atOk").onclick = () => {
      const what = box.querySelector("#atWhat").value.trim();
      if (!what) return alert("Say what you did, even in a few words.");
      close({ what, from: box.querySelector("#atFrom").value.trim(),
        cost: Number(box.querySelector("#atCost").value) || null,
        on: box.querySelector("#atDate").value || today(),
        ref: box.querySelector("#atRef").value.trim(), bill,
        by: state.user.uid, byName: state.me.name, at: today() });
    };
    box.onclick = e => { if (e.target === box) close(null); };
  });
}
/** Record what was done, then send it back to whoever asked. */
async function recordActionTaken(col, rec) {
  const a = await askActionTaken(rec);
  if (!a) return false;
  await db.collection(col).doc(rec.id).update({
    actionTaken: a, status: "arranged — with " + (userName(rec.uid) || "the person who asked"),
    doneOn: a.on, doneBy: state.user.uid
  });
  try { const t = await db.collection("assignments").where("fromId", "==", rec.id).limit(5).get();
    t.docs.forEach(d => d.ref.update({ status: "done – to verify", doneAt: a.on, doneNote: a.what })); } catch { }
  audit("action_taken", col, rec.id, `${a.what}${a.cost ? " · ₹" + a.cost : ""}`);
  toast("Recorded — " + (a.what || "").slice(0, 40));
  return true;
}


/* ---- the last turn of the circle ---- */

/** The person who asked says whether they got it, and what came of it. */
function askGotItAndReport(rec) {
  return new Promise(resolve => {
    const box = document.createElement("div"); box.className = "modal";
    const a = rec.actionTaken || {};
    box.innerHTML = `<div class="modal-card"><h2>Did you get it, and what came of it?</h2>
      <p class="small muted">${esc((rec.item || rec.purpose || "").slice(0, 90))}</p>
      ${a.what ? `<p class="small">${esc(userName(a.by) || a.byName || "Someone")} recorded: <b>${esc(a.what)}</b>${a.cost ? ` · ₹${Number(a.cost).toLocaleString("en-IN")}` : ""}${a.from ? ` · ${esc(a.from)}` : ""}</p>` : ""}
      <label class="check"><input type="radio" name="gotit" value="yes" checked> Yes, I got it</label>
      <label class="check"><input type="radio" name="gotit" value="partly"> Partly, or not as asked</label>
      <label class="check"><input type="radio" name="gotit" value="no"> No, I did not get it</label>
      <label class="field"><span>What you did with it, and what came of it</span>
        <textarea id="giWhat" rows="3" placeholder="Went to Khijri and Jatawala on 16–17 October with Meena and Nasima. Met 23 women, 11 enrolled for the slipper unit."></textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn small quiet" id="giCancel">Later</button><button class="btn small" id="giOk">Send</button></div></div>`;
    document.body.appendChild(box);
    const close = v => { box.remove(); resolve(v); };
    box.querySelector("#giCancel").onclick = () => close(null);
    box.querySelector("#giOk").onclick = () => {
      const got = box.querySelector('input[name="gotit"]:checked').value;
      const what = box.querySelector("#giWhat").value.trim();
      if (!what) return alert("Say in a line or two what came of it — that is what closes this.");
      close({ got, what, by: state.user.uid, on: today() });
    };
    box.onclick = e => { if (e.target === box) close(null); };
  });
}
async function confirmAndReport(col, rec) {
  const r = await askGotItAndReport(rec);
  if (!r) return false;
  await db.collection(col).doc(rec.id).update({
    received: r, status: r.got === "no" ? "not received — back to the department"
      : "reported — waiting to be closed", reportedOn: r.on
  });
  audit("received", col, rec.id, r.got + " · " + r.what.slice(0, 50));
  toast(r.got === "no" ? "Sent back" : "Thank you — it goes to be closed");
  return true;
}
/** Whoever verified it reads the report and closes the matter. */
async function closeTheMatter(col, rec) {
  const note = prompt("Closing this. Anything to add? (optional)") || "";
  await db.collection(col).doc(rec.id).update({
    status: "Closed", closedBy: state.user.uid, closedOn: today(), closeNote: note
  });
  audit("close", col, rec.id, note); toast("Closed");
  return true;
}

/* ================= WHO IS WHERE TODAY =================
   One screen answering the question an office asks every morning: who is here, who is
   in the field, who is at home, who is on leave, and who has not said. */
routes.whoToday = async () => {
  setTitle("Who is where today");
  const day = state.whoDay || today();
  const [att, lv, drs] = await Promise.all([
    db.collection("attendance").limit(400).get().then(s => s.docs.map(d => d.data())).catch(() => []),
    db.collection("leaveRequests").limit(300).get().then(s => s.docs.map(d => d.data())).catch(() => []),
    db.collection("dayReports").limit(300).get().then(s => s.docs.map(d => d.data())).catch(() => [])]);
  const team = (state.users || []).filter(u => u.active && isStaff(u));
  const mine = u => isAccounts() || seesWholeOrg() || has("admin", "program_officer", "program_coord")
    || u.officeId === state.me.officeId || mgrs(u).includes(state.user.uid) || u.id === state.user.uid;
  const people = team.filter(mine);
  const onDay = u => att.find(a => a.uid === u.id && a.date === day) || null;
  const leaveOn = u => lv.find(l => l.uid === u.id && /approved/i.test(l.status || "")
    && String(l.from || "") <= day && String(l.to || l.from || "") >= day) || null;
  const where = u => {
    const l = leaveOn(u);
    if (l && /work from home/i.test(l.type || "")) return { k: "home", t: "Working from home" };
    if (l) return { k: "leave", t: `On leave${l.type && !/casual|sick/i.test(l.type) ? " · "+l.type : ""}${l.to && l.to !== l.from ? " · till "+fmtD(l.to) : l.from ? " · "+fmtD(l.from) : ""}` };
    const a = onDay(u);
    if (!a || !a.checkIn) return { k: "none", t: "Not said yet" };
    if (/home/i.test(a.where || a.place || "")) return { k: "home", t: "Working from home", a };
    if (/field/i.test(a.where || "")) return { k: "field", t: "In the field" + (a.place ? " · " + a.place : ""), a };
    return { k: "office", t: (officeName(u.officeId) || "At the office"), a };
  };
  const rows = people.map(u => ({ u, w: where(u), wrote: drs.some(r => r.uid === u.id && r.date === day) }));
  const group = k => rows.filter(r => r.w.k === k).sort((a, b) => String(a.u.name || "").localeCompare(String(b.u.name || "")));
  const block = (k, title, tone) => { const g = group(k); if (!g.length) return "";
    return `<div class="card"><h2>${title} (${g.length})</h2><div class="list">
      ${g.map(r => `<div class="item"><div class="grow">
        <div class="t">${esc(r.u.name || "")}</div>
        <div class="s">${esc(r.u.postTitle || "")}${r.w.a && r.w.a.checkIn ? ` · in at ${esc(r.w.a.checkIn)}${r.w.a.checkOut ? `, out at ${esc(r.w.a.checkOut)}` : ""}` : ""}
          ${r.w.k !== "none" ? ` · ${esc(r.w.t)}` : ""}
</div></div>
        ${r.w.k !== "leave" && r.w.k !== "none"
          ? `<span class="tag ${r.wrote ? "ok" : ""}">${r.wrote ? "day report written" : "no day report yet"}</span>` : ""}
        ${r.w.a && r.w.a.wfhStatus === "awaiting approval" ? `<span class="tag warn">not yet agreed</span>` : ""}
      </div>`).join("")}</div></div>`; };
  html(`<div class="card"><h2>Who is where today</h2>
      <label class="field" style="max-width:200px"><span>Day</span><input type="date" id="whoDay" value="${day}" max="${today()}"></label>
      <p><span class="tag ok">${group("office").length} at the office</span>
        <span class="tag">${group("field").length} in the field</span>
        <span class="tag">${group("home").length} working from home</span>
        <span class="tag warn">${group("leave").length} on leave</span>
        <span class="tag ${group("none").length ? "bad" : ""}">${group("none").length} have not said</span></p>
      ${day === today() && !onDay(state.me) && !leaveOn(state.me)
        ? `<p class="small muted">You have not checked in today. <button class="btn small" onclick="go('home')">Do it now</button></p>` : ""}</div>
    ${block("office", "At the office")}
    ${block("field", "In the field")}
    ${block("home", "Working from home")}
    ${block("leave", "On leave")}
    ${block("none", "Have not said where they are")}
    ${people.length === 0 ? `<div class="card"><div class="empty">Nobody to show</div></div>` : ""}`);
  $("whoDay").onchange = e => { state.whoDay = e.target.value; routes.whoToday(); };
  // Quick mark absent — for admins and managers
  if (has("super_admin","founder","admin","director_acf","program_officer","program_lead","program_coord")) {
    const markBtn = document.createElement("button");
    markBtn.className = "btn small quiet"; markBtn.style.margin = "8px 16px";
    markBtn.textContent = "Mark someone absent today";
    $("content").appendChild(markBtn);
    markBtn.onclick = () => {
      const myTeam = staffList().filter(u => u.id !== state.user.uid && (has("super_admin","founder","admin","director_acf") || (u.managerIds||[]).includes(state.user.uid) || u.managerId===state.user.uid));
      if (!myTeam.length) { toast("No team members to mark"); return; }
      const box = document.createElement("div"); box.className = "modal";
      box.innerHTML = `<div class="modal-card"><h2>Mark absent today</h2>
        <label class="field"><span>Staff member</span><select id="mabStaff"><option value="">— select —</option>${myTeam.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Type</span><select id="mabType">
          <option value="Absent without leave">Absent without leave</option>
          <option value="Sick leave">Sick leave</option>
          <option value="Casual leave">Casual leave</option>
          <option value="Leave without pay">Leave without pay</option>
          <option value="Work from home">Working from home</option>
        </select></label>
        <label class="field"><span>Note</span><input type="text" id="mabNote" placeholder="e.g. informed on WhatsApp"></label>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn" id="mabSave">Save</button>
          <button class="btn quiet" id="mabCancel">Cancel</button>
        </div>
      </div>`;
      document.body.appendChild(box);
      $("mabCancel").onclick = () => document.body.removeChild(box);
      $("mabSave").onclick = async () => {
        const uid = $("mabStaff").value;
        const type = $("mabType").value;
        const note = $("mabNote").value.trim();
        if (!uid) { toast("Select a staff member"); return; }
        const u = staffList().find(s=>s.id===uid);
        $("mabSave").disabled=true; $("mabSave").textContent="Saving…";
        await db.collection("leaveRequests").add({
          uid, name: u?.name||"", type, from: today(), to: today(), days: 1,
          reason: note || "Marked by " + state.me.name,
          status: "approved", approvedBy: state.user.uid,
          approveNote: "Marked on staff member's behalf by " + state.me.name,
          approveAt: today(), markedBy: state.user.uid,
          managerIds: mgrs(u)||[], fromTime:"09:00", toTime:"18:00",
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        audit("leave_recorded","leaveRequests",null,(u?.name||uid)+" "+type+" "+today());
        toast(`${u?.name||uid} marked as ${type} today`);
        document.body.removeChild(box);
        routes.whoToday();
      };
    };
  }
};

/* ================= THE POLICY ASSISTANT =================
   Ask a question in your own words and get the clauses that answer it, quoted with
   their numbers. It never paraphrases and never invents: what it shows is what the
   manual says, so nobody acts on a summary of a rule. */
routes.policy = async () => {
  setTitle("Policy assistant");
  const q = (state.policyQ || "").trim();
  const DOCS = (typeof POLICY_DOCS !== "undefined") ? POLICY_DOCS : [];
  /* Both documents are searched together — nobody should have to know which one
     holds the answer. Each clause says where it came from. */
  const ALL = DOCS.flatMap(d => d.sections.map(s => ({ ...s, doc: d.short, docTitle: d.title })));
  const P = { sections: ALL };
  const STOP = new Set("a an and are as at be by can do does for from has have how i if in is it my me not of on or our shall should that the their there these this to was we what when where which who will with you your".split(" "));
  const words = q.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  /* People do not type the words a manual uses — "harasses" for "harassment",
     "fired" for "termination". So match on the stem of a word, and weigh a match in
     the heading far above one buried in the text. */
  const stem = w => w.replace(/(ing|ed|es|s|ment|tion|ness)$/, "").slice(0, 6);
  const SAME = { fired: "terminat", sacked: "terminat", sack: "terminat", holiday: "leave",
    chutti: "leave", money: "financ", buy: "procur", purchase: "procur", bribe: "corrupt",
    child: "child", kid: "child", abuse: "safeguard", complain: "grievanc", complaint: "grievanc" };
  const score = s => {
    if (!words.length) return 0;
    const t = (s.n + " " + s.t).toLowerCase(), b = (s.b || "").toLowerCase();
    let n = 0;
    words.forEach(w => {
      const forms = [w, stem(w), SAME[w] || ""].filter(Boolean);
      let inTitle = false, inBody = 0;
      forms.forEach(f => { if (t.includes(f)) inTitle = true;
        inBody += (b.match(new RegExp(f, "g")) || []).length; });
      if (inTitle) n += 25;                       // the heading is what the clause is about
      n += Math.min(inBody, 4) * 2;               // repeated words help, but only so far
    });
    /* A section matching every word asked beats one matching a single word often. */
    const covered = words.filter(w => [w, stem(w), SAME[w] || ""].filter(Boolean)
      .some(f => t.includes(f) || b.includes(f))).length;
    return n * (covered / words.length);
  };
  const hits = words.length
    ? P.sections.map(s => ({ s, n: score(s) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 5)
    : [];
  const show = s => `<div class="card"><h2 style="text-transform:none;letter-spacing:0;font-size:16px;color:var(--ink)">
      ${esc(s.doc || "")} §${esc(s.n)} ${esc(s.t)}</h2>
      <p style="white-space:pre-wrap;line-height:1.55">${esc(s.b || "(this section has no text of its own)")}</p></div>`;
  html(`<div class="card"><h2>Policy assistant</h2>
      <p class="small muted">${DOCS.map(d => esc(d.title)).join(" · ")} — ${ALL.length} sections in all.
        Ask in your own words. What you see is quoted from the manual, not summarised — act on the clause, not on a paraphrase.</p>
      <form id="pqf" style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="pq" value="${esc(q)}" placeholder="How long do I have to settle an advance?" style="flex:1;min-width:220px">
        <button class="btn" type="submit">Ask</button></form>
      <p class="small muted" style="margin-top:8px">${["How much casual leave do I get", "How long to settle an advance", "Who approves a purchase",
        "What to do about harassment", "Child protection", "Notice period"]
        .map(x => `<button class="btn small quiet" data-pq="${esc(x)}">${esc(x)}</button>`).join(" ")}</p></div>

    ${q && !hits.length ? `<div class="card"><div class="empty">Nothing in the manual uses those words.
      Try other words, or look through the sections below. If the manual is silent on it, ask the Director ACF —
      and it may be something the policy should cover.</div></div>` : ""}

    ${hits.map(h => show(h.s)).join("")}

    <div class="card"><h2>${q ? "Everything else in the manual" : "The whole manual"} (${P.sections.length} sections)</h2>
      <div class="list">${P.sections.filter(s => !hits.some(h => h.s.n === s.n)).map(s =>
        `<div class="item" style="cursor:pointer" data-sec="${esc((s.doc || "") + s.n)}"><div class="grow">
          <div class="t"><span class="tag">${esc(s.doc || "")}</span> §${esc(s.n)} ${esc(s.t)}</div>
          <div class="s">${esc((s.b || "").slice(0, 90))}${(s.b || "").length > 90 ? "…" : ""}</div></div></div>`).join("")}</div></div>`);
  $("pqf").onsubmit = e => { e.preventDefault(); state.policyQ = $("pq").value; routes.policy(); };
  $("content").querySelectorAll("[data-pq]").forEach(b => b.onclick = () => { state.policyQ = b.dataset.pq; routes.policy(); });
  $("content").querySelectorAll("[data-sec]").forEach(b => b.onclick = () => {
    const s = P.sections.find(x => (x.doc + x.n) === b.dataset.sec);
    if (s) { state.policyQ = s.t; routes.policy(); } });
};



routes.myActivities = () => { state.planTab = 'activities'; routes.myPlan(); };

// Travel tab in Ask for something — async loader
const _loadTravelTab = async () => {
  const uid = state.user.uid;
  const [trav, jours] = await Promise.all([
    db.collection("travelRequests").where("uid", "==", uid).orderBy("createdAt", "desc").limit(50).get().catch(() => ({docs:[]})),
    db.collection("journeys").where("travellerId", "==", uid).orderBy("createdAt", "desc").limit(50).get().catch(() => ({docs:[]}))
  ]);
  const travList = trav.docs.map(d => ({id: d.id, ...d.data()}));
  const jourList = jours.docs.map(d => ({id: d.id, ...d.data()}));
  const el = document.getElementById("content");
  if (!el) return;
  el.insertAdjacentHTML("beforeend",
    `<div class="card"><h2>Travel requests (${travList.length})</h2>
      <div class="list">${travList.map(r => `<div class="item"><div class="grow">
        <div class="t">${esc(r.purpose || "Travel request")}</div>
        <div class="s">${fmtD(r.date || r.from || "")} · ${esc(r.destination || "")} · ${esc(r.mode || "")}</div></div>
        <span class="tag ${r.status === "approved" ? "ok" : "warn"}">${esc(r.status || "submitted")}</span></div>`).join("") || "<div class='empty'>No travel requests yet</div>"}</div>
      <button class="btn small" style="margin-top:8px" onclick="go('itinerary')">New travel request ↗</button></div>
    <div class="card"><h2>My journeys (${jourList.length})</h2>
      <div class="list">${jourList.map(j => `<div class="item"><div class="grow">
        <div class="t">${esc(j.purpose || "Journey")}</div>
        <div class="s">${fmtD(j.date || "")} · ${esc(j.from || "")} → ${esc(j.to || "")} · ${esc(j.mode || "")}</div></div></div>`).join("") || "<div class='empty'>No journeys logged yet</div>"}</div>
      <button class="btn small" style="margin-top:8px" onclick="go('travelog')">Log a journey ↗</button></div>`);
};

/* ====================== OPERATIONS DASHBOARD ====================== */
routes.operations = async () => {
  setTitle("Operations");
  const uid = state.user.uid;
  const today_ = today();
  const fyFrom = (() => { const d = new Date(); const y = d.getMonth()>=3?d.getFullYear():d.getFullYear()-1; return `${y}-04-01`; })();

  // Parallel load everything
  const [petty, advSnap, expSnap, leaveSnap, attSnap, asgSnap, drSnap] = await Promise.all([
    db.collection("pettyCash").limit(500).get().catch(()=>({docs:[]})),
    db.collection("advances").where("status","in",["requested","issued","partially settled"]).limit(200).get().catch(()=>({docs:[]})),
    db.collection("expenses").where("payStage","!=","paid").limit(200).get().catch(()=>({docs:[]})),
    db.collection("leaveRequests").where("status","==","pending").limit(100).get().catch(()=>({docs:[]})),
    db.collection("attendance").where("date","==",today_).limit(100).get().catch(()=>({docs:[]})),
    db.collection("assignments").where("status","!=","verified").limit(300).get().catch(()=>({docs:[]})),
    db.collection("dayReports").where("status","==","submitted").limit(100).get().catch(()=>({docs:[]})),
  ]);

  const pettyRows = petty.docs.map(d=>({id:d.id,...d.data()})).filter(r=>!r.deleted&&!r.voided);
  const advRows   = advSnap.docs.map(d=>({id:d.id,...d.data()}));
  const expRows   = expSnap.docs.map(d=>({id:d.id,...d.data()}));
  const lvRows    = leaveSnap.docs.map(d=>({id:d.id,...d.data()}));
  const attRows   = attSnap.docs.map(d=>d.data());
  const asgRows   = asgSnap.docs.map(d=>({id:d.id,...d.data()}));
  const drRows    = drSnap.docs.map(d=>({id:d.id,...d.data()}));

  const staff = (state.users||[]).filter(u=>u.active&&isStaff(u));
  const checkedIn = new Set(attRows.map(a=>a.uid));
  const onLeave   = new Set(lvRows.filter(l=>l.from<=today_&&(l.to||today_)>=today_&&l.status==="approved").map(l=>l.uid));

  // --- Money section ---
  // Per-person cash box summary
  const boxByPerson = {};
  pettyRows.forEach(r => {
    const pid = r.holderId || r.by;
    if (!pid) return;
    if (!boxByPerson[pid]) boxByPerson[pid] = { inAmt:0, outAmt:0, missing:0, missingAmt:0 };
    boxByPerson[pid].inAmt  += Number(r.inAmt)  || 0;
    // Only count accepted entries as spent (not rejected/pending)
    if (r.status==="accepted" && !r.rejected) boxByPerson[pid].outAmt += Number(r.outAmt) || 0;
    if (r.status==="accepted" && r.outAmt && !r.bill) { boxByPerson[pid].missing++; boxByPerson[pid].missingAmt += Number(r.outAmt)||0; }
  });
  const totalCash = Object.values(boxByPerson).reduce((s,b)=>s+(b.inAmt-b.outAmt),0);
  const negBoxes  = Object.entries(boxByPerson).filter(([,b])=>b.inAmt-b.outAmt<0);
  const totalMissingBills = pettyRows.filter(r=>r.status==="accepted"&&r.outAmt&&!r.bill).length;
  const totalAdvAmt = advRows.reduce((s,a)=>s+(Number(a.amount)||0),0);
  const oldAdv = advRows.filter(a=>a.neededBy&&a.neededBy<today_);

  // Payment pipeline stages
  const pipeCount = {};
  expRows.forEach(r=>{ const s=r.payStage||"unknown"; pipeCount[s]=(pipeCount[s]||0)+1; });

  // --- People section ---
  const notIn = staff.filter(u=>!checkedIn.has(u.id)&&!onLeave.has(u.id));
  const lvPending = lvRows.filter(r=>!r.status||r.status==="pending");
  const overdueTasks = asgRows.filter(a=>a.due&&a.due<today_&&a.status!=="verified");
  const forMe = lvPending.filter(r=>(r.managerIds||[]).includes(uid));

  // --- Work section ---
  const unverifiedDR = drRows;

  // --- By person table ---
  const personRows = staff.map(u => {
    const b = boxByPerson[u.id] || { inAmt:0, outAmt:0, missing:0, missingAmt:0 };
    const bal = b.inAmt - b.outAmt;
    const myAdv = advRows.filter(a=>a.uid===u.id);
    const advAmt = myAdv.reduce((s,a)=>s+(Number(a.amount)||0),0);
    return { u, bal, missing:b.missing, missingAmt:b.missingAmt, advAmt, total:b.inAmt, spent:b.outAmt };
  }).filter(p=>p.total>0||p.advAmt>0);

  const stat = (label, val, colour="") =>
    `<div class="card stat"><span class="muted small">${label}</span><b style="${colour?`color:${colour}`:""}">${val}</b></div>`;

  html(`
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <h2 style="margin:0">Operations · ${fmtD(today_)}</h2>
      <button class="btn small quiet" onclick="routes.operations()">↻ Refresh</button>
    </div>

    <!-- MONEY -->
    <div class="card"><h2>💰 Money</h2>
      <div class="grid">
        ${stat("Cash in the field", inr(totalCash), totalCash<0?"var(--bad)":"")}
        ${stat("Unsettled advances", inr(totalAdvAmt), totalAdvAmt>0?"#8A5A00":"")}
        ${stat("Bills missing", totalMissingBills, totalMissingBills>0?"var(--bad)":"")}
        ${stat("Payments in pipeline", expRows.length)}
        ${stat("Overdue advances", oldAdv.length, oldAdv.length>0?"var(--bad)":"")}
      </div>
      ${negBoxes.length ? `<p class="small" style="color:var(--bad);margin-top:8px">⚠ Boxes in negative: ${negBoxes.map(([id])=>`<b>${esc(userName(id))}</b>`).join(", ")}</p>` : ""}
      ${Object.keys(pipeCount).length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Payment pipeline</div><div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(pipeCount).map(([k,v])=>`<span class="tag warn">${esc(k)}: ${v}</span>`).join("")}</div></div>` : ""}
    </div>

    <!-- BY PERSON -->
    ${personRows.length ? `<div class="card"><h2>By person</h2>
      <div class="tablewrap"><table class="table">
        <tr><th>Name</th><th>Received</th><th>Spent</th><th>Balance</th><th>Bills missing</th><th>Advances</th><th></th></tr>
        ${personRows.map(p=>`<tr>
          <td>${esc(p.u.name)}</td>
          <td>${inr(p.total)}</td>
          <td>${inr(p.spent)}</td>
          <td style="font-weight:500;color:${p.bal<0?"var(--bad)":"var(--green)"}">${p.bal<0?"−":""}${inr(Math.abs(p.bal))}</td>
          <td>${p.missing?`<span class="tag bad">${p.missing} (${inr(p.missingAmt)})</span>`:"—"}</td>
          <td>${p.advAmt?inr(p.advAmt):"—"}</td>
          <td><button class="btn small quiet" data-uid="${p.u.id}">Box ↗</button></td>
        </tr>`).join("")}
      </table></div></div>` : ""}

    <!-- PEOPLE -->
    <div class="card"><h2>👥 People today</h2>
      <div class="grid">
        ${stat("Checked in", checkedIn.size)}
        ${stat("On leave", onLeave.size)}
        ${stat("Not accounted for", notIn.length, notIn.length>3?"#8A5A00":"")}
        ${stat("Leave requests pending", lvPending.length, lvPending.length>0?"#8A5A00":"")}
        ${stat("Waiting for you", forMe.length, forMe.length>0?"var(--bad)":"")}
      </div>
      ${notIn.length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Not checked in and not on leave</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${notIn.map(u=>`<span class="tag">${esc(u.name)}</span>`).join("")}</div></div>` : ""}
      ${forMe.length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Leave requests waiting for you</div>
        <div class="list">${forMe.slice(0,5).map(l=>`<div class="item"><div class="grow"><div class="t">${esc(l.name)} · ${esc(l.type)}</div>
          <div class="s">${fmtD(l.from)} → ${fmtD(l.to)} · ${esc(l.reason||"")}</div></div>
          <button class="btn small" onclick="go('leaveRegister')">Review</button></div>`).join("")}</div>` : ""}
    </div>

    <!-- WORK -->
    <div class="card"><h2>📋 Work</h2>
      <div class="grid">
        ${stat("Overdue tasks (org)", overdueTasks.length, overdueTasks.length>0?"var(--bad)":"")}
        ${stat("Day reports unverified", unverifiedDR.length, unverifiedDR.length>5?"#8A5A00":"")}
      </div>
      ${overdueTasks.length ? `<div style="margin-top:10px"><div class="small muted" style="margin-bottom:4px">Overdue across the org</div>
        <div class="list">${overdueTasks.slice(0,6).map(a=>`<div class="item"><div class="grow">
          <div class="t">${esc(a.title)}</div>
          <div class="s">Due ${fmtD(a.due)} · ${esc(userName(a.assigneeId))}</div></div>
          <span class="tag bad">${Math.ceil((Date.now()-new Date(a.due))/86400000)}d late</span></div>`).join("")}</div>` : ""}
      ${unverifiedDR.length ? `<div style="margin-top:10px"><button class="btn small quiet" onclick="go('teamReports')">View day reports waiting for verification ↗</button></div>` : ""}
    </div>`);

  // Wire cash box links
  $("content").querySelectorAll("[data-uid]").forEach(b => b.onclick = () => {
    state.cbWho = b.dataset.uid; state.cashView = "accounts"; go("cashBox");
  });
};

/* ====================== MY ASSETS — acceptance flow ====================== */
/* Called from My account section and from Home "needs attention" block.
   Shows assets issued to the logged-in user that they haven't yet acknowledged. */
routes.myAssets = async () => {
  setTitle("My assets");
  const uid = viewUid();
  const allAssets = (await db.collection("assets").where("assignedTo", "==", uid).limit(100).get()
    .catch(() => ({ docs: [] }))).docs.map(d => ({ id: d.id, ...d.data() }));

  const pending  = allAssets.filter(a => !a.acceptedAt);
  const accepted = allAssets.filter(a =>  a.acceptedAt);

  html(`
    ${pending.length ? `<div class="card" style="border-left:4px solid var(--amber)">
      <h2>⚠ Awaiting your acknowledgement (${pending.length})</h2>
      <p class="small muted">These items are recorded as issued to you. Please check each one, confirm receipt, and note the condition.</p>
      <div class="list">${pending.map(a => `
        <div class="item" style="flex-wrap:wrap;gap:8px">
          <div class="grow">
            <div class="t">${esc(a.item || "")}</div>
            <div class="s">${a.tag ? `Code: ${esc(a.tag)} · ` : ""}${esc(a.category || "")}${a.cost ? " · ₹" + Number(a.cost).toLocaleString("en-IN") : ""}${a.notes ? " · " + esc(a.notes) : ""}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <select data-cond="${a.id}" style="width:auto;padding:5px 9px;border-radius:8px;font-size:13px">
              <option value="Good">Good — as described</option>
              <option value="Minor issue">Minor issue</option>
              <option value="Damaged">Damaged / not as described</option>
            </select>
            <button class="btn small" data-accept="${a.id}">Acknowledge receipt</button>
          </div>
        </div>`).join("")}
      </div>
    </div>` : `<div class="card"><div class="empty">No items waiting for your acknowledgement.</div></div>`}

    ${accepted.length ? `<div class="card"><h2>Assets in my custody (${accepted.length})</h2>
      <div class="tablewrap"><table class="table">
        <tr><th>Item</th><th>Code</th><th>Category</th><th>Condition</th><th>Acknowledged</th><th>Invoice / Photo</th></tr>
        ${accepted.map(a => {
          const inv = a.invoice;
          const invUrl = inv ? (inv.link || inv.url || (typeof inv==="string" ? inv : "")) : "";
          const invThumb = invUrl ? (invUrl.includes('drive.google') ? `<a href="${esc(invUrl)}" target="_blank" style="font-size:12px">📎 View</a>` : invUrl.startsWith('data:')||invUrl.startsWith('/')||invUrl.length>100 ? `<img src="${invUrl.startsWith('data:')||invUrl.startsWith('http')?invUrl:'data:image/jpeg;base64,'+invUrl}" style="height:40px;border-radius:4px">` : `<a href="${esc(invUrl)}" target="_blank" style="font-size:12px">📎 View</a>`) : "—";
          return `<tr>
          <td>${esc(a.item || "")}</td>
          <td style="font-family:monospace;font-size:13px">${esc(a.tag || "—")}</td>
          <td>${esc(a.category || "")}</td>
          <td>${statusTag(a.condition || "Good")}</td>
          <td class="small">${fmtD(a.acceptedAt)}</td>
          <td>${invThumb}</td>
        </tr>`;}).join("")}
      </table></div>
    </div>` : ""}
  `);

  const conditions = {};
  $("content").querySelectorAll("[data-cond]").forEach(sel => {
    conditions[sel.dataset.cond] = sel.value;
    sel.onchange = e => { conditions[e.target.dataset.cond] = e.target.value; };
  });

  $("content").querySelectorAll("[data-accept]").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.accept;
    const asset = pending.find(a => a.id === id);
    const condition = conditions[id] || "Good";
    const patch = {
      acceptedAt: today(),
      acceptedBy: uid,
      condition,
      history: [...(asset.history || []), {
        what: `Acknowledged receipt — condition: ${condition}`,
        at: today(), by: uid
      }]
    };
    if (condition === "Damaged") {
      patch.condition = "Needs repair";
      patch.conditionNote = `Reported by ${state.me.name} on receipt (${today()})`;
    }
    await db.collection("assets").doc(id).update(patch);
    audit("asset_accept", "assets", id, condition);
    if (condition === "Damaged") {
      toast("Acknowledged — Procurement has been notified of the condition issue");
    } else {
      toast("Acknowledged — thank you");
    }
    routes.myAssets();
  });
};

/* ====================== KARMA ENGINE ====================== */

function karmaGauge(score, name, subtitle, size) {
  const sz = size || 200;
  const cx = sz / 2, cy = sz * 0.65;
  const R = sz * 0.37, trackW = sz * 0.09;
  // Score is 0-100
  const pct = Math.max(0, Math.min(1, score / 100));
  const needleDeg = -90 + pct * 180;
  const arcLen = Math.PI * R;
  const zone = score < 40 ? "red" : score < 80 ? "yellow" : "green";
  const needleCol = zone === "red" ? "#E74C3C" : zone === "yellow" ? "#E67E22" : "#27AE60";
  const lbl = score < 20 ? "Needs focus" : score < 40 ? "Getting started" : score < 60 ? "On track" : score < 80 ? "Good going" : score < 92 ? "Excellent" : "Outstanding ✨";
  const pt = (th, r) => [cx + r*Math.cos(th*Math.PI/180), cy - r*Math.sin(th*Math.PI/180)];
  const arcD = (a, b, r) => { const [x1,y1]=pt(a,r); const [x2,y2]=pt(b,r); return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const ticks = Array.from({length:11},(_,i)=>{
    const th=180-i*18; const isMaj=i%2===0;
    const [ox,oy]=pt(th,R+trackW*0.58); const [ix,iy]=pt(th,R+trackW*0.58+(isMaj?sz*0.055:sz*0.03));
    const zCol = th>108?"#E74C3C":th>36?"#E67E22":"#27AE60";
    return `<line x1="${ox.toFixed(1)}" y1="${oy.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="${zCol}" stroke-width="${isMaj?1.5:0.8}" opacity="0.7"/>`;
  }).join("");
  const uid = "g"+Math.random().toString(36).slice(2,7);
  return `<div style="text-align:center" data-kuid="${uid}" data-kpct="${pct.toFixed(4)}" data-karc="${arcLen.toFixed(2)}" data-kangle="${needleDeg.toFixed(1)}" data-kcolour="${needleCol}">
    <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:4px;background:${needleCol}22;color:${needleCol};border:1px solid ${needleCol}44">${lbl}</span>
    <svg viewBox="0 0 ${sz} ${Math.round(sz*0.72)}" style="width:100%;max-width:${sz}px;overflow:visible;display:block;margin:0 auto">
      <defs>
        <filter id="sf${uid}"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-opacity="0.3"/></filter>
        <filter id="nf${uid}"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.35"/></filter>
      </defs>
      <path d="${arcD(0,180,R+trackW+sz*0.025)}" fill="none" stroke="#BDC3C7" stroke-width="${sz*0.014}" stroke-linecap="round"/>
      <path d="${arcD(0,180,R)}" fill="none" stroke="#ECF0F1" stroke-width="${trackW}" stroke-linecap="round"/>
      <path d="${arcD(108,180,R)}" fill="none" stroke="#E74C3C" stroke-width="${trackW}" stroke-linecap="butt" opacity="0.85"/>
      <path d="${arcD(36,108,R)}" fill="none" stroke="#E67E22" stroke-width="${trackW}" stroke-linecap="butt" opacity="0.85"/>
      <path d="${arcD(0,36,R)}" fill="none" stroke="#27AE60" stroke-width="${trackW}" stroke-linecap="butt" opacity="0.85"/>
      ${[108,36].map(th=>{const [ox,oy]=pt(th,R-trackW*0.5);const [ix,iy]=pt(th,R+trackW*0.5);return `<line x1="${ox.toFixed(1)}" y1="${oy.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="#fff" stroke-width="2"/>`;}).join("")}
      ${ticks}
      <g id="ndl${uid}" style="transform-origin:${cx}px ${cy}px;transform:rotate(-90deg)" filter="url(#nf${uid})">
        <polygon points="${cx},${(cy-R*0.84).toFixed(1)} ${(cx-sz*0.016).toFixed(1)},${(cy+sz*0.042).toFixed(1)} ${(cx+sz*0.016).toFixed(1)},${(cy+sz*0.042).toFixed(1)}" fill="${needleCol}"/>
        <circle cx="${cx}" cy="${cy}" r="${sz*0.044}" fill="#2C3E50"/>
        <circle cx="${cx}" cy="${cy}" r="${sz*0.024}" fill="#BDC3C7"/>
        <circle cx="${cx}" cy="${cy}" r="${sz*0.01}" fill="#7F8C8D"/>
      </g>
      <text x="${cx}" y="${(cy-sz*0.02).toFixed(1)}" text-anchor="middle" font-size="${(sz*0.14).toFixed(1)}" font-weight="700" fill="${needleCol}" font-family="system-ui">${score}</text>
    </svg>
    ${name ? `<div style="font-weight:600;font-size:14px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${esc(name)}</div>` : ""}
    ${subtitle ? `<div style="font-size:12px;color:#888;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${esc(subtitle)}</div>` : ""}
  </div>`;
}

async function calcKarma(uid, month) {
  const user = (state.users||[]).find(u => u.id === uid);
  if (!user) return { score: 0 };
  const roles = user.roles || [];

  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2,"0")}`;
  let workingDays = 0;
  for (let d = 1; d <= lastDay; d++) if (new Date(y,m-1,d).getDay() !== 0) workingDays++;
  // Mid-month: use elapsed working days as denominator so base score is fair
  const todayD2 = new Date(); const isCurrentMonth = todayD2.getFullYear()===y && (todayD2.getMonth()+1)===m;
  let elapsedWorkingDays = workingDays;
  if (isCurrentMonth) {
    elapsedWorkingDays = 0;
    for (let d = 1; d <= todayD2.getDate(); d++) if (new Date(y,m-1,d).getDay() !== 0) elapsedWorkingDays++;
  }
  const effectiveWorkingDays = isCurrentMonth ? elapsedWorkingDays : workingDays;

  try {
    const hr = (...rr) => rr.some(r => roles.includes(r) || roles.includes(Object.keys(ROLE_ALIAS||{}).find(k=>(ROLE_ALIAS||{})[k]===r && roles.includes(k))||"__none__"));

  // super_admin alone (technical account) → not tracked
  // founder role = Shafiq as GS → tracked
  if (roles.includes("super_admin") && !roles.includes("founder")) return null;
  if (roles.includes("counsellor")) return null; // Consultants not tracked
    const ts = sec => sec ? new Date(sec*1000).toISOString().slice(0,10) : "";
    const inM = v => v && v >= from && v <= to;

    /* ── Who reports to this person (from live Firestore managerIds) ── */
    const directReports = (state.users||[])
      .filter(u => u.active && (u.managerIds||[]).includes(uid))
      .map(u => u.id);
    const isManager = directReports.length > 0;

    /* ── Weights: managers always 30/30/40; individual contributors by role ── */
    let wBase, wOut, wCoord = 0;
    if (isManager) {
      wBase = 0.30; wOut = 0.30; wCoord = 0.40;
    } else if (hr("admin","admin_assistant","support_staff")) {
      wBase = 0.50; wOut = 0.50;
    } else {
      wBase = 0.30; wOut = 0.70;
    }

    /* ── Base: attendance + day reports ── */
    const [att, drs] = await Promise.all([
      db.collection("attendance").where("uid","==",uid).limit(300).get().catch(()=>({docs:[]})),
      db.collection("dayReports").where("uid","==",uid).limit(300).get().catch(()=>({docs:[]})),
    ]);
    const attM = att.docs.filter(d=>inM(d.data().date)).map(d=>d.data());
    const daysWithCO = attM.filter(r=>r.checkIn&&r.checkOut).length;
    const daysWithCI = attM.filter(r=>r.checkIn).length;
    const attScore = workingDays > 0 ? (daysWithCO/workingDays)*10 : 0;
    const drM = drs.docs.filter(d=>inM(d.data().date)).map(d=>d.data());
    const drOnTime = drM.filter(r=>!r.late).length;
    const drLate = drM.filter(r=>r.late).length;
    const drMissed = Math.max(0, daysWithCI - drM.length);
    // Productive day = checked in+out AND has a day report with actual content (app activity or narrative)
    // "Present but doing nothing in the app" does not earn full base score
    const drDates = new Set(drM.filter(r=>(r.items&&r.items.length>0)||r.narrative?.trim()).map(r=>r.date));
    const productiveDays = attM.filter(r=>r.checkIn&&r.checkOut&&drDates.has(r.date)).length;
    const attendanceDays = daysWithCO; // days with check-in+out regardless of report
    // Base = average of attendance % and productive day % — rewards both presence and work
    const attendancePct = effectiveWorkingDays > 0 ? (attendanceDays/effectiveWorkingDays)*100 : 0;
    const productivePct = effectiveWorkingDays > 0 ? (productiveDays/effectiveWorkingDays)*100 : 0;
    const basePct = Math.min(100, Math.round((attendancePct + productivePct) / 2));

    let outputPct = 0, coordPct = 0;
    let detail = { daysWithCO, daysWithCI, workingDays, productiveDays, drOnTime, drLate, drMissed, outputs:0, coordItems:0, outputBreakdown:"" };

    /* ── Work outputs: everything done in the app counts for everyone ──
       Each person's score reflects what THEY did, not what their role says.
       Rajbala's events and case updates count for her.
       Zubana's proposals and outreach count for her.
       The accountant's receipts and expenses count for them.
       Target: 20 points = 100%                                       ── */

    const WORK_TARGET = 20;
    // Date helpers
    var inMo = function(d, f) {
      var v = d[f] || d.date || d.sentOn || d.correctedOn || d.createdOn || "";
      return typeof v === "string" ? v.startsWith(month) : false;
    };
    var q = function(col, field, val) {
      return db.collection(col).where(field,"==",val).limit(200).get().catch(function(){return{docs:[]};});
    };

    // Fetch all activity by this user across the whole app
    var wAll = await Promise.all([
      q("eventReports","uid",uid),            // [0]  programme field work
      q("caseUpdates","by",uid),              // [1]  case management
      q("benefits","recordedBy",uid),         // [2]  benefits to Sakhis
      q("proposals","loggedBy",uid),          // [3]  proposals sent (fundraising)
      q("proposals","correctedBy",uid),       // [4]  proposals updated (fundraising)
      q("outreach","addedBy",uid),            // [5]  partnership contacts (PDRI)
      q("obligations","addedBy",uid),         // [6]  donor obligations tracked
      q("obligations","doneBy",uid),          // [7]  obligations submitted/completed
      q("persons","registeredBy",uid),         // [8]  Sakhis registered (field)
      q("programmeUpdates","by",uid),         // [9]  programme updates filed
      q("journeys","travellerId",uid),         // [10] journey reports (completed)
      q("dak","enteredBy",uid),               // [11] dak register entries
      q("handovers","createdBy",uid),         // [12] handovers (admin)
      q("incomeReceipts","createdBy",uid),    // [13] income receipts (accounts)
      q("assets","createdBy",uid),            // [14] assets registered (procurement)
      q("assets","verifiedBy",uid),           // [15] assets verified (procurement)
      q("pettyCash","by",uid),               // [16] petty cash entries (accounts)
      q("assignments","assigneeId",uid),      // [17] tasks
      q("expenseClaims","uid",uid),           // [18] expense claims (all staff)
      q("leaveRequests","approvedBy",uid),    // [19] leave approvals (managers)
      q("dayReports","approvedBy",uid),       // [20] day report verifications (managers)
      q("eventReports","approvedBy",uid),     // [21] event report verifications
      q("leaveRequests","uid",uid),           // [22] leave requests submitted (staff)
      q("advances","uid",uid),               // [23] advance requests
      q("requisitions","requestedBy",uid),   // [24] requisitions submitted
      q("performanceNotes","writtenBy",uid), // [25] performance notes written
      q("m3sage_household","filledBy",uid),  // [26] M3-SAGE household survey
      q("m3sage_village","filledBy",uid),    // [27] M3-SAGE village profile
      q("m3sage_kii","filledBy",uid),        // [28] M3-SAGE KII
      q("m3sage_fgd","filledBy",uid),        // [29] M3-SAGE FGD
      q("m3sage_survivor","filledBy",uid),   // [30] M3-SAGE survivor consultation
      q("m3sage_market","filledBy",uid),     // [31] M3-SAGE market assessment
      q("m3sage_institutional","filledBy",uid), // [32] M3-SAGE institutional mapping
    ]);

    // Count each, filtered to current month
    var evtFiled    = wAll[0].docs.filter(function(d){return inMo(d.data(),"date");}).length;

    // Only count on days the line manager verified the day report
    var verifiedDates = new Set(drM.filter(function(r){return r.status==="verified"&&inM(r.date);}).map(function(r){return r.date;}));

    // Case updates: verified days only, capped at 3 per day
    var cuByDay = {};
    wAll[1].docs.filter(function(d){var v=d.data().date||""; return v.startsWith(month)&&verifiedDates.has(v);})
      .forEach(function(d){var v=d.data().date; cuByDay[v]=(cuByDay[v]||0)+1;});
    var cuCount = Object.values(cuByDay).reduce(function(s,n){return s+Math.min(n,3);},0);

    // Benefits: verified days only, capped at 5 per day
    var benByDay = {};
    wAll[2].docs.filter(function(d){var v=d.data().date||""; return v.startsWith(month)&&verifiedDates.has(v);})
      .forEach(function(d){var v=d.data().date; benByDay[v]=(benByDay[v]||0)+1;});
    var benCount = Object.values(benByDay).reduce(function(s,n){return s+Math.min(n,5);},0);
    // Proposals: deduplicate across loggedBy + correctedBy
    var propSet = {};
    wAll[3].docs.filter(function(d){return inMo(d.data(),"sentOn");}).forEach(function(d){propSet[d.id]=1;});
    var propCorrSet = {};
    wAll[4].docs.filter(function(d){var dd=d.data();return inMo(dd,"correctedOn")&&!inMo(dd,"sentOn");}).forEach(function(d){propCorrSet[d.id]=1;});
    var propCorrCount = Object.keys(propCorrSet).length;
    var propCount   = Object.keys(propSet).length;
    var outCount    = wAll[5].docs.filter(function(d){return inMo(d.data(),"sentOn");}).length;
    // Obligations: addedBy this month
    var oblAdded    = wAll[6].docs.filter(function(d){
      var dd=d.data(); var v=dd.due||dd.date||""; return v.startsWith(month);
    }).length;
    // Obligations completed/submitted this month
    var oblDone     = wAll[7].docs.filter(function(d){
      var dd=d.data(); var v=dd.sentOn||dd.doneAt||""; return v.startsWith(month);
    }).length;
    var sakhiCount  = wAll[8].docs.filter(function(d){return inMo(d.data(),"registeredOn")||inMo(d.data(),"createdAt");}).length;
    var puCount     = wAll[9].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var jnyCount    = wAll[10].docs.filter(function(d){var dd=d.data();return inMo(dd,"date")&&dd.status==="reached";}).length;
    var dakCount    = wAll[11].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var hndCount    = wAll[12].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var recCount    = wAll[13].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var assetReg    = wAll[14].docs.filter(function(d){return inMo(d.data(),"boughtOn")||inMo(d.data(),"createdAt");}).length;
    var assetVer    = wAll[15].docs.filter(function(d){return inMo(d.data(),"verifiedAt");}).length;
    var pettyCount  = wAll[16].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var taskDone    = wAll[17].docs.filter(function(d){var dd=d.data();return inMo(dd,"doneAt")&&dd.verifiedBy;}).length;
    var m3hh        = wAll[26].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3vil       = wAll[27].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3kii       = wAll[28].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3fgd       = wAll[29].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3sur       = wAll[30].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3mkt       = wAll[31].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3ins       = wAll[32].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var m3total     = m3hh+m3vil+m3kii+m3fgd+m3sur+m3mkt+m3ins;
    // Map active assignments with quantity targets to karma output
    // Active = status "assigned", has a numeric target and targetUnit
    var activeAsgs = wAll[17].docs.map(function(d){return d.data();}).filter(function(d){
      return ["assigned","in progress"].includes(d.status) && d.target && d.targetUnit && Number(d.target)>0;
    });
    // For each targetUnit, sum up the relevant app activity and compare to target
    var asgTargetPct = 0, asgTargetBreakdown = [];
    var UNIT_MAP = {
      "Sakhis":    function(){ return sakhiCount; },
      "Events":    function(){ return evtFiled; },
      "Camps":     function(){ return evtFiled; },
      "Cases":     function(){ return cuCount; },
      "Benefits":  function(){ return benCount; },
      "Journeys":  function(){ return jnyCount; },
      "Updates":   function(){ return puCount; },
    };
    if (activeAsgs.length > 0) {
      var totalTargetPct = 0, totalWeight = 0;
      activeAsgs.forEach(function(asg) {
        var getter = UNIT_MAP[asg.targetUnit];
        if (!getter) return;
        var actual = getter();
        var target = Number(asg.target);
        var pct = Math.min(100, Math.round((actual / target) * 100));
        totalTargetPct += pct;
        totalWeight++;
        asgTargetBreakdown.push(actual + '/' + target + ' ' + asg.targetUnit + ' (' + pct + '% of target)');
      });
      if (totalWeight > 0) asgTargetPct = Math.round(totalTargetPct / totalWeight);
    }
    var sakhiTarget = 0; // legacy — now handled by activeAsgs above
    var claimCount  = wAll[18].docs.filter(function(d){return inMo(d.data(),"date");}).length;
    var leaveReqCount  = wAll[22]?.docs.filter(function(d){return inMo(d.data(),"date");}).length||0;
    var advCount       = wAll[23]?.docs.filter(function(d){return inMo(d.data(),"date");}).length||0;
    var reqCount       = wAll[24]?.docs.filter(function(d){return inMo(d.data(),"date");}).length||0;
    var perfNoteCount  = wAll[25]?.docs.filter(function(d){return inMo(d.data(),"date");}).length||0;
    // Manager activity: leave approvals + day report verifications + event report verifications
    var totalApprovals = 0; // verifications are duties, not achievements

    // Points (higher for significant/scarce work, lower for quick data entry)
    var pts = 0;
    pts += propCount   * 5;
    pts += (typeof propCorrCount !== "undefined" ? propCorrCount : 0) * 2;   // proposal: major effort
    pts += sakhiCount  * 4;   // registering a Sakhi: significant field work
    pts += evtFiled    * 3;   // event report: write-up + data entry
    pts += oblDone     * 3;   // obligation submitted: external accountability
    pts += hndCount    * 3;   // handover document: formal record
    pts += cuCount     * 2;   // case update: ongoing case work
    pts += benCount    * 2;   // benefit recorded: service delivery
    pts += puCount     * 2;   // programme update: internal reporting
    pts += outCount    * 2;   // outreach contact: partnership work
    pts += oblAdded    * 2;   // obligation tracked: donor management
    pts += recCount    * 2;   // income receipt: accounts work
    pts += assetReg    * 2;   // asset registered: procurement
    pts += taskDone    * 2;   // task verified by manager: any dept
    pts += m3hh  * 3;  // baseline household survey (×3)
    pts += m3vil * 2;  // village profile (×2)
    pts += m3kii * 3;  // KII (×3)
    pts += m3fgd * 4;  // FGD (×4)
    pts += m3sur * 5;  // survivor consultation (×5 — sensitive, skilled)
    pts += m3mkt * 2;  // market assessment (×2)
    pts += m3ins * 2;  // institutional mapping (×2)
    pts += totalApprovals*2;  // approvals/verifications: manager work
    pts += perfNoteCount*2;   // performance notes: HR/manager work
    pts += jnyCount    * 2;   // completed journey: field travel with activity log
    pts += dakCount    * 1;   // dak entry: admin record
    pts += pettyCount  * 1;   // petty cash: quick entry
    pts += assetVer    * 1;   // asset verified: spot check
    pts += claimCount  * 1;   // expense claim: own staff admin
    pts += leaveReqCount*1;   // leave request: self-service admin
    pts += advCount    * 1;   // advance request: self-service admin
    pts += reqCount    * 1;   // requisition submitted: procurement admin

    // Deduct for overdue assignments — not completed, past due date
    var todayStr = today();
    var overdueAsgs = wAll[17].docs.filter(function(d){var dd=d.data();return dd.due&&dd.due<todayStr&&!["verified","done – to verify"].includes(dd.status);});
    var overduePenalty = overdueAsgs.length * 2;
    // Deduct for returned assignments — submitted but sent back by assigner
    var returnedAsgs = wAll[17].docs.filter(function(d){var dd=d.data();return dd.doneAt&&dd.status==="assigned";});
    var returnedPenalty = returnedAsgs.length * 2;
    pts = Math.max(0, pts - overduePenalty - returnedPenalty);

    // Output % — if active quantitative assignments exist, weight them 70% of output score
    // This means: "are you meeting your assigned targets?" drives most of the output score
    var pointsPct = Math.min(100, Math.round((pts / WORK_TARGET) * 100));
    if (activeAsgs.length > 0 && asgTargetPct >= 0) {
      // 70% from assignment target progress, 30% from overall activity points
      outputPct = Math.round((asgTargetPct * 0.7) + (pointsPct * 0.3));
    } else {
      outputPct = pointsPct;
    }

    var parts = [];
    if (propCount)     parts.push(propCount + " proposal" + (propCount>1?"s":"") + " (×5)");
    if (typeof propCorrCount !== "undefined" && propCorrCount) parts.push(propCorrCount + " correction" + (propCorrCount>1?"s":"") + " (×2)");
    if (evtFiled)      parts.push(evtFiled + " event report" + (evtFiled>1?"s":"") + " (×3)");
    if (sakhiCount)    parts.push(sakhiCount + " Sakhi" + (sakhiCount>1?"s":"") + " (×4)");
    if (cuCount)       parts.push(cuCount + " case update" + (cuCount>1?"s":"") + " (×2)");
    if (benCount)      parts.push(benCount + " benefit" + (benCount>1?"s":"") + " (×2)");
    if (oblDone)       parts.push(oblDone + " obligation submitted (×3)");
    if (outCount)      parts.push(outCount + " outreach (×2)");
    if (puCount)       parts.push(puCount + " programme update" + (puCount>1?"s":"") + " (×2)");
    if (recCount)      parts.push(recCount + " receipt" + (recCount>1?"s":"") + " (×2)");
    if (assetReg)      parts.push(assetReg + " asset" + (assetReg>1?"s":"") + " registered (×2)");
    if (taskDone)      parts.push(taskDone + " task" + (taskDone>1?"s":"") + " done (×2)");
    if (overdueAsgs.length) parts.push(overdueAsgs.length + " overdue task" + (overdueAsgs.length>1?"s":"") + " (−" + overduePenalty + ")");
    if (returnedAsgs.length) parts.push(returnedAsgs.length + " returned task" + (returnedAsgs.length>1?"s":"") + " (−" + returnedPenalty + ")");
    if (totalApprovals)parts.push(totalApprovals + " approval" + (totalApprovals>1?"s":"") + " (×1)");
    if (hndCount)      parts.push(hndCount + " handover" + (hndCount>1?"s":"") + " (×3)");
    if (jnyCount)      parts.push(jnyCount + " journey" + (jnyCount>1?"s":"") + " (×2)");
    if (dakCount+pettyCount+assetVer+claimCount > 0)
      parts.push((dakCount+pettyCount+assetVer+claimCount) + " entries (×1)");
    if (m3total) parts.push("Baseline surveys: "+m3hh+" HH·"+m3vil+" village·"+m3kii+" KII·"+m3fgd+" FGD·"+m3sur+" survivor·"+m3mkt+" market·"+m3ins+" institutional");
    if (asgTargetBreakdown.length) parts.unshift("Assignment targets: " + asgTargetBreakdown.join(", "));
    detail.outputBreakdown = parts.length ? parts.join(" · ") : "nothing recorded yet this month";
    detail.asgTargetPct = asgTargetPct;
    detail.asgBreakdown = asgTargetBreakdown;
    detail.outputs = pts;

    /* ── Coordination: automatic from directReports, works for any manager ──
       Counts attendance check-ins + day reports of every direct report.
       When reporting lines change in Firestore, this updates automatically. ── */
    if (isManager) {
      const [drAtt, drDrs] = await Promise.all([
        db.collection("attendance").limit(500).get().catch(()=>({docs:[]})),
        db.collection("dayReports").limit(500).get().catch(()=>({docs:[]})),
      ]);
      const drCheckIns = drAtt.docs.filter(d=>
        directReports.includes(d.data().uid) && inM(d.data().date) && d.data().checkIn
      ).length;
      const drReports = drDrs.docs.filter(d=>
        directReports.includes(d.data().uid) && inM(d.data().date)
      ).length;
      const drActivity = drCheckIns + drReports;
      const expected = directReports.length * workingDays * 1.5; // 1.5 entries/person/day as target
      detail.coordItems = drActivity;
      detail.coordBreakdown = `${drCheckIns} check-ins · ${drReports} reports from ${directReports.length} direct report${directReports.length!==1?"s":""}`;
      coordPct = Math.min(100, (drActivity/Math.max(1,expected))*100);
    }

    const score = Math.round(Math.min(100, Math.max(0,
      basePct*wBase + outputPct*wOut + (isManager ? coordPct*wCoord : 0)
    )));

    return {
      score, basePct:Math.round(basePct), outputPct:Math.round(outputPct),
      coordPct: isManager ? Math.round(coordPct) : null,
      wBase, wOut, wCoord: isManager ? wCoord : 0,
      detail
    };
  } catch(e) { console.error("calcKarma error:", e); return { score: 0 }; }
}


async function getEmployeeOfMonth() {
  const now = new Date();
  const prevYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevMonthStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const label = new Date(prevYear, prevMonth - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  const eomRef = db.collection("appSettings").doc("eom");

  // ── Step 1: Everyone reads the cache first ──────────────────────────────
  // The cache is the single source of truth — same winner for all staff.
  // Non-admin users NEVER recalculate (they can only see their own state's data,
  // so their local calculation would be wrong).
  try {
    const cached = await eomRef.get();
    if (cached.exists && cached.data().month === prevMonthStr) {
      if ((cached.data().score || 0) < 15) return null;
      return { ...cached.data(), label };
    }
  } catch {}

  // ── Step 2: Only super_admin/founder can declare EOM (they see all staff) ──
  // All other staff return null — they'll see the banner once an admin opens the app.
  if (!has("super_admin", "founder")) return null;

  // Exclude: super_admin, founder, board, volunteer-only — these are org admins, not staff
  const ADMIN_ROLES = ['super_admin','founder','board'];
  // Calculate karma for all staff for the previous month
  const staff = (state.users || []).filter(u => {
    if (!u.active) return false;
    const roles = u.roles || [];
    if (roles.some(r => ADMIN_ROLES.includes(r))) return false;
    if (roles.length === 1 && roles[0] === 'volunteer') return false;
    return true;
  });
  if (!staff.length) return null;

  const scores = (await Promise.all(staff.map(async u => {
    try {
      const res = await calcKarma(u.id, prevMonthStr); if (!res) return null;
      const score = typeof res === "object" ? res.score : res;
      return { uid: u.id, name: u.name, post: u.postTitle || u.post || "", photo: u.photo || u.photoUrl || null, score };
    } catch { return null; }
  }))).filter(Boolean);

  scores.sort((a, b) => b.score - a.score);
  const winner = scores[0];
  if (!winner || winner.score < 15) return null;

  // Save via transaction — first browser's result wins, others are silently ignored
  // This guarantees exactly one result is saved and everyone reads the same value
  try {
    await db.runTransaction(async tx => {
      const existing = await tx.get(eomRef);
      if (existing.exists && existing.data().month === prevMonthStr) return; // already saved
      const { photo: _p, ...winnerSmall } = winner; // never store photo inline — look up from state.users
      tx.set(eomRef, { month: prevMonthStr, ...winnerSmall, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
  } catch {}

  // Re-read and return the authoritative saved value — never the local calculation
  try {
    const saved = await eomRef.get();
    if (saved.exists && saved.data().month === prevMonthStr && (saved.data().score || 0) >= 15) {
      return { ...saved.data(), label };
    }
  } catch {}

  return { ...winner, label };
}

/* ====================== FULL STAFF RECORD ====================== */
routes.staffRecord = async (uid) => {
  uid = uid || state.viewStaff || state.user.uid;
  state.viewStaff = uid;
  if (!has("super_admin","admin","director_acf") && !isManager()) return go("home");

  const [uSnap, leaveSnap, drSnap, taskSnap, karmaSnap, noteSnap, annualSnap, reviewSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("leaveRequests").where("uid","==",uid).limit(30).get().then(s=>{s.docs.sort((a,b)=>(b.data().from||"").localeCompare(a.data().from||""));return s;}).catch(()=>({docs:[]})),
    db.collection("dayReports").where("uid","==",uid).orderBy("date","desc").limit(10).get().catch(()=>({docs:[]})),
    db.collection("assignments").where("assigneeId","==",uid).limit(20).get().then(s=>{s.docs.sort((a,b)=>(b.data().createdAt?.seconds||0)-(a.data().createdAt?.seconds||0));return s;}).catch(()=>({docs:[]})),
    db.collection("karmaHistory").where("uid","==",uid).orderBy("month","desc").limit(12).get().catch(()=>({docs:[]})),
    db.collection("performanceNotes").where("uid","==",uid).limit(20).get().then(s=>{s.docs.sort((a,b)=>(b.data().createdAt?.seconds||0)-(a.data().createdAt?.seconds||0));return s;}).catch(()=>({docs:[]})),
    db.collection("karmaAnnual").where("uid","==",uid).orderBy("fy","desc").limit(3).get().catch(()=>({docs:[]})),
    db.collection("serviceReviews").where("uid","==",uid).orderBy("year","desc").limit(5).get().catch(()=>({docs:[]})),
  ]);

  if (!uSnap.exists) return html(`<div class="card"><div class="empty">Staff member not found.</div></div>`);
  const u = { id: uSnap.id, ...uSnap.data() };

  const leaveRows = leaveSnap.docs.map(d => ({id:d.id,...d.data()}));
  const drRows    = drSnap.docs.map(d => d.data());
  const taskRows  = taskSnap.docs.map(d => ({id:d.id,...d.data()}));
  const karmaRows = karmaSnap.docs.map(d => d.data());
  const noteRows  = noteSnap.docs.map(d => ({id:d.id,...d.data()}));
  const annualRows = annualSnap.docs.map(d => d.data());
  const reviewRows = reviewSnap.docs.map(d => ({id:d.id,...d.data()}));

  setTitle(`Staff record · ${u.name || ""}`);

  // Leave summary by type
  const lvSummary = {};
  const fyFrom = (() => { const d = new Date(); const y = d.getMonth()>=3?d.getFullYear():d.getFullYear()-1; return `${y}-04-01`; })();
  leaveRows.filter(l => l.status==="approved" && (l.from||"") >= fyFrom).forEach(l => {
    lvSummary[l.type] = (lvSummary[l.type]||0) + (Number(l.days)||1);
  });

  // Karma trend
  const kBar = (score) => {
    const col = score < 0 ? "var(--bad)" : score < 40 ? "var(--amber)" : "var(--ok)";
    const h = Math.min(60, Math.max(4, Math.abs(score)));
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span style="font-size:10px;font-weight:600;color:${col}">${score}</span>
      <div style="width:24px;height:${h}px;background:${col};border-radius:3px 3px 0 0;min-height:4px"></div>
    </div>`;
  };

  html(`
    <!-- Header -->
    <div class="card" style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      ${(u.photo||u.photoUrl) ? `<img src="${esc(u.photo||u.photoUrl)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;flex-shrink:0;border:3px solid var(--line)">` :
        `<div style="width:80px;height:80px;border-radius:50%;background:var(--green-pale);display:grid;place-items:center;font-size:32px;flex-shrink:0">👤</div>`}
      <div style="flex:1;min-width:0">
        <div style="font-size:22px;font-weight:700">${esc(u.name||"")}</div>
        <div style="color:var(--muted);margin-top:2px">${esc(standingOf(u)||u.designation||"")} · ${esc(officeName(u.officeId)||"")}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          ${(u.roles||[]).map(r=>`<span class="tag">${esc(ROLES[r]||r)}</span>`).join("")}
          <span class="tag ${u.active?"ok":"bad"}">${u.active?"Active":"Inactive"}</span>
          ${(()=>{const t=today();const al=leaveRows.find(l=>l.status==="approved"&&l.from<=t&&(l.to||l.from)>=t);return al?`<span class="tag warn">On leave${/work from home/i.test(al.type||"")?" (WFH)":""}${al.to&&al.to!==al.from?" · till "+fmtD(al.to):" · "+fmtD(al.from)}</span>`:"";})()}
        </div>
        <div style="font-size:13px;color:var(--muted);margin-top:6px">
          Reports to: <b>${esc(mgrs(u).map(id=>userName(id)).filter(Boolean).join(", ")||"—")}</b>
        </div>
      </div>
      <button class="btn small quiet" onclick="go('performance','${uid}')">Performance view ↗</button>
      <button class="btn small quiet" id="srF09">↓ F-09 Work sheet</button>
    </div>

    <!-- Personal & contact -->
    <div class="card">
      <h2>Personal & contact</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 20px">
        ${[
          ["Sex", u.sex],
          ["Phone", u.phone],
          ["Email", u.email],
          ["Date of birth", fmtD(u.dob)],
          ["Aadhaar (last 4)", u.aadhaarLast4],
          ["Address", u.address],
          ["City / PIN", u.city ? u.city + (u.pin ? " · " + u.pin : "") : null],
          ["Emergency contact", u.emergencyName ? `${u.emergencyName} · ${u.emergencyPhone||""}` : null],
          ["Emergency relation", u.emergencyRelation],
          ["Blood group", u.blood],
          ["Gender", u.gender],
        ].filter(([,v])=>v).map(([l,v])=>`<div><div class="small muted">${l}</div><div>${esc(v)}</div></div>`).join("") ||
        `<div class="empty">Profile not yet complete. Ask ${esc(u.name||"them")} to update their profile.</div>`}
      </div>
    </div>

    <!-- Employment -->
    <div class="card">
      <h2>Employment</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 20px">
        ${[
          ["Joined", fmtD(u.joinedOn||u.createdAt?.seconds?new Date(u.createdAt.seconds*1000).toISOString().slice(0,10):null)],
          ["Contract type", u.contractType],
          ["Department", u.department],
          ["Post", standingOf(u)],
          ["Office", officeName(u.officeId)],
          ["Profile approved", u.approvedAt ? (u.approvedAt.seconds ? new Date(u.approvedAt.seconds*1000) : new Date(u.approvedAt)).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}) : null],
          ["Bank", u.bankName],
          ["Account no.", has("super_admin","director_acf") ? u.bankAccount : u.bankAccount ? "••••" + String(u.bankAccount).slice(-4) : null],
          ["IFSC", has("super_admin","director_acf") ? u.ifsc : null],
        ].filter(([,v])=>v).map(([l,v])=>`<div><div class="small muted">${l}</div><div>${esc(v)}</div></div>`).join("") ||
        `<div class="empty">No employment details on file.</div>`}
      </div>
    </div>

    <!-- Documents -->
    ${u.cvUrl || u.certificates?.length || u.idProofUrl || (u.docs||[]).length ? `<div class="card">
      <h2>Documents</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${u.cvUrl ? `<a href="${esc(u.cvUrl)}" target="_blank" class="btn small quiet">📄 CV / Résumé</a>` : ""}
        ${u.idProofUrl ? `<a href="${esc(u.idProofUrl)}" target="_blank" class="btn small quiet">🪪 ID proof</a>` : ""}
        ${(u.certificates||[]).map((c,i) => `<a href="${esc(c.url||c)}" target="_blank" class="btn small quiet">📜 Certificate ${i+1}${c.name?" – "+esc(c.name):""}</a>`).join("")}
${(u.docs||[]).map(function(d,i){return `<span class="btn small quiet" style="cursor:pointer" data-docidx="${i}" title="${esc(d.at||"")}">📎 ${esc(d.name||("Document "+(i+1)))}</span>`;}).join("")}
      </div>
    </div>` : `<div class="card"><h2>Documents</h2><div class="empty">No documents uploaded yet. The staff member can upload from their Profile screen.</div></div>`}

    <!-- Karma history -->
    <div class="card">
      <h2>Karma history · last 12 months</h2>
      ${karmaRows.length ? `
        <div style="display:flex;align-items:flex-end;gap:6px;padding:8px 0;border-bottom:1px solid var(--line);margin-bottom:8px">
          ${karmaRows.map(k => `<div style="text-align:center">${kBar(k.score)}<div style="font-size:9px;color:var(--muted);margin-top:2px">${(k.month||"").slice(5)}</div></div>`).join("")}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:4px">
          <div><span class="small muted">Best month</span><div style="font-weight:600">${Math.max(...karmaRows.map(k=>k.score))} pts · ${(karmaRows.find(k=>k.score===Math.max(...karmaRows.map(k=>k.score)))||{}).month||""}</div></div>
          <div><span class="small muted">Average</span><div style="font-weight:600">${Math.round(karmaRows.reduce((s,k)=>s+k.score,0)/karmaRows.length)} pts / month</div></div>
          <div><span class="small muted">Trend</span><div style="font-weight:600">${karmaRows[0]?.score > (karmaRows[1]?.score||0) ? "📈 Going up" : karmaRows[0]?.score < (karmaRows[1]?.score||0) ? "📉 Going down" : "→ Steady"}</div></div>
        </div>
        ${annualRows.length ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--line)">
          <div class="small muted" style="margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Annual appraisal record</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${annualRows.map(a=>`<div style="border:1px solid var(--line);border-radius:8px;padding:8px 12px;min-width:120px">
              <div class="small muted">FY ${esc(a.fy)}</div>
              <div style="font-size:20px;font-weight:700;color:${a.avgScore<0?"var(--bad)":a.avgScore<40?"var(--amber)":"var(--ok)"}">${a.avgScore}</div>
              <div class="small muted">avg · best ${a.bestScore} · ${a.months}mo</div>
            </div>`).join("")}
          </div>
        </div>` : ""}
        <p class="small muted" style="margin-top:10px">Karma history is a permanent HR record. It is taken into account for promotions, contract renewals, and role changes.</p>` :
        `<div class="empty">No karma history yet — scores record at the end of each month.</div>`}
    </div>

    <!-- Leave this year -->
    <div class="card">
      <h2>Leave this financial year</h2>
      ${(()=>{const t=today();const upcoming=leaveRows.filter(l=>l.status==="approved"&&!/work from home/i.test(l.type||"")&&(l.to||l.from)>=t&&l.from<=(l.to||l.from)).sort((a,b)=>a.from.localeCompare(b.from));if(!upcoming.length)return"";return`<div style="margin-bottom:10px">${upcoming.map(l=>{const active=l.from<=t;return`<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><span class="tag ${active?"warn":"ok"}">${active?"On leave now":"Upcoming"}</span><span style="font-size:14px">${esc(l.type)} · <b>${fmtD(l.from)}${l.to&&l.to!==l.from?" → "+fmtD(l.to):""}</b> (${l.days||1} day${(l.days||1)!==1?"s":""})</span></div>`;}).join("")}</div>`})()}
      ${Object.keys(lvSummary).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
        ${Object.entries(lvSummary).map(([type,days])=>`<span class="tag">${esc(type)}: ${days} day${days!==1?"s":""}</span>`).join("")}
      </div>` : `<div class="empty">No approved leave recorded this year.</div>`}
      ${(()=>{
        const approved = leaveRows.filter(l=>l.status==="approved"&&!/work from home/i.test(l.type||""));
        const wfh = leaveRows.filter(l=>l.status==="approved"&&/work from home/i.test(l.type||""));
        const pending = leaveRows.filter(l=>l.status==="pending");
        const row = l=>`<div class="item"><div class="grow"><div class="t">${esc(l.type)}</div><div class="s">${fmtD(l.from)}${l.to&&l.to!==l.from?" → "+fmtD(l.to):""} · ${l.days||1} day${(l.days||1)!==1?"s":""}</div></div></div>`;
        return [approved.length?`<div style="margin-top:8px"><div class="small muted" style="margin-bottom:4px">Leave taken</div><div class="list">${approved.map(row).join("")}</div></div>`:"",
          wfh.length?`<div style="margin-top:8px"><div class="small muted" style="margin-bottom:4px">Work from home</div><div class="list">${wfh.map(row).join("")}</div></div>`:"",
          pending.length?`<div style="margin-top:8px"><div class="small muted" style="margin-bottom:4px">Pending approval</div><div class="list">${pending.map(l=>`<div class="item"><div class="grow"><div class="t">${esc(l.type)}</div><div class="s">${fmtD(l.from)}${l.to&&l.to!==l.from?" → "+fmtD(l.to):""} · ${l.days||1} day${(l.days||1)!==1?"s":""}</div></div><span class="tag warn">Pending</span></div>`).join("")}</div></div>`:""].join("");
      })()}
    </div>

    <!-- Recent tasks -->
    <div class="card">
      <h2>Recent tasks</h2>
      ${taskRows.length ? `<div class="list">${taskRows.map(a=>`<div class="item">
        <div class="grow"><div class="t">${esc(a.title)}</div><div class="s">Due ${fmtD(a.due||"")} · ${esc(projectName(a.projectId)||"—")}</div></div>
        <span class="tag ${a.status==="verified"?"ok":a.status==="rejected"?"bad":"warn"}">${esc(a.status||"open")}</span>
      </div>`).join("")}</div>` : `<div class="empty">No tasks assigned yet.</div>`}
    </div>

    <!-- Transfer / Update post (admin only) -->
    ${has("super_admin","admin") ? `
    <div class="card" id="trCard">
      <h2 style="margin-bottom:8px">Transfer &amp; post update</h2>
      <p class="small muted" style="margin-bottom:10px">Changes here update Firestore immediately and are recorded in the service book.</p>
      <form id="trF" style="display:grid;gap:10px">
        <div class="two">
          <label class="field"><span>Post title</span><input name="postTitle" value="${esc(u.postTitle||"")}" required></label>
          <label class="field"><span>Department</span>
            <select name="department">
              ${["Programme","Administration & Communication","Accounts & Compliance","Fundraising & Research","Governance","Field Operations"].map(function(d){return `<option ${(u.department||"")===d?"selected":""}>${d}</option>`;}).join("")}
            </select>
          </label>
        </div>
        <div class="two">
          <label class="field"><span>Office</span>
            <select name="officeId">
              ${(state.offices||[]).map(function(o){return `<option value="${o.id}" ${o.id===u.officeId?"selected":""}>${esc(o.name)}</option>`;}).join("")}
            </select>
          </label>
          <label class="field"><span>Reports to</span>
            <select name="managerId">
              <option value="">— none —</option>
              ${(state.users||[]).filter(function(x){return x.active&&x.id!==uid;}).map(function(x){return `<option value="${x.id}" ${(u.managerIds||[]).includes(x.id)?"selected":""}>${esc(x.name)} · ${esc(x.postTitle||"")}</option>`;}).join("")}
            </select>
          </label>
        </div>
        <label class="field"><span>States covered (Ctrl/Cmd to select multiple)</span>
          <select name="states" multiple style="height:80px">
            ${["Delhi","Haryana","Bihar","Assam","Uttar Pradesh","Rajasthan","Other"].map(function(s){return `<option ${(u.states||[]).includes(s)?"selected":""}>${s}</option>`;}).join("")}
          </select>
        </label>
        <label class="field"><span>Note for service book (reason for change)</span><input name="note" placeholder="e.g. Transferred to programme division to lead Azad Women" required></label>
        <button class="btn" type="submit">Save &amp; record in service book</button>
      </form>
    </div>` : ""}
    <!-- Service book -->
    ${(()=>{
      const isSelf = uid === state.user.uid;
      const canWriteSB = !isSelf && (isManager() || has("super_admin","director_acf","director_acf"));
      const canSeeAll = !isSelf && (isManager() || has("super_admin","director_acf","director_acf"));
      const POSITIVE = ["Achievement","Commendation","Training completed"];
      const HIDDEN = ["Concern","Conduct","Performance note"];
      const ALL_TYPES = [...POSITIVE,...HIDDEN];
      const visibleNotes = canSeeAll ? noteRows : noteRows.filter(n=>POSITIVE.includes(n.type||n.kind));
      const pendingCS = canSeeAll ? noteRows.filter(n=>n.countersignNeeded&&!n.countersignedBy) : [];
      const fy = fyOfDate(today());
      const canReview = has("super_admin") && new Date().getMonth()===4; // May only for GS

      const typeTag = type => {
        if(type==="Achievement"||type==="Commendation") return "ok";
        if(type==="Concern"||type==="Conduct") return "bad";
        return "warn";
      };

      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <h2>Service book${canSeeAll&&noteRows.length?` · ${noteRows.length} entr${noteRows.length===1?"y":"ies"}`:""}${isSelf?" · my record":""}</h2>
          ${canWriteSB ? `<button class="btn small quiet" id="sbAdd">+ Add entry</button>` : ""}
        </div>
        ${pendingCS.length ? `<div class="err" style="margin-bottom:8px">
          ${pendingCS.length} entry${pendingCS.length===1?" requires":"s require"} countersignature from the Director ACF or GS before it is active.
        </div>` : ""}

        <!-- Add entry form (hidden by default) -->
        <div id="sbForm" class="hidden" style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px">
          <h3 style="margin:0 0 8px">New service book entry</h3>
          <form id="sbF">
            <div class="two">
              <label class="field"><span>Type</span><select name="type" id="sbType">
                ${ALL_TYPES.map(x=>`<option>${x}</option>`).join("")}
              </select></label>
              <label class="field"><span>Date</span><input type="date" name="date" value="${today()}" required></label>
            </div>
            <label class="field"><span>Entry</span><textarea name="entry" rows="3" required placeholder="Describe clearly and factually — this is a permanent record"></textarea></label>
            <div id="sbCsNote" class="small muted hidden" style="margin-bottom:8px">⚠ Concern and Conduct entries require countersignature by the Director ACF before they appear in the record.</div>
            <button class="btn small" type="submit">Save entry</button>
            <button class="btn small quiet" type="button" id="sbCancel">Cancel</button>
          </form>
        </div>

        <!-- Entries -->
        <div class="list">
          ${visibleNotes.length ? visibleNotes.sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(n=>{
            const locked = n.locked || (n.createdAt?.seconds && (Date.now()/1000 - n.createdAt.seconds) > 86400);
            const needsCS = n.countersignNeeded && !n.countersignedBy;
            return `<div class="item" style="flex-direction:column;align-items:flex-start;gap:4px">
              <div style="display:flex;width:100%;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="tag ${typeTag(n.type||n.kind)}">${esc(n.type||n.kind||"note")}</span>
                <span class="small muted">${fmtD(n.date)} · ${esc(userName(n.writtenBy||n.createdBy))}</span>
                ${needsCS&&canSeeAll?`<span class="tag warn">awaiting countersign</span>`:""}
                ${n.countersignedBy?`<span class="tag ok">countersigned ${fmtD(n.countersignedOn)} by ${esc(userName(n.countersignedBy))}</span>`:""}
                ${!locked&&canSeeAll?`<button class="btn small quiet" data-sbedit="${n.id}" style="margin-left:auto">Edit</button>`:""}
                ${needsCS&&has("super_admin","director_acf","director_acf")?`<button class="btn small" data-sbcs="${n.id}">Countersign</button>`:""}
              </div>
              <div style="font-size:14px;line-height:1.5">${esc(n.entry||n.note||"")}</div>
            </div>`; }).join("") :
            `<div class="empty">${isSelf?"No commendations or achievements recorded yet.":"No service book entries yet."}</div>`}
        </div>
      </div>

      <!-- Annual reviews -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <h2>Annual reviews</h2>
          ${canWriteSB&&!reviewRows.find(r=>r.year===fy) ? `<button class="btn small quiet" id="sbReview">+ ${new Date().getMonth()===4?"Submit May review":"Start review"}</button>` : ""}
        </div>
        ${reviewRows.length ? reviewRows.map(r=>`
          <div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <b>${esc(r.year)} · ${esc(r.decision||"Pending")}</b>
              <span class="tag ${r.status==="gs_approved"?"ok":r.status==="director_reviewed"?"warn":""}">
                ${r.status==="gs_approved"?"Approved by GS":r.status==="director_reviewed"?"With GS":"Submitted"}
              </span>
            </div>
            ${r.summary?`<p class="small" style="margin:6px 0 0">${esc(r.summary)}</p>`:""}
            ${r.gsNote?`<p class="small muted" style="margin:4px 0 0">GS note: ${esc(r.gsNote)}</p>`:""}
            ${r.increment?`<p class="small muted">Increment: ₹${Number(r.increment).toLocaleString("en-IN")}</p>`:""}
            ${r.newPost?`<p class="small muted">New post: ${esc(r.newPost)}</p>`:""}
            ${r.status==="director_reviewed"&&has("super_admin")?`
              <div style="margin-top:8px;border-top:1px solid var(--line);padding-top:8px" id="gsReviewForm_${r.id}">
                <p class="small muted">As Founder & GS, make the final decision:</p>
                <div class="two" style="margin-bottom:6px">
                  <label class="field"><span>Decision</span><select id="gsDecision_${r.id}">
                    ${["Confirmed","Increment","Promotion","No change","PIP","Probation extended"].map(x=>`<option ${x===r.decision?"selected":""}>${x}</option>`).join("")}
                  </select></label>
                  <label class="field"><span>Increment ₹ (if any)</span><input type="number" id="gsIncrement_${r.id}" value="${r.increment||""}"></label>
                </div>
                <label class="field"><span>New post (if promotion)</span><input id="gsPost_${r.id}" value="${r.newPost||""}"></label>
                <label class="field"><span>Your note</span><textarea id="gsNote_${r.id}" rows="2">${r.gsNote||""}</textarea></label>
                <button class="btn small" data-gsapprove="${r.id}">Approve & issue letter</button>
              </div>` : ""}
            ${r.status!=="gs_approved"&&canWriteSB&&r.writtenBy===state.user.uid?`
              <div style="margin-top:6px">
                <button class="btn small quiet" data-sbdirectorreview="${r.id}">Forward to Director ACF</button>
              </div>` : ""}
          </div>`).join("") :
          `<div class="small muted">No annual reviews yet. Line managers submit a review in May each year.</div>`}

        <!-- Annual review form -->
        <div id="sbReviewForm" class="hidden" style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:10px">
          <h3 style="margin:0 0 8px">Annual review · ${fy}</h3>
          <form id="sbRF">
            <label class="field"><span>Summary of the year's performance</span><textarea name="summary" rows="4" required placeholder="Summarise achievements, development areas, attendance record, and overall contribution this financial year."></textarea></label>
            <div class="two">
              <label class="field"><span>Recommendation</span><select name="decision">
                ${["Confirmed","Increment","Promotion","No change","PIP","Probation extended"].map(x=>`<option>${x}</option>`).join("")}
              </select></label>
              <label class="field"><span>Suggested increment ₹ (if any)</span><input type="number" name="increment" min="0"></label>
            </div>
            <label class="field"><span>Suggested new post (if promotion)</span><input name="newPost" placeholder="Leave blank if no promotion"></label>
            <p class="small muted">This goes to the Director ACF and then to the Founder & GS for final decision. The staff member is not notified until the GS approves.</p>
            <button class="btn small" type="submit">Submit review</button>
            <button class="btn small quiet" type="button" id="sbRCancel">Cancel</button>
          </form>
        </div>
      </div>`;
    })()}
  `);
  // ── Staff record wiring ──
  // Transfer form wiring
  if($("trF")) $("trF").onsubmit = async function(e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var newPostTitle = fd.get("postTitle")||"";
    var newDept = fd.get("department")||"";
    var newOfficeId = fd.get("officeId")||"";
    var newManagerId = fd.get("managerId")||"";
    var newStates = fd.getAll("states");
    var note = fd.get("note")||"";
    if(!note.trim()){toast("Please add a note explaining the change");return;}
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled=true; btn.textContent="Saving…";
    try {
      var snap = await db.collection("users").doc(uid).get();
      var prev = snap.data()||{};
      var changes = [];
      if(newPostTitle!==prev.postTitle) changes.push("Post: "+(prev.postTitle||"—")+" → "+newPostTitle);
      if(newDept!==prev.department) changes.push("Dept: "+(prev.department||"—")+" → "+newDept);
      var prevOff = (state.offices||[]).find(function(o){return o.id===prev.officeId;});
      var newOff = (state.offices||[]).find(function(o){return o.id===newOfficeId;});
      if(newOfficeId!==prev.officeId) changes.push("Office: "+(prevOff?.name||"—")+" → "+(newOff?.name||"—"));
      var prevMgr = userName((prev.managerIds||[])[0])||"—";
      var newMgr = newManagerId ? userName(newManagerId)||"—" : "—";
      if(newManagerId!==(prev.managerIds||[])[0]) changes.push("Reports to: "+prevMgr+" → "+newMgr);
      await db.collection("users").doc(uid).update({
        postTitle:newPostTitle, department:newDept, officeId:newOfficeId,
        managerId:newManagerId, managerIds:newManagerId?[newManagerId]:[], states:newStates
      });
      var entry = (changes.length ? changes.join("; ")+". " : "") + note;
      await db.collection("performanceNotes").add({
        uid, type:"Transfer", entry, date:today(),
        writtenBy:state.user.uid, writtenOn:today(),
        kind:"transfer", status:"active",
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      audit("transfer","users",uid,entry);
      await loadMasters();
      toast("Transfer saved ✔ — service book updated");
      routes.staffRecord(uid);
    } catch(_te){toast("Could not save: "+(_te&&_te.message));btn.disabled=false;btn.textContent="Save & record in service book";}
  };
  // sbAdd toggles the add-entry form
  if($("sbAdd")) $("sbAdd").onclick = function() {
    var f = $("sbForm");
    if(f) { f.classList.toggle("hidden"); if(!f.classList.contains("hidden")) f.scrollIntoView({behavior:"smooth",block:"nearest"}); }
  };
  if($("sbAdd2")) $("sbAdd2").onclick = function() { if($("sbForm")) $("sbForm").classList.toggle("hidden"); };
  // sbType shows/hides countersign note
  if($("sbType")) $("sbType").onchange = function(e) {
    var needs = /Concern|Conduct|Disciplinary|Warning/.test(e.target.value||"");
    if($("sbCsNote")) $("sbCsNote").classList.toggle("hidden", !needs);
  };
  // sbF form submit
  if($("sbF")) $("sbF").onsubmit = async function(e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var d = {type:fd.get("type"), entry:fd.get("entry"), date:fd.get("date")||today()};
    if(!d.entry?.trim()){toast("Please write the entry");return;}
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled=true;btn.textContent="Saving…";
    try {
      await db.collection("performanceNotes").add({
        uid, type:d.type, entry:d.entry, date:d.date,
        writtenBy:state.user.uid, writtenOn:today(),
        kind:["Achievement","Commendation","Training completed"].includes(d.type)?"positive":"concern",
        status:"pending", createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      audit("create","performanceNotes",uid,d.type);
      toast("Entry saved");
      routes.staffRecord(uid);
    } catch(_e){toast("Could not save: "+(_e&&_e.message));btn.disabled=false;btn.textContent="Save entry";}
  };
  // sbRF annual review submit
  if($("sbRF")) $("sbRF").onsubmit = async function(e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled=true;btn.textContent="Saving…";
    try {
      await db.collection("serviceReviews").add({
        uid, summary:fd.get("summary"), decision:fd.get("decision"),
        increment:Number(fd.get("increment")||0), newPost:fd.get("newPost")||"",
        writtenBy:state.user.uid, writtenOn:today(), year:today().slice(0,4),
        status:"submitted", createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      audit("create","serviceReviews",uid,"Annual review");
      toast("Review submitted");
      routes.staffRecord(uid);
    } catch(_e){toast("Could not save: "+(_e&&_e.message));btn.disabled=false;btn.textContent="Submit review";}
  };
  // Open base64 docs from u.docs
  $("content").querySelectorAll("[data-docidx]").forEach(function(btn){
    btn.onclick=function(){
      var idx=parseInt(btn.dataset.docidx);
      var doc=(u.docs||[])[idx];
      if(!doc){toast("No file stored");return;}
      var src=doc.data?(doc.data.startsWith("data:")?doc.data:"data:image/jpeg;base64,"+doc.data):null;
      if(src){var w=window.open("","_blank");if(w){w.document.write('<html><body style="margin:0"><img src="'+src+'" style="max-width:100%"><p style="padding:8px;font-family:sans-serif">'+esc(doc.name||"")+'</p></body></html>');w.document.close();}}
      else toast("No image data — document may be a Drive file");
    };
  });
  if($("sbRCancel")) $("sbRCancel").onclick = function(){ if($("sbRForm")) $("sbRForm").classList.add("hidden"); };
  // sbCs countersign buttons
  $("content").querySelectorAll("[data-sbcs]").forEach(function(b){b.onclick=async function(){
    if(!confirm("Countersign this entry? It will become part of the permanent service book.")) return;
    await db.collection("performanceNotes").doc(b.dataset.sbcs).update({countersignedBy:state.user.uid,countersignedOn:today(),status:"active"});
    audit("countersign","performanceNotes",b.dataset.sbcs,""); toast("Countersigned"); routes.staffRecord(uid);
  };});
};


;(function(){
  var _origMR=routes.monthlyReports;
  routes.monthlyReports=async function(){
    await _origMR.apply(this,arguments);
    var mi=document.getElementById('mrMonth');
    var month=mi?mi.value:today().slice(0,7);
    var ms=month+'-01',me2=month+'-31';
    function att(r){return[(r.attachments||[]).map(function(a){return a.link||a.url||'';}).filter(Boolean).join(' | '),(r.photos||[]).map(function(a){return a.link||a.url||'';}).filter(Boolean).join(' | '),r.photo||'',r.reportDoc||'',r.billLink||r.bill||''].filter(Boolean).join(' | ');}
    function fsQ(col){return db.collection(col).where('date','>=',ms).where('date','<=',me2).limit(500).get().catch(function(){return{docs:[]};}).then(function(s){return s.docs.map(function(d){return Object.assign({id:d.id},d.data());});});}

    // ── Override accounts dept download ──────────────────────────
    var acctBtn=$("content")&&$("content").querySelector('[data-dept="accounts"]');
    if(acctBtn){acctBtn.onclick=async function(){
      var orig=this.textContent;this.disabled=true;this.textContent='Building…';
      try{
        if(!window.XLSX)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
        var _r=await Promise.all([fsQ('expenses'),fsQ('expenseClaims'),fsQ('pettyCash'),fsQ('advances'),fsQ('incomeReceipts'),fsQ('requisitions')]);
        var exps=_r[0],claims=_r[1],petty=_r[2],adv=_r[3],income=_r[4],reqs=_r[5];
        var wb=XLSX.utils.book_new();
        function addS(rows,name){if(rows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),name);}
        addS(exps.map(function(r){return{Date:r.date||'',Particulars:r.particulars||r.description||'',Payee:r.payee||'','₹':r.amount||'',Head:r.head||'',Voucher:r.voucher||'',Status:r.status||'',Attachments:att(r)};}), 'Expense vouchers');
        addS(claims.map(function(r){return{Date:r.date||'',Description:r.description||r.particulars||'','₹':r.amount||'','Claimed by':userName(r.uid)||'',Status:r.status||'',Attachments:att(r)};}), 'Reimbursement claims');
        addS(petty.map(function(r){return{Date:r.date||'',Particulars:r.particulars||'','Out ₹':r.outAmt||'','In ₹':r.inAmt||'',By:userName(r.by)||r.by||'',Payee:r.payee||'',Status:r.status||'',Attachments:r.bill||att(r)};}), 'Cash box');
        addS(adv.map(function(r){return{Date:r.date||'',Purpose:r.purpose||'','₹':r.amount||'',Person:userName(r.uid)||'',Status:r.status||'',Attachments:att(r)};}), 'Advances');
        addS(income.map(function(r){return{Date:r.date||'',Donor:r.donor||'',Reference:r.reference||'','₹':r.amount||'',Attachments:att(r)};}), 'Income receipts');
        addS(reqs.map(function(r){return{Date:r.date||'',Item:r.item||r.description||'','₹':r.amount||'',Person:userName(r.requestedBy||r.uid)||'',Status:r.status||'',Attachments:att(r)};}), 'Requisitions');
        if(!wb.SheetNames.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{Note:'No accounts activity for '+month}]),'Empty');
        XLSX.writeFile(wb,'EP-accounts-'+month+'.xlsx');
        audit('export','dept_month',null,'accounts-'+month);toast('Downloaded');
      }catch(e){toast('Error: '+(e.message||e));}
      this.disabled=false;this.textContent=orig;
    };}

    // ── Add Finance sheets to whole organisation download ─────────
    var mrAllBtn=document.getElementById('mrAll');
    if(mrAllBtn&&mrAllBtn.onclick){
      var _origOrg=mrAllBtn.onclick;
      mrAllBtn.onclick=async function(){
        var _self=this;
        if(!window.XLSX)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');var _origWF=XLSX.writeFile;
        XLSX.writeFile=async function(wb,fn){
          try{
            var _fr=await Promise.all([fsQ('expenseClaims'),fsQ('pettyCash'),fsQ('expenses')]);
            var allFin=_fr[0].concat(_fr[2]).map(function(r){return{Date:r.date||'',Description:r.description||r.particulars||'','₹':r.amount||'',Person:userName(r.uid)||'',Status:r.status||'',Attachments:att(r)};});
            var pettyF=_fr[1].map(function(r){return{Date:r.date||'',Particulars:r.particulars||'','Out ₹':r.outAmt||'','In ₹':r.inAmt||'',By:userName(r.by)||r.by||'',Payee:r.payee||'',Status:r.status||'',Attachments:r.bill||att(r)};});
            if(allFin.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(allFin),'Finance');
            if(pettyF.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(pettyF),'Cash box');
          }catch(fe){console.warn('Finance sheets:',fe);}
          _origWF.call(this,wb,fn);
        };
        try{await _origOrg.call(_self);}finally{XLSX.writeFile=_origWF;}
      };
    }
  };
})();