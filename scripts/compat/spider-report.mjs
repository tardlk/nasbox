import{readFileSync,writeFileSync}from'node:fs';import{resolve}from'node:path';import{isDeepStrictEqual}from'node:util';
import{root,sha256}from'./reference.mjs';import{buildSpiderFixtures}from'./spider-fixtures.mjs';import{buildSpiderOracle}from'./spider-oracle.mjs';import{spiderCases}from'./spider-cases.mjs';import{runSpiderCases}from'./spider-runner.mjs';
const fixtures=buildSpiderFixtures(),oracle=buildSpiderOracle(fixtures.built);
const expected=await runSpiderCases(spiderCases,fixtures,oracle),actual=await runSpiderCases(spiderCases,fixtures);
const rows=spiderCases.map((c,i)=>({id:c.id,equal:isDeepStrictEqual(expected[i],actual[i])}));
const report={baseline:oracle.extraction.commit,host:{platform:process.platform,architecture:process.arch},scope:oracle.extraction.scope,
 inputSha256:sha256(JSON.stringify(spiderCases)),quickjs:{wrapperVersion:fixtures.built.native.manifest.wrapperTag,wrapperCommit:fixtures.built.native.manifest.wrapperCommit,engineVersion:fixtures.built.native.manifest.quickjsVersion,engineCommit:fixtures.built.native.manifest.quickjsCommit,bytecodeVersion:67},
 comparison:'Exact result/error/identity/cache state equality against freshly extracted source with explicit shared host bindings',total:rows.length,matching:rows.filter(r=>r.equal).length,differences:rows.filter(r=>!r.equal).length,rows,
 limits:['No Android/ART or Linux/NAS runtime validation','No DEX conversion, protected/native plugin or Python execution','Only selected Global functions and explicitly supplied/local modules/artifacts; no Android module download/cache equivalence','Ordinary object-ext initialization is caught outside the owning QuickJS thread on this host; Android verification pending','Unresolved Promise and nonterminating calls are stopped by host process deadline','Subscription hosts/proxy/DOH and full live script effects remain unbound']};
writeFileSync(resolve(root,'docs/linux/spider-runtime-comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({total:report.total,matching:report.matching,differences:report.differences}));if(report.differences)process.exitCode=1;
