import {LIMITS,safeURL,validDate} from './model.mjs';

export function directFeed(value,config,pageOrigin=globalThis.location?.origin){
  const clean=safeURL(value,'',true);
  if(!clean||pageOrigin!=='https://coolcode.ca')return false;
  const url=new URL(clean);
  return url.origin===pageOrigin&&!url.search&&!url.hash&&
    Array.isArray(config.firstPartyFeeds)&&config.firstPartyFeeds.includes(url.pathname);
}

async function boundedText(response,limit){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Feed response exceeded the size limit.');}
  if(!response.body)throw Error('Feed response was empty.');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Error('Feed response exceeded the size limit.');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
  finally{reader.releaseLock();}
}

export async function requestFeed(feedURL,config,{signal,fetcher=fetch,pageOrigin=globalThis.location?.origin}={}){
  const direct=directFeed(feedURL,config,pageOrigin),url=new URL(direct?feedURL:config.gateway);
  if(!direct)url.searchParams.set('url',feedURL);
  const response=await fetcher(url,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:direct?'no-cache':'default'});
  if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'The shared gateway allowance is temporarily exhausted. Try later.':`Feed request returned HTTP ${response.status}.`);}
  const raw=await boundedText(response,direct?LIMITS.xmlBytes:LIMITS.xmlBytes*3);
  if(direct)return {fetched_at:new Date().toISOString(),data:{url:url.href,xml:raw}};
  const payload=JSON.parse(raw);
  if(typeof payload?.data?.xml!=='string'||!safeURL(payload?.data?.url,'',true)||!validDate(payload?.fetched_at))throw Error('Gateway returned an invalid feed envelope.');
  return payload;
}
