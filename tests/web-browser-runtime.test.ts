import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserBridge } from '../runtime/bridge/server.js';
import { contentSnapshotSchema } from '../runtime/bridge/validation.js';
import { canFallbackToBrowser, validateBrowserWebSnapshot, webPageIdentity } from '../runtime/web/http-capture.js';
import type { AdapterDefinition, CollectRequest, ContentSnapshot } from '../shared/contracts.js';
import type { RuntimeConfig } from '../runtime/policy/config.js';
const targetUrl = 'https://www.anthropic.com/engineering/example';
const adapter: AdapterDefinition = { id: 'anthropic_blog', version: 'old-rule', hosts: ['www.anthropic.com'], content_types: ['article'], status: 'experimental', match: url => url.hostname === 'www.anthropic.com' && url.pathname.startsWith('/engineering/') };
const request: CollectRequest = { target: { type: 'url', url: targetUrl }, save_as: 'document', output: { directory: '/tmp' } };
const listeners: Server[] = [];
afterEach(async () => { await Promise.all(listeners.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
function page(): ContentSnapshot {
 const id=webPageIdentity(targetUrl);
 return {schema_version:'1',platform:'web_page',adapter_version:'1',source_url:targetUrl,canonical_url:targetUrl,platform_content_id:id,content_type:'article',title:'Example',authors:[],published_at:null,blocks:[{type:'paragraph',text:'Public current page body'}],assets:[],access_class:'public_free',completeness:'complete',warnings:[],completeness_proof:{version:1,scope:'single_item',method:'browser_page_capture',rule_id:'web_page.browser-document.v1',platform_content_id:id,boundary:'dom_read',pending_marker_count:0,ordered_asset_count:0,unplaced_asset_count:0}};
}
async function harness(version: string) {
 const extensionId='a'.repeat(32);
 const config:RuntimeConfig={schema_version:1,port:0,state_dir:'/tmp',allowed_extension_ids:[extensionId],clients:[],fixture_origins:[]};
 const bridge=new BrowserBridge(config,{match:url=>adapter.match(url)?adapter:undefined,list:()=>[adapter]});
 const server=createServer((req,res)=>{void bridge.handle(req,res);});listeners.push(server);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No listener');config.port=address.port;
 const post=(path:string,body:unknown,token?:string)=>fetch(`http://127.0.0.1:${config.port}/v1/bridge/${path}`,{method:'POST',headers:{origin:`chrome-extension://${extensionId}`,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
 const registration=await post('register',{version:1,extension_id:extensionId,instance_id:'browser-web-test',extension_version:version});expect(registration.status).toBe(200);
 const session=await registration.json() as {session_id:string;token:string};
 return {bridge,session,post};
}
describe('runtime browser current-page boundary',()=>{
 it('only falls back for web delivery failures, never private-network, size, cancellation or scope errors',()=>{
  for(const code of ['ACCESS_NOT_PUBLIC','CONTENT_NOT_FOUND','HTML_REQUIRED','NETWORK_TIMEOUT','ECONNRESET'])expect(canFallbackToBrowser({code}),code).toBe(true);
  for(const code of ['PRIVATE_ADDRESS_BLOCKED','SIZE_LIMIT','CANCELLED','URL_NOT_ALLOWED','TARGET_URL_MISMATCH','REDIRECT_LIMIT'])expect(canFallbackToBrowser({code}),code).toBe(false);
 });
 it('does not send a new strategy to a legacy extension',async()=>{
  const {bridge,session,post}=await harness('0.1.21');
  await expect(bridge.capture(request.target,request,new AbortController().signal,'job_test',{web_document:true})).rejects.toMatchObject({code:'EXTENSION_UPDATE_REQUIRED',retryable:false});
  const polled=await post('poll',{version:1,session_id:session.session_id},session.token);expect((await polled.json()).commands).toEqual([]);
 });
 it('accepts only an explicitly requested browser receipt through the authenticated bridge',async()=>{
  const {bridge,session,post}=await harness('0.1.23');
  const controller=new AbortController();
  try {
   const pending=bridge.capture(request.target,request,controller.signal,'job_test',{web_document:true});
   const poll=await post('poll',{version:1,session_id:session.session_id},session.token);const command=(await poll.json()).commands[0];
   expect(command.request.adapter_id).toBe('anthropic_blog');expect(command.request.web_document.content_id).toBe(webPageIdentity(targetUrl));
   const response=await post('respond',{version:1,session_id:session.session_id,request_id:command.request_id,nonce:command.nonce,ok:true,result:{snapshot:page()}},session.token);
   expect(response.status).toBe(200);expect((await pending).platform).toBe('web_page');
   const legacy=bridge.capture(request.target,request,controller.signal,'job_legacy');const rejected=expect(legacy).rejects.toMatchObject({code:'SNAPSHOT_INVALID'});
   const next=(await (await post('poll',{version:1,session_id:session.session_id},session.token)).json()).commands[0];
   await post('respond',{version:1,session_id:session.session_id,request_id:next.request_id,nonce:next.nonce,ok:true,result:{snapshot:page()}},session.token);await rejected;
  } finally {controller.abort();}
 });
 it('uses the unified parser for an explicitly existing URL tab without an HTTP fallback',async()=>{
  const {bridge,session,post}=await harness('0.1.23');
  const existing={...request,browser:{tab_strategy:'existing' as const}};
  const pending=bridge.capture(existing.target,existing,new AbortController().signal,'job_existing');
  const command=(await (await post('poll',{version:1,session_id:session.session_id},session.token)).json()).commands[0];
  expect(command.request.web_document.content_id).toBe(webPageIdentity(targetUrl));
  expect(command.request.tab_strategy).toBe('existing');
  await post('respond',{version:1,session_id:session.session_id,request_id:command.request_id,nonce:command.nonce,ok:true,result:{snapshot:page()}},session.token);
  expect((await pending).platform).toBe('web_page');
 });
 it('hands embedded media to the platform path once while preserving the same URL task binding',async()=>{
  const {bridge,session,post}=await harness('0.1.23');
  const controller=new AbortController();
  const auto={...request,save_as:'auto' as const,browser:{tab_strategy:'existing' as const}};
  const pending=bridge.capture(auto.target,auto,controller.signal,'job_media');
  const result=pending.then(snapshot=>({snapshot,error:undefined}),error=>({snapshot:undefined,error}));
  try {
   const first=(await (await post('poll',{version:1,session_id:session.session_id},session.token)).json()).commands[0];
   await post('respond',{version:1,session_id:session.session_id,request_id:first.request_id,nonce:first.nonce,ok:true,result:{snapshot:{...page(),warnings:['media:embedded_content']}}},session.token);
   const second=(await (await post('poll',{version:1,session_id:session.session_id},session.token)).json()).commands[0];
   expect(second.job_id).toBe(first.job_id);expect(second.request.target).toEqual(first.request.target);
   expect(second.request.tab_strategy).toBe('existing');expect(second.request.web_document).toBeUndefined();
   await post('respond',{version:1,session_id:session.session_id,request_id:second.request_id,nonce:second.nonce,ok:true,result:{snapshot:{...page(),platform:adapter.id,adapter_version:adapter.version,content_type:'video',completeness:'unknown',completeness_proof:undefined}}},session.token);
   const collected=(await result).snapshot;
   expect(collected?.content_type).toBe('video');
   expect(collected?.completeness).toBe('partial');
   expect(collected?.warnings).toContain('content_pending:embedded_media');
  } finally {controller.abort();await result;}
 });
 it.each(['success','drift','legacy'] as const)('binds explicit tab capture to observed URL and instance: %s',async(mode)=>{
  const {bridge,session,post}=await harness(mode==='legacy'?'0.1.23':'0.1.24');
  const target={type:'tab' as const,instance_ref:'browser-web-test',tab_id:42};
  const controller=new AbortController();
  const pending=bridge.capture(target,{...request,target},controller.signal,'job_tab');
  const result=pending.then(snapshot=>({snapshot,error:undefined}),error=>({snapshot:undefined,error}));
  try {
   const discovery=(await (await post('poll',{version:1,session_id:session.session_id},session.token)).json()).commands[0];
   expect(discovery.tab_id).toBe(42);expect(discovery.request.capture_mode).toBe('observe');
   await post('respond',{version:1,session_id:session.session_id,request_id:discovery.request_id,nonce:discovery.nonce,ok:true,result:{observation:{instance_id:target.instance_ref,tab_id:42,url:targetUrl,title:'Example',origin:new URL(targetUrl).origin,adapter_id:adapter.id,access_class:'public_free',evidence:[]}}},session.token);
   const commands=(await (await post('poll',{version:1,session_id:session.session_id},session.token)).json()).commands;
   if(mode==='legacy'){
    expect(commands).toEqual([]);expect((await result).error).toMatchObject({code:'EXTENSION_UPDATE_REQUIRED'});return;
   }
   const command=commands[0];expect(command.tab_id).toBe(42);expect(command.request.target).toEqual(target);
   expect(command.request.web_document).toEqual({content_id:webPageIdentity(targetUrl),url:targetUrl});
   expect(command.request.tab_strategy).toBeUndefined();expect(command.request.allow_focus).toBe(false);
   const snapshot=mode==='drift'?{...page(),canonical_url:'https://www.anthropic.com/engineering/other'}:page();
   await post('respond',{version:1,session_id:session.session_id,request_id:command.request_id,nonce:command.nonce,ok:true,result:{snapshot}},session.token);
   const completed=await result;
   if(mode==='drift')expect(completed.error).toMatchObject({code:'SNAPSHOT_INVALID'});
   else expect(completed.snapshot?.platform).toBe('web_page');
  } finally {controller.abort();await result;}
 });
 it('rejects URL drift, runtime receipt forgery, pending completion and out-of-scope assets even in partial snapshots',()=>{
  const snap=page();expect(validateBrowserWebSnapshot({...snap,access_class:'login_public_free'},new URL(targetUrl)).id).toBe('web_page');expect(contentSnapshotSchema.safeParse(snap).success).toBe(true);expect(validateBrowserWebSnapshot(snap,new URL(targetUrl)).id).toBe('web_page');
  for(const altered of [
   {...snap,source_url:'https://www.anthropic.com/engineering/other'},
   {...snap,warnings:['content_pending:dom']},
   {...snap,completeness_proof:{...snap.completeness_proof!,method:'http_page_capture' as const}},
   {...snap,completeness:'partial' as const,completeness_proof:undefined,assets:[{id:'file',role:'file' as const,url:'https://example.org/program',order:0,availability:'available' as const}]},
  ])expect(()=>validateBrowserWebSnapshot(altered,new URL(targetUrl))).toThrow();
  const partial={...snap,completeness:'partial' as const,completeness_proof:undefined,warnings:['content_pending:dom']};expect(validateBrowserWebSnapshot(partial,new URL(targetUrl)).id).toBe('web_page');
 });
});
