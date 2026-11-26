# Feed Harbour

[Open Feed Harbour](https://coolcode.ca/feedharbour/) — read public RSS and Atom feeds in one calm workspace, organize them into folders and keep a private reading list. It runs as a static browser app with a shared public-feed gateway. No account, subscription, API key or app-specific scheduled collector is required.

<!-- coolcode:guide -->
Browse checked RSS feeds across CoolCode's topics, including British Columbia and Nova Scotia news, public records, Linux, networks, space, money and culture. CoolCode’s Civic Revision and Release Receipt feeds cover Wikipedia revisions and Statistics Canada releases. Paste Research Ledger’s university feeds or the Package Pulse and Rack Expiry release feeds to follow research and software updates. Add one source or a topic pack, then choose Refresh; browsing or subscribing does not fetch articles automatically. You can still enter any public feed, import OPML or read local RSS/Atom XML privately. Save deliberately on your device or export JSON to keep reading state; OPML exports subscriptions and folders. Failed refreshes keep the last good items visible.
<!-- /coolcode:guide -->

## Start reading

1. Start with the visible **Find feeds for your interests** directory. Search words such as `Nova Scotia`, `DNS`, `Linux` or `food`, or choose one of the nine CoolCode topics. **Add feed** subscribes to one source; **Add feeds in this topic** adds that whole topic only when you select it. Neither action fetches content. You can also open **Manage feeds** and paste any public HTTPS RSS/Atom URL and an optional folder. Feed addresses differ from normal website home pages.
2. Select **Refresh public feeds**, or refresh an individual subscription. Reviewed CoolCode research/software feeds load directly from the same site; other selected URLs are sent to the CoolCode gateway, which retrieves them from the publisher. Never use authenticated, tokenized, private-network or paid subscriber URLs in this public service.
3. Read feed-provided summaries. Search is case-insensitive and requires every entered word to occur in the title, summary or source names. Combine it with a folder/feed selector and All, Unread or Saved. Newest/oldest uses the publisher's publication date, or its update date when publication is unknown; undated items remain undated.
4. **Mark read**, **Mark unread** and **Save for later** affect the displayed duplicate group. Opening a publisher article also marks its displayed group read. Nothing loads the article until you click its link. **Mark shown as read** changes only the currently rendered items, up to the current Show more page.
5. Save on this browser/device deliberately, or export JSON before closing the tab. A fresh tab starts empty; use Load saved to restore a device save. No automatic restore or save occurs.

For a fully local example, click **Try an invented example**. The bundled example headlines are labelled demonstrations, not news. Directory recommendations are optional public subscriptions, not a limit on what visitors can follow. They span all nine existing CoolCode categories, with food/culture under Media and travel/local reporting under Maps, trails & history. Topic packs become ordinary folders; existing subscriptions are not duplicated or moved. If a pack would exceed the 50-feed workspace limit, the entire addition is rejected with an explanation.

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

Only an explicit public refresh contacts a feed source. The exact static CoolCode paths in `web/config.json` → `firstPartyFeeds` load directly when this app runs on https://coolcode.ca, with credentials omitted, redirects rejected and a streamed 2 MB limit. This lets new research and release feeds work without another Worker deployment. Other public refreshes send feed URLs to the gateway and publisher. Local XML/JSON/OPML imports, search, reading flags and saved items stay in the browser until the user exports or deliberately saves. Device storage is unencrypted under `coolcode:feedharbour:workspace`; storage quota failures show an error and suggest JSON export. The shared CoolCode counter records aggregate tool opens by ID only, not subscriptions, searches or feed content. Clicking an article contacts its publisher.

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

## Feed directory and verification

`web/data/feed-directory.json` contains the public recommendations and all nine existing CoolCode topic names. It is fetched locally on page load; no publisher is contacted to browse or search it. The page shows twelve recommendations initially, with **Show more**, a search box and a topic selector. Single-feed buttons show Added for existing subscriptions. Adding a topic pack is an explicit action, and there is no add-everything default or automatic refresh. The directory can be hidden while reading.

The directory also includes Civic Revision’s aggregate and four topic feeds, plus Release Receipt’s aggregate and Canada/BC/NS CPI and earnings feeds. Search `Civic Revision` or `Release Receipt` to find them; subscribing remains an explicit action. These are CoolCode-produced feeds based on the named public sources, not official publisher feeds. Their subscription URLs use the raw GitHub copies of the published XML, which work through the existing gateway; their source-page links remain on CoolCode. These public source URLs avoid self-proxying and work independently of Cloudflare allowlist changes. Existing subscriptions are not migrated or rewritten.

Every listed feed passed an actual HTTP GET through the same deployed gateway the reader uses and parsed as a supported RSS/Atom document with a nonempty title and entries. This is a manually reviewed directory, not a continuous uptime guarantee. The visible review/check dates refer to that verification, while each workspace still displays its own actual fetched and publisher dates. Format, entry count and latest dated entry at verification are available in each card's details. Unknown entry dates remain unknown.

The machine-readable results are in `docs/feed-validation.json`, including response status, final URL, format, entry counts, byte size and timestamps. `docs/feed-discovery.json` records publisher discovery sources and excluded candidates. Advertised feeds that failed the deployed gateway or returned empty/invalid XML were excluded, including CBC BC/NS, legacy Nova Scotia news/traffic endpoints, and several moved feed URLs. These are observations at the recorded check time, not claims that the publishers are permanently unavailable.

## Expand or customize

`web/config.json` contains the public gateway address. Add or revise recommendations in `web/data/feed-directory.json`, preserving its `coolcode.feed-directory.v1` schema. Each feed has an ID, title, public HTTPS feed URL, publisher/source page, one existing category ID, a short description, search tags and verification metadata. For example, a new local publisher belongs in `places`, with tags naming its community. Copy an existing entry's shape, give it a new ID and real publisher URL, and run verification before publishing; do not invent verification results.

Run the actual manual network check from the repository root:

```sh
python3 scripts/check_feeds.py --update-directory
```

This checks the configured feed entries through the production gateway, writes `docs/feed-validation.json`, and updates the directory's verification metadata **only when every feed passes**. The script rejects HTML, malformed/empty XML, DOCTYPE/entities and feeds over the reader's 2 MB limit. `--direct` can diagnose a publisher separately, but a direct-only success is not sufficient to recommend it in the gateway-based reader. Do not replace a healthy public entry with a failed candidate just to raise the count. The report contains metadata, not downloaded article bodies.

The list, search results, folder options and counts derive from the actual directory, not the initial number of entries. Tests add a recommendation beyond the shipped list and check topic-pack deduplication. Existing visitor JSON exports retain their own source URLs, items and captured dates when recommendations change. No migration or forced subscription occurs.

Browser workspace/retention logic is in `web/model.mjs`, XML parsing in `web/xml.mjs`, directory validation/search in `web/directory.mjs`, and UI in `web/app.mjs`. Update tests and documentation when changing formats or identity rules. Saved workspace schemas must remain readable or receive an explicit migration.

After checking sources, run the tests/build below, commit the directory, verification report, code and guide, then push to `main`. This manual maintenance command is **not** a scheduled collector. No new API key, recurring workflow or watchdog schedule is needed. The shared gateway remains maintained separately in the hub; ordinary directory edits require no gateway deployment.

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

The builder versions local scripts, module imports, directory/configuration JSON and CSS with one deterministic content hash, so a normal refresh loads a consistent release even when a browser retains older assets. Source files remain readable and unversioned; the build adds versioned references in `dist/`.

Pure-model tests cover directory expansion, topic/search filtering and pack deduplication, malicious URL rejection, canonical dedupe, dates, arbitrary added sources, refresh state, retention and exports. Browser tests exercise first-load recommendations, individual/topic subscriptions without background requests, actual RSS/Atom/OPML DOM parsing, namespaces and relative links, local-only imports, the gateway envelope, quota failure retention, read/save/filter actions, JSON/OPML downloads and mobile overflow. Gateway calls in CI are deterministic fixtures; deployment still requires a real public gateway smoke check.

GitHub Actions uses Ubuntu 24.04 and Google Chrome, checks PRs, saves screenshots and a preview, then publishes successful `main` builds. Set **Settings → Pages → Source → GitHub Actions**. Only `dist/` is deployed; do not commit it or add a CNAME. App assets remain relative for `/feedharbour/`.

Follow the [CoolCode lifecycle](https://github.com/jsdyer/jsdyer.github.io/blob/main/docs/tool-lifecycle.md): import `tool.json` and this marked guide in the hub, regenerate homepage/README, Worker registration and sitemap, reconcile repository coverage and ordinary live-page probes, and verify gateway behaviour. This app has **no collector/freshness watchdog schedule**. Its public-page and shared gateway probes are integration concerns, not additional cron jobs in this repo.

## Primary references and optional starters

- [RSS specification](https://www.rssboard.org/rss-specification)
- [Atom RFC 4287](https://www.rfc-editor.org/rfc/rfc4287)
- [OPML 2.0](https://2005.opml.org/spec2.html)
- [NASA's official feed directory](https://www.nasa.gov/rss-feeds/)
- [Government of Canada RSS subscription directory](https://www.canada.ca/en/news/subscribe-emails.html)

Reviewed 2026-11-25. These are format/source references, not a snapshot date for visitor-selected feeds. Publisher and retrieval dates are displayed separately in Manage feeds.
