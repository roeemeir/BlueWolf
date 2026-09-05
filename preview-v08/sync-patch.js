(()=>{
'use strict';
const C=window.BWCore;
if(!C) throw new Error('BWCore must load before sync-patch');
const cycleDistance=(a,b)=>{const d=Math.abs(((a-b)%1+1)%1);return Math.min(d,1-d)};
const pairAngleError=(actual,expected)=>{const a=Math.min(((actual%360)+360)%360,360-(((actual%360)+360)%360)),e=Math.min(((expected%360)+360)%360,360-(((expected%360)+360)%360));return Math.abs(a-e)};
function soRelationPhaseError(a,b,relation){const delta=((b-a)%1+1)%1,targets=relation==='same'?[0]:relation==='opposite'?[.5]:[.25,.75];return Math.min(...targets.map(t=>cycleDistance(delta,t)))}
const doubleQuarter=phase=>Math.floor((((phase%1)+1)%1)*4)%4;
function doubleQuarterRelation(a,b){const d=(doubleQuarter(b)-doubleQuarter(a)+4)%4;return d===0?'same':d===2?'opposite':'mixed'}
function doubleAsSingle(phase){const p=((phase%1)+1)%1;return p<.5?{localPhase:p*2,half:0,relation:'same'}:{localPhase:(p-.5)*2,half:1,relation:'opposite'}}
class StableGroupLifecycle{
  constructor({confirmSeconds=120,holdSeconds=300,preserveFraction=.60}={}){this.confirmSeconds=confirmSeconds;this.holdSeconds=holdSeconds;this.preserveFraction=preserveFraction;this.lastSeen=new Map;this.confirmed=new Set;this.candidate=new Set;this.candidateSince=null;this.revision=0}
  key(s){return [...s].sort().join('|')}
  update(t,observedIds){const observed=new Set(observedIds.map(String));for(const id of observed)this.lastSeen.set(id,t);const effective=new Set(observed);for(const id of this.confirmed)if(t-(this.lastSeen.get(id)??-Infinity)<this.holdSeconds)effective.add(id);const out=[];if(effective.size<2){if(this.confirmed.size){const old=new Set(this.confirmed);this.confirmed.clear();this.candidate.clear();this.candidateSince=null;this.revision++;out.push({kind:'event_closed',t,members:old,revision:this.revision},{kind:'group_closed',t,members:old,revision:this.revision})}return out}if(this.key(effective)===this.key(this.confirmed)){this.candidate.clear();this.candidateSince=null;return out}if(this.key(effective)!==this.key(this.candidate)){this.candidate=new Set(effective);this.candidateSince=t;out.push({kind:'group_candidate',t,members:new Set(effective),revision:this.revision});return out}if(t-this.candidateSince<this.confirmSeconds)return out;const old=new Set(this.confirmed),overlap=[...old].filter(x=>effective.has(x)).length,preserve=old.size>0&&overlap/old.size>=this.preserveFraction;this.confirmed=new Set(effective);this.candidate.clear();this.candidateSince=null;this.revision++;if(!old.size)out.push({kind:'group_confirmed',t,members:new Set(effective),revision:this.revision,preserve:true},{kind:'event_opened',t,members:new Set(effective),revision:this.revision,preserve:true});else out.push({kind:'event_closed',t,members:old,revision:this.revision,preserve},{kind:'group_changed',t,members:new Set(effective),revision:this.revision,preserve},{kind:'event_opened',t,members:new Set(effective),revision:this.revision,preserve});return out}
}
Object.assign(C,{cycleDistance,pairAngleError,soRelationPhaseError,doubleQuarter,doubleQuarterRelation,doubleAsSingle,StableGroupLifecycle});
const previous=C.runSelfTests;
C.runSelfTests=()=>{const base=previous(),tests=base.tests.map(t=>({...t}));const add=(name,category,fn)=>{try{tests.push({name,category,pass:fn()!==false})}catch(e){tests.push({name,category,pass:false,detail:String(e&&e.message||e)})}};
add('SI pair angle 240° equivalent to 120°','sync',()=>pairAngleError(240,120)===0);
add('SO same relation phase','sync',()=>soRelationPhaseError(.1,.1,'same')<1e-12);
add('SO opposite relation phase','sync',()=>soRelationPhaseError(.1,.6,'opposite')<1e-12);
add('SO mixed quarter relation','sync',()=>doubleQuarterRelation(.02,.28)==='mixed');
add('Double opposite quarters','sync',()=>doubleQuarterRelation(.02,.52)==='opposite');
add('Double maps to two opposite singles','sync',()=>{const a=doubleAsSingle(.2),b=doubleAsSingle(.7);return Math.abs(a.localPhase-b.localPhase)<1e-12&&a.relation==='same'&&b.relation==='opposite'});
add('Group confirms after 120s and opens event','event_lifecycle',()=>{const s=new StableGroupLifecycle(),ev=[];for(let t=0;t<=125;t+=5)ev.push(...s.update(t,['101','102','103']));return ev.some(e=>e.kind==='group_confirmed'&&e.t===120)&&ev.some(e=>e.kind==='event_opened'&&e.t===120)});
add('Short disconnect held without event boundary','event_lifecycle',()=>{const s=new StableGroupLifecycle();for(let t=0;t<=125;t+=5)s.update(t,['101','102','103']);let closed=false;for(let t=130;t<300;t+=5)closed||=s.update(t,['101','102']).some(e=>e.kind==='event_closed');return !closed&&s.confirmed.has('103')});
add('Confirmed membership change creates event boundary','event_lifecycle',()=>{const s=new StableGroupLifecycle({holdSeconds:30});for(let t=0;t<=125;t+=5)s.update(t,['101','102','103']);const ev=[];for(let t=130;t<=285;t+=5)ev.push(...s.update(t,['101','102','104']));return ['event_closed','group_changed','event_opened'].every(k=>ev.some(e=>e.kind===k))});
return{passed:tests.filter(t=>t.pass).length,total:tests.length,tests}}
})();
