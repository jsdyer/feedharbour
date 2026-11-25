import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA,LIMITS,emptyWorkspace,stableId,safeURL,feedURL,canonicalArticle,plainText,validDate,makeFeed,normalizeWorkspace,normalizeItem,addFeeds,mergeCapture,articleGroups,changeArticleState,exportOPML } from '../web/model.mjs';
const feed=(path='one',folder='Space')=>makeFeed(`https://example.org/${path}.xml`,path,folder);
const capture=(items)=>({title:'A real feed',sourceUpdated:'2026-11-24T12:00:00Z',items});
const item=(uid,overrides={})=>({uid,title:'Space discovery '+uid,url:`https://example.org/article/${uid}`,summary:'Earth and space research',published:'2026-11-20T12:00:00Z',...overrides});
function loaded(){const f=feed();return mergeCapture(addFeeds(emptyWorkspace(),[f]).workspace,f.id,capture([item('1'),item('2')]),'2026-11-25T12:00:00Z');}
test('public URL validation blocks active schemes, credentials and private addresses',()=>{
  for(const u of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd','https://a:b@example.org/feed','https://127.0.0.1/feed','https://2130706433/feed','https://[::1]/feed','https://localhost/feed','https://host.local/feed','https://example.org:8888/feed','https://example.org/\nfeed'])assert.equal(safeURL(u),'',u);
  assert.equal(feedURL('https://example.org/rss?a=1#part'),'https://example.org/rss?a=1');assert.throws(()=>feedURL('http://example.org/feed'));
  assert.equal(safeURL('/story','https://example.org/news/feed.xml'),'https://example.org/story');assert.equal(safeURL('http://example.org/story'),'http://example.org/story');
});
test('canonical grouping preserves meaningful query differences',()=>{
  assert.equal(canonicalArticle('https://example.org/post?a=1&utm_source=rss#hi'),'https://example.org/post?a=1');
  assert.equal(canonicalArticle('https://example.org/post?b=2&a=1&fbclid=x'),'https://example.org/post?a=1&b=2');assert.notEqual(canonicalArticle('https://example.org/?id=1'),canonicalArticle('https://example.org/?id=2'));
});
test('summaries are bounded plain text and dates do not become collection time',()=>{
  assert.equal(plainText('<p>Hello &amp; goodbye</p><script>bad()</script><img src=x>'),'Hello & goodbye');
  assert.equal(plainText('&#x1f30d; &#65; &nbsp;'),'🌍 A');assert.equal(plainText('x'.repeat(10000)).length,4000);
  assert.equal(validDate('bad'),'');assert.equal(validDate('Tue, 24 Nov 2026 12:00:00 GMT'),'2026-11-24T12:00:00.000Z');
});
test('stable identities and malformed workspaces',()=>{
  assert.equal(stableId('hello'),'a430d84680aabd0b');const w=loaded();assert.deepEqual(normalizeWorkspace(w),w);assert.equal(w.schema,SCHEMA);
  for(const raw of [null,{}, {...w,schema:'x'}, {...w,feeds:[{...w.feeds[0],id:'bad'}]}, {...w,items:[{feedId:'missing'}]}, {...w,feeds:[...w.feeds,...w.feeds]}])assert.throws(()=>normalizeWorkspace(raw));
  assert.equal(normalizeItem({title:'no id'},'feed:x').id,normalizeItem({title:'no id'},'feed:x').id);
});
test('arbitrary feeds beyond starters and duplicate subscriptions',()=>{
  const result=addFeeds(emptyWorkspace(),[feed('one'),feed('two'),feed('three'),feed('one')]);assert.equal(result.added,3);assert.equal(result.duplicates,1);assert.equal(result.workspace.feeds.length,3);
  assert.throws(()=>addFeeds(emptyWorkspace(),Array.from({length:LIMITS.feeds+1},(_,i)=>feed(String(i)))));
});
test('refresh merges revisions and preserves read/saved state and older captures',()=>{
  let w=loaded(),id=w.items.find(i=>i.uid==='1').id;w=changeArticleState(w,[id],'read',true);w=changeArticleState(w,[id],'saved',true);
  w=mergeCapture(w,w.feeds[0].id,capture([item('1',{title:'Revised'}),item('3')]),'2026-11-26T12:00:00Z');assert.equal(w.items.length,3);const kept=w.items.find(i=>i.uid==='1');assert.equal(kept.title,'Revised');assert.equal(kept.read,true);assert.equal(kept.saved,true);assert.equal(w.feeds[0].fetchedAt,'2026-11-26T12:00:00.000Z');assert.equal(w.feeds[0].sourceUpdated,'2026-11-24T12:00:00.000Z');
});
test('dedupe combines links across feeds without discarding originals',()=>{
  const a=feed(),b=feed('two');let w=addFeeds(emptyWorkspace(),[a,b]).workspace;
  w=mergeCapture(w,a.id,capture([item('1',{url:'https://example.org/story?utm_source=a',published:'2026-11-20',read:true})]),'2026-11-25');w=mergeCapture(w,b.id,capture([item('2',{url:'https://example.org/story#fragment',published:'2026-11-24',title:'Later update'})]),'2026-11-25');
  assert.equal(articleGroups(w).length,1);assert.equal(articleGroups(w)[0].ids.length,2);assert.equal(articleGroups(w)[0].title,'Later update');assert.equal(w.items.length,2);assert.equal(articleGroups(w,{dedupe:false}).length,2);
  w=changeArticleState(w,articleGroups(w)[0].ids,'read',true);assert.equal(articleGroups(w,{state:'unread'}).length,0);assert.equal(articleGroups(w,{feed:a.id}).length,1);
});
test('no-link items do not cross-dedupe solely by title',()=>{
  const a=feed(),b=feed('two');let w=addFeeds(emptyWorkspace(),[a,b]).workspace;for(const f of [a,b])w=mergeCapture(w,f.id,capture([item('same',{url:'',title:'Same'})]),'2026-11-25');assert.equal(articleGroups(w).length,2);
});
test('folder, AND keywords, saved and order filters compose',()=>{
  let w=loaded();const a=w.items.find(i=>i.uid==='1');w=changeArticleState(w,[a.id],'saved',true);
  assert.equal(articleGroups(w,{folder:'Space',query:'DISCOVERY earth',state:'saved'}).length,1);assert.equal(articleGroups(w,{folder:'Canada'}).length,0);assert.equal(articleGroups(w,{query:'space nonexistent'}).length,0);
  assert.throws(()=>changeArticleState(w,[a.id],'__proto__',true));
});
test('retention keeps saved history plus latest 300 unsaved items',()=>{
  const f=feed();let w=addFeeds(emptyWorkspace(),[f]).workspace;w=mergeCapture(w,f.id,capture(Array.from({length:300},(_,i)=>item('old'+i,{published:'2020-01-01'}))),'2026-11-25');
  const saved=w.items[0].id;w=changeArticleState(w,[saved],'saved',true);w=mergeCapture(w,f.id,capture(Array.from({length:300},(_,i)=>item('new'+i,{published:'2026-01-01'}))),'2026-11-26');assert.equal(w.items.length,301);assert.equal(w.items.filter(i=>i.saved).length,1);assert.ok(w.items.some(i=>i.id===saved));
});
test('JSON roundtrip does not retain unknown properties or unsafe links',()=>{
  const w=loaded();w.items[0].url='javascript:alert(1)';w.secret='ignore';w.feeds[0].secret='ignore';const normalized=normalizeWorkspace(JSON.parse(JSON.stringify(w)));assert.equal(normalized.secret,undefined);assert.equal(normalized.feeds[0].secret,undefined);assert.equal(normalized.items[0].url,'');
});
test('OPML exports only remote subscriptions and escapes labels',()=>{
  let w=addFeeds(emptyWorkspace(),[feed('one','A & B')]).workspace;w.feeds[0].title='"Quotes" <text>';w.feeds.push({id:'local:example',kind:'local',url:'',title:'Local'});
  const xml=exportOPML(w);assert.ok(xml.includes('A &amp; B'));assert.ok(xml.includes('&quot;Quotes&quot; &lt;text&gt;'));assert.ok(xml.includes('xmlUrl="https://example.org/one.xml"'));assert.ok(!xml.includes('local:example'));
});
