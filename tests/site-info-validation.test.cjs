const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(mode='current') {
 const elements=new Map();
 for(const id of ['currentLandUse','proposedLandUse','nextBtn','assessmentMode','siteName','siteStatus']) elements.set(id,{
  value:'',disabled:false,attrs:{},handlers:{},parentElement:{append(node){this.message=node;}},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},
  addEventListener(k,v){this.handlers[k]=v;},focus(){this.focused=true;}
 });
 const context=vm.createContext({document:{getElementById:id=>elements.get(id)},window:{location:{href:'assessment.html'}},LAND_USE_LABELS:{RLLD:'Residential',CL:'Commercial'},getActiveProfile:()=>({assessmentMode:mode}),updateActiveProfileData(){}});
 const utils=fs.readFileSync(require.resolve('../data-utils.js'),'utf8');
 vm.runInContext(utils.slice(utils.indexOf('function getSiteValidationError'),utils.indexOf('function parseCsv')),context);
 const script=fs.readFileSync(require.resolve('../script.js'),'utf8');
 vm.runInContext(script.slice(script.indexOf('const currentLandUse =')),context);
 return {elements,context};
}
test('Next remains clickable, marks missing current use, and navigates only after correction',()=>{
 const s=setup(),get=id=>s.elements.get(id);
 assert.equal(get('nextBtn').disabled,false);
 assert.equal(get('currentLandUse').attrs['aria-invalid'],undefined);
 get('nextBtn').handlers.click();
 assert.equal(s.context.window.location.href,'assessment.html');
 assert.equal(get('currentLandUse').attrs['aria-invalid'],'true');
 assert.equal(get('currentLandUse').focused,true);
 get('currentLandUse').value='RLLD';get('currentLandUse').handlers.change();
 assert.equal(get('currentLandUse').attrs['aria-invalid'],undefined);
 get('nextBtn').handlers.click();assert.equal(s.context.window.location.href,'contaminants.html');
});
test('proposed screening marks only the proposed dropdown and clears stale errors when mode changes',()=>{
 const s=setup('proposed'),get=id=>s.elements.get(id);
 get('nextBtn').handlers.click();
 assert.equal(get('proposedLandUse').attrs['aria-invalid'],'true');
 assert.equal(get('proposedLandUse').parentElement.message,get('siteStatus'));
 assert.equal(get('currentLandUse').attrs['aria-invalid'],undefined);
 get('assessmentMode').value='current';get('assessmentMode').handlers.change();
 assert.equal(get('proposedLandUse').attrs['aria-invalid'],undefined);
 assert.equal(get('currentLandUse').attrs['aria-invalid'],'true');
});
