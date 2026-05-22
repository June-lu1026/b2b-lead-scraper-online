# b2b-lead-scraper-online v2

Free online B2B lead scraper.

- No Google Places API key needed
- No Gemini key needed
- Uses only built-in Node.js APIs
- Searches public web results and extracts public emails/phones from company websites
- v2 adds Bing fallback and manual website list mode

## Deploy on Render

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

No environment variables are required.

## If search returns 0

Public search engines may block cloud servers such as Render. Use the manual website list field: paste one website per line, then the app will directly extract emails from those websites.
