import test from 'node:test';
import assert from 'node:assert/strict';
import {directFeed,requestFeed} from '../web/request.mjs';
const config={gateway:'https://gateway.example.org/feed',firstPartyFeeds:['/researchledger/feeds/dal.xml']};
const pageOrigin='https://coolcode.ca',url=pageOrigin+config.firstPartyFeeds[0];
test('only a reviewed same-origin static feed loads directly',()=>{
  assert.equal(directFeed(url,config,pageOrigin),true);
  for(const value of [url+'?key=x',url+'#x','https://elsewhere.example.org/researchledger/feeds/dal.xml',pageOrigin+'/admin/measurement-tools.json',pageOrigin+'/api/feed.xml'])assert.equal(directFeed(value,config,pageOrigin),false);
  assert.equal(directFeed(url,config,'http://localhost:8000'),false);
});
test('direct feeds omit credentials, reject redirects, retain XML and record retrieval time',async()=>{
  let called;const payload=await requestFeed(url,config,{pageOrigin,fetcher:async(u,options)=>{called={u,options};return new Response('<rss/>');}});
  assert.equal(called.u.href,url);assert.equal(called.options.credentials,'omit');assert.equal(called.options.redirect,'error');assert.equal(called.options.referrerPolicy,'no-referrer');
  assert.equal(payload.data.xml,'<rss/>');assert.equal(payload.data.url,url);assert.ok(Date.parse(payload.fetched_at));
});
test('external feed gateway timestamp survives and errors do not become captures',async()=>{
  const expected={fetched_at:'2026-11-25T00:00:00Z',data:{url:'https://publisher.example.org/feed',xml:'<rss/>'}};
  const got=await requestFeed(expected.data.url,config,{pageOrigin,fetcher:async(u)=>{assert.equal(u.searchParams.get('url'),expected.data.url);return Response.json(expected);}});
  assert.deepEqual(got,expected);
  await assert.rejects(requestFeed(url,config,{pageOrigin,fetcher:async()=>new Response('fail',{status:404})}),/HTTP 404/);
});
test('streamed and declared oversized feeds are rejected before parsing',async()=>{
  await assert.rejects(requestFeed(url,config,{pageOrigin,fetcher:async()=>new Response('x',{headers:{'content-length':'2000001'}})}),/size limit/);
  await assert.rejects(requestFeed(url,config,{pageOrigin,fetcher:async()=>new Response('x'.repeat(2000001))}),/size limit/);
  await assert.rejects(requestFeed(url,config,{pageOrigin,fetcher:async()=>new Response(new Uint8Array([0xff]))}));
});
