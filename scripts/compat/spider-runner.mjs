import{createSpiderRuntime}from'../../backend/spider-runtime/index.mjs';
export async function runSpiderCases(cases,fixtures,built=fixtures.built){
 const runtime=createSpiderRuntime({built});
 try{return await Promise.all(cases.map(({request})=>{
  const spec=structuredClone(request);if(spec.path==='@fixture')spec.path=fixtures.jar;if(spec.modules==='@modules')spec.modules=fixtures.modules;return runtime.query(spec);
 }));}finally{await runtime.close();}
}
