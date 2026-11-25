import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeDirectory, directoryMatches, directorySubscriptions } from '../web/directory.mjs';
import { addFeeds, emptyWorkspace } from '../web/model.mjs';
const raw=JSON.parse(fs.readFileSync(new URL('../web/data/feed-directory.json',import.meta.url)));
const directory=normalizeDirectory(raw);
test('directory covers all existing topics with distinct successfully checked sources',()=>{
 assert.equal(directory.categories.length,9);assert.ok(directory.feeds.length>=25);assert.equal(new Set(directory.feeds.map(f=>f.url)).size,directory.feeds.length);
 for(const category of directory.categories)assert.ok(directoryMatches(directory,{category:category.id}).length>0,category.id);
 for(const f of directory.feeds){assert.ok(f.verification.checked_at);assert.ok(f.verification.entry_count>0);assert.ok(f.url.startsWith('https://'));}
});
test('topic and multiword case-insensitive search use titles, descriptions and tags',()=>{
 assert.ok(directoryMatches(directory,{query:'nova scotia'}).some(f=>f.id==='global-halifax'));
 assert.ok(directoryMatches(directory,{category:'liminal-tools',query:'DNS'}).some(f=>f.id==='apnic-blog'));
 assert.equal(directoryMatches(directory,{category:'projects',query:'nonexistent-topic-xyz'}).length,0);
 assert.ok(directoryMatches(directory,{query:'food'}).length>0);
});
test('new arbitrary recommendation expands results and subscribes independently of starters',()=>{
 const expanded=structuredClone(raw),sample=expanded.feeds[0];expanded.feeds.push({...sample,id:'visitor-new-feed',title:'Visitor new feed',url:'https://publisher.example.org/new.xml',site:'https://publisher.example.org/',description:'New community research',tags:['Extra coverage'],category:'media'});
 const d=normalizeDirectory(expanded);assert.equal(d.feeds.length,directory.feeds.length+1);assert.equal(directoryMatches(d,{query:'extra coverage'}).length,1);
 const result=addFeeds(emptyWorkspace(),directorySubscriptions(d,['visitor-new-feed']));assert.equal(result.added,1);assert.equal(result.workspace.feeds[0].folder,'Media, events & the old web');assert.equal(result.workspace.items.length,0);
});
test('topic packs add just the selected sources and preserve existing folder choices',()=>{
 const ids=directoryMatches(directory,{category:'projects'}).map(f=>f.id),pack=directorySubscriptions(directory,ids);let w=addFeeds(emptyWorkspace(),[pack[0]]).workspace;w.feeds[0].folder='My custom folder';
 const added=addFeeds(w,pack);assert.equal(added.added,pack.length-1);assert.equal(added.duplicates,1);assert.equal(added.workspace.feeds[0].folder,'My custom folder');assert.equal(added.workspace.items.length,0);assert.equal(addFeeds(added.workspace,pack).added,0);
 assert.throws(()=>directorySubscriptions(directory,['unknown-id']));
});
test('unverified, unsafe, duplicate and unknown-category recommendations fail closed',()=>{
 for(const change of [{url:'javascript:alert(1)'},{site:'http://example.org/'},{category:'unknown'},{verification:null},{verification:{...raw.feeds[0].verification,entry_count:0}},{verification:{...raw.feeds[0].verification,format:'HTML'}}]){const r=structuredClone(raw);r.feeds[0]={...r.feeds[0],...change};assert.throws(()=>normalizeDirectory(r));}
 const duplicate=structuredClone(raw);duplicate.feeds.push({...duplicate.feeds[0],id:'different-id'});assert.throws(()=>normalizeDirectory(duplicate));
});
