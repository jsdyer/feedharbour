"""Real Chrome checks: XML parsing, private imports, gateway contract and reader flows."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import shutil
import tempfile
import threading
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'tests' / 'fixtures'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    screenshots = ROOT / 'browser-checks'
    screenshots.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        shutil.copytree(ROOT / 'dist', Path(temporary) / 'feedharbour')
        server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=temporary))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None)
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors, requests = [], []
                failing = [False]
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: errors.append('Unexpected dialog: ' + dialog.message))

                def gateway(route):
                    url = parse_qs(urlparse(route.request.url).query)['url'][0]
                    requests.append(url)
                    if failing[0]:
                        route.fulfill(status=429, content_type='application/json', body='{"error":"quota"}', headers={'Access-Control-Allow-Origin': '*'})
                        return
                    name = 'atom.xml' if 'atom' in url else 'rss.xml'
                    body = {'fetched_at': '2026-11-25T12:00:00Z', 'data': {'url': url, 'xml': (FIXTURES / name).read_text()}}
                    route.fulfill(content_type='application/json', body=json.dumps(body), headers={'Access-Control-Allow-Origin': '*'})

                page.route('https://coolcode-visitor-api.jeffdyer.workers.dev/api/feedharbour/feed?**', gateway)
                page.goto(f'http://127.0.0.1:{server.server_port}/feedharbour/')
                expect(page.locator('#empty')).to_be_visible()
                assert requests == []
                assert page.evaluate("localStorage.getItem('coolcode:feedharbour:workspace')") is None
                directory = json.loads((ROOT / 'web/data/feed-directory.json').read_text())
                expect(page.locator('#directory-cards article')).to_have_count(min(12, len(directory['feeds'])))
                expect(page.locator('#directory-meta')).to_contain_text(f"{len(directory['feeds'])} checked feeds")
                page.screenshot(path=str(screenshots / 'directory-desktop.png'), full_page=True)
                if len(directory['feeds']) > 12:
                    page.locator('#directory-more').click()
                    expect(page.locator('#directory-cards article')).to_have_count(min(24, len(directory['feeds'])))
                first = page.locator('#directory-cards article').first
                first.get_by_role('button', name='+ Add feed', exact=True).click()
                expect(first.get_by_role('button', name='✓ Added', exact=True)).to_be_disabled()
                expect(page.locator('#workspace-summary')).to_contain_text('1 feed')
                assert requests == [], 'Directory browsing/subscribing must not fetch publishers'
                page.locator('#directory-category').select_option('projects')
                project_count = sum(f['category'] == 'projects' for f in directory['feeds'])
                expect(page.locator('#directory-cards article')).to_have_count(min(12, project_count))
                page.locator('#add-topic').click()
                subscribed_count = len({directory['feeds'][0]['id']} | {f['id'] for f in directory['feeds'] if f['category'] == 'projects'})
                expect(page.locator('#workspace-summary')).to_contain_text(f'{subscribed_count} feeds')
                expect(page.locator('#add-topic')).to_be_disabled()
                assert requests == []
                page.locator('#directory-category').select_option('')
                page.locator('#directory-search').fill('Nova Scotia')
                expect(page.locator('#directory-count')).to_contain_text('recommendation')
                assert page.locator('#directory-cards article').count() >= 1
                page.locator('#directory-search').fill('no-such-recommendation-xyz')
                expect(page.locator('#directory-empty')).to_be_visible()
                page.locator('#directory-toggle').click()
                expect(page.locator('#directory-content')).to_be_hidden()
                page.reload()
                expect(page.locator('#directory-cards article')).to_have_count(min(12, len(directory['feeds'])))
                expect(page.locator('#workspace-summary')).to_contain_text('0 feeds')
                assert requests == []
                # Exercise the actual browser XML parser, including Atom xml:base and XHTML.
                parsed = page.evaluate("""async texts => {const m=await import('./xml.mjs');return {rss:m.parseFeed(texts.rss,'https://publisher.example.org/feed.xml'),atom:m.parseFeed(texts.atom,'https://publisher.example.org/atom.xml'),opml:m.parseOPML(texts.opml)};}""", {'rss': (FIXTURES/'rss.xml').read_text(), 'atom': (FIXTURES/'atom.xml').read_text(), 'opml': (FIXTURES/'subscriptions.opml').read_text()})
                assert parsed['rss']['items'][1]['url'] == ''
                assert parsed['rss']['items'][1]['published'] == ''
                assert parsed['rss']['items'][0]['summary'] == 'Ocean research and climate.'
                assert parsed['atom']['items'][0]['url'] == 'https://publisher.example.org/story#duplicate'
                assert parsed['atom']['items'][1]['url'] == 'https://publisher.example.org/telescope'
                assert parsed['atom']['items'][1]['summary'] == 'A telescope in the night sky.'
                assert parsed['opml']['feeds'][1]['folder'] == 'Science / Nested'
                relative = page.evaluate("""async () => {const m=await import('./xml.mjs');return m.parseFeed('<feed xmlns="http://www.w3.org/2005/Atom" xml:base="news/"><title>Relative</title><entry xml:base="posts/"><id>relative</id><title>Nested base</title><link href="story"/></entry></feed>','https://publisher.example.org/root/feed.xml').items[0].url;}""")
                assert relative == 'https://publisher.example.org/root/news/posts/story'
                rejected = page.evaluate("""async () => {const m=await import('./xml.mjs');return ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>','<rss><broken>','<html><body>Not a feed</body></html>'].map(x=>{try{m.parseFeed(x);return false;}catch{return true;}})}""")
                assert rejected == [True, True, True]
                page.locator('#manage-toggle').click()
                page.locator('#import-opml').set_input_files(FIXTURES / 'subscriptions.opml')
                expect(page.locator('#status')).to_contain_text('2 feeds added, 1 duplicates, 1 unsupported')
                assert requests == []
                page.locator('#refresh-all').click()
                expect(page.locator('#status')).to_contain_text('2 feeds refreshed; 0 failed')
                assert len(requests) == 2
                assert page.locator('#items article').count() == 3
                assert page.locator('img').count() == 0
                assert page.locator('#items a[href^="javascript:"]').count() == 0
                ocean = page.locator('#items article').filter(has_text='Ocean discovery')
                expect(ocean).to_contain_text('2 feed copies grouped')
                ocean.get_by_role('button', name='Mark read', exact=True).click()
                ocean.get_by_role('button', name='☆ Save for later', exact=True).click()
                page.locator('#search').fill('telescope sky')
                assert page.locator('#items article').count() == 1
                page.locator('#search').fill('')
                page.locator('#folder-filter').select_option('Science / Nested')
                assert page.locator('#items article').count() == 2
                page.locator('#folder-filter').select_option('')
                page.locator('#mark-visible').click()
                expect(page.locator('#unread-count')).to_have_text('0')
                page.locator('[data-state=saved]').click()
                assert page.locator('#items article').count() == 1
                page.locator('[data-state=all]').click()
                page.locator('#save').click()
                expect(page.locator('#storage-status')).to_contain_text('Saved on this browser')
                with page.expect_download() as dl:
                    page.locator('#export-json').click()
                backup = Path(temporary) / 'backup.json'
                dl.value.save_as(backup)
                exported = json.loads(backup.read_text())
                assert len(exported['feeds']) == 2 and len(exported['items']) == 4
                with page.expect_download() as dl:
                    page.locator('#export-opml').click()
                opml = Path(temporary) / 'export.opml'
                dl.value.save_as(opml)
                assert 'Science / Nested' in opml.read_text()
                before = len(requests)
                page.locator('#import-xml').set_input_files(FIXTURES / 'rss.xml')
                expect(page.locator('#status')).to_contain_text('Local XML imported: 2 items')
                assert len(requests) == before
                page.locator('#feed-url').fill('https://another.example.org/custom.xml')
                page.locator('#feed-folder').fill('Arbitrary visitor feed')
                page.locator('#add-feed button').click()
                expect(page.locator('#workspace-summary')).to_contain_text('4 feeds')
                assert len(requests) == before
                page.locator('#load').click()
                expect(page.locator('#workspace-summary')).to_contain_text('2 feeds')
                page.locator('#import-json').set_input_files(backup)
                expect(page.locator('#status')).to_contain_text('JSON workspace imported')
                failing[0] = True
                page.locator('#refresh-all').click()
                expect(page.locator('#status')).to_contain_text('0 feeds refreshed; 2 failed')
                assert page.locator('#items article').count() == 3
                expect(page.locator('#feed-manager')).to_contain_text('Last good items kept')
                malicious = Path(temporary) / 'malicious.xml'
                malicious.write_text('<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>')
                page.locator('#import-xml').set_input_files(malicious)
                expect(page.locator('#status')).to_contain_text('Import rejected')
                assert page.locator('#items article').count() == 3
                page.locator('#forget').click()
                assert page.evaluate("localStorage.getItem('coolcode:feedharbour:workspace')") is None
                page.locator('#close-manage').click()
                page.screenshot(path=str(screenshots / 'desktop.png'), full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                for opened in [False, True]:
                    if opened:
                        page.locator('#manage-toggle').click()
                    page.screenshot(path=str(screenshots / f'mobile-{opened}.png'), full_page=True)
                    overflow = page.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,15)")
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), overflow
                assert not errors, errors
                base = f'http://127.0.0.1:{server.server_port}/feedharbour/'
                visitor = browser.new_page(viewport={'width':390, 'height':844})
                external = []
                visitor.on('request', lambda req: external.append(req.url) if '127.0.0.1' not in req.url else None)
                visitor.goto(base + 'records/')
                expect(visitor.get_by_role('heading', name='Small Web North', exact=True)).to_be_visible()
                visitor.screenshot(path=str(screenshots / 'small-web-mobile.png'))
                assert visitor.evaluate('document.documentElement.scrollWidth <= innerWidth')
                sources = json.loads((ROOT/'web/data/small-web-sites.json').read_text())
                captures = json.loads((ROOT/'web/data/small-web.json').read_text())['captures']
                visitor.get_by_role('searchbox').fill('montreal')
                expect(visitor.locator('[data-site]:visible')).to_have_count(sum('Montréal' in s['place'] and bool(captures[s['id']]['items']) for s in sources))
                visitor.get_by_role('searchbox').fill('a nonmatching query')
                expect(visitor.get_by_role('button', name='Surprise me with a site')).to_be_disabled()
                visitor.get_by_role('searchbox').fill('cycling')
                visitor.get_by_role('button', name='Surprise me with a site').click()
                expect(visitor).to_have_url(base + 'records/sites/hans-on-the-bike/')
                expect(visitor.get_by_role('heading', name='Related sites')).to_be_visible()
                visitor.get_by_role('link', name='Read in Feed Harbour').click()
                expect(visitor.locator('#items article')).to_have_count(len(captures['hans-on-the-bike']['items']))
                expect(visitor.locator('#status')).to_contain_text('Hans on the Bike')
                assert external == [], 'Opening the weekly capture should not contact publishers or gateway'
                assert visitor.evaluate("localStorage.getItem('coolcode:feedharbour:workspace')") is None
                visitor.goto(base + '?smallweb=unknown#reading')
                expect(visitor.locator('#status')).to_contain_text('No captured site matches')
                no_js = browser.new_context(java_script_enabled=False)
                static_page = no_js.new_page()
                static_page.goto(base + 'records/')
                expect(static_page.locator('[data-site]')).to_have_count(sum(bool(c['items']) for c in captures.values()))
                static_page.get_by_role('heading', name='Miss604', exact=True).get_by_role('link').click()
                expect(static_page.get_by_role('link', name='Original feed')).to_be_visible()
                expect(static_page.locator('.headlines').first.get_by_role('link').first).to_be_visible()
                assert static_page.locator('.headlines').first.get_by_role('link').first.get_attribute('href').startswith('https://')
                no_js.close()
                browser.close()
            print('Browser checks passed: recommended directory, explicit topic packs, RSS/Atom/OPML, XML safety, live contract, failed refresh retention, reading state, arbitrary feeds, exports and mobile layout')
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()
