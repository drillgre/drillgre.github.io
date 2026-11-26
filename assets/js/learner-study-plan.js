(() => {
"use strict";
const db=window.supabase.createClient("https://aayzpcfryixauwsytphd.supabase.co","sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz");
const $=id=>document.getElementById(id);
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const monday=()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d};
const key=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let plan={items:[],targets:[]},quant={};
function status(message,error=false){const el=$("studyPlanStatus");el.textContent=message;el.classList.toggle("error",error)}
async function load(){
 const {data:session}=await db.auth.getSession();if(!session?.session)return;
 $("studyActivityDate").value=today();\n const weekStart=monday(),weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+6);\n $("studyActivityDate").min=key(weekStart);$("studyActivityDate").max=key(weekEnd);
 const start=key(monday());
 const [p,a]=await Promise.all([db.rpc("get_gre_study_plan",{p_week_start:start}),db.rpc("get_learner_quant_analytics")]);
 if(p.error){status("Run supabase/learner-study-plan.sql in Supabase to activate the planner. "+p.error.message,true);return}
 plan=p.data||{items:[],targets:[]};quant={};
 (a.data?.daily_activity||[]).forEach(x=>quant[x.activity_date]=Number(x.answered||0));
 render();
}
function render(){
 const start=monday(),items=plan.items||[],targets=plan.targets||[],todayKey=today();
 const target=targets.find(x=>x.target_date===todayKey)||{quant_target:20,vocab_target:10,vocab_completed:0};
 const q=quant[todayKey]||0;
 $("studyQuantTarget").value=target.quant_target;$("studyVocabTarget").value=target.vocab_target;$("studyVocabDone").value=target.vocab_completed;
 $("studyQuantProgress").textContent=q+" / "+target.quant_target;$("studyVocabProgress").textContent=target.vocab_completed+" / "+target.vocab_target;
 $("studyQuantBar").style.width=(target.quant_target?Math.min(100,q/target.quant_target*100):0)+"%";
 $("studyVocabBar").style.width=(target.vocab_target?Math.min(100,target.vocab_completed/target.vocab_target*100):0)+"%";
 const done=items.filter(x=>x.completed).length;$("studyPlanCompletion").textContent=(items.length?Math.round(done/items.length*100):0)+"%";
 $("studyPlanWeek").innerHTML=Array.from({length:7},(_,i)=>{
  const d=new Date(start);d.setDate(d.getDate()+i);const date=key(d),dayItems=items.filter(x=>x.activity_date===date);
  const list=dayItems.length?dayItems.map(x=>'<div class="study-plan-item '+(x.completed?'done':'')+'"><strong>'+esc(x.title)+'</strong><small>'+esc(x.activity_type)+' · '+(x.completed?'Completed':'Planned')+'</small><div class="study-plan-item-actions"><button type="button" data-action="toggle" data-id="'+x.id+'">'+(x.completed?'Undo':'Complete')+'</button><button type="button" data-action="edit" data-id="'+x.id+'">Edit / move</button><button type="button" data-action="delete" data-id="'+x.id+'">Remove</button></div></div>').join(""):'<div class="study-plan-empty">No activities</div>';
  return '<section class="study-plan-day '+(date===todayKey?'today':'')+'"><div class="study-plan-day-head">'+d.toLocaleDateString(undefined,{weekday:"short"})+'<span>'+d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+'</span></div>'+list+'</section>';
 }).join("");
 status("Your weekly plan is saved to your account.");
}
$("saveStudyTargets").addEventListener("click",async()=>{
 const start=monday(),quantTarget=Number($("studyQuantTarget").value),vocabTarget=Number($("studyVocabTarget").value),vocabDone=Number($("studyVocabDone").value);
 const requests=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);const date=key(d),existing=(plan.targets||[]).find(x=>x.target_date===date);return db.rpc("set_gre_study_plan_target",{p_target_date:date,p_quant_target:quantTarget,p_vocab_target:vocabTarget,p_vocab_completed:date===today()?vocabDone:Number(existing?.vocab_completed||0)})});
 const results=await Promise.all(requests),failed=results.find(x=>x.error);
 if(failed){status(failed.error.message,true);return}await load();
});
$("studyPlanForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const r=await db.rpc("save_gre_study_plan_item",{p_id:null,p_activity_date:$("studyActivityDate").value,p_activity_type:$("studyActivityType").value,p_title:$("studyActivityTitle").value,p_details:null});
 if(r.error){status(r.error.message,true);return}$("studyActivityTitle").value="";await load();
});
$("studyPlanWeek").addEventListener("click",async e=>{
 const b=e.target.closest("button[data-action]");if(!b)return;
 const item=plan.items.find(x=>x.id===b.dataset.id);if(!item)return;
 let r;
 if(b.dataset.action==="toggle")r=await db.rpc("set_gre_study_plan_item_completed",{p_id:item.id,p_completed:!item.completed});
 if(b.dataset.action==="delete"){if(!confirm("Remove this activity from your plan?"))return;r=await db.rpc("delete_gre_study_plan_item",{p_id:item.id})}
 if(b.dataset.action==="edit"){
  const title=prompt("Activity title:",item.title);if(title===null)return;
  const date=prompt("Reschedule date (YYYY-MM-DD):",item.activity_date);if(date===null)return;
  r=await db.rpc("save_gre_study_plan_item",{p_id:item.id,p_activity_date:date,p_activity_type:item.activity_type,p_title:title,p_details:item.details||null});
 }
 if(r?.error){status(r.error.message,true);return}await load();
});
document.addEventListener("DOMContentLoaded",load);
})();