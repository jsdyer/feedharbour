/** Portable workspace transforms; XML parsing is isolated in xml.mjs. */
export const SCHEMA='coolcode.feedharbour.v1';
export const LIMITS={feeds:50,items:5000,perFeed:300,xmlBytes:2000000,workspaceBytes:10000000};
export const emptyWorkspace=()=>({schema:SCHEMA,feeds:[],items:[]});
export function stableId(value){let h=14695981039346656037n;for(const byte of new TextEncoder().encode(value)){h^=BigInt(byte);h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16);}
export function safeURL(value,base='',httpsOnly=false){
  if(typeof value!=='string'||!value.trim()||/[\u0000-\u001f\u007f]/.test(value)||value.length>3000)return '';
  try{const u=base?new URL(value.trim(),base):new URL(value.trim());
    if(!(httpsOnly?['https:']:['https:','http:']).includes(u.protocol)||u.username||u.password||u.port)return '';
    const h=u.hostname.toLowerCase();
    if(!h.includes('.')||h.endsWith('.')||/(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(h)||h.includes(':')||/^\d+\.\d+\.\d+\.\d+$/.test(h))return '';
    return u.href;
  }catch{return '';}
}
export function feedURL(value){const url=safeURL(value,'',true);if(!url)throw new Error('Use a public HTTPS feed URL without credentials, IP addresses or a custom port.');const u=new URL(url);u.hash='';return u.href;}
export function canonicalArticle(value){const clean=safeURL(value);if(!clean)return '';const u=new URL(clean);u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid','mc_cid','mc_eid'].includes(key.toLowerCase()))u.searchParams.delete(key);u.searchParams.sort();return u.href;}
export function validDate(value){if(typeof value!=='string'||!value.trim())return '';const ms=Date.parse(value);return Number.isFinite(ms)?new Date(ms).toISOString():'';}
export function plainText(value,max=4000){
  let t=String(value??'').slice(0,100000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ');
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  t=t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{if(key[0]!=='#')return entities[key.toLowerCase()]??all;const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';});
  return t.replace(/\s+/g,' ').trim().slice(0,max);
}
function str(v,max,fallback=''){return typeof v==='string'?v.slice(0,max):fallback;}
export function makeFeed(url,title='',folder='') {url=feedURL(url);return {id:'feed:'+stableId(url),kind:'remote',url,title:plainText(title,160)||new URL(url).hostname,folder:str(folder,80).trim(),fetchedAt:'',sourceUpdated:'',error:''};}
export function normalizeItem(raw,feedId){
  if(!raw||typeof raw!=='object')throw new Error('Invalid article entry.');
  const title=plainText(raw.title,400)||'Untitled item',url=safeURL(raw.url),published=validDate(raw.published),updated=validDate(raw.updated),uid=str(raw.uid,3000)||canonicalArticle(url)||`${title}|${published}`;
  return {id:`${feedId}:${stableId(uid)}`,feedId,uid,title,url,summary:plainText(raw.summary,4000),published,updated,read:raw.read===true,saved:raw.saved===true};
}
export function normalizeWorkspace(raw){
  if(!raw||raw.schema!==SCHEMA||!Array.isArray(raw.feeds)||!Array.isArray(raw.items))throw new Error('This is not a Feed Harbour workspace.');
  if(raw.feeds.length>LIMITS.feeds||raw.items.length>LIMITS.items)throw new Error(`Workspace limit: ${LIMITS.feeds} feeds and ${LIMITS.items} items.`);
  const feeds=[],ids=new Set();
  for(const f of raw.feeds){
    if(!f||typeof f!=='object')throw new Error('Invalid feed entry.');
    let clean;
    if(f.kind==='remote')clean=makeFeed(f.url,f.title,f.folder);
    else if(f.kind==='local'&&typeof f.id==='string'&&/^local:[a-zA-Z0-9_-]{1,80}$/.test(f.id))clean={id:f.id,kind:'local',url:'',title:plainText(f.title,160)||'Imported feed',folder:str(f.folder,80).trim()};
    else throw new Error('Invalid local or remote feed identity.');
    if(f.id!==clean.id||ids.has(clean.id))throw new Error('Feed identities must be unique and match their URLs.');
    ids.add(clean.id);feeds.push({...clean,fetchedAt:validDate(f.fetchedAt),sourceUpdated:validDate(f.sourceUpdated),error:str(f.error,300)});
  }
  const seen=new Set(),items=[];
  for(const i of raw.items){if(!ids.has(i?.feedId))throw new Error('Article refers to an unknown feed.');const item=normalizeItem(i,i.feedId);if(seen.has(item.id))continue;seen.add(item.id);items.push(item);}
  const clean={schema:SCHEMA,feeds,items};
  if(new TextEncoder().encode(JSON.stringify(clean,null,2)).length+1>LIMITS.workspaceBytes)throw new Error('Workspace content exceeds 10 MB. Export a backup, then remove some feeds or read items.');
  return clean;
}
export function addFeeds(workspace,incoming){
  const result=structuredClone(workspace);let added=0,duplicates=0;
  for(const feed of incoming){if(result.feeds.some(f=>f.id===feed.id)){duplicates++;continue;}result.feeds.push(feed);added++;}
  if(result.feeds.length>LIMITS.feeds)throw new Error(`A workspace supports ${LIMITS.feeds} feeds. Remove some feeds before importing more.`);
  return {workspace:normalizeWorkspace(result),added,duplicates};
}
export function mergeCapture(workspace,feedId,capture,fetchedAt){
  const next=structuredClone(workspace),feed=next.feeds.find(f=>f.id===feedId);if(!feed)throw new Error('Feed no longer exists.');
  const prior=new Map(next.items.filter(i=>i.feedId===feedId).map(i=>[i.id,i]));
  for(const raw of capture.items.slice(0,LIMITS.perFeed)){const item=normalizeItem(raw,feedId),old=prior.get(item.id);prior.set(item.id,{...item,read:old?.read??false,saved:old?.saved??false});}
  const all=[...prior.values()].sort(newestFirst),saved=all.filter(i=>i.saved),unsaved=all.filter(i=>!i.saved).slice(0,LIMITS.perFeed);
  next.items=[...next.items.filter(i=>i.feedId!==feedId),...saved,...unsaved];
  if(next.items.length>LIMITS.items)throw new Error('The 5,000-item workspace is full. Export a backup, then remove a feed or clear older items. Existing capture was kept.');
  feed.title=plainText(capture.title,160)||feed.title;feed.fetchedAt=validDate(fetchedAt);feed.sourceUpdated=validDate(capture.sourceUpdated);feed.error='';
  return normalizeWorkspace(next);
}
export function newestFirst(a,b){return (Date.parse(b.published||b.updated)||0)-(Date.parse(a.published||a.updated)||0)||a.id.localeCompare(b.id);}
export function articleGroups(workspace,{feed='',folder='',state='all',query='',dedupe=true,order='newest'}={}){
  const feedMap=new Map(workspace.feeds.map(f=>[f.id,f]));
  const candidates=workspace.items.filter(i=>(!feed||i.feedId===feed)&&(!folder||feedMap.get(i.feedId)?.folder===folder));
  const groups=new Map();for(const i of candidates){const key=dedupe?(canonicalArticle(i.url)||i.id):i.id;const prev=groups.get(key);if(prev){const ids=[...prev.ids,i.id],sources=[...prev.sources,feedMap.get(i.feedId)?.title||'Feed'];groups.set(key,{...(newestFirst(i,prev)<0?i:prev),ids,sources,read:prev.read&&i.read,saved:prev.saved||i.saved});}else groups.set(key,{...i,ids:[i.id],sources:[feedMap.get(i.feedId)?.title||'Feed']});}
  const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return [...groups.values()].filter(i=>(state!=='unread'||!i.read)&&(state!=='saved'||i.saved)&&terms.every(t=>`${i.title} ${i.summary} ${i.sources.join(' ')}`.toLocaleLowerCase().includes(t))).sort(order==='oldest'?(a,b)=>-newestFirst(a,b):newestFirst);
}
export function changeArticleState(workspace,ids,key,value){if(!['read','saved'].includes(key))throw new Error('Unknown article state.');const set=new Set(ids);return {...workspace,items:workspace.items.map(i=>set.has(i.id)?{...i,[key]:!!value}:i)};}
export function escapeXML(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
export function exportOPML(workspace){
  const groups=new Map();for(const f of workspace.feeds.filter(f=>f.kind==='remote')){if(!groups.has(f.folder))groups.set(f.folder,[]);groups.get(f.folder).push(f);}
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<opml version="2.0"><head><title>Feed Harbour subscriptions</title></head><body>'];
  for(const [folder,feeds]of groups){if(folder)lines.push(`<outline text="${escapeXML(folder)}">`);for(const f of feeds)lines.push(`<outline type="rss" text="${escapeXML(f.title)}" title="${escapeXML(f.title)}" xmlUrl="${escapeXML(f.url)}"/>`);if(folder)lines.push('</outline>');}lines.push('</body></opml>');return lines.join('\n')+'\n';
}
