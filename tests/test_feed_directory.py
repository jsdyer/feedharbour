"""Verify the offline catalogue corresponds to real-source validation evidence."""
import importlib.util
import json
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('feed_checker', ROOT / 'scripts/check_feeds.py')
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class FeedDirectoryTests(unittest.TestCase):
    def test_every_recommendation_has_matching_successful_gateway_evidence(self):
        directory = json.loads((ROOT / 'web/data/feed-directory.json').read_text())
        report = json.loads((ROOT / 'docs/feed-validation.json').read_text())
        rows = {r['id']: r for r in report['results']}
        self.assertEqual(report['passed'], len(directory['feeds']))
        self.assertEqual(set(rows), {f['id'] for f in directory['feeds']})
        self.assertEqual(directory['reviewed_at'], report['checked_at'])
        for feed in directory['feeds']:
            row = rows[feed['id']]
            self.assertTrue(row['ok'])
            self.assertEqual(row['http_status'], 200)
            self.assertEqual(row['route'], 'production gateway')
            self.assertEqual(row['url'], feed['url'])
            self.assertGreater(row['entry_count'], 0)
            self.assertLessEqual(row['xml_bytes'], checker.MAX_BYTES)
            for key in ('checked_at', 'fetched_at', 'format', 'entry_count', 'latest_entry_at'):
                self.assertEqual(feed['verification'][key], row[key])

    def test_actual_rss_atom_fixtures_and_rejections(self):
        rss = checker.parse_feed((ROOT / 'tests/fixtures/rss.xml').read_text())
        atom = checker.parse_feed((ROOT / 'tests/fixtures/atom.xml').read_text())
        self.assertEqual(rss['format'], 'RSS')
        self.assertEqual(atom['format'], 'Atom')
        self.assertEqual(rss['entry_count'], 2)
        self.assertEqual(atom['entry_count'], 2)
        for xml in ('<html><body>Website, not a feed</body></html>', '<rss><channel><title>Empty</title></channel></rss>', '<!DOCTYPE rss [<!ENTITY x "hello">]><rss/>', '<rss>'):
            with self.assertRaises(Exception):
                checker.parse_feed(xml)

    def test_rss_one_with_namespaced_dates(self):
        xml = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Public findings</title></channel><item><title>Published result</title><dc:date>2026-11-24T12:00:00Z</dc:date></item></rdf:RDF>'
        result = checker.parse_feed(xml)
        self.assertEqual(result['format'], 'RSS 1.0')
        self.assertEqual(result['latest_entry_at'], '2026-11-24T12:00:00Z')
