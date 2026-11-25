# Feed Harbour

[Open Feed Harbour](https://coolcode.ca/feedharbour/) — read public RSS and Atom feeds in one calm workspace, organize them into folders and keep a private reading list. It runs as a static browser app with a shared public-feed gateway. No account, subscription, API key or app-specific scheduled collector is required.

<!-- coolcode:guide -->
Add a public HTTPS feed, or import an OPML subscription list, then choose Refresh public feeds. For example, put NASA in a Space folder and Canada news in a Canada folder, search a topic, and save useful items for later. Duplicate article links can be grouped without losing their original feed entries. Local RSS/Atom XML can be imported without contacting a publisher. Save explicitly on your device or export JSON to keep content and reading state; OPML exports subscriptions and folders only. A failed refresh keeps the last good items visible.
<!-- /coolcode:guide -->

## Start reading

1. Open **Manage feeds**. Paste a public HTTPS RSS/Atom URL and optionally a folder name. This adds a subscription without fetching it. Feed addresses are different from a publisher's normal home page.
2. Select **Refresh public feeds**, or refresh an individual subscription. The selected URL is sent to the CoolCode gateway, which retrieves it from the publisher. Never use authenticated, tokenized, private-network or paid subscriber URLs in this public service.
3. Read feed-provided summaries. Search is case-insensitive and requires every entered word to occur in the title, summary or source names. Combine it with a folder/feed selector and All, Unread or Saved. Newest/oldest uses the publisher's publication date, or its update date when publication is unknown; undated items remain undated.
4. **Mark read**, **Mark unread** and **Save for later** affect the displayed duplicate group. Opening a publisher article also marks its displayed group read. Nothing loads the article until you click its link. **Mark shown as read** changes only the currently rendered items, up to the current Show more page.
5. Save on this browser/device deliberately, or export JSON before closing the tab. A fresh tab starts empty; use Load saved to restore a device save. No automatic restore or save occurs.

For a fully local example, click **Try an invented example**. The bundled example headlines are labelled demonstrations, not news. The optional NASA and Government of Canada starter subscriptions are regular editable sources, not a hardcoded limit on what visitors can follow.

## Imports, exports and retention

| Format | Import | Export |
| --- | --- | --- |
| RSS 2.x / common RSS 1.0 / Atom XML | Local feed content; no network request | Not exported as XML; included in JSON |
| OPML | Public subscriptions and nested folder names; no automatic fetch | Remote subscriptions and folders only |
| Feed Harbour JSON | Replaces the open workspace after full validation | Feed content, reading/saved state, source dates and subscriptions |

UTF-8 XML is limited to 2 MB; JSON to 10 MB. A workspace supports up to 50 feeds and 5,000 items, and its normalized JSON export must also fit the 10 MB bound. The first 300 entries in each feed capture are parsed. Merged history retains the newest 300 **unsaved** entries per feed plus all saved entries, subject to the global bounds. An over-limit update is rejected while the existing workspace is preserved. The reader is not a permanent archive: export backups you want to retain.

Local feed files cannot be remotely refreshed. Their Imported time is the time they were opened; Publisher update is taken from the feed if present. Private XML remains local, but its content and any visible absolute article links can still be present in a downloaded JSON backup. Relative article links are resolved against a safe feed/channel URL or Atom `xml:base`; unsupported or unsafe links remain plain text. Missing dates stay unknown rather than being replaced by an import/build timestamp.

OPML nesting becomes a folder path, such as `Science / Space`. Duplicate subscription URLs are skipped. Unsupported HTTP/private URLs are counted and skipped; malformed XML is rejected. OPML include URLs are never fetched. JSON imports validate schema `coolcode.feedharbour.v1`, identities, bounds and feed references before replacing the workspace. Unknown fields are discarded. Failed imports preserve the current workspace.

**Remove read, unsaved items** removes those entries from the open tab; a later refresh can bring them back if the publisher still includes them. Removing a feed also removes its captured items in the tab. Device saves remain unchanged until you explicitly save again. Forget saved deletes only the saved browser key, leaving the tab intact.

## Duplicate and identity rules

Feed IDs derive from normalized subscription URLs. Article IDs prefer the publisher's GUID/Atom ID, then its URL, then title plus publication date. Refresh updates an existing ID while retaining its read/saved flags and older captured entries within the retention limits. Different feeds retain separate entries in JSON.

Grouping uses a safe article URL after removing its fragment, `utm_*`, `fbclid`, `gclid`, `mc_cid` and `mc_eid` and sorting remaining query parameters. Meaningful query values remain distinct. No-link entries do not cross-dedupe just because titles match. A group displays the newest dated copy; it is read only when every included copy is read, and saved if any included copy is saved. Group actions apply to the copies included by the current feed/folder filters. Turning grouping off shows each original entry.

## Safety and privacy

All feed titles, summaries, folder names and errors render as text, never raw HTML. XML with DOCTYPE or entity declarations is rejected before parsing. Scripts/styles and tags are removed from summaries; images, tracking pixels, embedded players and external content references are never loaded. External article links permit only safe HTTP/HTTPS URLs and open with `noopener noreferrer`; no javascript/data/file links, credentials, IP literals or custom ports are accepted. This app does not scrape full articles or bypass paid access.

Only an explicit public refresh sends feed URLs to the gateway and publisher. Local XML/JSON/OPML imports, search, reading flags and saved items stay in the browser until the user exports or deliberately saves. Device storage is unencrypted under `coolcode:feedharbour:workspace`; storage quota failures show an error and suggest JSON export. The shared CoolCode counter records aggregate tool opens by ID only, not subscriptions, searches or feed content. Clicking an article contacts its publisher.

The gateway uses HTTPS, public-network restrictions, redirect validation and bounded responses. Its shared cache can retain a successful feed response for 15 minutes; the UI displays the gateway's actual `fetched_at`, not the page-build time. A shared daily allowance and upstream 403/404/429 errors can prevent a refresh. Errors are visible per feed and last-good captures are retained. No automatic polling, background job or scheduled collection occurs in this repository.

## Gateway contract and setup

No repository API secret or variable is needed. `web/config.json` points to the shared gateway:

```text
GET https://coolcode-visitor-api.jeffdyer.workers.dev/api/feedharbour/feed?url=ENCODED_PUBLIC_HTTPS_FEED
```

Expected successful JSON:

```json
{
  "fetched_at": "2026-11-25T12:00:00Z",
  "data": {"url": "https://publisher.example.org/feed.xml", "xml": "<rss>...</rss>"}
}
```

The response URL is the final validated publisher URL and is used to resolve relative links. Production requests omit credentials and the referrer. Non-success status, malformed envelopes, invalid XML, timeout, or capacity limits leave good items intact. CORS must allow the deployed CoolCode origin. If deploying the repository independently, configure your own compatible gateway or use local XML imports; never put private credentials into `config.json`.

## Expand or customize

`web/config.json` contains the public gateway and an arbitrary `starterFeeds` array. To add another optional source, append an object:

```json
{"url":"https://publisher.example.org/feed.xml","title":"My public source","folder":"Local"}
```

Use a real public feed URL and verify its XML before publishing. The UI derives source counts and folders from actual subscriptions; it does not require the initial two sources. Visitors can add other feeds and imports without changing the repo. Existing JSON exports preserve their own feeds and captured dates even if starters change. Starter additions do not contact providers until a visitor chooses Refresh.

The browser model and retention bounds live in `web/model.mjs`; XML parsing in `web/xml.mjs`; UI in `web/app.mjs`. Update fixtures, browser flows and documentation when changing supported formats or identity rules. Saved workspace schemas must remain readable or receive an explicit migration.

Run checks, commit and push to `main` to publish code/config changes. There is no data refresh workflow to invoke, API key to enter, or collector guard to register. The shared gateway is maintained separately in the hub; app changes alone cannot deploy gateway changes.

## Develop and publish

Node 24+, Python 3.12+, no npm install or production dependency:

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests -v
python3 scripts/build.py
python3 -m http.server 8000 --directory dist
```

Browser regression tests use Playwright with the runner's Google Chrome:

```sh
python3 -m pip install -r tests/browser-requirements.txt
CHROMIUM_PATH="$(command -v google-chrome)" python3 tests/browser_smoke.py
```

Pure-model tests cover malicious URL rejection, canonical dedupe, dates, arbitrary added sources, refresh state, retention and exports. Browser tests exercise actual RSS/Atom/OPML DOM parsing, namespaces and relative links, local-only imports, the gateway envelope, quota failure retention, read/save/filter actions, JSON/OPML downloads and mobile overflow. Gateway calls in CI are deterministic fixtures; deployment still requires a real public gateway smoke check.

GitHub Actions uses Ubuntu 24.04 and Google Chrome, checks PRs, saves screenshots and a preview, then publishes successful `main` builds. Set **Settings → Pages → Source → GitHub Actions**. Only `dist/` is deployed; do not commit it or add a CNAME. App assets remain relative for `/feedharbour/`.

Follow the [CoolCode lifecycle](https://github.com/jsdyer/jsdyer.github.io/blob/main/docs/tool-lifecycle.md): import `tool.json` and this marked guide in the hub, regenerate homepage/README, Worker registration and sitemap, reconcile repository coverage and ordinary live-page probes, and verify gateway behaviour. This app has **no collector/freshness watchdog schedule**. Its public-page and shared gateway probes are integration concerns, not additional cron jobs in this repo.

## Primary references and optional starters

- [RSS specification](https://www.rssboard.org/rss-specification)
- [Atom RFC 4287](https://www.rfc-editor.org/rfc/rfc4287)
- [OPML 2.0](https://2005.opml.org/spec2.html)
- [NASA's official feed directory](https://www.nasa.gov/rss-feeds/)
- [Government of Canada RSS subscription directory](https://www.canada.ca/en/news/subscribe-emails.html)

Reviewed 2026-11-25. These are format/source references, not a snapshot date for visitor-selected feeds. Publisher and retrieval dates are displayed separately in Manage feeds.
