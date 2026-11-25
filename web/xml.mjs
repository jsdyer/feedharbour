import { LIMITS, feedURL, makeFeed, plainText, safeURL, validDate } from './model.mjs';
export function parseDocument(xml){
  if(typeof xml!=='string'||new TextEncoder().encode(xml).length>LIMITS.xmlBytes)throw new Error('XML must be UTF-8 text no larger than 2 MB.');
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw new Error('DOCTYPE and entity declarations are not supported.');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||doc.documentElement.localName==='parsererror')throw new Error('The XML is malformed. Export a valid RSS, Atom or OPML file.');
  if(doc.getElementsByTagName('*').length>30000)throw new Error('XML has too many elements.');return doc;
}
const children=(node,name)=>[...node.children].filter(n=>n.localName===name);
const child=(node,name)=>children(node,name)[0];
const content=(node,name)=>child(node,name)?.textContent||'';
function inheritedBase(node,fallback){const bases=[];for(let n=node;n&&n.nodeType===1;n=n.parentElement){const b=n.getAttributeNS('http://www.w3.org/XML/1998/namespace','base');if(b)bases.unshift(b);}let base=fallback;for(const b of bases){base=safeURL(b,base)||base;}return base;}
function link(node,base,atom=false){
  const scope=inheritedBase(node,base);
  if(atom){const links=children(node,'link');const target=links.find(n=>(!n.getAttribute('rel')||n.getAttribute('rel')==='alternate')&&(!n.getAttribute('type')||['text/html','application/xhtml+xml'].includes(n.getAttribute('type'))));return target?safeURL(target.getAttribute('href'),inheritedBase(target,scope)):'';}
  const explicit=safeURL(content(node,'link'),scope);
  const guid=child(node,'guid');
  return explicit||(guid&&guid.getAttribute('isPermaLink')!=='false'?safeURL(guid.textContent,scope):'');
}
export function parseFeed(xml,sourceURL=''){
  const doc=parseDocument(xml),root=doc.documentElement;let container,entries,atom=false;
  if(root.localName==='rss'){container=child(root,'channel');if(!container)throw new Error('RSS has no channel.');entries=children(container,'item');}
  else if(root.localName==='feed'&&root.namespaceURI==='http://www.w3.org/2005/Atom'){container=root;entries=children(root,'entry');atom=true;}
  else if(root.localName==='RDF'){container=child(root,'channel');if(!container)throw new Error('RSS 1.0 has no channel.');entries=children(root,'item');}
  else throw new Error('This file is not a supported RSS or Atom feed. Use the feed URL, not the website home page.');
  const base=safeURL(sourceURL)||link(container,'',atom),title=plainText(content(container,'title'),160)||'Untitled feed';
  const items=entries.slice(0,LIMITS.perFeed).map(entry=>{
    const url=link(entry,base,atom),guid=content(entry,atom?'id':'guid');
    let summary=content(entry,atom?'summary':'description');if(!summary)summary=content(entry,atom?'content':'encoded');
    // XHTML content's textContent is plain text; embedded HTML is stripped by plainText.
    const published=validDate(content(entry,atom?'published':'pubDate')||content(entry,'date'));
    return {uid:guid||url||'',title:plainText(content(entry,'title'),400)||'Untitled item',url,summary:plainText(summary),published,updated:validDate(content(entry,'updated'))};
  });
  return {title,sourceUpdated:validDate(content(container,atom?'updated':'lastBuildDate')||content(container,'pubDate')),items,totalEntries:entries.length,truncated:entries.length>LIMITS.perFeed};
}
export function parseOPML(xml){
  const doc=parseDocument(xml);if(doc.documentElement.localName!=='opml')throw new Error('This file is not OPML.');const body=child(doc.documentElement,'body');if(!body)throw new Error('OPML has no body.');
  const feeds=[],skipped=[];let outlines=0;
  function visit(node,path,depth){if(depth>30)throw new Error('OPML folders are nested too deeply.');for(const o of children(node,'outline')){if(++outlines>3000)throw new Error('OPML contains too many outlines.');const url=o.getAttribute('xmlUrl');const title=plainText(o.getAttribute('title')||o.getAttribute('text')||'',160);if(url){try{feeds.push(makeFeed(feedURL(url),title,path.join(' / ').slice(0,80)));}catch{skipped.push(title||'Unnamed feed');}}else visit(o,title?[...path,title]:path,depth+1);}}
  visit(body,[],0);const unique=[...new Map(feeds.map(f=>[f.id,f])).values()];if(unique.length>LIMITS.feeds)throw new Error(`OPML contains more than ${LIMITS.feeds} usable feeds. Split the file or remove some entries.`);return {feeds:unique,skipped,duplicates:feeds.length-unique.length};
}
