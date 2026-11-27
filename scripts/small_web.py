"""Collect publicly linked headline metadata from the reviewed Small Web North publishers."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
import ipaddress
import json
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from check_feeds import check, date, local, MAX_BYTES, parse_feed, UA

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "web/data/small-web-sites.json"
ARCHIVE = ROOT / "web/data/small-web.json"
PER_SITE = 8
XML_BASE = "{http://www.w3.org/XML/1998/namespace}base"


def safe_url(url):
    try:
        p = urlsplit(url)
        name = (p.hostname or "").rstrip(".").lower()
        if name.endswith((".local", ".internal", ".localhost")):
            return False
        try:
            ipaddress.ip_address(name)
            return False
        except ValueError:
            pass
        return bool(p.scheme in {"http", "https"} and p.hostname and "." in p.hostname
                    and not p.username and not p.password and p.port in (None, 80, 443)
                    and not any(c.isspace() or ord(c) < 32 or c == "\\" for c in url))
    except ValueError:
        return False


def load_sites(path):
    sites = json.loads(path.read_text())
    ids, urls = set(), set()
    for site in sites:
        if (not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", site["id"]) or site["id"] in ids
                or site["feed"] in urls or not site["topics"] or not site["basis"]
                or not all(safe_url(site[k]) and site[k].startswith("https://") for k in ("url", "feed", "evidence"))):
            raise ValueError("Invalid or duplicate reviewed site")
        if site.get("related_tool") and not site["related_tool"]["url"].startswith("https://coolcode.ca/"):
            raise ValueError("Related tools must be on CoolCode")
        ids.add(site["id"])
        urls.add(site["feed"])
    if not sites:
        raise ValueError("No reviewed sites")
    return sites


def fetch_xml(url):
    request = Request(url, headers={"User-Agent": UA, "Accept": "application/atom+xml, application/rss+xml, application/xml, text/xml"})
    with urlopen(request, timeout=25) as response:
        raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES or not response.url.startswith("https://"):
            raise ValueError("Invalid publisher response")
        return raw.decode("utf-8-sig"), response.url


def field(node, name):
    return next(("".join(c.itertext()).strip() for c in node if local(c.tag) == name), "")


def headlines(xml, base):
    parse_feed(xml)  # Same size, DTD, supported-format and entry requirements as the reader.
    root = ET.fromstring(xml)
    channel = next((c for c in root if local(c.tag) == "channel"), root)
    atom = root.tag == "{http://www.w3.org/2005/Atom}feed"
    container = root if local(root.tag) == "RDF" else channel
    base = urljoin(base, root.get(XML_BASE, ""))
    if container is not root:
        base = urljoin(base, container.get(XML_BASE, ""))
    items = {}
    for entry in container:
        if local(entry.tag) != ("entry" if atom else "item"):
            continue
        link = next((c for c in entry if local(c.tag) == "link" and c.get("rel", "alternate") == "alternate"), None)
        if link is None:
            continue
        ref = (link.get("href") if atom else link.text) or ""
        if not ref.strip():
            continue
        url = urljoin(urljoin(urljoin(base, entry.get(XML_BASE, "")), link.get(XML_BASE, "")), ref.strip())
        title = " ".join(unescape(re.sub("<[^>]+>", "", field(entry, "title"))).split())[:400]
        if title and safe_url(url) and url not in items:
            items[url] = {"title": title, "url": url,
                          "uid": field(entry, "id" if atom else "guid")[:3000] or url,
                          "published": date(field(entry, "published" if atom else "pubDate") or field(entry, "date")),
                          "updated": date(field(entry, "updated"))}
    if not items:
        raise ValueError("Feed contained no linked headlines")
    return sorted(items.values(), key=lambda i: i["published"] or i["updated"], reverse=True)[:PER_SITE]


def refresh(config=CONFIG, archive=ARCHIVE, fetch=fetch_xml, at=None):
    sites = load_sites(config)
    previous = json.loads(archive.read_text())["captures"] if archive.exists() else {}
    checked = at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def collect(site):
        try:
            xml, base = fetch(site["feed"])
            return {"status": "ok", "checked_at": checked, "last_success_at": checked, "items": headlines(xml, base)}
        except (OSError, ValueError, ET.ParseError) as exc:
            old = previous.get(site["id"], {})
            print(f"{site['id']}: {type(exc).__name__}. Keeping last successful capture.", file=sys.stderr)
            return {"status": "unavailable", "checked_at": checked,
                    "last_success_at": old.get("last_success_at"), "items": old.get("items", [])}

    with ThreadPoolExecutor(max_workers=3) as pool:
        captures = dict(zip((s["id"] for s in sites), pool.map(collect, sites)))
    successful = sum(c["status"] == "ok" for c in captures.values())
    if not successful:
        raise ValueError("All publishers unavailable. Last successful edition kept.")
    snapshot = {"checked_at": checked, "captures": captures}
    with tempfile.NamedTemporaryFile("w", dir=archive.parent, encoding="utf-8", delete=False) as tmp:
        json.dump(snapshot, tmp, ensure_ascii=False, indent=2)
        tmp.write("\n")
    Path(tmp.name).replace(archive)
    print(f"{successful} of {len(sites)} publishers checked successfully. {sum(len(c['items']) for c in captures.values())} linked headlines.")
    return successful == len(sites)


def verify_reader(config=CONFIG, report=ROOT / "docs/small-web-validation.json"):
    """Separately verify each recommendation through the reader’s actual gateway."""
    def verify(site):
        return check({"id": site["id"], "url": site["feed"]})
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(verify, load_sites(config)))
    for row in rows:
        print(row["id"], "passed" if row["ok"] else row["error"])
    if not all(row["ok"] for row in rows):
        return False
    report.write_text(json.dumps({"method": "RSS/Atom parsed through the deployed Feed Harbour gateway.", "publishers": rows},
                                 indent=2, ensure_ascii=False) + "\n")
    return True


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-reader", action="store_true", help="Recheck original publisher feeds through the public reader gateway")
    args = parser.parse_args()
    try:
        success = verify_reader() if args.verify_reader else refresh()
        sys.exit(0 if success else 2)
    except (OSError, ValueError) as error:
        sys.exit(str(error))
