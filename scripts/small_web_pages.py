"""Render a no-JavaScript directory, site records and subscription exports."""
from datetime import datetime
from email.utils import format_datetime
from html import escape
import json
import xml.etree.ElementTree as ET

from small_web import load_sites

ATOM = "http://www.w3.org/2005/Atom"
SM = "http://www.sitemaps.org/schemas/sitemap/0.9"


def link(href, label):
    return f'<a href="{escape(href, quote=True)}">{escape(label)}</a>'


def item_markup(item, origin=""):
    stamp = item["published"] or item["updated"]
    date = (("Published " if item["published"] else "Updated ") + stamp[:10]) if stamp else "Date unavailable"
    return '<li>' + link(item["url"], item["title"]) + '<small>' + origin + escape(date) + '</small></li>'


def xml_file(path, root):
    ET.indent(root)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def save_page(where, title, description, body, base, canonical):
    where.mkdir(parents=True, exist_ok=True)
    meta = f'<link rel="canonical" href="{canonical}">' if canonical else ''
    page = f"""<!doctype html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)} · Feed Harbour</title><meta name="description" content="{escape(description, quote=True)}">
{meta}<link rel="stylesheet" href="{base}small-web.css">
<link rel="alternate" type="application/rss+xml" title="Small Web North headlines" href="{base}records/feed.xml">
<script type="module" src="{base}small-web.mjs"></script></head>
<body><a class="skip" href="#main">Skip to content</a><header><a href="{base}">Feed Harbour</a><a href="{base}records/">Small Web North</a></header>
<main id="main">{body}</main><footer><a href="{base}">Open the private feed reader</a><a href="https://coolcode.ca/">CoolCode</a></footer>
</body></html>"""
    (where / "index.html").write_text(page)


def build_records(stage, tool, production):
    sites = load_sites(stage / "data/small-web-sites.json")
    snapshot = json.loads((stage / "data/small-web.json").read_text())
    captures = snapshot["captures"]
    selected = [s for s in sites if captures.get(s["id"], {}).get("items")]
    if not selected:
        raise ValueError("No verified linked headlines to publish")
    output = stage / "records"
    output.mkdir()
    checked = snapshot["checked_at"][:10]
    url = "https://coolcode.ca" + tool["url"] if production else ""
    record_url = lambda path: url + "records/" + path if url else ""
    posts = sorted([(s, item) for s in selected for item in captures[s["id"]]["items"]],
                   key=lambda p: p[1]["published"] or p[1]["updated"], reverse=True)
    sitemap = ET.Element("urlset", xmlns=SM)

    def index_url(path):
        if url:
            entry = ET.SubElement(sitemap, "url")
            ET.SubElement(entry, "loc").text = record_url(path)

    index_url("")
    opml = ET.Element("opml", version="2.0")
    ET.SubElement(ET.SubElement(opml, "head"), "title").text = "Small Web North – Canadian independent publishers"
    outline = ET.SubElement(ET.SubElement(opml, "body"), "outline", text="Small Web North")
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "Small Web North · Feed Harbour"
    ET.SubElement(channel, "description").text = "A weekly capture of linked headlines from selected independent Canadian publishers."
    ET.SubElement(channel, "link").text = record_url("") or "records/"
    ET.SubElement(channel, "language").text = "en-ca"
    if url:
        ET.register_namespace("atom", ATOM)
        ET.SubElement(channel, f"{{{ATOM}}}link", href=record_url("feed.xml"), rel="self", type="application/rss+xml")
    for site in selected:
        ET.SubElement(outline, "outline", type="rss", text=site["name"], title=site["name"], xmlUrl=site["feed"], htmlUrl=site["url"])
    seen = set()
    for site, item in posts:
        if item["url"] in seen:
            continue
        seen.add(item["url"])
        row = ET.SubElement(channel, "item")
        ET.SubElement(row, "title").text = item["title"]
        ET.SubElement(row, "link").text = item["url"]
        ET.SubElement(row, "guid", isPermaLink="true").text = item["url"]
        ET.SubElement(row, "source", url=site["feed"]).text = site["name"]
        if item["published"]:
            ET.SubElement(row, "pubDate").text = format_datetime(datetime.fromisoformat(item["published"].replace("Z", "+00:00")), usegmt=True)
    xml_file(output / "feed.xml", rss)
    xml_file(output / "subscriptions.opml", opml)
    cards = []
    for site in selected:
        slug = site["id"]
        section = f"sites/{slug}/"
        index_url(section)
        cap = captures[slug]
        topics = ", ".join(site["topics"])
        cards.append(f'<article class="card" data-site><small>{escape(site["place"])}</small><h3>{link(section, site["name"])}</h3>'
                     f'<p>{escape(site["description"])}</p><small>{escape(topics)}</small></article>')
        related = []
        for s in selected:
            if s["id"] == slug:
                continue
            reasons = (["same place: " + s["place"]] if site["place"] == s["place"] else [])
            common = [topic for topic in site["topics"] if topic in s["topics"]]
            if common:
                reasons.append("shared topics: " + ", ".join(common))
            if reasons:
                related.append('<li>' + link("../" + s["id"] + "/", s["name"]) + "<small>" + escape(" · ".join(reasons)) + "</small></li>")
        last_good = cap["last_success_at"][:10]
        failed = (f'<p class="notice">The feed was unavailable on {escape(cap["checked_at"][:10])}. Showing its last successful capture.</p>'
                  if cap["status"] != "ok" else "")
        latest = "".join(item_markup(i) for i in cap["items"])
        summary = f'<p class="place">{escape(site["place"])} · {escape(topics)}</p><h1>{escape(site["name"])}</h1><p class="intro">{escape(site["description"])}</p>'
        actions = (f'<nav class="actions"><a class="primary" href="../../../?smallweb={slug}#reading">Read in Feed Harbour</a>'
                   + link(site["url"], "Visit publisher") + link(site["feed"], "Original feed") + '</nav>')
        body = '<p>' + link("../../", "← All independent sites") + '</p>' + summary + actions
        body += (f'<section><h2>Latest from this site</h2><p>Headlines captured {last_good} UTC. Open a title to read it at the publisher.</p>'
                 + failed + f'<ol class="headlines">{latest}</ol></section>')
        body += ('<section><h2>Why this site is here</h2><p>' + escape(site["basis"]) + " " + link(site["evidence"], "Publisher’s background") + '</p></section>')
        if related:
            body += '<section><h2>Related sites</h2><ul class="headlines">' + "".join(related) + '</ul></section>'
        if tool_link := site.get("related_tool"):
            body += ('<section><h2>Explore the subject</h2><p>' + escape(tool_link["detail"]) + ' '
                     + link(tool_link["url"], tool_link["title"]) + '</p></section>')
        save_page(output / section, site["name"] + " headlines and related sites", site["description"], body, "../../../", record_url(section))

    intro = f'<p class="place">A Feed Harbour collection</p><h1>Small Web North</h1><p class="intro">Discover independent Canadian sites and read their latest headlines. Start with a story, or choose a publisher to explore.</p>'
    first_site, first_item = posts[0]
    lead = ('<article class="lead"><small>Latest headline · ' + escape(first_site["name"]) + '</small><h2>'
            + link(first_item["url"], first_item["title"]) + '</h2><p>'
            + escape((first_item["published"] or first_item["updated"])[:10] or "Date unavailable") + " · "
            + link("sites/" + first_site["id"] + "/", "More from " + first_site["name"]) + '</p></article>')
    actions = ('<nav class="actions"><a class="primary" href="#sites">Browse sites</a><a href="#latest">All headlines</a>'
               '<button id="random-site" type="button" hidden>Surprise me with a site</button></nav>')
    recent = "".join(item_markup(i, link("sites/" + s["id"] + "/", s["name"]) + " · ") for s, i in posts)
    failures = len([s for s in sites if captures.get(s["id"], {}).get("status") != "ok"])
    coverage = f' {failures} publisher feed(s) unavailable on this check.' if failures else ''
    index_body = intro + actions + lead
    index_body += (f'<section id="sites"><h2>Browse {len(selected)} independent sites</h2><label class="filter" hidden>Find a site, place or topic'
                   '<input type="search" id="site-search" placeholder="Try Ottawa or cycling"></label><p id="filter-count" aria-live="polite"></p>'
                   '<div class="cards">' + "".join(cards) + '</div></section>')
    index_body += ('<section id="latest"><h2>Headlines across the collection</h2><p>Publisher dates appear below each headline. '
                   'Checks run Tuesdays at 11:17 UTC. Last checked ' + checked + ' UTC.' + coverage + '</p><div class="actions">'
                   + link("feed.xml", "Combined RSS feed") + link("subscriptions.opml", "Download all publisher feeds (OPML)")
                   + link("../?smallweb=all#reading", "Read this collection in Feed Harbour") + '</div>'
                   + '<ol class="headlines">' + recent + '</ol></section>')
    index_body += ('<section><h2>How sites are selected</h2><p>Each personal site or independent publication offers a public feed and '
                   'identifies a Canadian connection on its own site. Profiles link that evidence. This is a selection, and publishers post at their own pace. '
                   'Each weekly check keeps up to eight titles and links per site. The full stories stay with their publishers.</p></section>')
    save_page(output, "Small Web North · Canadian independent sites and headlines", "Explore independent Canadian sites, the places and topics they cover, and their latest linked headlines.", index_body, "../", record_url(""))
    xml_file(stage / "sitemap.xml", sitemap)
    status = {"checked_at": checked, "sites": len(selected), "headlines": len(posts), "unavailable": failures,
              "latest_publisher_date": max((i["published"] for _, i in posts), default="")[:10] or None}
    (stage / "data/small-web-status.json").write_text(json.dumps(status, indent=2) + "\n")
