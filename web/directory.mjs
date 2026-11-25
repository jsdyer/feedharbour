/** Curated recommendations are independent from a visitor's private subscriptions. */
import { feedURL, safeURL, plainText, validDate, makeFeed } from './model.mjs';
export function normalizeDirectory(raw){
  if(!raw||raw.schema!=='coolcode.feed-directory.v1'||!Array.isArray(raw.categories)||!Array.isArray(raw.feeds)||raw.feeds.length>500)throw new Error('Invalid feed directory.');
  const seenCategories=new Set(),seenIds=new Set(),seenURLs=new Set();
  const categories=raw.categories.map(c=>{if(!c||typeof c.id!=='string'||!/^[a-z0-9-]+$/.test(c.id)||seenCategories.has(c.id)||!plainText(c.title,80))throw new Error('Invalid directory category.');seenCategories.add(c.id);return {id:c.id,title:plainText(c.title,80)};});
  const feeds=raw.feeds.map(f=>{
    if(!f||typeof f.id!=='string'||!/^[a-z0-9-]+$/.test(f.id)||seenIds.has(f.id)||!seenCategories.has(f.category))throw new Error('Invalid directory feed identity.');
    const url=feedURL(f.url),site=safeURL(f.site,'',true),title=plainText(f.title,160),description=plainText(f.description,260);
    if(seenURLs.has(url)||!site||!title||!description||!Array.isArray(f.tags)||f.tags.length>12)throw new Error('Invalid or duplicate recommended feed.');
    const verification=f.verification;
    if(!verification||!validDate(verification.checked_at)||!validDate(verification.fetched_at)||!['RSS','Atom','RSS 1.0'].includes(verification.format)||!Number.isInteger(verification.entry_count)||verification.entry_count<1)throw new Error('Directory feed is missing a successful verification.');
    seenIds.add(f.id);seenURLs.add(url);
    return {id:f.id,title,url,site,category:f.category,description,tags:f.tags.map(t=>plainText(t,40)).filter(Boolean),verification:{checked_at:validDate(verification.checked_at),fetched_at:validDate(verification.fetched_at),format:verification.format,entry_count:verification.entry_count,latest_entry_at:validDate(verification.latest_entry_at)}};
  });
  if(!validDate(raw.reviewed_at))throw new Error('Directory review date is missing.');
  return {schema:raw.schema,reviewed_at:validDate(raw.reviewed_at),categories,feeds};
}
export function directoryMatches(directory,{category='',query=''}={}){
  const names=new Map(directory.categories.map(c=>[c.id,c.title]));const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return directory.feeds.filter(f=>(!category||f.category===category)&&terms.every(t=>`${f.title} ${f.description} ${f.tags.join(' ')} ${names.get(f.category)}`.toLocaleLowerCase().includes(t)));
}
export function directorySubscriptions(directory,ids){
  const wanted=new Set(ids),categories=new Map(directory.categories.map(c=>[c.id,c.title]));
  if([...wanted].some(id=>!directory.feeds.some(f=>f.id===id)))throw new Error('A selected recommendation is no longer in this directory.');
  return directory.feeds.filter(f=>wanted.has(f.id)).map(f=>makeFeed(f.url,f.title,categories.get(f.category)));
}
