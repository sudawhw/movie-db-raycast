# Movie db

[中文文档](README.zh-CN.md)

A Raycast extension for searching movies and TV shows, viewing Douban, IMDb and Rotten Tomatoes ratings, and browsing public cloud-share links posted in selected Telegram channels. Metadata and artwork can be enriched using TMDB.

## Requirements

- macOS, Raycast, and Node.js 22.22.2 or newer.
- Internet access to the services you use. All API keys are optional, but ratings and metadata are limited without them.

## Install locally

1. Download or clone this repository and open its directory in Terminal.
2. Run `npm install`, then `npm run dev`. Raycast imports the development extension.
3. Open Raycast and run **Search Movies and TV**. Open **Extension Settings** to configure your keys and language.
4. In Raycast settings, assign a hotkey or alias to the command if desired.

## API keys

Add each key in Raycast's extension settings; never commit keys to a repository.

- **TMDB:** Create a [TMDB account](https://www.themoviedb.org/signup), open [Settings → API](https://www.themoviedb.org/settings/api), apply for developer access and copy either the API Key or API Read Access Token. Supplies posters, descriptions and credits. Chinese metadata depends on availability.
- **OMDb:** Open the [OMDb API key form](https://www.omdbapi.com/apikey.aspx), choose the desired plan, complete the form, and follow the email activation instructions. Enter the key in **OMDb API Key**. Supplies IMDb and Rotten Tomatoes ratings when available.
- **ApiZero:** Register or sign in at [ApiZero](https://apizero.cn/), create an API key in the account console, and check the [Douban Movie API](https://apizero.cn/aidocs/douban-movie) quota. Enter it in **ApiZero API Key**. Free and membership limits may change; consult the provider.

Keys are stored in Raycast password preferences. No key is needed for the public Telegram channel search. Setting **Language / 语言** changes interface labels; source titles, descriptions and channel posts remain in their original language.

## How to use

1. Search a Chinese or English movie or series title. Select a Douban result and press Return.
2. View the poster, ratings, synopsis and credits. Press Return to search cloud shares, or `⌘K` for source links, refresh and settings.
3. Search selected public Telegram channels. Exact title matches appear by default; use the filter to show all results. Shares are grouped by 115, Baidu and Quark. Open a result or inspect its original Telegram message.
4. Publicly verifiable expired shares are hidden by default. Unverifiable shares are retained. Bot claim links open in Telegram; the extension does not sign in or send bot messages.
5. Edit **Telegram Search Channels** in settings to add or remove comma-separated usernames or `t.me` URLs. Clearing the field restores the defaults.

## Data, limitations and privacy

Douban's search endpoint is the entry point and may be restricted. Metadata availability, language and matching depend on providers. Strict matching can miss alternate names or seasons; a Douban season may not correspond to an IMDb/TMDB series. Some results require login, an access code or a Telegram bot. Public-channel searches cover only the returned page of results. Share availability may change; a successful check is not a guarantee of downloadability.

Search terms go to Douban and configured Telegram channels. Selected title IDs and/or titles go to ApiZero, Wikidata/Wikipedia, OMDb and TMDB as applicable. Share checks send the public share identifier and any supplied access code to the relevant cloud provider. See [the Chinese guide](README.zh-CN.md) for details.

## Development

Run `npm test`, `npm run build`, and `npx tsc --noEmit`. Tests use mocked responses and do not require API keys.

## License and attribution

Source code is licensed under the [MIT License](LICENSE). Third-party services, metadata, artwork, trademarks and shared content remain subject to their respective owners' terms; MIT applies to this repository's code, not third-party data.

This product uses the TMDB API but is not endorsed or certified by TMDB. TMDB logo and branding are owned by TMDB.
