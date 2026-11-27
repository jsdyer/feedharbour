import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from small_web import CONFIG, headlines, load_sites, refresh
from small_web_pages import build_records


class SmallWeb(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.config = self.out / "sites.json"
        self.archive = self.out / "snapshot.json"
        self.sites = load_sites(CONFIG)[:2]
        self.config.write_text(json.dumps(self.sites))
        self.xml = """<rss version="2.0"><channel><title>Independent site</title><item><guid>own-id</guid>
        <title>Fish &amp; chips</title><link>https://publisher.example.org/article</link>
        <description>Article body never copied</description><pubDate>Fri, 20 Nov 2026 10:00:00 GMT</pubDate>
        </item></channel></rss>"""
        self.good = lambda url: (self.xml, url)

    def test_rss_atom_dates_and_links(self):
        result = headlines(self.xml, "https://publisher.example.org/rss")
        self.assertEqual(result[0]["title"], "Fish & chips")
        self.assertEqual(result[0]["published"], "2026-11-20T10:00:00Z")
        self.assertNotIn("Article body", str(result))
        atom = '<feed xmlns="http://www.w3.org/2005/Atom" xml:base="/notes/"><title>Blog</title><entry xml:base="new/"><title>One</title><id>p1</id><updated>2026-11-22T00:00:00Z</updated><link rel="self" href="ignore"/><link href="post"/></entry><entry><title>Unsafe</title><link href="javascript:alert(1)"/></entry></feed>'
        result = headlines(atom, "https://publisher.example.org/atom.xml")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["url"], "https://publisher.example.org/notes/new/post")
        self.assertEqual(result[0]["published"], "")
        self.assertTrue(result[0]["updated"])

    def test_partial_and_total_failures_preserve_original_success_and_item(self):
        first, second = "2026-11-17T11:17:00Z", "2026-11-24T11:17:00Z"
        self.assertTrue(refresh(self.config, self.archive, self.good, first))
        def partial(url):
            if url == self.sites[1]["feed"]:
                raise OSError("unavailable")
            return self.good(url)
        self.assertFalse(refresh(self.config, self.archive, partial, second))
        old = self.archive.read_bytes()
        snap = json.loads(old)
        stale = snap["captures"][self.sites[1]["id"]]
        self.assertEqual((stale["checked_at"], stale["last_success_at"], stale["status"]), (second, first, "unavailable"))
        self.assertEqual(stale["items"][0]["uid"], "own-id")
        with self.assertRaisesRegex(ValueError, "All publishers"):
            refresh(self.config, self.archive, lambda url: ("<html/>", url), second)
        self.assertEqual(self.archive.read_bytes(), old)

    def test_directory_profile_sitemap_rss_and_opml_coverage(self):
        stage = self.out / "site"
        shutil.copytree(ROOT / "web/data", stage / "data")
        tool = json.loads((ROOT / "tool.json").read_text())
        build_records(stage, tool, True)
        sites = load_sites(stage / "data/small-web-sites.json")
        captures = json.loads((stage / "data/small-web.json").read_text())["captures"]
        sitemap = {row.text for row in ET.parse(stage / "sitemap.xml").findall(".//{*}loc")}
        base = "https://coolcode.ca/feedharbour/records/"
        self.assertEqual(sitemap, {base} | {base + "sites/" + s["id"] + "/" for s in sites if captures[s["id"]]["items"]})
        rss = ET.parse(stage / "records/feed.xml").findall("./channel/item")
        unique = {item["url"] for cap in captures.values() for item in cap["items"]}
        self.assertEqual({r.findtext("link") for r in rss}, unique)
        self.assertEqual(len(rss), len(unique))
        self.assertTrue(all(r.find("description") is None and r.find("source").get("url") for r in rss))
        opml = ET.parse(stage / "records/subscriptions.opml").findall(".//outline[@xmlUrl]")
        self.assertEqual({r.get("xmlUrl") for r in opml}, {s["feed"] for s in sites})
        for s in sites:
            page = (stage / "records/sites" / s["id"] / "index.html").read_text()
            for key in ("evidence", "feed"):
                self.assertIn(s[key], page)
            self.assertIn(f'?smallweb={s["id"]}', page)
            self.assertIn("Related sites", page)
            self.assertIn(f'rel="canonical" href="{base}sites/{s["id"]}/"', page)
