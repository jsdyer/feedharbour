import { LIMITS, emptyWorkspace, makeFeed, normalizeWorkspace, addFeeds, mergeCapture, articleGroups, changeArticleState, exportOPML, safeURL, validDate } from './model.mjs';
import { parseFeed, parseOPML } from './xml.mjs';
import { normalizeDirectory, directoryMatches, directorySubscriptions } from './directory.mjs';
import { requestFeed } from './request.mjs';
const $=s=>document.querySelector(s),storageKey='coolcode:feedharbour:workspace';
let directory=null,directoryShown=12;
let workspace=emptyWorkspace(),config=null,filterState='all',shown=40,refreshing=false,controller=null,stopped=false,generation=0;
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function button(text,action,className='quiet'){const b=el('button',text,className);b.type='button';b.addEventListener('click',action);return b;}
function message(text,error=false){$('#status').textContent=text;$('#status').className=error?'error':'';}
function dirty(){ $('#storage-status').textContent='Changes are in this tab only. Save or export to keep them.'; }
function manage(open=true){$('#manage').hidden=!open;$('#manage-toggle').setAttribute('aria-expanded',String(open));}
function dateLabel(value){return value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Unknown';}
function options(select,values,defaultText){const value=select.value;select.replaceChildren();const option=el('option',defaultText);option.value='';select.append(option);for(const [id,title]of values){const o=el('option',title);o.value=id;select.append(o);}if([...select.options].some(o=>o.value===value))select.value=value;}
function filters(){return {feed:$('#feed-filter').value,folder:$('#folder-filter').value,state:filterState,query:$('#search').value,dedupe:$('#dedupe').checked,order:$('#sort').value};}
function currentGroups(){return articleGroups(workspace,filters());}
function render(){
  options($('#folder-filter'),[...new Set(workspace.feeds.map(f=>f.folder).filter(Boolean))].sort().map(f=>[f,f]),'All folders');
  options($('#feed-filter'),workspace.feeds.map(f=>[f.id,f.title]),'All feeds');
  const groups=articleGroups(workspace,{dedupe:$('#dedupe').checked});
  $('#all-count').textContent=groups.length;$('#unread-count').textContent=groups.filter(i=>!i.read).length;$('#saved-count').textContent=groups.filter(i=>i.saved).length;
  $('#workspace-summary').textContent=`${workspace.feeds.length} ${workspace.feeds.length===1?'feed':'feeds'} · ${workspace.items.length} captured items · ${groups.filter(i=>!i.read).length} unread groups`;
  $('#refresh-all').disabled=refreshing||!workspace.feeds.some(f=>f.kind==='remote')||!config;
  $('#load').disabled=refreshing;$('#import-json').disabled=refreshing;$('#clear-read').disabled=refreshing;
  renderManager();renderItems();renderDirectory();
}
function renderManager(){
  const node=$('#feed-manager');node.replaceChildren();
  for(const feed of workspace.feeds){
    const row=el('article',undefined,'feed-row');const info=el('div',undefined,'feed-info');info.append(el('strong',feed.title),el('small',feed.kind==='local'?'Local XML · no remote refresh':feed.url));
    const times=el('p',`${feed.kind==='local'?'Imported':'Last successful fetch'}: ${dateLabel(feed.fetchedAt)} · Publisher update: ${dateLabel(feed.sourceUpdated)}`,'feed-dates');info.append(times);if(feed.error)info.append(el('p',feed.error,'error'));row.append(info);
    const folder=el('label','Folder'),input=el('input');input.value=feed.folder;input.maxLength=80;input.setAttribute('aria-label',`Folder for ${feed.title}`);input.disabled=refreshing;input.addEventListener('change',()=>{feed.folder=input.value.trim();dirty();render();});folder.append(input);row.append(folder);
    const actions=el('div',undefined,'actions');if(feed.kind==='remote'){const b=button('Refresh',()=>refreshFeeds([feed.id]),'secondary');b.disabled=refreshing;actions.append(b);}
    const remove=button('Remove',()=>{workspace={...workspace,feeds:workspace.feeds.filter(f=>f.id!==feed.id),items:workspace.items.filter(i=>i.feedId!==feed.id)};generation++;dirty();render();message('Feed and its captured items removed from this tab. A previously saved workspace is unchanged.');});remove.disabled=refreshing;actions.append(remove);row.append(actions);node.append(row);
  }
}
function renderItems(){
  const groups=currentGroups(),visible=groups.slice(0,shown),container=$('#items');container.replaceChildren();
  $('#result-count').textContent=`${groups.length} ${groups.length===1?'item':'items'}${$('#dedupe').checked?' after grouping':''}${groups.length>shown?` · showing ${shown}`:''}`;
  $('#show-more').hidden=groups.length<=shown;$('#mark-visible').disabled=!visible.length;$('#empty').hidden=!!groups.length;
  if(!groups.length){$('#empty h2').textContent=workspace.items.length?'Nothing matches this view.':'Give your feeds a home.';$('#empty p').textContent=workspace.items.length?'Try another folder, switch to All items, or clear your search.':'Add any public RSS or Atom feed, import subscriptions from OPML, or open a local feed file.';}
  for(const item of visible){
    const card=el('article',undefined,`item${item.read?' read':''}`),meta=el('div',undefined,'item-meta');meta.append(el('span',item.sources.join(' · '),'source-name'),el('span',item.published?dateLabel(item.published):item.updated?`Updated ${dateLabel(item.updated)}`:'No publisher date'));card.append(meta);
    const h=el('h2');if(item.url){const a=el('a',item.title);a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';a.addEventListener('click',()=>{workspace=changeArticleState(workspace,item.ids,'read',true);dirty();render();});h.append(a);}else h.textContent=item.title;card.append(h);
    if(item.summary)card.append(el('p',item.summary,'item-summary'));else card.append(el('p','This feed did not include a summary.','muted'));
    const actions=el('div',undefined,'item-actions');actions.append(button(item.read?'Mark unread':'Mark read',()=>{workspace=changeArticleState(workspace,item.ids,'read',!item.read);dirty();render();}));const save=button(item.saved?'★ Saved':'☆ Save for later',()=>{workspace=changeArticleState(workspace,item.ids,'saved',!item.saved);dirty();render();});save.setAttribute('aria-pressed',String(item.saved));actions.append(save);if(item.ids.length>1)actions.append(el('span',`${item.ids.length} feed copies grouped`,'muted'));if(!item.url)actions.append(el('span','No safe article link','muted'));card.append(actions);container.append(card);
  }
}
async function refreshFeeds(ids){
  if(refreshing||!config)return;refreshing=true;stopped=false;controller=new AbortController();const token=generation;$('#stop').hidden=false;render();let good=0,bad=0,truncated=0;
  try{for(const id of ids){if(stopped||token!==generation)break;const feed=workspace.feeds.find(f=>f.id===id&&f.kind==='remote');if(!feed)continue;message(`Fetching ${feed.title}… (${good+bad+1} of ${ids.length})`);
      try{
        const timeout=setTimeout(()=>controller.abort(),25000);let payload;
        try{payload=await requestFeed(feed.url,config,{signal:controller.signal});}finally{clearTimeout(timeout);}
        const capture=parseFeed(payload.data.xml,payload.data.url);if(token!==generation)break;workspace=mergeCapture(workspace,id,capture,payload.fetched_at);good++;if(capture.truncated)truncated++;dirty();
      }catch(e){if(stopped)break;bad++;const current=workspace.feeds.find(f=>f.id===id);if(current)current.error=e.name==='AbortError'?'Request timed out. Last good items kept.':`${e.message} Last good items kept.`;if(controller.signal.aborted)controller=new AbortController();}
      render();
    }
  }finally{refreshing=false;controller=null;$('#stop').hidden=true;render();message(`${stopped?'Stopped. ':''}${good} feeds refreshed; ${bad} failed.${truncated?` ${truncated} feed(s) limited to the first 300 entries.`:''} Last good items are retained.`,bad>0);}
}
function download(name,type,text){const url=URL.createObjectURL(new Blob([text],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function withStatus(action){try{action();}catch(e){message(e.message,true);}}
async function readFile(input,max,action){const file=input.files[0];if(!file)return;try{if(file.size>max)throw new Error(`File is too large; maximum ${max/1000000} MB.`);await action(await file.text(),file.name);}catch(e){message(`Import rejected: ${e.message} The current workspace was kept.`,true);}finally{input.value='';}}
async function addExample(){try{const response=await fetch('./data/example.xml');if(!response.ok)throw new Error('Example could not load.');const capture=parseFeed(await response.text());const feed={id:'local:example',kind:'local',url:'',title:'Invented example',folder:'Example',fetchedAt:'',sourceUpdated:'',error:''};const result=addFeeds(workspace,[feed]);workspace=mergeCapture(result.workspace,feed.id,capture,new Date().toISOString());dirty();render();message('Invented local example added. These are demonstration headlines, not live news.');}catch(e){message(e.message,true);}}
$('#manage-toggle').addEventListener('click',()=>manage($('#manage').hidden));$('#close-manage').addEventListener('click',()=>manage(false));$('#empty-add').addEventListener('click',()=>{manage();$('#feed-url').focus();});
$('#add-feed').addEventListener('submit',e=>{e.preventDefault();withStatus(()=>{const f=makeFeed($('#feed-url').value,'',$('#feed-folder').value);const result=addFeeds(workspace,[f]);workspace=result.workspace;$('#feed-url').value='';dirty();render();message(result.added?'Feed added. Click Refresh to fetch its public content.':'This feed is already in your workspace.');});});
$('#add-starters').addEventListener('click',()=>{setDirectoryOpen(true);$('#directory').scrollIntoView({behavior:'smooth',block:'start'});$('#directory-search').focus({preventScroll:true});});
$('#refresh-all').addEventListener('click',()=>refreshFeeds(workspace.feeds.filter(f=>f.kind==='remote').map(f=>f.id)));
$('#stop').addEventListener('click',()=>{stopped=true;controller?.abort();});
for(const id of ['example','empty-example'])$('#'+id).addEventListener('click',addExample);
for(const b of document.querySelectorAll('[data-state]'))b.addEventListener('click',()=>{filterState=b.dataset.state;shown=40;for(const other of document.querySelectorAll('[data-state]'))other.setAttribute('aria-pressed',String(other===b));renderItems();});
for(const id of ['folder-filter','feed-filter','sort','dedupe'])$('#'+id).addEventListener('change',()=>{shown=40;render();});$('#search').addEventListener('input',()=>{shown=40;renderItems();});
$('#show-more').addEventListener('click',()=>{shown+=40;renderItems();});
$('#mark-visible').addEventListener('click',()=>{workspace=changeArticleState(workspace,currentGroups().slice(0,shown).flatMap(i=>i.ids),'read',true);dirty();render();});
$('#clear-read').addEventListener('click',()=>{const before=workspace.items.length;workspace={...workspace,items:workspace.items.filter(i=>!i.read||i.saved)};dirty();render();message(`${before-workspace.items.length} read, unsaved items removed from this tab. Refresh can re-import items still present in a feed.`);});
$('#save').addEventListener('click',()=>{try{localStorage.setItem(storageKey,JSON.stringify(normalizeWorkspace(workspace)));$('#storage-status').textContent='Saved on this browser/device. Nothing was sent to a server.';}catch(e){$('#storage-status').textContent=`Could not save: ${e.message} Export JSON to keep a backup.`;}});
$('#load').addEventListener('click',()=>withStatus(()=>{const raw=localStorage.getItem(storageKey);if(!raw)throw new Error('No saved workspace on this browser/device.');const clean=normalizeWorkspace(JSON.parse(raw));workspace=clean;generation++;shown=40;render();$('#storage-status').textContent='Saved workspace loaded. No feed was contacted.';}));
$('#forget').addEventListener('click',()=>{try{localStorage.removeItem(storageKey);$('#storage-status').textContent='Saved workspace removed. The open tab is unchanged.';}catch(e){$('#storage-status').textContent=e.message;}});
$('#export-json').addEventListener('click',()=>withStatus(()=>download('feedharbour-workspace.json','application/json',JSON.stringify(normalizeWorkspace(workspace),null,2)+'\n')));
$('#export-opml').addEventListener('click',()=>withStatus(()=>{download('feedharbour-subscriptions.opml','application/xml',exportOPML(workspace));message('Exported public subscriptions and folders. Local XML feeds and reading state are included only in JSON.');}));
$('#import-json').addEventListener('change',e=>readFile(e.target,LIMITS.workspaceBytes,async text=>{const clean=normalizeWorkspace(JSON.parse(text));workspace=clean;generation++;shown=40;render();dirty();message('JSON workspace imported. Nothing was saved or fetched automatically.');}));
$('#import-opml').addEventListener('change',e=>readFile(e.target,LIMITS.xmlBytes,async text=>{const parsed=parseOPML(text),result=addFeeds(workspace,parsed.feeds);workspace=result.workspace;dirty();render();manage();message(`OPML: ${result.added} feeds added, ${result.duplicates+parsed.duplicates} duplicates, ${parsed.skipped.length} unsupported URLs skipped. No feeds were fetched.`);}));
$('#import-xml').addEventListener('change',e=>readFile(e.target,LIMITS.xmlBytes,async text=>{const parsed=parseFeed(text);const feed={id:'local:'+crypto.randomUUID(),kind:'local',url:'',title:parsed.title,folder:'Local imports',fetchedAt:'',sourceUpdated:'',error:''};const result=addFeeds(workspace,[feed]);const next=mergeCapture(result.workspace,feed.id,parsed,new Date().toISOString());workspace=next;dirty();render();message(`Local XML imported: ${parsed.items.length} items${parsed.truncated?' (first 300 only)':''}. No publisher or gateway was contacted.`);}));
render();
try{const r=await fetch('./config.json');if(!r.ok)throw new Error('Configuration could not load.');const c=await r.json();if(!safeURL(c.gateway,'',true))throw new Error('Invalid configuration.');config=c;render();}catch(e){message(`${e.message} Local file imports and reading still work.`,true);}

function setDirectoryOpen(open){$('#directory-content').hidden=!open;$('#directory-toggle').setAttribute('aria-expanded',String(open));$('#directory-toggle').textContent=open?'Hide directory':'Browse feed directory';}
function addRecommendations(ids){try{const added=addFeeds(workspace,directorySubscriptions(directory,ids));workspace=added.workspace;dirty();render();const text=`${added.added} ${added.added===1?'feed':'feeds'} added; ${added.duplicates} already present. Choose Refresh public feeds when ready. Nothing was fetched or saved.`;$('#directory-status').textContent=text;$('#directory-status').className='';message(text);}catch(e){$('#directory-status').textContent=e.message;$('#directory-status').className='error';}}
function renderDirectory(){
  if(!directory)return;
  const names=new Map(directory.categories.map(c=>[c.id,c.title])),category=$('#directory-category').value,query=$('#directory-search').value;
  const matches=directoryMatches(directory,{category,query}),subscribed=new Set(workspace.feeds.filter(f=>f.kind==='remote').map(f=>f.url));
  $('#directory-meta').textContent=`${directory.feeds.length} checked feeds across ${directory.categories.length} CoolCode topics · Reviewed ${new Date(directory.reviewed_at).toLocaleDateString(undefined,{dateStyle:'medium'})}`;
  $('#directory-count').textContent=`${matches.length} ${matches.length===1?'recommendation':'recommendations'}${matches.length>directoryShown?` · showing ${directoryShown}`:''}`;
  $('#directory-more').hidden=matches.length<=directoryShown;$('#directory-empty').hidden=matches.length!==0;
  const pack=directoryMatches(directory,{category});const packButton=$('#add-topic');packButton.hidden=!category||!!query.trim();packButton.textContent=`Add ${pack.length} feeds in this topic`;packButton.disabled=pack.every(f=>subscribed.has(f.url));
  const cards=$('#directory-cards');cards.replaceChildren();
  for(const f of matches.slice(0,directoryShown)){
    const card=el('article',undefined,'recommendation');card.dataset.feedId=f.id;
    card.append(el('p',names.get(f.category),'recommendation-topic'),el('h3',f.title),el('p',f.description,'recommendation-description'));
    const tags=el('p',f.tags.join(' · '),'recommendation-tags');card.append(tags);
    const actions=el('div',undefined,'recommendation-actions');const added=subscribed.has(f.url);const add=button(added?'✓ Added':'+ Add feed',()=>addRecommendations([f.id]),'secondary');add.disabled=added;actions.append(add);
    const source=el('a','Publisher ↗');source.href=f.site;source.target='_blank';source.rel='noopener noreferrer';source.referrerPolicy='no-referrer';actions.append(source);card.append(actions);
    const check=el('details',undefined,'recommendation-check');check.append(el('summary',`${f.verification.format} · checked ${new Date(f.verification.checked_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`));check.append(el('p',`${f.verification.entry_count} entries were returned at verification. Latest dated entry: ${f.verification.latest_entry_at?new Date(f.verification.latest_entry_at).toLocaleDateString():'unknown'}. This is a past availability check, not a live news update.`));const feedLink=el('a','Feed XML ↗');feedLink.href=f.url;feedLink.target='_blank';feedLink.rel='noopener noreferrer';feedLink.referrerPolicy='no-referrer';check.append(feedLink);card.append(check);cards.append(card);
  }
}
$('#directory-toggle').addEventListener('click',()=>setDirectoryOpen($('#directory-content').hidden));
for(const id of ['directory-category','directory-search'])$('#'+id).addEventListener(id==='directory-search'?'input':'change',()=>{directoryShown=12;renderDirectory();});
$('#directory-more').addEventListener('click',()=>{directoryShown+=12;renderDirectory();});
$('#add-topic').addEventListener('click',()=>{if(directory){const category=$('#directory-category').value;if(category)addRecommendations(directoryMatches(directory,{category}).map(f=>f.id));}});
try{const r=await fetch('./data/feed-directory.json');if(!r.ok)throw new Error('Directory could not load.');directory=normalizeDirectory(await r.json());options($('#directory-category'),directory.categories.map(c=>[c.id,`${c.title} (${directory.feeds.filter(f=>f.category===c.id).length})`]),'All topics');renderDirectory();}catch(e){$('#directory-meta').textContent=`${e.message} You can still add your own feeds or import OPML below.`;$('#directory-content').hidden=true;$('#directory-toggle').disabled=true;}
