(() => {
  "use strict";
  const db = window.supabase.createClient(
    "https://aayzpcfryixauwsytphd.supabase.co",
    "sb_publishable_hdrTlMQ0yEIzHYzJMOBDIQ_u0rWfRNz"
  );
  const $ = id => document.getElementById(id);
  const fmt = (v,d=1) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(d);
  const pct = v => v == null ? "—" : fmt(v,0) + "th";
  function metric(title,value,sub){return '<article class="peer-kpi"><span>'+title+'</span><strong>'+value+'</strong><small>'+sub+'</small></article>';}
  async function load(){
    const host=$("peerBenchmarkPanel"),status=$("peerBenchmarkStatus"),content=$("peerBenchmarkContent");
    if(!host)return;
    const {data:session}=await db.auth.getSession();
    if(!session?.session){host.hidden=true;return;}
    const {data,error}=await db.rpc("get_learner_peer_benchmarks");
    if(error){status.textContent="Peer benchmarks are not available yet. Run supabase/learner-peer-benchmarks.sql in Supabase, then refresh. "+error.message;status.classList.add("error");return;}
    const m=data.my_metrics||{},p=data.percentiles||{},b=data.benchmarks||{};
    $("peerRegistered").textContent=Number(data.registered_learners||0).toLocaleString();
    $("peerActive").textContent=Number(data.active_learners||0).toLocaleString();
    const rows=[
      ["Accuracy",m.accuracy==null?"—":fmt(m.accuracy)+"%",pct(p.accuracy),fmt(b.accuracy_p50)+"%",fmt(b.accuracy_p75)+"%","Higher is better"],
      ["Question speed",m.questions_per_minute==null?"—":fmt(m.questions_per_minute,2)+" / min",pct(p.speed),fmt(b.speed_p50,2),fmt(b.speed_p75,2),"Questions per minute, higher is faster"],
      ["Best mock score",m.best_mock_score==null?"—":fmt(m.best_mock_score,0)+"/170",pct(p.best_mock_score),fmt(b.score_p50,0),fmt(b.score_p75,0),"Practice score, not an official ETS score"],
      ["Recorded study time",fmt(m.recorded_study_hours,1)+" hrs",pct(p.study_hours),fmt(b.hours_p50,1)+" hrs",fmt(b.hours_p75,1)+" hrs","Only time captured by timed activities"]
    ];
    $("peerBenchmarkRows").innerHTML=rows.map(r=>'<div class="peer-row"><strong>'+r[0]+'</strong><span>'+r[1]+'</span><span>'+r[2]+'</span><small>Median: '+r[3]+' · 75th percentile: '+r[4]+' · '+r[5]+'</small></div>').join("");
    $("peerActivityCount").textContent=Number(m.scored_answers||0).toLocaleString();
    if(!data.cohort_sufficient){
      status.textContent="Peer percentiles will appear when at least 10 learners meet the activity threshold. Your own statistics and registered learner count are shown where available.";
    }else{
      status.textContent="Compared with "+Number(data.active_learners).toLocaleString()+" active learners. Eligibility: "+data.eligibility_rule+". Percentiles are anonymous and calculated from learner-level results.";
    }
    content.hidden=false;
  }
  document.addEventListener("DOMContentLoaded",()=>load().catch(e=>{const s=$("peerBenchmarkStatus");if(s){s.textContent="Unable to load peer benchmarks: "+(e.message||e);s.classList.add("error");}}));
})();