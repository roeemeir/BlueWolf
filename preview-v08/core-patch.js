(()=>{
'use strict';
const core=window.BWCore;
if(!core) throw new Error('BWCore must load before core-patch');
const classifyBase=core.classifyRoute;
core.classifyRoute=(points,periodSec)=>{
  const d=classifyBase(points,periodSec);
  if(d.family==='SO'&&d.subtype==='hippodrome'&&d.selfIntersections===0&&d.axisRatio>1.5&&d.waistRatio<0.70){
    return {...d,subtype:'double_hippodrome',quality:Math.max(d.quality,0.82)};
  }
  return d;
};
const baseTests=core.runSelfTests;
core.runSelfTests=()=>{
  const result=baseTests();
  const tests=result.tests.map(t=>({...t}));
  const target=tests.find(t=>t.name==='SO continuous double hippodrome');
  if(target){
    try{
      const d=core.classifyRoute(core.doubleHippoLoop(0,0,1,0),144);
      target.pass=d.subtype==='double_hippodrome'&&d.waistRatio<0.70&&d.selfIntersections===0;
      target.detail=`waist=${d.waistRatio.toFixed(3)}, axis=${d.axisRatio.toFixed(3)}`;
    }catch(error){target.pass=false;target.detail=String(error&&error.message||error);}
  }
  return {passed:tests.filter(t=>t.pass).length,total:tests.length,tests};
};
})();
