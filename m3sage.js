/* ═══════════════════════════════════════════════════════════════

   M3-SAGE Baseline Survey — 7 forms, native in EP Office app
   Data → Firestore collections: m3sage_household, m3sage_village,
   m3sage_kii, m3sage_fgd, m3sage_survivor, m3sage_market, m3sage_institutional
   ═══════════════════════════════════════════════════════════════ */

const M3_TARGETS = {
  household:     { sherghati:256, amas:160, dobhi:224, total:640,   note:"" },
  village:       { sherghati:"All", amas:"All", dobhi:"All", total:"100%", note:"Every village" },
  kii:           { sherghati:14,  amas:9,   dobhi:13,  total:36,   note:"" },
  fgd:           { sherghati:4,   amas:4,   dobhi:4,   total:12,   note:"" },
  survivor:      { sherghati:"6–10", amas:"4–6", dobhi:"5–9", total:"15–25", note:"Voluntary estimates, not quotas" },
  market:        { sherghati:"6–8",  amas:"4–5", dobhi:"5–7", total:"15–20", note:"Cover solar/LED and food/agri sectors" },
  institutional: { sherghati:"8–12", amas:"5–7", dobhi:"7–11",total:"20–30", note:"Avoid duplicate interviews" }
};

const M3_FORMS = [
  { n:1, key:"kii",           en:"Key Informant Interview (KII)",          hi:"प्रमुख सूचना साक्षात्कार",icon:"💬", col:"m3sage_kii"           },
  { n:2, key:"village",       en:"Village Profile & Vulnerability Mapping",hi:"ग्राम प्रोफाइल",          icon:"🗺️", col:"m3sage_village"       },
  { n:3, key:"household",     en:"Household Socio-Economic Survey",       hi:"परिवार सर्वेक्षण",         icon:"🏠", col:"m3sage_household"     },
  { n:4, key:"fgd",           en:"Focus Group Discussion (FGD)",           hi:"समूह चर्चा",              icon:"👥", col:"m3sage_fgd"           },
  { n:5, key:"survivor",      en:"Confidential Survivor Consultation",     hi:"गोपनीय परामर्श",          icon:"🔒", col:"m3sage_survivor",  confidential:true },
  { n:6, key:"market",        en:"Market & Enterprise Assessment",         hi:"बाजार एवं उद्यम आकलन",   icon:"🏪", col:"m3sage_market"        },
  { n:7, key:"institutional", en:"Institutional & Service Mapping",        hi:"संस्थागत मानचित्रण",     icon:"🏛️", col:"m3sage_institutional" }
];

function m3canAccess(form) {
  if (!form) return false;
  const m3proj = (state.projects||[]).find(p=>(p.code||p.name||"").toUpperCase().includes("M3-SAGE"));
  const onTeam = m3proj && (m3proj.leadId===state.user.uid||(m3proj.team||[]).includes(state.user.uid));
  return has("super_admin","founder","admin","program_officer","program_lead") || onTeam;
}
function m3canManage() { return has("super_admin","founder","program_officer"); }

// ── Home screen ──────────────────────────────────────────────
routes.m3baseline = async () => {
  setTitle("M3-SAGE Baseline Survey");
  if (typeof paintBack === "function") paintBack();
  // Fetch counts by block for each form
  const blockCounts = {}; // { formKey: { sherghati:N, amas:N, dobhi:N, total:N } }
  const BLOCKS_MAP = { "शेरघाटी":"sherghati", "आमस":"amas", "डोभी":"dobhi" };
  await Promise.all(M3_FORMS.filter(f=>m3canAccess(f)).map(async f => {
    const snap = await db.collection(f.col).get().catch(()=>({docs:[]}));
    const bc = {sherghati:0, amas:0, dobhi:0, total:0};
    snap.docs.forEach(d => {
      const v = d.data(); bc.total++;
      const bk = BLOCKS_MAP[v.block||v.blockDistrict||""] || null;
      if (bk) bc[bk]++;
    });
    blockCounts[f.key] = bc;
  }));

  const progBar = (done, target) => {
    if (typeof target !== "number") return "";
    const pct = Math.min(100, Math.round(done/target*100));
    const col = pct>=100?"var(--green)":pct>=50?"#C8922F":"var(--accent)";
    return `<div style="background:var(--line);border-radius:4px;height:5px;margin-top:4px"><div style="width:${pct}%;height:100%;border-radius:4px;background:${col}"></div></div>`;
  };

  html(`<div class="card">
    <h2>M3-SAGE · Baseline Survey</h2>
    <p class="small muted">शेरघाटी · आमस · डोभी — गया, बिहार &nbsp;|&nbsp; Leopold Bachmann Foundation</p>
    ${m3canManage() ? `<div style="margin-top:8px"><button class="btn quiet small" onclick="routes.m3responses()">📊 View all responses & download Excel</button></div>` : ""}
  </div>

  ${m3canManage() ? `<div class="card">
    <h3 style="margin:0 0 12px">Progress by block</h3>
    <div style="overflow-x:auto">
    <table class="table" style="min-width:600px">
      <tr><th>Form</th><th>शेरघाटी left</th><th>Target</th><th>आमस left</th><th>Target</th><th>डोभी left</th><th>Target</th><th>Remaining</th><th>Target</th></tr>
      ${M3_FORMS.filter(f=>m3canAccess(f)).map(f => {
        const bc = blockCounts[f.key]||{sherghati:0,amas:0,dobhi:0,total:0};
        const tgt = M3_TARGETS[f.key]||{};
        const cell = (done, target) => {
          const isNum = typeof target === "number";
          const col = isNum && done>=target ? "color:var(--green);font-weight:600" : "";
          return `<td style="${col}">${done}</td><td class="muted small">${target}</td>`;
        };
        return `<tr>
          <td>${f.icon} ${f.en}</td>
          ${(()=>{
            const rem=(done,target)=>{if(typeof target!=="number")return`<td>${done}</td><td class="muted small">${target}</td>`;const r=Math.max(0,target-done);const col=r===0?"color:var(--green);font-weight:600":r<target*0.25?"color:#C8922F":"";return`<td style="${col}">${r} left</td><td class="muted small">${target}</td>`;};
            return rem(bc.sherghati,tgt.sherghati)+rem(bc.amas,tgt.amas)+rem(bc.dobhi,tgt.dobhi)+rem(bc.total,tgt.total);
          })()}
        </tr>`;
      }).join("")}
    </table></div>
  </div>` : ""}

  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
    ${M3_FORMS.filter(f=>m3canAccess(f)).map(f=>{
      const bc = blockCounts[f.key]||{sherghati:0,amas:0,dobhi:0,total:0};
      const tgt = M3_TARGETS[f.key]||{};
      const totalNum = typeof tgt.total === "number" ? tgt.total : null;
      return `<div class="card" style="${f.confidential?"border-left:4px solid #c0392b;":""}" onclick="go('m3form_${f.key}')">
        <div style="font-size:32px;margin-bottom:6px">${f.icon}</div>
        <div style="font-weight:600;font-size:15px"><span style="color:var(--muted);margin-right:4px">${f.n}.</span>${f.en}</div>
        <div class="small muted" style="margin:3px 0 8px">${f.hi}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          ${(()=>{
            const rem=(k)=>{ const t=tgt[k]; const d=bc[k]; if(typeof t!=="number")return`<div class="small muted">${t}</div>`; const r=Math.max(0,t-d); const col=r===0?"color:var(--green);font-weight:600":r<t*0.25?"color:#C8922F":""; return`<div class="small ${col}"><b>${r}</b><span class="muted"> left · SG</span></div>`; };
            const remA=(k)=>{ const t=tgt[k]; const d=bc[k]; if(typeof t!=="number")return`<div class="small muted">${t}</div>`; const r=Math.max(0,t-d); const col=r===0?"color:var(--green);font-weight:600":r<t*0.25?"color:#C8922F":""; return`<div class="small ${col}"><b>${r}</b><span class="muted"> left · AM</span></div>`; };
            const remD=(k)=>{ const t=tgt[k]; const d=bc[k]; if(typeof t!=="number")return`<div class="small muted">${t}</div>`; const r=Math.max(0,t-d); const col=r===0?"color:var(--green);font-weight:600":r<t*0.25?"color:#C8922F":""; return`<div class="small ${col}"><b>${r}</b><span class="muted"> left · DB</span></div>`; };
            return rem("sherghati")+remA("amas")+remD("dobhi");
          })()}
        </div>
        ${totalNum ? progBar(bc.total, totalNum) : ""}
        ${(()=>{ const r=totalNum?Math.max(0,totalNum-bc.total):null; const col=r===0?"color:var(--green);font-weight:600":""; return r!==null?`<div class="small ${col}" style="margin-top:6px">${r===0?"✅ Complete":"<b>"+r+"</b> of "+tgt.total+" remaining"}</div>`:`<div class="small muted" style="margin-top:6px">${bc.total} recorded</div>`; })()}
        ${tgt.note ? `<div class="small muted" style="margin-top:4px;font-style:italic">${tgt.note}</div>` : ""}
        ${f.confidential ? `<div class="small" style="color:#c0392b;margin-top:4px">🔒 Conduct privately · voluntary only</div>` : ""}
        <button class="btn small" style="margin-top:10px" onclick="event.stopPropagation();go('m3form_${f.key}')">Open form →</button>
      </div>`;
    }).join("")}
  </div>`);
};

const M3_GUIDELINES = {
  household: {
    who: "Adult women (18+) who understand the household's economic and social situation — preferably the woman who manages household expenditure, income or livelihood activities.",
    priority: [
      "Women from low-income households",
      "Women-headed households",
      "Households with unemployed or underemployed women",
      "Households dependent on agricultural or daily-wage labour",
      "Households with women interested in starting an enterprise"
    ],
    important: "Do not interview only the male household head. Women's economic participation and decision-making are central to M3-SAGE. If the preferred respondent is unavailable, interview another knowledgeable adult member.",
    target: "640 households — Sherghati: 256 · Amas: 160 · Dobhi: 224"
  },
  village: {
    who: "2–3 knowledgeable people per village using one consolidated village profile.",
    priority: [
      "Mukhiya / Gram Panchayat representative — population, village issues, priorities",
      "Ward member — household-level challenges and local vulnerabilities",
      "Panchayat Secretary / Vikas Mitra — government schemes, records and services",
      "ASHA worker — women's health and access to health services",
      "Anganwadi worker — children, adolescent girls and nutrition",
      "School teacher / Headmaster — education, dropout and attendance",
      "SHG leader / Jeevika community cadre — women's groups, savings and livelihoods",
      "Community leader — migration, social conditions and local concerns"
    ],
    important: "You do not need to interview all eight people in every village. Select at least two knowledgeable respondents and triangulate important information with available records and observations. One profile per village.",
    target: "Every village in all three blocks — 318 villages total"
  },
  kii: {
    who: "Individual, in-depth interviews with people who have specialised knowledge or institutional influence.",
    priority: [
      "Block administration, BDO, officials and Panchayat representatives (6)",
      "Agriculture, livelihood and rural development officials (6)",
      "Jeevika / SHG and community institution representatives (6)",
      "NGOs and civil society organisations (6)",
      "Education, health and social protection professionals (6)",
      "Financial institutions, skill development and enterprise experts (6)"
    ],
    important: "Interview people such as Block Development Officers, Jeevika officials, agriculture officers, bank managers, school principals, NGO programme directors and local enterprise experts. Avoid duplicating interviews already done under Form 7 unless the KII explores a broader strategic issue.",
    target: "36 interviews — Sherghati: 14 · Amas: 9 · Dobhi: 13"
  },
  fgd: {
    who: "Organise four FGDs per block with 8–10 participants each.",
    priority: [
      "FGD 1: Adult women from vulnerable households — economic situation, barriers and aspirations",
      "FGD 2: SHG / Jeevika members and women entrepreneurs — savings, credit, business and market access",
      "FGD 3: Young women aged 18–30 — education, skills, employment and mobility",
      "FGD 4: Women community leaders and representatives — women's agency, leadership and community systems"
    ],
    important: "Do not mix powerful community leaders with vulnerable women — it can inhibit honest discussion. Survivor consultations must NEVER be conducted through group discussions. Each FGD should have 8–10 participants.",
    target: "12 FGDs total — 4 per block · approx. 96–120 participants across all blocks"
  },
  survivor: {
    who: "Women who voluntarily identify themselves as having experienced trafficking, forced marriage, coercion or exploitation, and who are willing to participate in a confidential consultation.",
    priority: [
      "Current economic situation and barriers to independence",
      "Skills, work experience and enterprise aspirations",
      "Access to financial services and social support",
      "Mental health and psychosocial support needs (only if the participant wishes to discuss)",
      "Safety and referral needs"
    ],
    important: "MUST be conducted by a trained female counsellor or survivor-support professional. Do NOT identify survivors through public meetings. Do NOT ask Mukhiya, police or community leaders to disclose identities. Do NOT require an FIR or legal proof. Do NOT pressure women to recount traumatic experiences. 15–25 is NOT a compulsory quota. Keep this data strictly separate from all other forms.",
    target: "15–25 voluntary consultations — Sherghati: 6–10 · Amas: 4–6 · Dobhi: 5–9"
  },
  market: {
    who: "People who understand actual demand, supply, production costs and market opportunities — not just general opinions.",
    priority: [
      "Food processors and agricultural traders (4–5)",
      "Agricultural producers, aggregators and FPO representatives (3–4)",
      "LED / solar wholesalers, retailers and suppliers (4–5)",
      "Potential institutional and bulk buyers (2–3)",
      "Entrepreneurs and business development experts (2–3)"
    ],
    important: "Prioritise people who can give real data: product demand, purchase prices, raw material availability, production costs, quality requirements, potential sales volumes, distribution channels and purchase commitments. Do not rely on general opinions about viability — get actual prices and buyer interest.",
    target: "15–20 interviews — Sherghati: 6–8 · Amas: 4–5 · Dobhi: 5–7"
  },
  institutional: {
    who: "The person responsible for delivering or coordinating services at each institution.",
    priority: [
      "Block administration — BDO or designated official",
      "Panchayat — Mukhiya / Panchayat Secretary",
      "Jeevika — Block Project Manager / Community Coordinator",
      "Banks — Branch Manager / Financial Inclusion Officer",
      "Skill development — Centre Head / Training Coordinator",
      "Agriculture — Block Agriculture Officer",
      "Health — Medical Officer / ASHA coordination personnel",
      "Education — BEO / School Head",
      "Women and child development — CDPO / Supervisor",
      "Legal services — DLSA representative / Legal Aid Counsel",
      "Protection services — Relevant authorised service provider",
      "NGOs — Programme Director / Field Coordinator",
      "Market institutions — Buyer / Supplier / Business Association"
    ],
    important: "For every institution establish: (1) What services are available? (2) Who is eligible? (3) What documents are required? (4) How can women access services? (5) Are services actually functioning? (6) What barriers prevent women from accessing them? (7) Is the institution willing to collaborate with M3-SAGE?",
    target: "20–30 institutions — Sherghati: 8–12 · Amas: 5–7 · Dobhi: 7–11"
  }
};


// ── Form definitions ─────────────────────────────────────────
function m3formDef(key) {
  const BLOCKS = ["शेरघाटी","आमस","डोभी"];
  const YNN = ["हाँ","नहीं","बताना नहीं चाहते"];
  const YN  = ["हाँ","नहीं"];

  const defs = {
    household: {
      title:"परिवार सामाजिक-आर्थिक सर्वेक्षण",
      sections:[
        { label:"खंड A: सर्वेक्षण की जानकारी", fields:[
          {k:"date",        l:"सर्वेक्षण की तारीख",                 t:"date"},
          {k:"block",       l:"प्रखंड",                             t:"select", o:BLOCKS},
          {k:"panchayat",   l:"पंचायत",                            t:"text"},
          {k:"village",     l:"गाँव",                              t:"text"},
          {k:"tola",        l:"टोला / मोहल्ला",                    t:"text"},
          {k:"surveyorName",l:"सर्वेक्षक का नाम",                  t:"text"},
          {k:"respondent",  l:"उत्तरदाता का नाम",                  t:"text"},
          {k:"relation",    l:"परिवार के मुखिया से संबंध",          t:"text"},
          {k:"phone",       l:"मोबाइल नंबर (सहमति से)",            t:"tel"},
          {k:"consent",     l:"उत्तरदाता की सहमति",                t:"select", o:YN}
        ]},
        { label:"खंड B: परिवार की सामान्य जानकारी", fields:[
          {k:"headName",    l:"परिवार के मुखिया का नाम",           t:"text"},
          {k:"familyType",  l:"परिवार का प्रकार",                  t:"select", o:["एकल परिवार","संयुक्त परिवार","महिला मुखिया वाला परिवार","अन्य"]},
          {k:"totalMembers",l:"परिवार में कुल सदस्य",              t:"number"},
          {k:"males",       l:"पुरुष सदस्य",                       t:"number"},
          {k:"females",     l:"महिला सदस्य",                       t:"number"},
          {k:"age0_5",      l:"0–5 वर्ष के बच्चे",                 t:"number"},
          {k:"age6_14",     l:"6–14 वर्ष के बच्चे",               t:"number"},
          {k:"age15_18",    l:"15–18 वर्ष के किशोर/किशोरियाँ",    t:"number"},
          {k:"age19_59",    l:"19–59 वर्ष के सदस्य",              t:"number"},
          {k:"age60plus",   l:"60+ वर्ष के सदस्य",                t:"number"},
          {k:"education",   l:"परिवार का शैक्षणिक स्तर",           t:"select", o:["निरक्षर","प्राथमिक","माध्यमिक","उच्च माध्यमिक","स्नातक या अधिक"]},
          {k:"disabled",    l:"परिवार में दिव्यांग सदस्य",          t:"select", o:YNN}
        ]},
        { label:"खंड C: आवास एवं बुनियादी सुविधाएँ", fields:[
          {k:"houseType",   l:"मकान का प्रकार",                    t:"select", o:["कच्चा","अर्ध-पक्का","पक्का"]},
          {k:"houseOwn",    l:"मकान का स्वामित्व",                  t:"select", o:["स्वयं का","किराये का","रिश्तेदार का","अन्य"]},
          {k:"toilet",      l:"शौचालय",                             t:"select", o:["हाँ","नहीं","सामुदायिक शौचालय"]},
          {k:"water",       l:"पेयजल स्रोत",                        t:"select", o:["नल","हैंडपंप","कुआँ","टैंकर","अन्य"]},
          {k:"electricity", l:"बिजली की सुविधा",                    t:"select", o:["नियमित","अनियमित","उपलब्ध नहीं"]},
          {k:"fuel",        l:"खाना पकाने का ईंधन",                 t:"select", o:["LPG","लकड़ी","कोयला","गोबर","अन्य"]},
          {k:"smartphone",  l:"स्मार्टफोन उपलब्ध है?",             t:"select", o:YN},
          {k:"internet",    l:"इंटरनेट की सुविधा है?",             t:"select", o:YN}
        ]},
        { label:"खंड D: आजीविका एवं आय", fields:[
          {k:"income_source",l:"मुख्य आय स्रोत",                   t:"select", o:["कृषि","कृषि मजदूरी","गैर-कृषि मजदूरी","सरकारी/निजी नौकरी","स्वरोजगार/व्यवसाय","पशुपालन","अन्य"]},
          {k:"earners",     l:"आय अर्जित करने वाले सदस्य",          t:"number"},
          {k:"monthlyIncome",l:"अनुमानित मासिक आय",                t:"select", o:["₹5,000 से कम","₹5,001–10,000","₹10,001–15,000","₹15,001–25,000","₹25,001–40,000","₹40,000 से अधिक","बताना नहीं चाहते"]},
          {k:"incomeRegular",l:"आय की नियमितता",                   t:"select", o:["नियमित","मौसमी","अनियमित"]},
          {k:"debt",        l:"परिवार पर कर्ज है?",                 t:"select", o:YNN},
          {k:"debtSource",  l:"कर्ज का स्रोत",                     t:"select", o:["बैंक","स्वयं सहायता समूह","साहूकार","रिश्तेदार/मित्र","माइक्रोफाइनेंस","अन्य","लागू नहीं"]},
          {k:"farmLand",    l:"कृषि भूमि है?",                     t:"select", o:YN},
          {k:"landSize",    l:"भूमि का आकार (यदि है)",              t:"text"},
          {k:"livestock",   l:"पशुपालन करता है?",                   t:"select", o:YN},
          {k:"assets",      l:"उत्पादक संसाधन (विवरण)",             t:"textarea"}
        ]},
        { label:"खंड E: महिलाओं की आर्थिक भागीदारी", fields:[
          {k:"womenWork",   l:"महिलाएँ कोई आर्थिक गतिविधि करती हैं?",t:"select", o:YN},
          {k:"womenActivity",l:"किस प्रकार की गतिविधि?",           t:"text"},
          {k:"womenDecision",l:"कमाई पर स्वयं निर्णय लेने का अधिकार",t:"select", o:["पूरी तरह","आंशिक रूप से","नहीं","लागू नहीं"]},
          {k:"bankAccount", l:"महिलाएँ बैंक खाता संचालित करती हैं?",t:"select", o:YNN},
          {k:"bankAccess",  l:"वित्तीय संस्थाओं तक पहुँच",          t:"select", o:YNN},
          {k:"shgMember",   l:"स्वयं सहायता समूह से जुड़ी हैं?",    t:"select", o:YNN},
          {k:"familySupport",l:"व्यवसाय में परिवार का सहयोग मिलेगा?",t:"select", o:YNN},
          {k:"barriers",    l:"रोजगार/उद्यम में मुख्य बाधाएँ",       t:"select", o:["पूँजी की कमी","कौशल की कमी","बाजार तक पहुँच नहीं","परिवार का विरोध","देखभाल की जिम्मेदारी","आवागमन की समस्या","सामाजिक प्रतिबंध","अन्य"]}
        ]},
        { label:"खंड F: शिक्षा, स्वास्थ्य एवं सामाजिक सुरक्षा", fields:[
          {k:"allSchool",   l:"सभी बच्चे विद्यालय जाते हैं?",        t:"select", o:YNN},
          {k:"dropout",     l:"कोई बच्चा विद्यालय छोड़ चुका है?",    t:"select", o:YN},
          {k:"dropoutReason",l:"यदि हाँ, कारण",                     t:"text"},
          {k:"aadhar",      l:"आधार कार्ड उपलब्ध है?",              t:"select", o:YN},
          {k:"ration",      l:"राशन कार्ड उपलब्ध है?",              t:"select", o:YN},
          {k:"healthInsur", l:"आयुष्मान / स्वास्थ्य बीमा",          t:"select", o:YNN},
          {k:"pension",     l:"पेंशन मिलती है?",                    t:"select", o:YNN},
          {k:"govSchemes",  l:"सरकारी योजनाओं का लाभ प्राप्त होता है?",t:"select", o:YN},
          {k:"schemesDetail",l:"किन योजनाओं का लाभ?",               t:"textarea"}
        ]},
        { label:"खंड G: आर्थिक आकांक्षाएँ", fields:[
          {k:"aspiration",  l:"परिवार की महिलाओं की प्रमुख आर्थिक आकांक्षा",t:"textarea"},
          {k:"wantBusiness",l:"कोई महिला नया व्यवसाय शुरू करना चाहती है?",t:"select", o:YN},
          {k:"businessType",l:"किस प्रकार का व्यवसाय?",              t:"text"},
          {k:"trainingReady",l:"प्रशिक्षण के लिए तैयार है?",         t:"select", o:YNN},
          {k:"trainingTime",l:"प्रशिक्षण के लिए उपलब्ध समय",         t:"text"},
          {k:"mobilityOk",  l:"घर से बाहर जाकर काम कर सकती है?",    t:"select", o:YNN},
          {k:"groupWork",   l:"समूह के साथ काम करना पसंद करेगी?",    t:"select", o:YNN},
          {k:"solarFoodInterest",l:"सौर/LED या खाद्य प्रसंस्करण में रुचि?",t:"select", o:YNN},
          {k:"supportNeeded",l:"आवश्यक सहायता का प्रकार",             t:"textarea"}
        ]},
        { label:"खंड H: सर्वेक्षक का अवलोकन", fields:[
          {k:"weaknesses",  l:"परिवार की प्रमुख आर्थिक कमजोरियाँ",   t:"textarea"},
          {k:"resources",   l:"परिवार के उपलब्ध संसाधन",             t:"textarea"},
          {k:"womenPotential",l:"महिला की संभावित आर्थिक क्षमता",    t:"textarea"},
          {k:"notes",       l:"अन्य टिप्पणियाँ",                     t:"textarea"}
        ]}
      ]
    },

    village: {
      title:"ग्राम प्रोफाइल एवं संवेदनशीलता मानचित्रण",
      sections:[
        { label:"खंड A: गाँव की पहचान", fields:[
          {k:"date",        l:"सर्वेक्षण की तारीख",    t:"date"},
          {k:"block",       l:"प्रखंड",                t:"select", o:BLOCKS},
          {k:"panchayat",   l:"पंचायत",               t:"text"},
          {k:"village",     l:"गाँव",                 t:"text"},
          {k:"surveyor",    l:"सर्वेक्षक",             t:"text"},
          {k:"totalPop",    l:"अनुमानित कुल आबादी",    t:"number"},
          {k:"totalFamilies",l:"कुल परिवार",           t:"number"},
          {k:"femalePop",   l:"कुल महिला आबादी",      t:"number"},
          {k:"girlsCount",  l:"किशोरियों की अनुमानित संख्या",t:"number"},
          {k:"community",   l:"प्रमुख सामाजिक एवं आर्थिक समुदाय",t:"text"}
        ]},
        { label:"खंड B: बुनियादी सुविधाएँ", fields:[
          {k:"primarySchool",l:"प्राथमिक विद्यालय",    t:"select", o:YN},
          {k:"middleSchool", l:"माध्यमिक विद्यालय",   t:"select", o:YN},
          {k:"highSchool",   l:"उच्च माध्यमिक विद्यालय",t:"select", o:YN},
          {k:"anganwadi",    l:"आंगनवाड़ी केंद्र (संख्या)",t:"number"},
          {k:"healthCenter", l:"स्वास्थ्य उपकेंद्र/अस्पताल",t:"select", o:YN},
          {k:"bank",         l:"बैंक/बैंकिंग प्रतिनिधि",t:"select", o:YN},
          {k:"shgCount",     l:"स्वयं सहायता समूहों की संख्या",t:"number"},
          {k:"panchayatBhavan",l:"पंचायत भवन",         t:"select", o:YN},
          {k:"transport",    l:"सार्वजनिक परिवहन",     t:"select", o:YN},
          {k:"network",      l:"मोबाइल नेटवर्क एवं इंटरनेट",t:"select", o:["अच्छा","सीमित","उपलब्ध नहीं"]}
        ]},
        { label:"खंड C: आजीविका एवं पलायन", fields:[
          {k:"livelihood",  l:"प्रमुख आजीविका स्रोत",  t:"text"},
          {k:"farmFamilies",l:"कृषि पर निर्भर परिवार", t:"number"},
          {k:"labourFamilies",l:"मजदूरी पर निर्भर परिवार",t:"number"},
          {k:"migration",   l:"रोजगार के लिए पलायन होता है?",t:"select", o:YN},
          {k:"migDest",     l:"पलायन का प्रमुख गंतव्य",t:"text"},
          {k:"migDuration", l:"पलायन की सामान्य अवधि",  t:"text"},
          {k:"migAgeGroup", l:"पलायन करने वाले प्रमुख आयु समूह",t:"text"},
          {k:"womenMigrate",l:"महिलाएँ भी बाहर जाती हैं?",t:"select", o:YNN},
          {k:"agents",      l:"एजेंट/बिचौलियों की सेवाएँ लेनी पड़ती हैं?",t:"select", o:YNN},
          {k:"migProblems", l:"पलायन के दौरान आम समस्याएँ",t:"textarea"}
        ]},
        { label:"खंड D: महिलाओं एवं किशोरियों की स्थिति", fields:[
          {k:"girlsSchool", l:"लड़कियों की माध्यमिक शिक्षा तक पहुँच",t:"select", o:YNN},
          {k:"dropout",     l:"लड़कियों का विद्यालय छोड़ना सामान्य समस्या है?",t:"select", o:YNN},
          {k:"childMarriage",l:"बाल विवाह की स्थिति",   t:"text"},
          {k:"womenBarriers",l:"महिलाओं के रोजगार में सामाजिक बाधाएँ",t:"textarea"},
          {k:"marketAccess",l:"महिलाएँ स्वतंत्र रूप से बाजार जा सकती हैं?",t:"select", o:YNN},
          {k:"bankAccess",  l:"महिलाएँ बैंक और सरकारी कार्यालयों तक पहुँच सकती हैं?",t:"select", o:YNN},
          {k:"womenGroups", l:"महिला समूह सक्रिय हैं?",  t:"select", o:YNN},
          {k:"womenLeaders",l:"महिला नेतृत्व या सामुदायिक संगठन",t:"select", o:YNN}
        ]},
        { label:"खंड E: मानव तस्करी एवं शोषण से जुड़ी संवेदनशीलता", fields:[
          {k:"interstate",  l:"अन्य राज्यों में जाने का चलन है?",   t:"select", o:YNN},
          {k:"fraudMarriage",l:"विवाह के नाम पर दूसरे राज्यों में भेजे जाने की घटनाएँ",t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"employFraud", l:"रोजगार के नाम पर धोखाधड़ी/शोषण की शिकायतें",t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"coercion",    l:"जबरन विवाह/श्रम/यौन शोषण के मामले",  t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"missingGirls",l:"नाबालिग लड़कियों के गायब होने की सूचना",t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"coercionMarriage",l:"विवाह/रोजगार के लिए दबाव या धोखे का सामना",t:"select", o:YNN},
          {k:"identSystem", l:"मामलों की पहचान के लिए कोई व्यवस्था है?",t:"select", o:YNN},
          {k:"communityOpen",l:"समुदाय इन मुद्दों पर खुलकर बात करने में सहज है?",t:"select", o:YNN},
          {k:"stigma",      l:"प्रभावित महिलाओं को सामाजिक भेदभाव या कलंक",t:"select", o:YNN},
          {k:"infoSource",  l:"जानकारी का स्रोत",                   t:"select", o:["दस्तावेजीकृत","स्वतंत्र स्रोतों से पुष्ट","रिपोर्ट की गई, अपुष्ट","सामुदायिक धारणा","प्रत्यक्ष अवलोकन","जानकारी उपलब्ध नहीं"]}
        ]},
        { label:"खंड F: जोखिम एवं सुरक्षा तंत्र", fields:[
          {k:"risks",       l:"महिला सुरक्षा से संबंधित प्रमुख जोखिम",t:"textarea"},
          {k:"panchayatActive",l:"ग्राम पंचायत इस विषय पर सक्रिय है?",t:"select", o:YNN},
          {k:"policeAccess",l:"पुलिस/प्रशासन तक शिकायत पहुँचाने की व्यवस्था",t:"select", o:YNN},
          {k:"helpline",    l:"महिला हेल्पलाइन की जानकारी उपलब्ध है?",t:"select", o:YNN},
          {k:"osc",         l:"वन स्टॉप सेंटर की जानकारी है?",       t:"select", o:YNN},
          {k:"localLeader", l:"भरोसेमंद महिला नेता/सामाजिक कार्यकर्ता है?",t:"select", o:YNN},
          {k:"safeShelter", l:"संकट में सुरक्षित सहायता उपलब्ध है?",  t:"select", o:YNN},
          {k:"servicesNeeded",l:"किन सेवाओं की सबसे अधिक आवश्यकता है?",t:"textarea"}
        ]},
        { label:"खंड G: ग्राम विकास की संभावनाएँ", fields:[
          {k:"opportunities",l:"महिलाओं के लिए उपलब्ध रोजगार अवसर",  t:"textarea"},
          {k:"localProducts",l:"स्थानीय उत्पाद जो बेचे जा सकते हैं", t:"textarea"},
          {k:"foodProcessing",l:"खाद्य एवं कृषि प्रसंस्करण की संभावना",t:"select", o:YNN},
          {k:"solarPotential",l:"सौर/LED असेंबली के आर्थिक अवसर",   t:"select", o:YNN},
          {k:"localBuyers", l:"स्थानीय बाजार या खरीदार उपलब्ध हैं?", t:"select", o:YNN},
          {k:"womenGroup",  l:"महिला उद्यम समूह बनाया जा सकता है?",   t:"select", o:YNN},
          {k:"challenges",  l:"M3-SAGE के लिए प्रमुख अवसर एवं चुनौतियाँ",t:"textarea"}
        ]}
      ]
    },

    kii: {
      title:"प्रमुख सूचना प्रदाता साक्षात्कार (KII)",
      sections:[
        { label:"खंड A: उत्तरदाता का परिचय", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"block",       l:"प्रखंड",                            t:"select", o:BLOCKS},
          {k:"panchayatVillage",l:"पंचायत / गाँव",                t:"text"},
          {k:"name",        l:"उत्तरदाता का नाम (सहमति से)",       t:"text"},
          {k:"role",        l:"पद / भूमिका",                       t:"text"},
          {k:"org",         l:"संस्था / विभाग",                    t:"text"},
          {k:"area",        l:"कार्यक्षेत्र",                      t:"text"},
          {k:"experience",  l:"अनुभव के वर्ष",                     t:"number"},
          {k:"contact",     l:"संपर्क विवरण (वैकल्पिक)",           t:"text"},
          {k:"consent",     l:"सहमति",                             t:"select", o:YN}
        ]},
        { label:"खंड B: क्षेत्र की सामाजिक-आर्थिक स्थिति", fields:[
          {k:"mainProblems",l:"क्षेत्र की प्रमुख सामाजिक एवं आर्थिक समस्याएँ",t:"textarea"},
          {k:"womenStatus", l:"महिलाओं की आर्थिक स्थिति",          t:"textarea"},
          {k:"womenOpportunities",l:"महिलाओं के लिए उपलब्ध रोजगार अवसर",t:"textarea"},
          {k:"womenBarriers",l:"महिलाओं की आर्थिक भागीदारी में मुख्य बाधाएँ",t:"textarea"},
          {k:"youthStatus", l:"युवतियों के रोजगार एवं शिक्षा की स्थिति",t:"textarea"},
          {k:"financialAccess",l:"महिलाओं को वित्तीय सेवाओं तक पहुँच",t:"select", o:["समान पहुँच","आंशिक पहुँच","बहुत कम","नहीं"]}
        ]},
        { label:"खंड C: पलायन, तस्करी एवं शोषण", fields:[
          {k:"migrationStatus",l:"क्षेत्र में पलायन की स्थिति",     t:"textarea"},
          {k:"fraudCases",  l:"रोजगार/विवाह के नाम पर धोखाधड़ी की शिकायतें",t:"textarea"},
          {k:"coercionCases",l:"जबरन विवाह/श्रम/शोषण के मामले",    t:"textarea"},
          {k:"identification",l:"मामलों की पहचान किस प्रकार की जाती है?",t:"textarea"},
          {k:"communityReporting",l:"समुदाय की सूचना देने में सहजता",t:"select", o:["सहज","आंशिक रूप से","असहज","जानकारी नहीं"]},
          {k:"womenChallenges",l:"प्रभावित महिलाओं को चुनौतियाँ",   t:"textarea"},
          {k:"systemResponse",l:"मौजूदा संस्थागत व्यवस्था पर्याप्त है?",t:"select", o:["हाँ","आंशिक रूप से","नहीं"]},
          {k:"dataAvailable",l:"क्या डेटा या दस्तावेज उपलब्ध हैं?",  t:"select", o:YN}
        ]},
        { label:"खंड D: सरकारी योजनाएँ एवं सेवाएँ", fields:[
          {k:"govSchemes",  l:"महिलाओं के लिए सरकारी योजनाएँ",       t:"textarea"},
          {k:"schemeAccess",l:"क्या महिलाओं को योजनाओं का लाभ मिल पा रहा है?",t:"textarea"},
          {k:"accessIssues",l:"किन योजनाओं तक पहुँच में सबसे अधिक कठिनाई",t:"textarea"},
          {k:"skillPrograms",l:"कौशल विकास कार्यक्रम उपलब्ध हैं?",   t:"select", o:YN},
          {k:"shgActive",   l:"बैंक, SHG या माइक्रोफाइनेंस सेवाएँ सक्रिय हैं?",t:"select", o:YNN},
          {k:"creditAccess",l:"महिला उद्यमियों को ऋण और बाजार सहायता मिलती है?",t:"select", o:YNN}
        ]},
        { label:"खंड E: बाजार एवं उद्यम संभावनाएँ", fields:[
          {k:"localBusiness",l:"क्षेत्र में सफल हो सकने वाले स्थानीय व्यवसाय",t:"textarea"},
          {k:"rawMaterial", l:"खाद्य प्रसंस्करण के लिए कच्चा माल उपलब्ध है?",t:"select", o:YNN},
          {k:"solarMarket", l:"सौर/LED उत्पादों के लिए बाजार की संभावना",t:"select", o:YNN},
          {k:"buyers",      l:"संभावित खरीदार",                      t:"text"},
          {k:"productionGroups",l:"उत्पादन एवं विपणन समूह बनाए जा सकते हैं?",t:"select", o:YNN},
          {k:"challenges",  l:"उद्यम शुरू करने में प्रमुख चुनौतियाँ",  t:"textarea"},
          {k:"skillsNeeded",l:"किन कौशलों का प्रशिक्षण आवश्यक है?",   t:"textarea"}
        ]},
        { label:"खंड F: M3-SAGE परियोजना के लिए सुझाव", fields:[
          {k:"priority",    l:"किन समुदायों और महिलाओं तक प्राथमिकता से पहुँचना चाहिए",t:"textarea"},
          {k:"criteria",    l:"लाभार्थियों की पहचान के लिए मानदंड",   t:"textarea"},
          {k:"localOrgs",   l:"कौन-सी स्थानीय संस्थाएँ सहयोग कर सकती हैं?",t:"textarea"},
          {k:"partnerships",l:"किन विभागों/संस्थाओं के साथ साझेदारी आवश्यक है?",t:"textarea"},
          {k:"marketPartners",l:"संभावित बाजार या तकनीकी साझेदार",    t:"text"},
          {k:"indicators",  l:"सफलता मापने के लिए संकेतक",             t:"textarea"},
          {k:"otherSuggestions",l:"अन्य सुझाव",                      t:"textarea"}
        ]}
      ]
    },

    fgd: {
      title:"समूह चर्चा (FGD)",
      sections:[
        { label:"खंड A: चर्चा की जानकारी", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"block",       l:"प्रखंड",                            t:"select", o:BLOCKS},
          {k:"village",     l:"गाँव",                             t:"text"},
          {k:"participants",l:"प्रतिभागियों की संख्या",             t:"number"},
          {k:"group",       l:"प्रतिभागियों का समूह",               t:"select", o:["महिलाएँ","युवा महिलाएँ","महिला उद्यमी","SHG सदस्य","सामुदायिक नेता","अन्य"]},
          {k:"facilitator", l:"संचालक का नाम",                     t:"text"},
          {k:"notetaker",   l:"नोट लेने वाले का नाम",              t:"text"}
        ]},
        { label:"खंड B: महिलाओं की सामाजिक एवं आर्थिक स्थिति", fields:[
          {k:"generalStatus",l:"गाँव में महिलाओं की सामान्य सामाजिक एवं आर्थिक स्थिति",t:"textarea"},
          {k:"mainWork",    l:"महिलाएँ मुख्य रूप से कौन-से काम करती हैं?",t:"textarea"},
          {k:"incomeOpportunity",l:"महिलाओं को आय अर्जित करने के अवसर मिलते हैं?",t:"select", o:YNN},
          {k:"incomeDecision",l:"महिलाएँ अपनी कमाई का उपयोग स्वयं तय कर सकती हैं?",t:"select", o:YNN},
          {k:"barriers",    l:"महिलाओं के रोजगार में सबसे बड़ी बाधाएँ",t:"textarea"},
          {k:"familySupport",l:"परिवार महिलाओं के व्यवसाय/नौकरी का समर्थन करते हैं?",t:"select", o:YNN}
        ]},
        { label:"खंड C: शिक्षा, कौशल एवं अवसर", fields:[
          {k:"girlsEducation",l:"लड़कियों को शिक्षा पूरी करने का अवसर मिलता है?",t:"select", o:YNN},
          {k:"skillTraining",l:"महिलाओं को कौशल प्रशिक्षण मिलता है?",t:"select", o:YNN},
          {k:"skillsNeeded",l:"सबसे अधिक आवश्यक कौशल प्रशिक्षण",     t:"textarea"},
          {k:"groupBusiness",l:"महिलाएँ समूह में व्यवसाय करना चाहेंगी?",t:"select", o:YNN},
          {k:"digitalFinance",l:"महिलाएँ डिजिटल और वित्तीय सेवाओं का उपयोग कर पाती हैं?",t:"select", o:YNN}
        ]},
        { label:"खंड D: पलायन एवं सुरक्षा", fields:[
          {k:"migrationWhy",l:"गाँव से रोजगार के लिए पलायन क्यों होता है?",t:"textarea"},
          {k:"migrationChallenges",l:"पलायन के दौरान महिलाओं को कठिनाइयाँ",t:"textarea"},
          {k:"fraudAwareness",l:"विवाह/रोजगार के नाम पर धोखाधड़ी की जानकारी समुदाय में है?",t:"select", o:YNN},
          {k:"safetyShare",  l:"महिलाएँ सुरक्षा संबंधी समस्याएँ साझा कर सकती हैं?",t:"select", o:YNN},
          {k:"supportSource",l:"संकट में महिलाएँ किससे सहायता माँगती हैं?",t:"textarea"},
          {k:"localSupport", l:"स्थानीय सहायता व्यवस्था पर्याप्त है?",   t:"select", o:YNN}
        ]},
        { label:"खंड E: उद्यम एवं बाजार", fields:[
          {k:"localProducts",l:"स्थानीय उत्पाद जो बनाए या बेचे जा सकते हैं",t:"textarea"},
          {k:"foodOpp",     l:"खाद्य एवं कृषि प्रसंस्करण के अवसर",    t:"select", o:YNN},
          {k:"solarOpp",    l:"सौर/LED उत्पादों की असेंबली या बिक्री की संभावना",t:"select", o:YNN},
          {k:"markets",     l:"उत्पादों को बेचने के लिए उपलब्ध बाजार",  t:"textarea"},
          {k:"collectiveBiz",l:"महिलाएँ सामूहिक उद्यम चलाना चाहेंगी?",  t:"select", o:YNN},
          {k:"supportNeeded",l:"व्यवसाय शुरू करने के लिए आवश्यक सहायता",t:"textarea"},
          {k:"timeSpace",   l:"परिवार महिलाओं को उद्यम के लिए समय और स्थान देगा?",t:"select", o:YNN}
        ]},
        { label:"खंड F: मानसिक स्वास्थ्य एवं सामाजिक सहयोग", fields:[
          {k:"confidence",  l:"आर्थिक और सामाजिक दबाव का महिलाओं के आत्मविश्वास पर असर",t:"textarea"},
          {k:"supportGroup",l:"भावनात्मक सहयोग के लिए कोई सुरक्षित समूह है?",t:"select", o:YNN},
          {k:"mutualHelp",  l:"महिलाएँ एक-दूसरे की सहायता करती हैं?",   t:"select", o:YNN},
          {k:"communitySupport",l:"किस प्रकार के सामुदायिक सहयोग की आवश्यकता है?",t:"textarea"}
        ]},
        { label:"खंड G: परियोजना की प्राथमिकताएँ", fields:[
          {k:"usefulTraining",l:"M3-SAGE के अंतर्गत किस प्रकार का प्रशिक्षण उपयोगी होगा?",t:"textarea"},
          {k:"trainingTime", l:"प्रशिक्षण का सुविधाजनक समय",           t:"text"},
          {k:"marketFinance",l:"कौन-से बाजार एवं वित्तीय अवसर विकसित किए जा सकते हैं?",t:"textarea"},
          {k:"communityContrib",l:"परियोजना को सफल बनाने के लिए समुदाय का योगदान",t:"textarea"},
          {k:"otherSugg",   l:"अन्य सुझाव",                           t:"textarea"},
          {k:"facilitatorSummary",l:"संचालक का सारांश (प्रमुख समस्याएँ, अवसर, प्राथमिकताएँ)",t:"textarea"}
        ]}
      ]
    },

    survivor: {
      title:"गोपनीय एवं स्वैच्छिक उत्तरजीवी परामर्श",
      confidential:true,
      sections:[
        { label:"खंड A: सुरक्षित सहमति", fields:[
          {k:"purposeExplained",l:"महिला को बातचीत का उद्देश्य समझाया गया?",t:"select", o:YN},
          {k:"voluntary",   l:"महिला अपनी इच्छा से सहमत है?",         t:"select", o:YN},
          {k:"refusalRight",l:"महिला जानती है कि वह मना कर सकती है?", t:"select", o:YN},
          {k:"stopAnytime", l:"महिला जानती है कि बातचीत रोक सकती है?",t:"select", o:YN},
          {k:"safeSpace",   l:"सुरक्षित और निजी स्थान उपलब्ध है?",    t:"select", o:YN},
          {k:"comfortable", l:"महिला सहज महसूस कर रही है?",           t:"select", o:YN},
          {k:"trustPerson", l:"महिला चाहती है कि कोई भरोसेमंद साथ रहे?",t:"select", o:["हाँ","नहीं","लागू नहीं"]},
          {k:"audioConsent",l:"ऑडियो रिकॉर्डिंग के लिए सहमति",        t:"select", o:["हाँ","नहीं — डिफॉल्ट नहीं की जाएगी"]}
        ]},
        { label:"खंड B: न्यूनतम आवश्यक जानकारी", fields:[
          {k:"caseId",      l:"गोपनीय केस आईडी",                     t:"text"},
          {k:"date",        l:"तारीख",                               t:"date"},
          {k:"ageGroup",    l:"आयु वर्ग",                            t:"select", o:["18 वर्ष से कम","18–24 वर्ष","25–34 वर्ष","35–44 वर्ष","45 वर्ष या अधिक","बताना नहीं चाहतीं"]},
          {k:"district",    l:"वर्तमान निवास का जिला/प्रखंड (यदि आवश्यक)", t:"text"},
          {k:"familySituation",l:"वर्तमान पारिवारिक स्थिति",          t:"select", o:["अकेली","परिवार के साथ","पति/ससुराल के साथ","अन्य","बताना नहीं चाहतीं"]},
          {k:"feelsSafe",   l:"क्या महिला वर्तमान में सुरक्षित महसूस करती हैं?",t:"select", o:["हाँ","नहीं","निश्चित नहीं","बताना नहीं चाहतीं"]}
        ]},
        { label:"खंड C: अनुभव एवं परिस्थितियाँ", fields:[
          {k:"wantsToShare",l:"महिला अपने अनुभवों के बारे में बात करना चाहती हैं?",t:"select", o:["हाँ","नहीं","बाद में"]},
          {k:"supportNeeded",l:"महिला किस प्रकार की सहायता चाहती हैं?",t:"select", o:["आर्थिक सहायता","रोजगार/उद्यम","कौशल प्रशिक्षण","कानूनी जानकारी","मनोसामाजिक सहयोग","स्वास्थ्य सेवाएँ","शिक्षा","परिवार/समुदाय सहयोग","अन्य"]},
          {k:"circumstances",l:"अनुभव में शामिल परिस्थितियाँ (यदि स्वयं बताना चाहें)",t:"select", o:["धोखे से विवाह या संबंध","जबरन विवाह","दबाव या धमकी","जबरन श्रम","यौन शोषण","आर्थिक शोषण","आवागमन पर नियंत्रण","अन्य","साझा नहीं करना चाहतीं"]},
          {k:"currentRisk", l:"वर्तमान में किसी प्रकार के दबाव/धमकी/शोषण का सामना?",t:"select", o:YNN},
          {k:"immediateSupport",l:"तत्काल सुरक्षा सहायता आवश्यक है?",  t:"select", o:YNN},
          {k:"legalConnected",l:"किसी कानूनी या सरकारी सहायता से जुड़ी हैं?",t:"select", o:YNN},
          {k:"orgSupport",  l:"किसी संस्था या सामुदायिक समूह से सहयोग मिल रहा है?",t:"select", o:YNN}
        ]},
        { label:"खंड D: आर्थिक स्थिति एवं आकांक्षाएँ", fields:[
          {k:"currentActivity",l:"वर्तमान में कोई आर्थिक गतिविधि करती हैं?",t:"select", o:YN},
          {k:"activityType",l:"यदि हाँ, कौन-सी?",                    t:"text"},
          {k:"regularIncome",l:"नियमित आय है?",                      t:"select", o:YNN},
          {k:"incomeDecision",l:"आय पर स्वयं निर्णय ले सकती हैं?",    t:"select", o:YNN},
          {k:"bankAccount", l:"स्वयं का बैंक खाता है?",               t:"select", o:YNN},
          {k:"bankSelf",    l:"बैंक खाते का उपयोग स्वयं कर सकती हैं?",t:"select", o:YNN},
          {k:"skills",      l:"कोई कौशल या पूर्व कार्य अनुभव है?",    t:"text"},
          {k:"wantBusiness",l:"नया व्यवसाय शुरू करना चाहती हैं?",     t:"select", o:YNN},
          {k:"businessPreference",l:"किस प्रकार का व्यवसाय पसंद करेंगी?",t:"select", o:["खाद्य प्रसंस्करण","कृषि आधारित उद्यम","सौर/LED असेंबली","सिलाई/हस्तशिल्प","सेवा आधारित उद्यम","अन्य","अभी तय नहीं"]},
          {k:"groupOrSolo", l:"व्यक्तिगत या समूह के साथ काम करना पसंद करेंगी?",t:"select", o:["व्यक्तिगत","समूह के साथ","दोनों","अभी तय नहीं"]},
          {k:"trainingReady",l:"प्रशिक्षण लेने के लिए तैयार हैं?",     t:"select", o:YNN},
          {k:"supportForTraining",l:"प्रशिक्षण में भाग लेने के लिए आवश्यक सहायता",t:"textarea"},
          {k:"barriers",    l:"बच्चों की देखभाल, यात्रा या समय से जुड़ी बाधाएँ",t:"textarea"},
          {k:"priority",    l:"महिला की अपनी आर्थिक प्राथमिकता",       t:"textarea"}
        ]},
        { label:"खंड E: मानसिक स्वास्थ्य एवं सामाजिक सहयोग", fields:[
          {k:"emotionalSupport",l:"भावनात्मक या मनोसामाजिक सहयोग चाहती हैं?",t:"select", o:YNN},
          {k:"trustedPerson",l:"किसी भरोसेमंद व्यक्ति या समूह से जुड़ी हैं?",t:"select", o:YNN},
          {k:"communityGroup",l:"सामुदायिक महिला समूह में शामिल होना चाहेंगी?",t:"select", o:YNN},
          {k:"selfDecision",l:"अपने जीवन से जुड़े निर्णय स्वयं लेने में सक्षम महसूस करती हैं?",t:"select", o:YNN},
          {k:"stigma",      l:"सामाजिक भेदभाव या कलंक का सामना करना पड़ता है?",t:"select", o:YNN},
          {k:"supportType", l:"किस प्रकार का सहयोग आत्मविश्वास और स्वतंत्रता बढ़ा सकता है?",t:"textarea"}
        ]},
        { label:"खंड F: सहायता एवं रेफरल", fields:[
          {k:"immediateNeeds",l:"तत्काल आवश्यक सहायता",               t:"textarea"},
          {k:"chosenService",l:"महिला द्वारा चुनी गई सहायता सेवा",    t:"text"},
          {k:"referralConsent",l:"रेफरल के लिए सहमत हैं?",            t:"select", o:YNN},
          {k:"referralOrg", l:"किस संस्था/सेवा से संपर्क किया जाना है?",t:"text"},
          {k:"referralStatus",l:"रेफरल की स्थिति",                    t:"select", o:["लंबित","संपर्क किया गया","सेवा प्राप्त हुई","महिला ने मना किया"]},
          {k:"followupConsent",l:"आगे संपर्क करने के लिए सहमति",      t:"select", o:YNN},
          {k:"safeContact", l:"सुरक्षित संपर्क का तरीका",              t:"text"},
          {k:"safeTime",    l:"संपर्क करने का सुरक्षित समय",           t:"text"},
          {k:"smsOk",       l:"संदेश/फोन करना सुरक्षित है?",           t:"select", o:YNN}
        ]},
        { label:"खंड G: परामर्शकर्ता का अवलोकन", fields:[
          {k:"statedPriority",l:"महिला की व्यक्त की गई प्राथमिकताएँ",  t:"textarea"},
          {k:"safetyConcern",l:"तत्काल सुरक्षा संबंधी चिंता",         t:"textarea"},
          {k:"economicPriority",l:"आर्थिक सहायता की प्राथमिकता",       t:"textarea"},
          {k:"actionPlan",  l:"प्रस्तावित कार्ययोजना",                  t:"textarea"},
          {k:"nextActionDate",l:"अगली कार्रवाई की तारीख",              t:"date"},
          {k:"counsellor",  l:"परामर्शकर्ता का नाम एवं कोड",           t:"text"}
        ]}
      ]
    },

    market: {
      title:"बाजार एवं उद्यम व्यवहार्यता आकलन",
      sections:[
        { label:"खंड A: बाजार की जानकारी", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"block",       l:"प्रखंड",                            t:"select", o:BLOCKS},
          {k:"marketPlace", l:"बाजार / स्थान",                     t:"text"},
          {k:"respondent",  l:"उत्तरदाता का नाम (वैकल्पिक)",       t:"text"},
          {k:"businessType",l:"व्यवसाय / दुकान का प्रकार",         t:"text"},
          {k:"experience",  l:"बाजार में अनुभव",                   t:"text"},
          {k:"surveyor",    l:"सर्वेक्षक",                         t:"text"},
          {k:"consent",     l:"साक्षात्कार सहमति",                  t:"select", o:YN}
        ]},
        { label:"खंड B: स्थानीय बाजार की स्थिति", fields:[
          {k:"mainProducts",l:"बाजार में प्रमुख उत्पाद",            t:"textarea"},
          {k:"growingDemand",l:"किन उत्पादों की माँग बढ़ रही है?",   t:"textarea"},
          {k:"unavailable", l:"स्थानीय स्तर पर अनुपलब्ध उत्पाद",   t:"textarea"},
          {k:"womenProducts",l:"महिलाओं द्वारा निर्मित उत्पाद बिकते हैं?",t:"select", o:YNN},
          {k:"qualityIssue",l:"स्थानीय उत्पादों की गुणवत्ता/आपूर्ति में समस्या",t:"select", o:YNN},
          {k:"buyerSource", l:"ग्राहक सामान्यतः कहाँ से उत्पाद खरीदते हैं?",t:"textarea"},
          {k:"mainBuyers",  l:"प्रमुख खरीदार",                     t:"text"},
          {k:"wholesalers", l:"थोक खरीददार उपलब्ध हैं?",           t:"select", o:YNN}
        ]},
        { label:"खंड C: खाद्य एवं कृषि प्रसंस्करण", fields:[
          {k:"cropProducts",l:"प्रमुख कृषि उत्पाद",                 t:"textarea"},
          {k:"processingPossible",l:"किन उत्पादों का प्रसंस्करण संभव है?",t:"textarea"},
          {k:"yearRoundMaterial",l:"कच्चा माल पूरे वर्ष उपलब्ध रहता है?",t:"select", o:YNN},
          {k:"rawPrice",    l:"कच्चे माल की औसत कीमत",              t:"text"},
          {k:"storage",     l:"भंडारण की सुविधा उपलब्ध है?",        t:"select", o:YNN},
          {k:"processedDemand",l:"प्रसंस्कृत उत्पादों की माँग",      t:"textarea"},
          {k:"sellingPrice",l:"संभावित बिक्री मूल्य",               t:"text"},
          {k:"packaging",   l:"पैकेजिंग और गुणवत्ता की आवश्यकताएँ",  t:"textarea"},
          {k:"buyers",      l:"संभावित खरीदार",                     t:"text"},
          {k:"transport",   l:"परिवहन और वितरण की व्यवस्था",         t:"text"},
          {k:"seasonalRisk",l:"मौसमी जोखिम",                        t:"textarea"}
        ]},
        { label:"खंड D: सौर एवं LED उत्पाद असेंबली", fields:[
          {k:"solarDemand", l:"सौर/LED उत्पादों की माँग है?",        t:"select", o:YNN},
          {k:"topSolar",    l:"कौन-से उत्पाद अधिक बिकते हैं?",       t:"text"},
          {k:"supplySource",l:"स्थानीय दुकानदार कहाँ से उत्पाद खरीदते हैं?",t:"text"},
          {k:"localAssembly",l:"स्थानीय स्तर पर असेंबली/मरम्मत की आवश्यकता",t:"select", o:YNN},
          {k:"solarBuyers", l:"संभावित ग्राहक",                     t:"text"},
          {k:"wholesaleSolar",l:"थोक खरीददार",                      t:"text"},
          {k:"suppliers",   l:"कच्चे माल और पुर्जों के आपूर्तिकर्ता",t:"text"},
          {k:"techTraining",l:"तकनीकी प्रशिक्षण की आवश्यकता",       t:"textarea"},
          {k:"qualityStd",  l:"गुणवत्ता और सुरक्षा मानक",            t:"text"},
          {k:"salesChannels",l:"बिक्री के संभावित माध्यम",           t:"text"},
          {k:"competition", l:"प्रतिस्पर्धी उत्पाद और ब्रांड",       t:"text"}
        ]},
        { label:"खंड E: उद्यम लागत एवं लाभ", fields:[
          {k:"enterpriseType",l:"प्रस्तावित उद्यम का प्रकार",         t:"text"},
          {k:"machinery",   l:"मशीनरी / उपकरण की आवश्यकता",          t:"textarea"},
          {k:"capitalEst",  l:"प्रारंभिक पूँजी का अनुमान (₹)",        t:"number"},
          {k:"rawCost",     l:"कच्चे माल की लागत (₹/माह)",            t:"number"},
          {k:"labourCost",  l:"श्रम लागत (₹/माह)",                   t:"number"},
          {k:"packagingCost",l:"पैकेजिंग लागत (₹/माह)",              t:"number"},
          {k:"transportCost",l:"परिवहन लागत (₹/माह)",                t:"number"},
          {k:"monthlyOutput",l:"अनुमानित मासिक उत्पादन",             t:"text"},
          {k:"unitCost",    l:"प्रति इकाई उत्पादन लागत (₹)",          t:"number"},
          {k:"unitPrice",   l:"अनुमानित बिक्री मूल्य (₹/इकाई)",       t:"number"},
          {k:"monthlySales",l:"संभावित मासिक बिक्री (₹)",             t:"number"},
          {k:"monthlyProfit",l:"अनुमानित मासिक परिचालन लाभ (₹)",      t:"number"},
          {k:"risks",       l:"व्यवसाय में प्रमुख जोखिम",             t:"textarea"}
        ]},
        { label:"खंड F: महिला उद्यमिता के अवसर", fields:[
          {k:"womenGroup",  l:"महिला समूह इस उद्यम को संचालित कर सकता है?",t:"select", o:YNN},
          {k:"marketInterest",l:"बाजार महिला-निर्मित उत्पाद खरीदने में रुचि रखता है?",t:"select", o:YNN},
          {k:"directLink",  l:"महिलाओं को सीधे बाजार से जोड़ने की संभावना",t:"select", o:YNN},
          {k:"dealerBuy",   l:"स्थानीय दुकानदार महिलाओं से उत्पाद खरीदने को तैयार हैं?",t:"select", o:YNN},
          {k:"branding",    l:"सामूहिक ब्रांडिंग और पैकेजिंग उपयोगी होगी?",t:"select", o:YNN},
          {k:"digital",     l:"डिजिटल बिक्री की संभावना है?",          t:"select", o:YNN},
          {k:"trainingNeeds",l:"महिलाओं के लिए आवश्यक प्रशिक्षण",     t:"textarea"},
          {k:"womenCount",  l:"उद्यम में महिलाओं की संभावित संख्या",    t:"number"}
        ]},
        { label:"खंड G: बाजार से प्राप्त निष्कर्ष", fields:[
          {k:"topEnterprise",l:"सबसे अधिक संभावनाशील उद्यम",           t:"textarea"},
          {k:"keyBuyers",   l:"संभावित खरीदार / विक्रेता",             t:"text"},
          {k:"competition", l:"बाजार में प्रमुख प्रतिस्पर्धा",          t:"text"},
          {k:"techSupport", l:"आवश्यक तकनीकी सहयोग",                   t:"text"},
          {k:"finPartner",  l:"संभावित वित्तीय साझेदार",                t:"text"},
          {k:"accessBarriers",l:"बाजार तक पहुँच की चुनौतियाँ",         t:"textarea"},
          {k:"recommendations",l:"परियोजना के लिए सिफारिशें",           t:"textarea"}
        ]}
      ]
    },

    institutional: {
      title:"संस्थागत एवं सेवा मानचित्रण",
      sections:[
        { label:"खंड A: संस्था की जानकारी", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"orgName",     l:"संस्था का नाम",                     t:"text"},
          {k:"orgType",     l:"संस्था का प्रकार",                   t:"select", o:["सरकारी विभाग","पंचायत/स्थानीय निकाय","बैंक/वित्तीय संस्था","NGO/CSO","अस्पताल/स्वास्थ्य संस्था","शैक्षणिक संस्था","कौशल विकास संस्था","बाजार/निजी क्षेत्र","अन्य"]},
          {k:"address",     l:"पता",                                t:"text"},
          {k:"blockDistrict",l:"प्रखंड / जिला",                    t:"text"},
          {k:"contactPerson",l:"संपर्क व्यक्ति",                   t:"text"},
          {k:"role",        l:"पद",                                 t:"text"},
          {k:"contact",     l:"फोन / ईमेल (सहमति से)",             t:"text"},
          {k:"area",        l:"कार्यक्षेत्र",                      t:"text"},
          {k:"experience",  l:"संस्था के कार्य का अनुभव",           t:"text"},
          {k:"consent",     l:"उत्तरदाता की सहमति",                 t:"select", o:YN}
        ]},
        { label:"खंड B: सेवाओं की जानकारी", fields:[
          {k:"services",    l:"प्रदान की जाने वाली सेवाएँ",          t:"textarea"},
          {k:"beneficiaries",l:"मुख्य लाभार्थी",                    t:"text"},
          {k:"womenAccess",  l:"महिलाएँ सेवाओं का लाभ ले सकती हैं?",t:"select", o:YN},
          {k:"poorWomen",   l:"गरीब और वंचित महिलाओं के लिए विशेष सहायता",t:"select", o:YNN},
          {k:"skillTraining",l:"कौशल प्रशिक्षण प्रदान करती है?",    t:"select", o:YN},
          {k:"selfEmployment",l:"स्वरोजगार या उद्यम विकास में सहयोग",t:"select", o:YN},
          {k:"credit",       l:"ऋण या वित्तीय सहायता उपलब्ध कराती है?",t:"select", o:YN},
          {k:"marketLink",   l:"बाजार संपर्क में मदद करती है?",      t:"select", o:YN},
          {k:"psychosocial", l:"मनोसामाजिक सहायता उपलब्ध कराती है?",t:"select", o:YN},
          {k:"legal",        l:"कानूनी सहायता या परामर्श देती है?",  t:"select", o:YN},
          {k:"safety",       l:"महिला सुरक्षा एवं संकट सहायता",      t:"select", o:YN}
        ]},
        { label:"खंड C: पहुँच एवं पात्रता", fields:[
          {k:"eligibility", l:"सेवाओं के लिए पात्रता मानदंड",         t:"textarea"},
          {k:"process",     l:"आवेदन की प्रक्रिया",                   t:"text"},
          {k:"documents",   l:"आवश्यक दस्तावेज",                     t:"text"},
          {k:"free",        l:"सेवाएँ निःशुल्क हैं?",                 t:"select", o:YNN},
          {k:"ruralAccess", l:"ग्रामीण महिलाओं के लिए पहुँच आसान है?",t:"select", o:YNN},
          {k:"threeBlocks", l:"तीनों प्रखंडों में सेवाएँ उपलब्ध हैं?",t:"select", o:YNN},
          {k:"docHelp",     l:"दस्तावेज तैयार करने में सहायता मिलती है?",t:"select", o:YNN},
          {k:"timeframe",   l:"सेवा प्राप्त करने में सामान्य समय",    t:"text"}
        ]},
        { label:"खंड D: महिला उद्यम एवं आजीविका सहयोग", fields:[
          {k:"womenTraining",l:"महिला उद्यमियों को प्रशिक्षण देती है?",t:"select", o:YN},
          {k:"startupFund",  l:"उद्यम शुरू करने के लिए वित्तीय सहायता",t:"select", o:YN},
          {k:"shgLoan",      l:"बैंक ऋण या SHG ऋण उपलब्ध है?",       t:"select", o:YN},
          {k:"marketConnect",l:"बाजार से जोड़ती है?",                 t:"select", o:YN},
          {k:"productMarket",l:"उत्पादों की खरीद या विपणन में मदद",   t:"select", o:YN},
          {k:"collectiveModel",l:"सामूहिक उद्यम मॉडल को समर्थन देती है?",t:"select", o:YN},
          {k:"solarTech",    l:"सौर/LED असेंबली के लिए तकनीकी सहायता",t:"select", o:YNN},
          {k:"foodSupport",  l:"खाद्य एवं कृषि प्रसंस्करण के लिए सहयोग",t:"select", o:YNN}
        ]},
        { label:"खंड E: महिला सुरक्षा एवं अधिकार आधारित सेवाएँ", fields:[
          {k:"violenceSupport",l:"हिंसा या शोषण से प्रभावित महिलाओं को सहायता",t:"select", o:YN},
          {k:"traffickingWork",l:"मानव तस्करी से प्रभावित महिलाओं के साथ काम",t:"select", o:YN},
          {k:"legalAid",     l:"कानूनी सहायता उपलब्ध कराती है?",     t:"select", o:YN},
          {k:"mentalHealth", l:"मनोसामाजिक सहायता उपलब्ध कराती है?", t:"select", o:YN},
          {k:"safeReferral", l:"गोपनीय एवं सुरक्षित रेफरल प्रक्रिया",t:"select", o:YN},
          {k:"childProt",    l:"बच्चों के संरक्षण संबंधी सेवाएँ",     t:"select", o:YN},
          {k:"referralNetwork",l:"अन्य संगठनों के साथ रेफरल नेटवर्क",t:"select", o:YN},
          {k:"policeReqd",   l:"कानूनी दस्तावेज/पुलिस शिकायत अनिवार्य है?",t:"select", o:YNN}
        ]},
        { label:"खंड F: साझेदारी की संभावना", fields:[
          {k:"partnerInterest",l:"M3-SAGE के साथ सहयोग में रुचि है?",  t:"select", o:YNN},
          {k:"supportType",  l:"किस प्रकार का सहयोग दे सकती है?",     t:"select", o:["प्रशिक्षण","तकनीकी सहायता","वित्तीय समावेशन","बाजार संपर्क","सरकारी योजनाओं से जोड़ना","कानूनी सहायता","मनोसामाजिक सहायता","रेफरल","अन्य"]},
          {k:"activityPart", l:"परियोजना गतिविधियों में भाग ले सकती है?",t:"select", o:YNN},
          {k:"partnerRef",   l:"किसी अन्य संभावित साझेदार की सिफारिश",t:"text"},
          {k:"conditions",   l:"सहयोग के लिए आवश्यक शर्तें",          t:"textarea"},
          {k:"timeline",     l:"संभावित सहयोग की समयसीमा",             t:"text"}
        ]},
        { label:"खंड G: सेवा उपलब्धता एवं अंतराल", fields:[
          {k:"missingServices",l:"क्षेत्र में अनुपलब्ध सेवाएँ",        t:"textarea"},
          {k:"hardestAccess",l:"किन सेवाओं तक पहुँचना सबसे कठिन है?",  t:"textarea"},
          {k:"coordination", l:"सेवा प्रदाताओं के बीच समन्वय की कमी है?",t:"select", o:YNN},
          {k:"awareness",    l:"ग्रामीण क्षेत्रों में जागरूकता की कमी",t:"select", o:YNN},
          {k:"specialMech",  l:"महिलाओं के लिए विशेष सहायता तंत्र आवश्यक है?",t:"select", o:YNN},
          {k:"priority",     l:"किन सेवाओं को मजबूत करने की प्राथमिकता?",t:"textarea"}
        ]},
        { label:"खंड H: निष्कर्ष", fields:[
          {k:"usefulServices",l:"संस्था की प्रमुख उपयोगी सेवाएँ",      t:"textarea"},
          {k:"partnership",  l:"संस्था के साथ संभावित साझेदारी",        t:"textarea"},
          {k:"referralContact",l:"रेफरल संपर्क",                       t:"text"},
          {k:"projectSuggestions",l:"परियोजना के लिए सुझाव",           t:"textarea"},
          {k:"notes",        l:"अन्य टिप्पणियाँ",                      t:"textarea"}
        ]}
      ]
    }
  };
  return defs[key] || null;
}

// ── Render a form ────────────────────────────────────────────
function m3formDef(key) {
  const BLOCKS = ["शेरघाटी","आमस","डोभी"];
  const YNN = ["हाँ","नहीं","बताना नहीं चाहते"];
  const YN  = ["हाँ","नहीं"];

  const defs = {
    household: {
      title:"परिवार सामाजिक-आर्थिक सर्वेक्षण",
      sections:[
        { label:"खंड A: सर्वेक्षण की जानकारी", fields:[
          {k:"date",        l:"सर्वेक्षण की तारीख",                 t:"date"},
          {k:"block",       l:"प्रखंड",                             t:"select", o:BLOCKS},
          {k:"panchayat",   l:"पंचायत",                            t:"text"},
          {k:"village",     l:"गाँव",                              t:"text"},
          {k:"tola",        l:"टोला / मोहल्ला",                    t:"text"},
          {k:"surveyorName",l:"सर्वेक्षक का नाम",                  t:"text"},
          {k:"respondent",  l:"उत्तरदाता का नाम",                  t:"text"},
          {k:"relation",    l:"परिवार के मुखिया से संबंध",          t:"text"},
          {k:"phone",       l:"मोबाइल नंबर (सहमति से)",            t:"tel"},
          {k:"consent",     l:"उत्तरदाता की सहमति",                t:"select", o:YN}
        ]},
        { label:"खंड B: परिवार की सामान्य जानकारी", fields:[
          {k:"headName",    l:"परिवार के मुखिया का नाम",           t:"text"},
          {k:"familyType",  l:"परिवार का प्रकार",                  t:"select", o:["एकल परिवार","संयुक्त परिवार","महिला मुखिया वाला परिवार","अन्य"]},
          {k:"totalMembers",l:"परिवार में कुल सदस्य",              t:"number"},
          {k:"males",       l:"पुरुष सदस्य",                       t:"number"},
          {k:"females",     l:"महिला सदस्य",                       t:"number"},
          {k:"age0_5",      l:"0–5 वर्ष के बच्चे",                 t:"number"},
          {k:"age6_14",     l:"6–14 वर्ष के बच्चे",               t:"number"},
          {k:"age15_18",    l:"15–18 वर्ष के किशोर/किशोरियाँ",    t:"number"},
          {k:"age19_59",    l:"19–59 वर्ष के सदस्य",              t:"number"},
          {k:"age60plus",   l:"60+ वर्ष के सदस्य",                t:"number"},
          {k:"education",   l:"परिवार का शैक्षणिक स्तर",           t:"select", o:["निरक्षर","प्राथमिक","माध्यमिक","उच्च माध्यमिक","स्नातक या अधिक"]},
          {k:"disabled",    l:"परिवार में दिव्यांग सदस्य",          t:"select", o:YNN}
        ]},
        { label:"खंड C: आवास एवं बुनियादी सुविधाएँ", fields:[
          {k:"houseType",   l:"मकान का प्रकार",                    t:"select", o:["कच्चा","अर्ध-पक्का","पक्का"]},
          {k:"houseOwn",    l:"मकान का स्वामित्व",                  t:"select", o:["स्वयं का","किराये का","रिश्तेदार का","अन्य"]},
          {k:"toilet",      l:"शौचालय",                             t:"select", o:["हाँ","नहीं","सामुदायिक शौचालय"]},
          {k:"water",       l:"पेयजल स्रोत",                        t:"select", o:["नल","हैंडपंप","कुआँ","टैंकर","अन्य"]},
          {k:"electricity", l:"बिजली की सुविधा",                    t:"select", o:["नियमित","अनियमित","उपलब्ध नहीं"]},
          {k:"fuel",        l:"खाना पकाने का ईंधन",                 t:"select", o:["LPG","लकड़ी","कोयला","गोबर","अन्य"]},
          {k:"smartphone",  l:"स्मार्टफोन उपलब्ध है?",             t:"select", o:YN},
          {k:"internet",    l:"इंटरनेट की सुविधा है?",             t:"select", o:YN}
        ]},
        { label:"खंड D: आजीविका एवं आय", fields:[
          {k:"income_source",l:"मुख्य आय स्रोत",                   t:"select", o:["कृषि","कृषि मजदूरी","गैर-कृषि मजदूरी","सरकारी/निजी नौकरी","स्वरोजगार/व्यवसाय","पशुपालन","अन्य"]},
          {k:"earners",     l:"आय अर्जित करने वाले सदस्य",          t:"number"},
          {k:"monthlyIncome",l:"अनुमानित मासिक आय",                t:"select", o:["₹5,000 से कम","₹5,001–10,000","₹10,001–15,000","₹15,001–25,000","₹25,001–40,000","₹40,000 से अधिक","बताना नहीं चाहते"]},
          {k:"incomeRegular",l:"आय की नियमितता",                   t:"select", o:["नियमित","मौसमी","अनियमित"]},
          {k:"debt",        l:"परिवार पर कर्ज है?",                 t:"select", o:YNN},
          {k:"debtSource",  l:"कर्ज का स्रोत",                     t:"select", o:["बैंक","स्वयं सहायता समूह","साहूकार","रिश्तेदार/मित्र","माइक्रोफाइनेंस","अन्य","लागू नहीं"]},
          {k:"farmLand",    l:"कृषि भूमि है?",                     t:"select", o:YN},
          {k:"landSize",    l:"भूमि का आकार (यदि है)",              t:"text"},
          {k:"livestock",   l:"पशुपालन करता है?",                   t:"select", o:YN},
          {k:"assets",      l:"उत्पादक संसाधन (विवरण)",             t:"textarea"}
        ]},
        { label:"खंड E: महिलाओं की आर्थिक भागीदारी", fields:[
          {k:"womenWork",   l:"महिलाएँ कोई आर्थिक गतिविधि करती हैं?",t:"select", o:YN},
          {k:"womenActivity",l:"किस प्रकार की गतिविधि?",           t:"text"},
          {k:"womenDecision",l:"कमाई पर स्वयं निर्णय लेने का अधिकार",t:"select", o:["पूरी तरह","आंशिक रूप से","नहीं","लागू नहीं"]},
          {k:"bankAccount", l:"महिलाएँ बैंक खाता संचालित करती हैं?",t:"select", o:YNN},
          {k:"bankAccess",  l:"वित्तीय संस्थाओं तक पहुँच",          t:"select", o:YNN},
          {k:"shgMember",   l:"स्वयं सहायता समूह से जुड़ी हैं?",    t:"select", o:YNN},
          {k:"familySupport",l:"व्यवसाय में परिवार का सहयोग मिलेगा?",t:"select", o:YNN},
          {k:"barriers",    l:"रोजगार/उद्यम में मुख्य बाधाएँ",       t:"select", o:["पूँजी की कमी","कौशल की कमी","बाजार तक पहुँच नहीं","परिवार का विरोध","देखभाल की जिम्मेदारी","आवागमन की समस्या","सामाजिक प्रतिबंध","अन्य"]}
        ]},
        { label:"खंड F: शिक्षा, स्वास्थ्य एवं सामाजिक सुरक्षा", fields:[
          {k:"allSchool",   l:"सभी बच्चे विद्यालय जाते हैं?",        t:"select", o:YNN},
          {k:"dropout",     l:"कोई बच्चा विद्यालय छोड़ चुका है?",    t:"select", o:YN},
          {k:"dropoutReason",l:"यदि हाँ, कारण",                     t:"text"},
          {k:"aadhar",      l:"आधार कार्ड उपलब्ध है?",              t:"select", o:YN},
          {k:"ration",      l:"राशन कार्ड उपलब्ध है?",              t:"select", o:YN},
          {k:"healthInsur", l:"आयुष्मान / स्वास्थ्य बीमा",          t:"select", o:YNN},
          {k:"pension",     l:"पेंशन मिलती है?",                    t:"select", o:YNN},
          {k:"govSchemes",  l:"सरकारी योजनाओं का लाभ प्राप्त होता है?",t:"select", o:YN},
          {k:"schemesDetail",l:"किन योजनाओं का लाभ?",               t:"textarea"}
        ]},
        { label:"खंड G: आर्थिक आकांक्षाएँ", fields:[
          {k:"aspiration",  l:"परिवार की महिलाओं की प्रमुख आर्थिक आकांक्षा",t:"textarea"},
          {k:"wantBusiness",l:"कोई महिला नया व्यवसाय शुरू करना चाहती है?",t:"select", o:YN},
          {k:"businessType",l:"किस प्रकार का व्यवसाय?",              t:"text"},
          {k:"trainingReady",l:"प्रशिक्षण के लिए तैयार है?",         t:"select", o:YNN},
          {k:"trainingTime",l:"प्रशिक्षण के लिए उपलब्ध समय",         t:"text"},
          {k:"mobilityOk",  l:"घर से बाहर जाकर काम कर सकती है?",    t:"select", o:YNN},
          {k:"groupWork",   l:"समूह के साथ काम करना पसंद करेगी?",    t:"select", o:YNN},
          {k:"solarFoodInterest",l:"सौर/LED या खाद्य प्रसंस्करण में रुचि?",t:"select", o:YNN},
          {k:"supportNeeded",l:"आवश्यक सहायता का प्रकार",             t:"textarea"}
        ]},
        { label:"खंड H: सर्वेक्षक का अवलोकन", fields:[
          {k:"weaknesses",  l:"परिवार की प्रमुख आर्थिक कमजोरियाँ",   t:"textarea"},
          {k:"resources",   l:"परिवार के उपलब्ध संसाधन",             t:"textarea"},
          {k:"womenPotential",l:"महिला की संभावित आर्थिक क्षमता",    t:"textarea"},
          {k:"notes",       l:"अन्य टिप्पणियाँ",                     t:"textarea"}
        ]}
      ]
    },

    village: {
      title:"ग्राम प्रोफाइल एवं संवेदनशीलता मानचित्रण",
      sections:[
        { label:"खंड A: गाँव की पहचान", fields:[
          {k:"date",        l:"सर्वेक्षण की तारीख",    t:"date"},
          {k:"block",       l:"प्रखंड",                t:"select", o:BLOCKS},
          {k:"panchayat",   l:"पंचायत",               t:"text"},
          {k:"village",     l:"गाँव",                 t:"text"},
          {k:"surveyor",    l:"सर्वेक्षक",             t:"text"},
          {k:"totalPop",    l:"अनुमानित कुल आबादी",    t:"number"},
          {k:"totalFamilies",l:"कुल परिवार",           t:"number"},
          {k:"femalePop",   l:"कुल महिला आबादी",      t:"number"},
          {k:"girlsCount",  l:"किशोरियों की अनुमानित संख्या",t:"number"},
          {k:"community",   l:"प्रमुख सामाजिक एवं आर्थिक समुदाय",t:"text"}
        ]},
        { label:"खंड B: बुनियादी सुविधाएँ", fields:[
          {k:"primarySchool",l:"प्राथमिक विद्यालय",    t:"select", o:YN},
          {k:"middleSchool", l:"माध्यमिक विद्यालय",   t:"select", o:YN},
          {k:"highSchool",   l:"उच्च माध्यमिक विद्यालय",t:"select", o:YN},
          {k:"anganwadi",    l:"आंगनवाड़ी केंद्र (संख्या)",t:"number"},
          {k:"healthCenter", l:"स्वास्थ्य उपकेंद्र/अस्पताल",t:"select", o:YN},
          {k:"bank",         l:"बैंक/बैंकिंग प्रतिनिधि",t:"select", o:YN},
          {k:"shgCount",     l:"स्वयं सहायता समूहों की संख्या",t:"number"},
          {k:"panchayatBhavan",l:"पंचायत भवन",         t:"select", o:YN},
          {k:"transport",    l:"सार्वजनिक परिवहन",     t:"select", o:YN},
          {k:"network",      l:"मोबाइल नेटवर्क एवं इंटरनेट",t:"select", o:["अच्छा","सीमित","उपलब्ध नहीं"]}
        ]},
        { label:"खंड C: आजीविका एवं पलायन", fields:[
          {k:"livelihood",  l:"प्रमुख आजीविका स्रोत",  t:"text"},
          {k:"farmFamilies",l:"कृषि पर निर्भर परिवार", t:"number"},
          {k:"labourFamilies",l:"मजदूरी पर निर्भर परिवार",t:"number"},
          {k:"migration",   l:"रोजगार के लिए पलायन होता है?",t:"select", o:YN},
          {k:"migDest",     l:"पलायन का प्रमुख गंतव्य",t:"text"},
          {k:"migDuration", l:"पलायन की सामान्य अवधि",  t:"text"},
          {k:"migAgeGroup", l:"पलायन करने वाले प्रमुख आयु समूह",t:"text"},
          {k:"womenMigrate",l:"महिलाएँ भी बाहर जाती हैं?",t:"select", o:YNN},
          {k:"agents",      l:"एजेंट/बिचौलियों की सेवाएँ लेनी पड़ती हैं?",t:"select", o:YNN},
          {k:"migProblems", l:"पलायन के दौरान आम समस्याएँ",t:"textarea"}
        ]},
        { label:"खंड D: महिलाओं एवं किशोरियों की स्थिति", fields:[
          {k:"girlsSchool", l:"लड़कियों की माध्यमिक शिक्षा तक पहुँच",t:"select", o:YNN},
          {k:"dropout",     l:"लड़कियों का विद्यालय छोड़ना सामान्य समस्या है?",t:"select", o:YNN},
          {k:"childMarriage",l:"बाल विवाह की स्थिति",   t:"text"},
          {k:"womenBarriers",l:"महिलाओं के रोजगार में सामाजिक बाधाएँ",t:"textarea"},
          {k:"marketAccess",l:"महिलाएँ स्वतंत्र रूप से बाजार जा सकती हैं?",t:"select", o:YNN},
          {k:"bankAccess",  l:"महिलाएँ बैंक और सरकारी कार्यालयों तक पहुँच सकती हैं?",t:"select", o:YNN},
          {k:"womenGroups", l:"महिला समूह सक्रिय हैं?",  t:"select", o:YNN},
          {k:"womenLeaders",l:"महिला नेतृत्व या सामुदायिक संगठन",t:"select", o:YNN}
        ]},
        { label:"खंड E: मानव तस्करी एवं शोषण से जुड़ी संवेदनशीलता", fields:[
          {k:"interstate",  l:"अन्य राज्यों में जाने का चलन है?",   t:"select", o:YNN},
          {k:"fraudMarriage",l:"विवाह के नाम पर दूसरे राज्यों में भेजे जाने की घटनाएँ",t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"employFraud", l:"रोजगार के नाम पर धोखाधड़ी/शोषण की शिकायतें",t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"coercion",    l:"जबरन विवाह/श्रम/यौन शोषण के मामले",  t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"missingGirls",l:"नाबालिग लड़कियों के गायब होने की सूचना",t:"select", o:["हाँ, रिपोर्ट की गई","नहीं","अपुष्ट जानकारी","जानकारी नहीं"]},
          {k:"coercionMarriage",l:"विवाह/रोजगार के लिए दबाव या धोखे का सामना",t:"select", o:YNN},
          {k:"identSystem", l:"मामलों की पहचान के लिए कोई व्यवस्था है?",t:"select", o:YNN},
          {k:"communityOpen",l:"समुदाय इन मुद्दों पर खुलकर बात करने में सहज है?",t:"select", o:YNN},
          {k:"stigma",      l:"प्रभावित महिलाओं को सामाजिक भेदभाव या कलंक",t:"select", o:YNN},
          {k:"infoSource",  l:"जानकारी का स्रोत",                   t:"select", o:["दस्तावेजीकृत","स्वतंत्र स्रोतों से पुष्ट","रिपोर्ट की गई, अपुष्ट","सामुदायिक धारणा","प्रत्यक्ष अवलोकन","जानकारी उपलब्ध नहीं"]}
        ]},
        { label:"खंड F: जोखिम एवं सुरक्षा तंत्र", fields:[
          {k:"risks",       l:"महिला सुरक्षा से संबंधित प्रमुख जोखिम",t:"textarea"},
          {k:"panchayatActive",l:"ग्राम पंचायत इस विषय पर सक्रिय है?",t:"select", o:YNN},
          {k:"policeAccess",l:"पुलिस/प्रशासन तक शिकायत पहुँचाने की व्यवस्था",t:"select", o:YNN},
          {k:"helpline",    l:"महिला हेल्पलाइन की जानकारी उपलब्ध है?",t:"select", o:YNN},
          {k:"osc",         l:"वन स्टॉप सेंटर की जानकारी है?",       t:"select", o:YNN},
          {k:"localLeader", l:"भरोसेमंद महिला नेता/सामाजिक कार्यकर्ता है?",t:"select", o:YNN},
          {k:"safeShelter", l:"संकट में सुरक्षित सहायता उपलब्ध है?",  t:"select", o:YNN},
          {k:"servicesNeeded",l:"किन सेवाओं की सबसे अधिक आवश्यकता है?",t:"textarea"}
        ]},
        { label:"खंड G: ग्राम विकास की संभावनाएँ", fields:[
          {k:"opportunities",l:"महिलाओं के लिए उपलब्ध रोजगार अवसर",  t:"textarea"},
          {k:"localProducts",l:"स्थानीय उत्पाद जो बेचे जा सकते हैं", t:"textarea"},
          {k:"foodProcessing",l:"खाद्य एवं कृषि प्रसंस्करण की संभावना",t:"select", o:YNN},
          {k:"solarPotential",l:"सौर/LED असेंबली के आर्थिक अवसर",   t:"select", o:YNN},
          {k:"localBuyers", l:"स्थानीय बाजार या खरीदार उपलब्ध हैं?", t:"select", o:YNN},
          {k:"womenGroup",  l:"महिला उद्यम समूह बनाया जा सकता है?",   t:"select", o:YNN},
          {k:"challenges",  l:"M3-SAGE के लिए प्रमुख अवसर एवं चुनौतियाँ",t:"textarea"}
        ]}
      ]
    },

    kii: {
      title:"प्रमुख सूचना प्रदाता साक्षात्कार (KII)",
      sections:[
        { label:"खंड A: उत्तरदाता का परिचय", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"block",       l:"प्रखंड",                            t:"select", o:BLOCKS},
          {k:"panchayatVillage",l:"पंचायत / गाँव",                t:"text"},
          {k:"name",        l:"उत्तरदाता का नाम (सहमति से)",       t:"text"},
          {k:"role",        l:"पद / भूमिका",                       t:"text"},
          {k:"org",         l:"संस्था / विभाग",                    t:"text"},
          {k:"area",        l:"कार्यक्षेत्र",                      t:"text"},
          {k:"experience",  l:"अनुभव के वर्ष",                     t:"number"},
          {k:"contact",     l:"संपर्क विवरण (वैकल्पिक)",           t:"text"},
          {k:"consent",     l:"सहमति",                             t:"select", o:YN}
        ]},
        { label:"खंड B: क्षेत्र की सामाजिक-आर्थिक स्थिति", fields:[
          {k:"mainProblems",l:"क्षेत्र की प्रमुख सामाजिक एवं आर्थिक समस्याएँ",t:"textarea"},
          {k:"womenStatus", l:"महिलाओं की आर्थिक स्थिति",          t:"textarea"},
          {k:"womenOpportunities",l:"महिलाओं के लिए उपलब्ध रोजगार अवसर",t:"textarea"},
          {k:"womenBarriers",l:"महिलाओं की आर्थिक भागीदारी में मुख्य बाधाएँ",t:"textarea"},
          {k:"youthStatus", l:"युवतियों के रोजगार एवं शिक्षा की स्थिति",t:"textarea"},
          {k:"financialAccess",l:"महिलाओं को वित्तीय सेवाओं तक पहुँच",t:"select", o:["समान पहुँच","आंशिक पहुँच","बहुत कम","नहीं"]}
        ]},
        { label:"खंड C: पलायन, तस्करी एवं शोषण", fields:[
          {k:"migrationStatus",l:"क्षेत्र में पलायन की स्थिति",     t:"textarea"},
          {k:"fraudCases",  l:"रोजगार/विवाह के नाम पर धोखाधड़ी की शिकायतें",t:"textarea"},
          {k:"coercionCases",l:"जबरन विवाह/श्रम/शोषण के मामले",    t:"textarea"},
          {k:"identification",l:"मामलों की पहचान किस प्रकार की जाती है?",t:"textarea"},
          {k:"communityReporting",l:"समुदाय की सूचना देने में सहजता",t:"select", o:["सहज","आंशिक रूप से","असहज","जानकारी नहीं"]},
          {k:"womenChallenges",l:"प्रभावित महिलाओं को चुनौतियाँ",   t:"textarea"},
          {k:"systemResponse",l:"मौजूदा संस्थागत व्यवस्था पर्याप्त है?",t:"select", o:["हाँ","आंशिक रूप से","नहीं"]},
          {k:"dataAvailable",l:"क्या डेटा या दस्तावेज उपलब्ध हैं?",  t:"select", o:YN}
        ]},
        { label:"खंड D: सरकारी योजनाएँ एवं सेवाएँ", fields:[
          {k:"govSchemes",  l:"महिलाओं के लिए सरकारी योजनाएँ",       t:"textarea"},
          {k:"schemeAccess",l:"क्या महिलाओं को योजनाओं का लाभ मिल पा रहा है?",t:"textarea"},
          {k:"accessIssues",l:"किन योजनाओं तक पहुँच में सबसे अधिक कठिनाई",t:"textarea"},
          {k:"skillPrograms",l:"कौशल विकास कार्यक्रम उपलब्ध हैं?",   t:"select", o:YN},
          {k:"shgActive",   l:"बैंक, SHG या माइक्रोफाइनेंस सेवाएँ सक्रिय हैं?",t:"select", o:YNN},
          {k:"creditAccess",l:"महिला उद्यमियों को ऋण और बाजार सहायता मिलती है?",t:"select", o:YNN}
        ]},
        { label:"खंड E: बाजार एवं उद्यम संभावनाएँ", fields:[
          {k:"localBusiness",l:"क्षेत्र में सफल हो सकने वाले स्थानीय व्यवसाय",t:"textarea"},
          {k:"rawMaterial", l:"खाद्य प्रसंस्करण के लिए कच्चा माल उपलब्ध है?",t:"select", o:YNN},
          {k:"solarMarket", l:"सौर/LED उत्पादों के लिए बाजार की संभावना",t:"select", o:YNN},
          {k:"buyers",      l:"संभावित खरीदार",                      t:"text"},
          {k:"productionGroups",l:"उत्पादन एवं विपणन समूह बनाए जा सकते हैं?",t:"select", o:YNN},
          {k:"challenges",  l:"उद्यम शुरू करने में प्रमुख चुनौतियाँ",  t:"textarea"},
          {k:"skillsNeeded",l:"किन कौशलों का प्रशिक्षण आवश्यक है?",   t:"textarea"}
        ]},
        { label:"खंड F: M3-SAGE परियोजना के लिए सुझाव", fields:[
          {k:"priority",    l:"किन समुदायों और महिलाओं तक प्राथमिकता से पहुँचना चाहिए",t:"textarea"},
          {k:"criteria",    l:"लाभार्थियों की पहचान के लिए मानदंड",   t:"textarea"},
          {k:"localOrgs",   l:"कौन-सी स्थानीय संस्थाएँ सहयोग कर सकती हैं?",t:"textarea"},
          {k:"partnerships",l:"किन विभागों/संस्थाओं के साथ साझेदारी आवश्यक है?",t:"textarea"},
          {k:"marketPartners",l:"संभावित बाजार या तकनीकी साझेदार",    t:"text"},
          {k:"indicators",  l:"सफलता मापने के लिए संकेतक",             t:"textarea"},
          {k:"otherSuggestions",l:"अन्य सुझाव",                      t:"textarea"}
        ]}
      ]
    },

    fgd: {
      title:"समूह चर्चा (FGD)",
      sections:[
        { label:"खंड A: चर्चा की जानकारी", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"block",       l:"प्रखंड",                            t:"select", o:BLOCKS},
          {k:"village",     l:"गाँव",                             t:"text"},
          {k:"participants",l:"प्रतिभागियों की संख्या",             t:"number"},
          {k:"group",       l:"प्रतिभागियों का समूह",               t:"select", o:["महिलाएँ","युवा महिलाएँ","महिला उद्यमी","SHG सदस्य","सामुदायिक नेता","अन्य"]},
          {k:"facilitator", l:"संचालक का नाम",                     t:"text"},
          {k:"notetaker",   l:"नोट लेने वाले का नाम",              t:"text"}
        ]},
        { label:"खंड B: महिलाओं की सामाजिक एवं आर्थिक स्थिति", fields:[
          {k:"generalStatus",l:"गाँव में महिलाओं की सामान्य सामाजिक एवं आर्थिक स्थिति",t:"textarea"},
          {k:"mainWork",    l:"महिलाएँ मुख्य रूप से कौन-से काम करती हैं?",t:"textarea"},
          {k:"incomeOpportunity",l:"महिलाओं को आय अर्जित करने के अवसर मिलते हैं?",t:"select", o:YNN},
          {k:"incomeDecision",l:"महिलाएँ अपनी कमाई का उपयोग स्वयं तय कर सकती हैं?",t:"select", o:YNN},
          {k:"barriers",    l:"महिलाओं के रोजगार में सबसे बड़ी बाधाएँ",t:"textarea"},
          {k:"familySupport",l:"परिवार महिलाओं के व्यवसाय/नौकरी का समर्थन करते हैं?",t:"select", o:YNN}
        ]},
        { label:"खंड C: शिक्षा, कौशल एवं अवसर", fields:[
          {k:"girlsEducation",l:"लड़कियों को शिक्षा पूरी करने का अवसर मिलता है?",t:"select", o:YNN},
          {k:"skillTraining",l:"महिलाओं को कौशल प्रशिक्षण मिलता है?",t:"select", o:YNN},
          {k:"skillsNeeded",l:"सबसे अधिक आवश्यक कौशल प्रशिक्षण",     t:"textarea"},
          {k:"groupBusiness",l:"महिलाएँ समूह में व्यवसाय करना चाहेंगी?",t:"select", o:YNN},
          {k:"digitalFinance",l:"महिलाएँ डिजिटल और वित्तीय सेवाओं का उपयोग कर पाती हैं?",t:"select", o:YNN}
        ]},
        { label:"खंड D: पलायन एवं सुरक्षा", fields:[
          {k:"migrationWhy",l:"गाँव से रोजगार के लिए पलायन क्यों होता है?",t:"textarea"},
          {k:"migrationChallenges",l:"पलायन के दौरान महिलाओं को कठिनाइयाँ",t:"textarea"},
          {k:"fraudAwareness",l:"विवाह/रोजगार के नाम पर धोखाधड़ी की जानकारी समुदाय में है?",t:"select", o:YNN},
          {k:"safetyShare",  l:"महिलाएँ सुरक्षा संबंधी समस्याएँ साझा कर सकती हैं?",t:"select", o:YNN},
          {k:"supportSource",l:"संकट में महिलाएँ किससे सहायता माँगती हैं?",t:"textarea"},
          {k:"localSupport", l:"स्थानीय सहायता व्यवस्था पर्याप्त है?",   t:"select", o:YNN}
        ]},
        { label:"खंड E: उद्यम एवं बाजार", fields:[
          {k:"localProducts",l:"स्थानीय उत्पाद जो बनाए या बेचे जा सकते हैं",t:"textarea"},
          {k:"foodOpp",     l:"खाद्य एवं कृषि प्रसंस्करण के अवसर",    t:"select", o:YNN},
          {k:"solarOpp",    l:"सौर/LED उत्पादों की असेंबली या बिक्री की संभावना",t:"select", o:YNN},
          {k:"markets",     l:"उत्पादों को बेचने के लिए उपलब्ध बाजार",  t:"textarea"},
          {k:"collectiveBiz",l:"महिलाएँ सामूहिक उद्यम चलाना चाहेंगी?",  t:"select", o:YNN},
          {k:"supportNeeded",l:"व्यवसाय शुरू करने के लिए आवश्यक सहायता",t:"textarea"},
          {k:"timeSpace",   l:"परिवार महिलाओं को उद्यम के लिए समय और स्थान देगा?",t:"select", o:YNN}
        ]},
        { label:"खंड F: मानसिक स्वास्थ्य एवं सामाजिक सहयोग", fields:[
          {k:"confidence",  l:"आर्थिक और सामाजिक दबाव का महिलाओं के आत्मविश्वास पर असर",t:"textarea"},
          {k:"supportGroup",l:"भावनात्मक सहयोग के लिए कोई सुरक्षित समूह है?",t:"select", o:YNN},
          {k:"mutualHelp",  l:"महिलाएँ एक-दूसरे की सहायता करती हैं?",   t:"select", o:YNN},
          {k:"communitySupport",l:"किस प्रकार के सामुदायिक सहयोग की आवश्यकता है?",t:"textarea"}
        ]},
        { label:"खंड G: परियोजना की प्राथमिकताएँ", fields:[
          {k:"usefulTraining",l:"M3-SAGE के अंतर्गत किस प्रकार का प्रशिक्षण उपयोगी होगा?",t:"textarea"},
          {k:"trainingTime", l:"प्रशिक्षण का सुविधाजनक समय",           t:"text"},
          {k:"marketFinance",l:"कौन-से बाजार एवं वित्तीय अवसर विकसित किए जा सकते हैं?",t:"textarea"},
          {k:"communityContrib",l:"परियोजना को सफल बनाने के लिए समुदाय का योगदान",t:"textarea"},
          {k:"otherSugg",   l:"अन्य सुझाव",                           t:"textarea"},
          {k:"facilitatorSummary",l:"संचालक का सारांश (प्रमुख समस्याएँ, अवसर, प्राथमिकताएँ)",t:"textarea"}
        ]}
      ]
    },

    survivor: {
      title:"गोपनीय एवं स्वैच्छिक उत्तरजीवी परामर्श",
      confidential:true,
      sections:[
        { label:"खंड A: सुरक्षित सहमति", fields:[
          {k:"purposeExplained",l:"महिला को बातचीत का उद्देश्य समझाया गया?",t:"select", o:YN},
          {k:"voluntary",   l:"महिला अपनी इच्छा से सहमत है?",         t:"select", o:YN},
          {k:"refusalRight",l:"महिला जानती है कि वह मना कर सकती है?", t:"select", o:YN},
          {k:"stopAnytime", l:"महिला जानती है कि बातचीत रोक सकती है?",t:"select", o:YN},
          {k:"safeSpace",   l:"सुरक्षित और निजी स्थान उपलब्ध है?",    t:"select", o:YN},
          {k:"comfortable", l:"महिला सहज महसूस कर रही है?",           t:"select", o:YN},
          {k:"trustPerson", l:"महिला चाहती है कि कोई भरोसेमंद साथ रहे?",t:"select", o:["हाँ","नहीं","लागू नहीं"]},
          {k:"audioConsent",l:"ऑडियो रिकॉर्डिंग के लिए सहमति",        t:"select", o:["हाँ","नहीं — डिफॉल्ट नहीं की जाएगी"]}
        ]},
        { label:"खंड B: न्यूनतम आवश्यक जानकारी", fields:[
          {k:"caseId",      l:"गोपनीय केस आईडी",                     t:"text"},
          {k:"date",        l:"तारीख",                               t:"date"},
          {k:"ageGroup",    l:"आयु वर्ग",                            t:"select", o:["18 वर्ष से कम","18–24 वर्ष","25–34 वर्ष","35–44 वर्ष","45 वर्ष या अधिक","बताना नहीं चाहतीं"]},
          {k:"district",    l:"वर्तमान निवास का जिला/प्रखंड (यदि आवश्यक)", t:"text"},
          {k:"familySituation",l:"वर्तमान पारिवारिक स्थिति",          t:"select", o:["अकेली","परिवार के साथ","पति/ससुराल के साथ","अन्य","बताना नहीं चाहतीं"]},
          {k:"feelsSafe",   l:"क्या महिला वर्तमान में सुरक्षित महसूस करती हैं?",t:"select", o:["हाँ","नहीं","निश्चित नहीं","बताना नहीं चाहतीं"]}
        ]},
        { label:"खंड C: अनुभव एवं परिस्थितियाँ", fields:[
          {k:"wantsToShare",l:"महिला अपने अनुभवों के बारे में बात करना चाहती हैं?",t:"select", o:["हाँ","नहीं","बाद में"]},
          {k:"supportNeeded",l:"महिला किस प्रकार की सहायता चाहती हैं?",t:"select", o:["आर्थिक सहायता","रोजगार/उद्यम","कौशल प्रशिक्षण","कानूनी जानकारी","मनोसामाजिक सहयोग","स्वास्थ्य सेवाएँ","शिक्षा","परिवार/समुदाय सहयोग","अन्य"]},
          {k:"circumstances",l:"अनुभव में शामिल परिस्थितियाँ (यदि स्वयं बताना चाहें)",t:"select", o:["धोखे से विवाह या संबंध","जबरन विवाह","दबाव या धमकी","जबरन श्रम","यौन शोषण","आर्थिक शोषण","आवागमन पर नियंत्रण","अन्य","साझा नहीं करना चाहतीं"]},
          {k:"currentRisk", l:"वर्तमान में किसी प्रकार के दबाव/धमकी/शोषण का सामना?",t:"select", o:YNN},
          {k:"immediateSupport",l:"तत्काल सुरक्षा सहायता आवश्यक है?",  t:"select", o:YNN},
          {k:"legalConnected",l:"किसी कानूनी या सरकारी सहायता से जुड़ी हैं?",t:"select", o:YNN},
          {k:"orgSupport",  l:"किसी संस्था या सामुदायिक समूह से सहयोग मिल रहा है?",t:"select", o:YNN}
        ]},
        { label:"खंड D: आर्थिक स्थिति एवं आकांक्षाएँ", fields:[
          {k:"currentActivity",l:"वर्तमान में कोई आर्थिक गतिविधि करती हैं?",t:"select", o:YN},
          {k:"activityType",l:"यदि हाँ, कौन-सी?",                    t:"text"},
          {k:"regularIncome",l:"नियमित आय है?",                      t:"select", o:YNN},
          {k:"incomeDecision",l:"आय पर स्वयं निर्णय ले सकती हैं?",    t:"select", o:YNN},
          {k:"bankAccount", l:"स्वयं का बैंक खाता है?",               t:"select", o:YNN},
          {k:"bankSelf",    l:"बैंक खाते का उपयोग स्वयं कर सकती हैं?",t:"select", o:YNN},
          {k:"skills",      l:"कोई कौशल या पूर्व कार्य अनुभव है?",    t:"text"},
          {k:"wantBusiness",l:"नया व्यवसाय शुरू करना चाहती हैं?",     t:"select", o:YNN},
          {k:"businessPreference",l:"किस प्रकार का व्यवसाय पसंद करेंगी?",t:"select", o:["खाद्य प्रसंस्करण","कृषि आधारित उद्यम","सौर/LED असेंबली","सिलाई/हस्तशिल्प","सेवा आधारित उद्यम","अन्य","अभी तय नहीं"]},
          {k:"groupOrSolo", l:"व्यक्तिगत या समूह के साथ काम करना पसंद करेंगी?",t:"select", o:["व्यक्तिगत","समूह के साथ","दोनों","अभी तय नहीं"]},
          {k:"trainingReady",l:"प्रशिक्षण लेने के लिए तैयार हैं?",     t:"select", o:YNN},
          {k:"supportForTraining",l:"प्रशिक्षण में भाग लेने के लिए आवश्यक सहायता",t:"textarea"},
          {k:"barriers",    l:"बच्चों की देखभाल, यात्रा या समय से जुड़ी बाधाएँ",t:"textarea"},
          {k:"priority",    l:"महिला की अपनी आर्थिक प्राथमिकता",       t:"textarea"}
        ]},
        { label:"खंड E: मानसिक स्वास्थ्य एवं सामाजिक सहयोग", fields:[
          {k:"emotionalSupport",l:"भावनात्मक या मनोसामाजिक सहयोग चाहती हैं?",t:"select", o:YNN},
          {k:"trustedPerson",l:"किसी भरोसेमंद व्यक्ति या समूह से जुड़ी हैं?",t:"select", o:YNN},
          {k:"communityGroup",l:"सामुदायिक महिला समूह में शामिल होना चाहेंगी?",t:"select", o:YNN},
          {k:"selfDecision",l:"अपने जीवन से जुड़े निर्णय स्वयं लेने में सक्षम महसूस करती हैं?",t:"select", o:YNN},
          {k:"stigma",      l:"सामाजिक भेदभाव या कलंक का सामना करना पड़ता है?",t:"select", o:YNN},
          {k:"supportType", l:"किस प्रकार का सहयोग आत्मविश्वास और स्वतंत्रता बढ़ा सकता है?",t:"textarea"}
        ]},
        { label:"खंड F: सहायता एवं रेफरल", fields:[
          {k:"immediateNeeds",l:"तत्काल आवश्यक सहायता",               t:"textarea"},
          {k:"chosenService",l:"महिला द्वारा चुनी गई सहायता सेवा",    t:"text"},
          {k:"referralConsent",l:"रेफरल के लिए सहमत हैं?",            t:"select", o:YNN},
          {k:"referralOrg", l:"किस संस्था/सेवा से संपर्क किया जाना है?",t:"text"},
          {k:"referralStatus",l:"रेफरल की स्थिति",                    t:"select", o:["लंबित","संपर्क किया गया","सेवा प्राप्त हुई","महिला ने मना किया"]},
          {k:"followupConsent",l:"आगे संपर्क करने के लिए सहमति",      t:"select", o:YNN},
          {k:"safeContact", l:"सुरक्षित संपर्क का तरीका",              t:"text"},
          {k:"safeTime",    l:"संपर्क करने का सुरक्षित समय",           t:"text"},
          {k:"smsOk",       l:"संदेश/फोन करना सुरक्षित है?",           t:"select", o:YNN}
        ]},
        { label:"खंड G: परामर्शकर्ता का अवलोकन", fields:[
          {k:"statedPriority",l:"महिला की व्यक्त की गई प्राथमिकताएँ",  t:"textarea"},
          {k:"safetyConcern",l:"तत्काल सुरक्षा संबंधी चिंता",         t:"textarea"},
          {k:"economicPriority",l:"आर्थिक सहायता की प्राथमिकता",       t:"textarea"},
          {k:"actionPlan",  l:"प्रस्तावित कार्ययोजना",                  t:"textarea"},
          {k:"nextActionDate",l:"अगली कार्रवाई की तारीख",              t:"date"},
          {k:"counsellor",  l:"परामर्शकर्ता का नाम एवं कोड",           t:"text"}
        ]}
      ]
    },

    market: {
      title:"बाजार एवं उद्यम व्यवहार्यता आकलन",
      sections:[
        { label:"खंड A: बाजार की जानकारी", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"block",       l:"प्रखंड",                            t:"select", o:BLOCKS},
          {k:"marketPlace", l:"बाजार / स्थान",                     t:"text"},
          {k:"respondent",  l:"उत्तरदाता का नाम (वैकल्पिक)",       t:"text"},
          {k:"businessType",l:"व्यवसाय / दुकान का प्रकार",         t:"text"},
          {k:"experience",  l:"बाजार में अनुभव",                   t:"text"},
          {k:"surveyor",    l:"सर्वेक्षक",                         t:"text"},
          {k:"consent",     l:"साक्षात्कार सहमति",                  t:"select", o:YN}
        ]},
        { label:"खंड B: स्थानीय बाजार की स्थिति", fields:[
          {k:"mainProducts",l:"बाजार में प्रमुख उत्पाद",            t:"textarea"},
          {k:"growingDemand",l:"किन उत्पादों की माँग बढ़ रही है?",   t:"textarea"},
          {k:"unavailable", l:"स्थानीय स्तर पर अनुपलब्ध उत्पाद",   t:"textarea"},
          {k:"womenProducts",l:"महिलाओं द्वारा निर्मित उत्पाद बिकते हैं?",t:"select", o:YNN},
          {k:"qualityIssue",l:"स्थानीय उत्पादों की गुणवत्ता/आपूर्ति में समस्या",t:"select", o:YNN},
          {k:"buyerSource", l:"ग्राहक सामान्यतः कहाँ से उत्पाद खरीदते हैं?",t:"textarea"},
          {k:"mainBuyers",  l:"प्रमुख खरीदार",                     t:"text"},
          {k:"wholesalers", l:"थोक खरीददार उपलब्ध हैं?",           t:"select", o:YNN}
        ]},
        { label:"खंड C: खाद्य एवं कृषि प्रसंस्करण", fields:[
          {k:"cropProducts",l:"प्रमुख कृषि उत्पाद",                 t:"textarea"},
          {k:"processingPossible",l:"किन उत्पादों का प्रसंस्करण संभव है?",t:"textarea"},
          {k:"yearRoundMaterial",l:"कच्चा माल पूरे वर्ष उपलब्ध रहता है?",t:"select", o:YNN},
          {k:"rawPrice",    l:"कच्चे माल की औसत कीमत",              t:"text"},
          {k:"storage",     l:"भंडारण की सुविधा उपलब्ध है?",        t:"select", o:YNN},
          {k:"processedDemand",l:"प्रसंस्कृत उत्पादों की माँग",      t:"textarea"},
          {k:"sellingPrice",l:"संभावित बिक्री मूल्य",               t:"text"},
          {k:"packaging",   l:"पैकेजिंग और गुणवत्ता की आवश्यकताएँ",  t:"textarea"},
          {k:"buyers",      l:"संभावित खरीदार",                     t:"text"},
          {k:"transport",   l:"परिवहन और वितरण की व्यवस्था",         t:"text"},
          {k:"seasonalRisk",l:"मौसमी जोखिम",                        t:"textarea"}
        ]},
        { label:"खंड D: सौर एवं LED उत्पाद असेंबली", fields:[
          {k:"solarDemand", l:"सौर/LED उत्पादों की माँग है?",        t:"select", o:YNN},
          {k:"topSolar",    l:"कौन-से उत्पाद अधिक बिकते हैं?",       t:"text"},
          {k:"supplySource",l:"स्थानीय दुकानदार कहाँ से उत्पाद खरीदते हैं?",t:"text"},
          {k:"localAssembly",l:"स्थानीय स्तर पर असेंबली/मरम्मत की आवश्यकता",t:"select", o:YNN},
          {k:"solarBuyers", l:"संभावित ग्राहक",                     t:"text"},
          {k:"wholesaleSolar",l:"थोक खरीददार",                      t:"text"},
          {k:"suppliers",   l:"कच्चे माल और पुर्जों के आपूर्तिकर्ता",t:"text"},
          {k:"techTraining",l:"तकनीकी प्रशिक्षण की आवश्यकता",       t:"textarea"},
          {k:"qualityStd",  l:"गुणवत्ता और सुरक्षा मानक",            t:"text"},
          {k:"salesChannels",l:"बिक्री के संभावित माध्यम",           t:"text"},
          {k:"competition", l:"प्रतिस्पर्धी उत्पाद और ब्रांड",       t:"text"}
        ]},
        { label:"खंड E: उद्यम लागत एवं लाभ", fields:[
          {k:"enterpriseType",l:"प्रस्तावित उद्यम का प्रकार",         t:"text"},
          {k:"machinery",   l:"मशीनरी / उपकरण की आवश्यकता",          t:"textarea"},
          {k:"capitalEst",  l:"प्रारंभिक पूँजी का अनुमान (₹)",        t:"number"},
          {k:"rawCost",     l:"कच्चे माल की लागत (₹/माह)",            t:"number"},
          {k:"labourCost",  l:"श्रम लागत (₹/माह)",                   t:"number"},
          {k:"packagingCost",l:"पैकेजिंग लागत (₹/माह)",              t:"number"},
          {k:"transportCost",l:"परिवहन लागत (₹/माह)",                t:"number"},
          {k:"monthlyOutput",l:"अनुमानित मासिक उत्पादन",             t:"text"},
          {k:"unitCost",    l:"प्रति इकाई उत्पादन लागत (₹)",          t:"number"},
          {k:"unitPrice",   l:"अनुमानित बिक्री मूल्य (₹/इकाई)",       t:"number"},
          {k:"monthlySales",l:"संभावित मासिक बिक्री (₹)",             t:"number"},
          {k:"monthlyProfit",l:"अनुमानित मासिक परिचालन लाभ (₹)",      t:"number"},
          {k:"risks",       l:"व्यवसाय में प्रमुख जोखिम",             t:"textarea"}
        ]},
        { label:"खंड F: महिला उद्यमिता के अवसर", fields:[
          {k:"womenGroup",  l:"महिला समूह इस उद्यम को संचालित कर सकता है?",t:"select", o:YNN},
          {k:"marketInterest",l:"बाजार महिला-निर्मित उत्पाद खरीदने में रुचि रखता है?",t:"select", o:YNN},
          {k:"directLink",  l:"महिलाओं को सीधे बाजार से जोड़ने की संभावना",t:"select", o:YNN},
          {k:"dealerBuy",   l:"स्थानीय दुकानदार महिलाओं से उत्पाद खरीदने को तैयार हैं?",t:"select", o:YNN},
          {k:"branding",    l:"सामूहिक ब्रांडिंग और पैकेजिंग उपयोगी होगी?",t:"select", o:YNN},
          {k:"digital",     l:"डिजिटल बिक्री की संभावना है?",          t:"select", o:YNN},
          {k:"trainingNeeds",l:"महिलाओं के लिए आवश्यक प्रशिक्षण",     t:"textarea"},
          {k:"womenCount",  l:"उद्यम में महिलाओं की संभावित संख्या",    t:"number"}
        ]},
        { label:"खंड G: बाजार से प्राप्त निष्कर्ष", fields:[
          {k:"topEnterprise",l:"सबसे अधिक संभावनाशील उद्यम",           t:"textarea"},
          {k:"keyBuyers",   l:"संभावित खरीदार / विक्रेता",             t:"text"},
          {k:"competition", l:"बाजार में प्रमुख प्रतिस्पर्धा",          t:"text"},
          {k:"techSupport", l:"आवश्यक तकनीकी सहयोग",                   t:"text"},
          {k:"finPartner",  l:"संभावित वित्तीय साझेदार",                t:"text"},
          {k:"accessBarriers",l:"बाजार तक पहुँच की चुनौतियाँ",         t:"textarea"},
          {k:"recommendations",l:"परियोजना के लिए सिफारिशें",           t:"textarea"}
        ]}
      ]
    },

    institutional: {
      title:"संस्थागत एवं सेवा मानचित्रण",
      sections:[
        { label:"खंड A: संस्था की जानकारी", fields:[
          {k:"date",        l:"तारीख",                              t:"date"},
          {k:"orgName",     l:"संस्था का नाम",                     t:"text"},
          {k:"orgType",     l:"संस्था का प्रकार",                   t:"select", o:["सरकारी विभाग","पंचायत/स्थानीय निकाय","बैंक/वित्तीय संस्था","NGO/CSO","अस्पताल/स्वास्थ्य संस्था","शैक्षणिक संस्था","कौशल विकास संस्था","बाजार/निजी क्षेत्र","अन्य"]},
          {k:"address",     l:"पता",                                t:"text"},
          {k:"blockDistrict",l:"प्रखंड / जिला",                    t:"text"},
          {k:"contactPerson",l:"संपर्क व्यक्ति",                   t:"text"},
          {k:"role",        l:"पद",                                 t:"text"},
          {k:"contact",     l:"फोन / ईमेल (सहमति से)",             t:"text"},
          {k:"area",        l:"कार्यक्षेत्र",                      t:"text"},
          {k:"experience",  l:"संस्था के कार्य का अनुभव",           t:"text"},
          {k:"consent",     l:"उत्तरदाता की सहमति",                 t:"select", o:YN}
        ]},
        { label:"खंड B: सेवाओं की जानकारी", fields:[
          {k:"services",    l:"प्रदान की जाने वाली सेवाएँ",          t:"textarea"},
          {k:"beneficiaries",l:"मुख्य लाभार्थी",                    t:"text"},
          {k:"womenAccess",  l:"महिलाएँ सेवाओं का लाभ ले सकती हैं?",t:"select", o:YN},
          {k:"poorWomen",   l:"गरीब और वंचित महिलाओं के लिए विशेष सहायता",t:"select", o:YNN},
          {k:"skillTraining",l:"कौशल प्रशिक्षण प्रदान करती है?",    t:"select", o:YN},
          {k:"selfEmployment",l:"स्वरोजगार या उद्यम विकास में सहयोग",t:"select", o:YN},
          {k:"credit",       l:"ऋण या वित्तीय सहायता उपलब्ध कराती है?",t:"select", o:YN},
          {k:"marketLink",   l:"बाजार संपर्क में मदद करती है?",      t:"select", o:YN},
          {k:"psychosocial", l:"मनोसामाजिक सहायता उपलब्ध कराती है?",t:"select", o:YN},
          {k:"legal",        l:"कानूनी सहायता या परामर्श देती है?",  t:"select", o:YN},
          {k:"safety",       l:"महिला सुरक्षा एवं संकट सहायता",      t:"select", o:YN}
        ]},
        { label:"खंड C: पहुँच एवं पात्रता", fields:[
          {k:"eligibility", l:"सेवाओं के लिए पात्रता मानदंड",         t:"textarea"},
          {k:"process",     l:"आवेदन की प्रक्रिया",                   t:"text"},
          {k:"documents",   l:"आवश्यक दस्तावेज",                     t:"text"},
          {k:"free",        l:"सेवाएँ निःशुल्क हैं?",                 t:"select", o:YNN},
          {k:"ruralAccess", l:"ग्रामीण महिलाओं के लिए पहुँच आसान है?",t:"select", o:YNN},
          {k:"threeBlocks", l:"तीनों प्रखंडों में सेवाएँ उपलब्ध हैं?",t:"select", o:YNN},
          {k:"docHelp",     l:"दस्तावेज तैयार करने में सहायता मिलती है?",t:"select", o:YNN},
          {k:"timeframe",   l:"सेवा प्राप्त करने में सामान्य समय",    t:"text"}
        ]},
        { label:"खंड D: महिला उद्यम एवं आजीविका सहयोग", fields:[
          {k:"womenTraining",l:"महिला उद्यमियों को प्रशिक्षण देती है?",t:"select", o:YN},
          {k:"startupFund",  l:"उद्यम शुरू करने के लिए वित्तीय सहायता",t:"select", o:YN},
          {k:"shgLoan",      l:"बैंक ऋण या SHG ऋण उपलब्ध है?",       t:"select", o:YN},
          {k:"marketConnect",l:"बाजार से जोड़ती है?",                 t:"select", o:YN},
          {k:"productMarket",l:"उत्पादों की खरीद या विपणन में मदद",   t:"select", o:YN},
          {k:"collectiveModel",l:"सामूहिक उद्यम मॉडल को समर्थन देती है?",t:"select", o:YN},
          {k:"solarTech",    l:"सौर/LED असेंबली के लिए तकनीकी सहायता",t:"select", o:YNN},
          {k:"foodSupport",  l:"खाद्य एवं कृषि प्रसंस्करण के लिए सहयोग",t:"select", o:YNN}
        ]},
        { label:"खंड E: महिला सुरक्षा एवं अधिकार आधारित सेवाएँ", fields:[
          {k:"violenceSupport",l:"हिंसा या शोषण से प्रभावित महिलाओं को सहायता",t:"select", o:YN},
          {k:"traffickingWork",l:"मानव तस्करी से प्रभावित महिलाओं के साथ काम",t:"select", o:YN},
          {k:"legalAid",     l:"कानूनी सहायता उपलब्ध कराती है?",     t:"select", o:YN},
          {k:"mentalHealth", l:"मनोसामाजिक सहायता उपलब्ध कराती है?", t:"select", o:YN},
          {k:"safeReferral", l:"गोपनीय एवं सुरक्षित रेफरल प्रक्रिया",t:"select", o:YN},
          {k:"childProt",    l:"बच्चों के संरक्षण संबंधी सेवाएँ",     t:"select", o:YN},
          {k:"referralNetwork",l:"अन्य संगठनों के साथ रेफरल नेटवर्क",t:"select", o:YN},
          {k:"policeReqd",   l:"कानूनी दस्तावेज/पुलिस शिकायत अनिवार्य है?",t:"select", o:YNN}
        ]},
        { label:"खंड F: साझेदारी की संभावना", fields:[
          {k:"partnerInterest",l:"M3-SAGE के साथ सहयोग में रुचि है?",  t:"select", o:YNN},
          {k:"supportType",  l:"किस प्रकार का सहयोग दे सकती है?",     t:"select", o:["प्रशिक्षण","तकनीकी सहायता","वित्तीय समावेशन","बाजार संपर्क","सरकारी योजनाओं से जोड़ना","कानूनी सहायता","मनोसामाजिक सहायता","रेफरल","अन्य"]},
          {k:"activityPart", l:"परियोजना गतिविधियों में भाग ले सकती है?",t:"select", o:YNN},
          {k:"partnerRef",   l:"किसी अन्य संभावित साझेदार की सिफारिश",t:"text"},
          {k:"conditions",   l:"सहयोग के लिए आवश्यक शर्तें",          t:"textarea"},
          {k:"timeline",     l:"संभावित सहयोग की समयसीमा",             t:"text"}
        ]},
        { label:"खंड G: सेवा उपलब्धता एवं अंतराल", fields:[
          {k:"missingServices",l:"क्षेत्र में अनुपलब्ध सेवाएँ",        t:"textarea"},
          {k:"hardestAccess",l:"किन सेवाओं तक पहुँचना सबसे कठिन है?",  t:"textarea"},
          {k:"coordination", l:"सेवा प्रदाताओं के बीच समन्वय की कमी है?",t:"select", o:YNN},
          {k:"awareness",    l:"ग्रामीण क्षेत्रों में जागरूकता की कमी",t:"select", o:YNN},
          {k:"specialMech",  l:"महिलाओं के लिए विशेष सहायता तंत्र आवश्यक है?",t:"select", o:YNN},
          {k:"priority",     l:"किन सेवाओं को मजबूत करने की प्राथमिकता?",t:"textarea"}
        ]},
        { label:"खंड H: निष्कर्ष", fields:[
          {k:"usefulServices",l:"संस्था की प्रमुख उपयोगी सेवाएँ",      t:"textarea"},
          {k:"partnership",  l:"संस्था के साथ संभावित साझेदारी",        t:"textarea"},
          {k:"referralContact",l:"रेफरल संपर्क",                       t:"text"},
          {k:"projectSuggestions",l:"परियोजना के लिए सुझाव",           t:"textarea"},
          {k:"notes",        l:"अन्य टिप्पणियाँ",                      t:"textarea"}
        ]}
      ]
    }
  };
  return defs[key] || null;
}

// ── Render a form ────────────────────────────────────────────
function m3renderForm(def, existing) {
  if (!def) return '<div class="card"><div class="empty">Form not found</div></div>';
  const v = existing || {};
  const autoName = (state.me&&state.me.name)||"";
  const autoDate = today();
  const fld = (f) => {
    const isSurveyor = f.k==="surveyorName"||f.k==="surveyor";
    const isDate = f.t==="date";
    const val = v[f.k]||(isSurveyor&&!existing?autoName:"")||(isDate&&!existing?autoDate:"");
    if (f.t === "select") return '<select name="'+f.k+'" class="select-input"><option value="">— चुनें —</option>'+f.o.map(o=>'<option'+(o===val?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select>';
    if (f.t === "textarea") return '<textarea name="'+f.k+'" class="text-input" rows="3">'+esc(val)+'</textarea>';
    if (isSurveyor&&!existing) return '<input type="text" name="'+f.k+'" class="text-input" value="'+esc(val)+'" readonly style="background:var(--bg2);color:var(--muted)">';
    return '<input type="'+(f.t||"text")+'" name="'+f.k+'" class="text-input" value="'+esc(val)+'"'+(f.t==="date"?"":" placeholder=\"___\"")+ '>'; 
  };
  return def.sections.map((sec,si) => `
    <div class="card">
      <h3 style="margin:0 0 14px;font-size:16px">${esc(sec.label)}</h3>
      ${sec.fields.map(f=>`
        <label class="field"><span>${esc(f.l)}</span>${fld(f)}</label>
      `).join("")}
    </div>`).join("");
}

// ── Open form route ──────────────────────────────────────────
routes.m3form = async (formKey, editId) => {
  const fmeta = M3_FORMS.find(f=>f.key===formKey);
  if (!fmeta || !m3canAccess(fmeta)) return html(`<div class="card"><div class="empty">Form not available or access denied.</div></div>`);
  const def = m3formDef(formKey);
  setTitle("M3-SAGE · " + (def?.title || formKey));
  if (typeof paintBack === "function") paintBack();

  let existing = null;
  if (editId) {
    const doc = await db.collection(fmeta.col).doc(editId).get().catch(()=>null);
    if (doc?.exists) existing = doc.data();
  }

  const guide = M3_GUIDELINES[formKey];
  html(`${fmeta.confidential ? `<div style="background:#c0392b;color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:13px">
    🔒 Confidential — Conduct this consultation privately. Participation is fully voluntary. Do not pressure, record, or share identity.</div>` : ""}
  <div class="card"><h2><span style="color:var(--muted);font-weight:400;margin-right:6px">${fmeta.n}.</span>${esc(def?.title||"")}</h2>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small quiet" onclick="go('m3baseline_home')">← All forms</button>
      ${m3canManage() ? `<button class="btn small quiet" onclick="go('m3responses')">View responses</button>` : ""}
    </div>
  </div>
  ${guide ? `<div class="card" style="border-left:4px solid #0d4a7c">
    <h3 style="margin:0 0 10px;font-size:15px">📋 Field Guide</h3>
    <div class="small" style="margin-bottom:8px"><b>Target:</b> ${esc(guide.target)}</div>
    <div class="small" style="margin-bottom:6px"><b>Who to interview:</b> ${esc(guide.who)}</div>
    <div class="small" style="margin-bottom:6px"><b>Priority / respondents:</b>
      <ul style="margin:4px 0 0;padding-left:18px">${guide.priority.map(p=>`<li style="margin:2px 0">${esc(p)}</li>`).join('')}</ul>
    </div>
    <div class="small" style="margin-top:8px;padding:8px;background:var(--bg2);border-radius:6px">
      ⚠️ <b>Important:</b> ${esc(guide.important)}
    </div>
  </div>` : ""}
  <form id="m3f" autocomplete="off">
    ${m3renderForm(def, existing)}
    <div class="card">
      <div class="err" id="m3err"></div>
      <div style="display:flex;gap:8px">
        <button type="submit" class="btn" id="m3sub">Save response</button>
        <button type="button" class="btn quiet" onclick="go('m3baseline_home')">Cancel</button>
      </div>
    </div>
  </form>`);

  $("m3f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("m3sub"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      const fd = new FormData($("m3f"));
      const data = {}; fd.forEach((v,k) => { if(v) data[k] = v; });
      data._formType = formKey;
      data._formTitle = def?.title || formKey;
      data._by = state.user.uid;
      data._byName = state.me.name || "";
      data._at = today();
      data.filledBy = state.user.uid;
      data.date = data.date || today();
      data._ts = firebase.firestore.FieldValue.serverTimestamp();
      if (editId) {
        await db.collection(fmeta.col).doc(editId).update(data);
      } else {
        await db.collection(fmeta.col).add(data);
      }
      audit("m3form_submit", fmeta.col, null, formKey);
      // Auto-log to day report
      const _formNames = {household:"Household survey",village:"Village profile",kii:"KII",fgd:"FGD",survivor:"Survivor consultation",market:"Market assessment",institutional:"Institutional mapping"};
      if (typeof autoLogActivity === "function") autoLogActivity("M3-SAGE Baseline · " + (_formNames[formKey]||formKey) + (data.block?" · "+data.block:"")).catch(()=>{});
      // Wire to work plan activities
      const _actId = formKey==="village"
        ? ((data.block==="शेरघाटी") ? "qFU3FuNX8GIlpxHq9Sau" : "otuNf5GU1ewLjFkGJIVt")
        : "CjRUJhjZI5ijzVjkmPqJ";
      db.collection("activities").doc(_actId).update({
        _submissionCount: firebase.firestore.FieldValue.increment(1),
        _lastSubmission: today()
      }).catch(()=>{});
      toast("Response saved ✓");
      routes.m3baseline();
    } catch(err) { $("m3err").textContent = "Could not save: " + (err.message||err); }
    finally { btn.disabled = false; btn.textContent = "Save response"; }
  };
};

// ── View responses + download ────────────────────────────────
routes.m3responses = async (formKey) => {
  if (!m3canManage()) return html(`<div class="card"><div class="empty">Access denied.</div></div>`);
  formKey = formKey || M3_FORMS[0].key;
  setTitle("M3-SAGE Responses");
  if (typeof paintBack === "function") paintBack();

  const fmeta = M3_FORMS.find(f=>f.key===formKey) || M3_FORMS[0];
  const snap = await db.collection(fmeta.col).orderBy("_ts","desc").limit(200).get().catch(()=>({docs:[]}));
  const rows = snap.docs.map(d=>({id:d.id,...d.data()}));

  html(`<div class="card">
    <h2>M3-SAGE Survey Responses</h2>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${M3_FORMS.filter(f=>!f.confidential||m3canAccess(f)).map(f=>
        `<button class="btn small ${f.key===formKey?"":"quiet"}" data-m3tab="${f.key}">${f.icon} ${f.en}</button>`
      ).join("")}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="m3dl">⬇ Download ${fmeta.en} Excel</button>
      <button class="btn quiet" onclick="go('m3baseline_home')">← Forms</button>
    </div>
  </div>
  <div class="card">
    <h3 style="margin:0 0 10px">${fmeta.icon} ${fmeta.en} &nbsp;<span class="small muted">${rows.length} records</span></h3>
    ${rows.length ? `<div class="list">${rows.map(r=>`
      <div class="item">
        <div class="grow">
          <div class="t">${esc(r.village||r.marketPlace||r.orgName||r.name||"—")} · ${esc(r.block||r.blockDistrict||"")} · ${esc(r._at||"")}</div>
          <div class="s">By ${esc(r._byName||"")} · ${esc(r.panchayat||r.panchayatVillage||"")}${r.caseId?" · "+r.caseId:""}</div>
        </div>
        <button class="btn small quiet" onclick="routes.m3form('${formKey}','${r.id}')">View</button>
      </div>`).join("")}</div>`
    : `<div class="empty">No responses yet</div>`}
  </div>`);


  $("content").querySelectorAll("[data-m3tab]").forEach(b=>b.onclick=()=>routes.m3responses(b.dataset.m3tab));

  $("m3dl").onclick = async () => {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    toast("Building Excel…");
    const wb = XLSX.utils.book_new();
    // All responses as one sheet
    const data = rows.map(r => {
      const out = { "Date":r._at||"", "By":r._byName||"" };
      Object.keys(r).filter(k=>!k.startsWith("_")&&k!=="id").forEach(k=>{ out[k]=r[k]||""; });
      return out;
    });
    if (data.length) {
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, fmeta.en.slice(0,28));
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{Note:"No responses yet"}]), "Empty");
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
      {Field:"Form",Value:fmeta.en},
      {Field:"Records",Value:rows.length},
      {Field:"Downloaded on",Value:today()},
      {Field:"Downloaded by",Value:state.me.name||""}
    ]), "Cover");
    const _fname = "M3SAGE-"+formKey+"-"+today()+".xlsx";
    XLSX.writeFile(wb, _fname);
    // Also save to Drive — 01 Programmes/M3-SAGE/Survey responses
    try {
      const _arr = XLSX.write(wb,{bookType:'xlsx',type:'array'});
      const _blob = new Blob([_arr],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const _file = new File([_blob], _fname, {type:_blob.type});
      const _uploadUrl = (state.drive||{}).uploadUrl||"";
      if (_uploadUrl) {
        // Get M3-SAGE survey responses folder from Firestore
        db.collection("settings").doc("driveFolders").get().then(d=>{
          const fid = d.data()?.["01_programmes_M3_SAGE_survey_responses"] || d.data()?.["01_programmes_M3_SAGE_Survey_responses"] || "";
          fileToStore(_file, 0, 1, "program").catch(()=>{});
          if(fid) {
            const fd=new FormData(); fd.append("action","upload"); fd.append("folderId",fid); fd.append("name",_fname); fd.append("mime","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            const r=new FileReader(); r.onload=()=>{ fd.append("data",r.result.split(",")[1]); fetch(_uploadUrl,{method:"POST",body:fd}).catch(()=>{}); }; r.readAsDataURL(_file);
          }
        }).catch(()=>{});
      }
    } catch(_e) {}
    toast("Downloaded ✓");
  };
};

// Named routes for each form — no argument passing needed
["household","village","kii","fgd","survivor","market","institutional"].forEach(k => {
  routes["m3form_" + k] = () => routes.m3form(k);
});
routes.m3baseline_home = () => routes.m3baseline();
