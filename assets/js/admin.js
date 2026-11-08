// Uses only Supabase project URL and publishable key. Never put a service-role key here.
const SUPABASE_URL="https://aayzpcfryixauwsytphd.supabase.co";
const SUPABASE_KEY="sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz";
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const $=id=>document.getElementById(id);let user=null,lessonsCache=[],figureUrl=null,figurePath=null;
const typeNames={quantitative_comparison:"Quantitative Comparison",multiple_choice_single:"Multiple Choice: Single Answer",multiple_choice_multiple:"Multiple Choice: Multiple Answers",numeric_entry:"Numeric Entry",data_interpretation:"Data Interpretation"};
const slug=s=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function message(id,t,ok=false){$(id).textContent=t;$(id).style.color=ok?"#147d54":"#b42318";}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("selected",x===b));$("lessons").hidden=b.dataset.tab!=="lessons";$("questions").hidden=b.dataset.tab!=="questions";});
async function adminCheck(u){let {data,error}=await db.from("profiles").select("role").eq("id",u.id).single();if(error||data?.role!=="admin")throw Error("This account does not have the DrillGRE admin role.");}
async function enter(u){user=u;try{await adminCheck(u);}catch(e){await db.auth.signOut();$("login").hidden=false;$("dashboard").hidden=true;message("loginMsg",e.message);return;}$("login").hidden=true;$("dashboard").hidden=false;$("who").textContent=u.email||"Admin";await Promise.all([loadLessons(),loadQuestions(),loadLessonOptions()]);}
$("loginForm").onsubmit=async e=>{e.preventDefault();message("loginMsg","Signing in…");let {data,error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});if(error)message("loginMsg",error.message);else await enter(data.user);};
$("logout").onclick=async()=>{await db.auth.signOut();user=null;$("dashboard").hidden=true;$("login").hidden=false;};
(async()=>{let {data}=await db.auth.getSession();if(data.session)await enter(data.session.user);})();
async function loadLessons(){let {data,error}=await db.from("lessons").select("id,title,slug,module_id,sort_order,published,content,modules(id,title,slug)").order("sort_order");if(error){$("lessonList").textContent=error.message;return;}lessonsCache=data||[];$("lessonList").innerHTML=lessonsCache.length?lessonsCache.map(l=>`<div class="entry"><div><strong>${esc(l.title)}</strong><div class="meta">${esc(l.modules?.title||"Module")} · ${l.published?"Published":"Draft"} · order ${l.sort_order}</div></div><div class="buttons"><button data-edit="${l.id}">Edit</button><button data-pub="${l.id}">${l.published?"Unpublish":"Publish"}</button><button class="del" data-del="${l.id}">Delete</button></div></div>`).join():"<p>No lessons yet. Create your first lesson.</p>";$("lessonList").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>editLesson(b.dataset.edit));$("lessonList").querySelectorAll("[data-pub]").forEach(b=>b.onclick=()=>toggleLesson(b.dataset.pub));$("lessonList").querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>deleteLesson(b.dataset.del));}
async function loadLessonOptions(){let {data}=await db.from("lessons").select("id,title").order("title");$("linkedLesson").innerHTML='<option value="">None</option>'+(data||[]).map(l=>`<option value="${l.id}">${esc(l.title)}</option>`).join("");}
$("newLesson").onclick=()=>{$("lessonForm").reset();$("lessonId").value="";$("lessonFormTitle").textContent="New lesson";$("order").value=0;message("lessonMsg","");$("lessonDialog").showModal();};
$("moduleTitle").oninput=()=>{if(!$("moduleSlug").dataset.manual)$("moduleSlug").value=slug($("moduleTitle").value);};$("moduleSlug").oninput=()=>$("moduleSlug").dataset.manual="1";
$("title").oninput=()=>{if(!$("slug").dataset.manual)$("slug").value=slug($("title").value);};$("slug").oninput=()=>$("slug").dataset.manual="1";
async function editLesson(id){let {data,error}=await db.from("lessons").select("*,modules(*)").eq("id",id).single();if(error)return alert(error.message);$("lessonId").value=data.id;$("moduleTitle").value=data.modules?.title||"";$("moduleSlug").value=data.modules?.slug||"";$("title").value=data.title;$("slug").value=data.slug;$("order").value=data.sort_order;$("lessonPublished").checked=data.published;$("content").value=data.content?.markdown||JSON.stringify(data.content||{},null,2);$("lessonFormTitle").textContent="Edit lesson";message("lessonMsg","");$("lessonDialog").showModal();}
$("lessonForm").onsubmit=async e=>{e.preventDefault();message("lessonMsg","Saving…");let mslug=slug($("moduleSlug").value),{data:mod,error}=await db.from("modules").select("id").eq("slug",mslug).maybeSingle();if(error)return message("lessonMsg",error.message);if(!mod){let r=await db.from("modules").insert({title:$("moduleTitle").value.trim(),slug:mslug,sort_order:+$("order").value||0,published:$("lessonPublished").checked}).select("id").single();if(r.error)return message("lessonMsg",r.error.message);mod=r.data;}else{let r=await db.from("modules").update({title:$("moduleTitle").value.trim(),sort_order:+$("order").value||0}).eq("id",mod.id);if(r.error)return message("lessonMsg",r.error.message);}let body={module_id:mod.id,title:$("title").value.trim(),slug:slug($("slug").value),sort_order:+$("order").value||0,published:$("lessonPublished").checked,content:{markdown:$("content").value},updated_at:new Date().toISOString()};let id=$("lessonId").value;let r=id?await db.from("lessons").update(body).eq("id",id):await db.from("lessons").insert(body);if(r.error)return message("lessonMsg",r.error.message);$("lessonDialog").close();await loadLessons();await loadLessonOptions();};
async function toggleLesson(id){let l=lessonsCache.find(x=>x.id===id),r=await db.from("lessons").update({published:!l.published,updated_at:new Date().toISOString()}).eq("id",id);if(r.error)alert(r.error.message);else loadLessons();}
async function deleteLesson(id){if(!confirm("Delete this lesson?"))return;let r=await db.from("lessons").delete().eq("id",id);if(r.error)alert(r.error.message);else{loadLessons();loadLessonOptions();}}

function parseOptions(raw){
  if(Array.isArray(raw)) return raw.map((x,i)=>typeof x==="string"?{label:String.fromCharCode(65+i),text:x}:x);
  if(typeof raw==="string"){try{return parseOptions(JSON.parse(raw));}catch(e){return raw.split("\n").filter(Boolean).map((text,i)=>({label:String.fromCharCode(65+i),text}));}}
  return [];
}
function answerString(raw){
  if(Array.isArray(raw)) return raw;
  if(raw && typeof raw==="object") return raw.answer ?? raw.value ?? raw.selected ?? "";
  return raw ?? "";
}
function renderDynamicFields(existingOptions=[], existingAnswer="", extra={}){
  const type=$("qType").value;
  const opts=parseOptions(existingOptions);
  const ans=answerString(existingAnswer);
  const answerList=Array.isArray(ans)?ans.map(String):String(ans).split(",").map(s=>s.trim()).filter(Boolean);
  let out="";
  if(type==="quantitative_comparison"){
    const qa=extra.quantity_a ?? opts[0]?.text ?? "";
    const qb=extra.quantity_b ?? opts[1]?.text ?? "";
    out=`<div class="dynamic-card"><h3>Quantitative Comparison</h3>
      <label>Quantity A<textarea id="quantityA" rows="2" placeholder="Enter Quantity A">${esc(qa)}</textarea></label>
      <label>Quantity B<textarea id="quantityB" rows="2" placeholder="Enter Quantity B">${esc(qb)}</textarea></label>
      <label>Correct answer</label><div class="answer-choices">
      ${[["A","Quantity A is greater"],["B","Quantity B is greater"],["C","The two quantities are equal"],["D","The relationship cannot be determined"]].map(([v,t])=>`<label class="choice"><input type="radio" name="dynamicAnswer" value="${v}" ${String(ans)===v?"checked":""} required><span><b>${v}.</b> ${t}</span></label>`).join("")}
      </div></div>`;
  } else if(type==="numeric_entry"){
    const numeric=extra.numeric_answer ?? (typeof ans==="object"?ans.value:ans) ?? "";
    const tolerance=extra.tolerance ?? "";
    out=`<div class="dynamic-card"><h3>Numeric Entry</h3><label>Correct numerical answer<input id="numericAnswer" type="text" inputmode="decimal" value="${esc(numeric)}" placeholder="e.g. 12.5" required></label><label>Optional tolerance<input id="numericTolerance" type="number" min="0" step="any" value="${esc(tolerance)}" placeholder="e.g. 0.01"></label><p class="field-note">If tolerance is provided, answers within that distance of the correct value may be accepted by the learner-side checker.</p></div>`;
  } else {
    const multiple=type==="multiple_choice_multiple";
    const defaultOptions=opts.length?opts:[{label:"A",text:""},{label:"B",text:""},{label:"C",text:""},{label:"D",text:""}];
    out=`<div class="dynamic-card"><h3>${type==="data_interpretation"?"Data Interpretation question options":"Answer options"}</h3>
      <p class="field-note">${type==="data_interpretation"?"Put the shared table, chart, or data context in Question text or upload it as a figure. This editor records one DI question at a time.":"Add, remove, or edit the answer options below."}</p>
      <div id="optionRows">${defaultOptions.map((o,i)=>optionRow(o,i,multiple,answerList)).join("")}</div>
      <button type="button" class="secondary add-option" id="addOption">+ Add option</button>
      <label>Correct answer${multiple?"s":""}</label><div class="answer-choices" id="correctChoices">
      ${defaultOptions.map((o,i)=>{const v=o.label||String.fromCharCode(65+i);return `<label class="choice"><input type="${multiple?"checkbox":"radio"}" name="dynamicAnswer" value="${esc(v)}" ${answerList.includes(v)?"checked":""} ${!multiple?"required":""}><span><b>${esc(v)}.</b> ${esc(o.text||"Option "+v)}</span></label>`}).join("")}
      </div></div>`;
  }
  $("dynamicFields").innerHTML=out;
  if(type!=="quantitative_comparison"&&type!=="numeric_entry"){
    $("addOption")?.addEventListener("click",()=>{const rows=$("optionRows");const n=rows.querySelectorAll(".option-row").length;const row=document.createElement("div");row.innerHTML=optionRow({label:String.fromCharCode(65+n),text:""},n,type==="multiple_choice_multiple",[]);rows.appendChild(row.firstElementChild);syncCorrectChoices();});
    $("optionRows")?.addEventListener("input",syncCorrectChoices);
    $("optionRows")?.addEventListener("click",e=>{if(e.target.matches("[data-remove-option]")){e.preventDefault();e.target.closest(".option-row").remove();renumberOptions();syncCorrectChoices();}});
  }
}
function optionRow(o,i,multiple,answers){
  const label=o.label||String.fromCharCode(65+i);
  return `<div class="option-row"><span class="option-label">${esc(label)}.</span><input class="option-text" aria-label="Option ${esc(label)}" value="${esc(o.text??"")}" placeholder="Enter option ${esc(label)}"><button type="button" class="secondary remove-option" data-remove-option>Remove</button></div>`;
}
function collectOptions(){
  return [...document.querySelectorAll("#optionRows .option-row")].map((row,i)=>({label:String.fromCharCode(65+i),text:row.querySelector(".option-text").value.trim()})).filter(o=>o.text);
}
function renumberOptions(){
  document.querySelectorAll("#optionRows .option-row").forEach((row,i)=>row.querySelector(".option-label").textContent=String.fromCharCode(65+i)+".");
}
function syncCorrectChoices(){
  const type=$("qType").value, multiple=type==="multiple_choice_multiple";
  const prior=[...document.querySelectorAll("#correctChoices input:checked")].map(x=>x.value);
  const opts=collectOptions();
  $("correctChoices").innerHTML=opts.map(o=>`<label class="choice"><input type="${multiple?"checkbox":"radio"}" name="dynamicAnswer" value="${esc(o.label)}" ${prior.includes(o.label)?"checked":""} ${!multiple?"required":""}><span><b>${esc(o.label)}.</b> ${esc(o.text)}</span></label>`).join("");
}
