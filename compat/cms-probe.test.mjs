import test from 'node:test';
import assert from 'node:assert/strict';
import {cmsDoctor} from '../scripts/container/cms-doctor.mjs';
import {cmsFailure} from '../scripts/container/cms-source-probe.mjs';
test('packaged CMS session supports both XML and JSON without creating script instances, including clear and close',async()=>{
 const r=await cmsDoctor();assert.equal(r.ok,true);assert.deepEqual(r.cases.map(c=>c.type),[1,0]);assert.equal(r.requestCount,10);assert.equal(r.cleanup.httpStopped,true);
});
test('CMS HTTP rejection, XML parse failure and timeout never collapse into empty business success',()=>{
 assert.equal(cmsFailure(Object.assign(new Error('CMS_HTTP_403'),{code:'CMS_HTTP_403'})).category,'network');assert.equal(cmsFailure(Object.assign(new Error('CMS_INVALID_BODY'),{code:'CMS_INVALID_BODY'})).category,'invalid-response');assert.equal(cmsFailure(Object.assign(new Error('CMS_TIMEOUT'),{code:'CMS_TIMEOUT'})).category,'timeout');
});
