(() => {
  "use strict";
  const db=window.supabase.createClient("https://aayzpcfryixauwsytphd.supabase.co","sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz");
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtTime=s=>{s=Math.max(0,Number(s)||0);return s>=3600?(s/3600).toFixed(1)+" hrs":Math.round(s/60)+" min";};

  async function load(){
    const {data:sessionData}=await db.auth.getSession();
    if(!sessionData?.session)return;
    const {data,error}=await db.rpc("get_learner_lesson_overview");
    if(error){console.warn("Lesson overview unavailable:",error.message);return;}
    const lessons=data.lessons||[];
    const completed=lessons.filter(x=>x.status==="completed").length;
    const pct=Number(data.completion_percentage||0);
    const active=lessons.filter(x=>x.status==="in_progress").sort((a,b)=>new Date(b.last_activity_at||0)-new Date(a.last_activity_at||0));
    const next=active[0]||lessons.find(x=>x.status==="not_started");
    const resume=$("continueLearning");
    if(resume){
      resume.innerHTML=next
        ? '<div class="lesson-resume-copy"><span class="lesson-resume-label">'+(next.status==="in_progress"?"PICK UP WHERE YOU LEFT OFF":"YOUR NEXT LESSON")+'</span><strong>'+esc(next.title)+'</strong><small>'+esc(next.module_title||"GRE Quant")+' · '+(next.status==="in_progress"?fmtTime(next.active_seconds)+" studied":"Not started")+'</small></div><a class="dash-button" href="/quant/lesson.html?slug='+encodeURIComponent(next.slug)+'">Continue learning →</a>'
        : '<div class="lesson-resume-copy"><strong>All published lessons completed</strong><small>Check back as new lessons are published.</small></div>';
    }
    if($("lessonCompletionPercent"))$("lessonCompletionPercent").textContent=pct.toFixed(1)+"%";
    if($("lessonCompletionSummary"))$("lessonCompletionSummary").textContent=completed+" of "+lessons.length+" published lessons completed";
    if($("lessonCompletionBar"))$("lessonCompletionBar").style.width=pct+"%";
    if($("lessonStudyHours"))$("lessonStudyHours").textContent=fmtTime(data.study_seconds||0);
    if($("lessonLearningStreak"))$("lessonLearningStreak").textContent=Number(data.learning_streak_days||0)+" days";
    if($("lessonCatalogueCount"))$("lessonCatalogueCount").textContent=lessons.length.toLocaleString()+" published lessons";
    const list=$("allLearnerLessons");
    if(list){
      list.innerHTML=lessons.map(x=>{
        const label=x.status==="completed"?"Completed":x.status==="in_progress"?"In progress":"Not started";
        return '<a class="learner-lesson-row '+x.status+'" href="/quant/lesson.html?slug='+encodeURIComponent(x.slug)+'"><span><strong>'+esc(x.title)+'</strong><small>'+esc(x.module_title||"GRE Quant")+' · '+label+'</small></span><span class="learner-lesson-action">'+(x.status==="completed"?"Review →":x.status==="in_progress"?"Resume →":"Start →")+'</span></a>';
      }).join("")||'<p class="account-muted">No published lessons are available yet.</p>';
    }
  }
  document.addEventListener("DOMContentLoaded",()=>load().catch(e=>console.warn("Lesson dashboard:",e)));
})();