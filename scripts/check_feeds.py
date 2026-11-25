#!/usr/bin/env python3
"""Manually verify curated public feeds through the production gateway; never a build dependency."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 2_000_000
GATEWAY = 'https://coolcode-visitor-api.jeffdyer.workers.dev/api/feedharbour/feed'
UA = 'Mozilla/5.0 (compatible; CoolCodeFeedCheck/1.0; +https://coolcode.ca/feedharbour/)'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def local(tag):
    return tag.rsplit('}', 1)[-1]


def date(value):
    if not value:
        return ''
    try:
        d = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
    except ValueError:
        try:
            d = parsedate_to_datetime(value)
        except (ValueError, TypeError):
            return ''
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def parse_feed(xml):
    if len(xml.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Feed exceeds the reader’s 2 MB limit')
    if re.search(r'<!\s*(?:DOCTYPE|ENTITY)\b', xml, re.I):
        raise ValueError('DOCTYPE or entity declaration unsupported by reader')
    root = ET.fromstring(xml)
    kind = local(root.tag)
    if kind == 'rss':
        channel = next((n for n in root if local(n.tag) == 'channel'), None)
        if channel is None:
            raise ValueError('RSS channel missing')
        entries = [n for n in channel if local(n.tag) == 'item']
        format_name = 'RSS'
    elif root.tag == '{http://www.w3.org/2005/Atom}feed':
        channel = root
        entries = [n for n in root if local(n.tag) == 'entry']
        format_name = 'Atom'
    elif kind == 'RDF':
        channel = next((n for n in root if local(n.tag) == 'channel'), None)
        if channel is None:
            raise ValueError('RSS 1.0 channel missing')
        entries = [n for n in root if local(n.tag) == 'item']
        format_name = 'RSS 1.0'
    else:
        raise ValueError(f'Expected RSS/Atom, received {kind}')
    title = next((''.join(n.itertext()).strip() for n in channel if local(n.tag) == 'title'), '')
    if not title or not entries:
        raise ValueError('Feed lacks a title or any entries')
    if not any(any(local(n.tag) == 'title' and ''.join(n.itertext()).strip() for n in e) for e in entries):
        raise ValueError('Feed entries have no usable titles')
    dates = [date(''.join(n.itertext())) for e in entries for n in e if local(n.tag) in ('pubDate', 'published', 'updated', 'date')]
    return {'format': format_name, 'feed_title': title[:200], 'entry_count': len(entries), 'latest_entry_at': max((d for d in dates if d), default=''), 'xml_bytes': len(xml.encode('utf-8'))}


def check(feed, gateway=GATEWAY):
    row = {'id': feed['id'], 'url': feed['url'], 'checked_at': now(), 'route': 'production gateway' if gateway else 'direct publisher HTTPS'}
    try:
        if urlsplit(feed['url']).scheme != 'https':
            raise ValueError('Curated feed must use HTTPS')
        url = gateway + '?' + urlencode({'url': feed['url']}) if gateway else feed['url']
        request = Request(url, headers={'User-Agent': UA, 'Origin': 'https://coolcode.ca', 'Accept': 'application/json' if gateway else 'application/rss+xml, application/atom+xml, application/xml, text/xml'})
        with urlopen(request, timeout=35) as response:
            row['http_status'] = response.status
            raw = response.read(MAX_BYTES * 4 + 1)
            row['response_content_type'] = response.headers.get('Content-Type', '')
            final_url = response.url
        if len(raw) > MAX_BYTES * 4:
            raise ValueError('Response too large')
        if gateway:
            envelope = json.loads(raw)
            xml = envelope['data']['xml']
            row['final_url'] = envelope['data']['url']
            row['fetched_at'] = envelope['fetched_at']
        else:
            xml = raw.decode('utf-8-sig')
            row['final_url'] = final_url
            row['fetched_at'] = row['checked_at']
        row.update(parse_feed(xml))
        row['ok'] = True
    except Exception as exc:
        row['ok'] = False
        row['error'] = str(exc)[:300]
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT / 'web/data/feed-directory.json')
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/feed-validation.json')
    parser.add_argument('--direct', action='store_true', help='Check publishers directly instead of the visitor gateway')
    parser.add_argument('--update-directory', action='store_true', help='Update verification metadata only when every feed passes')
    args = parser.parse_args()
    directory = json.loads(args.directory.read_text())
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(lambda f: check(f, '' if args.direct else GATEWAY), directory['feeds']))
    report = {'checked_at': now(), 'method': 'HTTPS GET, bounded UTF-8 XML, supported root/channel, nonempty title and entries; no article scraping', 'passed': sum(r['ok'] for r in rows), 'total': len(rows), 'results': rows}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    for row in rows:
        print(f"{'PASS' if row['ok'] else 'FAIL'} {row['id']}: {str(row.get('entry_count', ''))+' entries' if row['ok'] else row['error']}")
    if args.update_directory and all(r['ok'] for r in rows):
        by_id = {r['id']: r for r in rows}
        directory['reviewed_at'] = report['checked_at']
        for feed in directory['feeds']:
            row = by_id[feed['id']]
            feed['verification'] = {k: row[k] for k in ('checked_at', 'fetched_at', 'format', 'entry_count', 'latest_entry_at')}
        args.directory.write_text(json.dumps(directory, indent=2, ensure_ascii=False) + '\n')
    return 0 if all(r['ok'] for r in rows) else 1


if __name__ == '__main__':
    sys.exit(main())
