# B2B Lead Scraper - Online Deploy Version

This is the online deploy version of the free B2B lead scraper.

## Features

- No Google Places API key required
- No Gemini API key required
- No npm dependencies
- Runs as a Node.js web service
- Suitable for Render/Railway/other Node.js hosting

## Local run

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

## Deploy to Render

1. Create a GitHub repository.
2. Upload these files to the repository:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `README.md`
3. Open Render.
4. Create a new Web Service from the GitHub repository.
5. Use:
   - Runtime: Node
   - Build Command: empty
   - Start Command: `npm start`
6. Deploy.

The service will use the `PORT` environment variable supplied by Render.

## Compliance

Use this only to collect public business contact information from publicly accessible websites. Keep request limits small, do not bypass login pages, CAPTCHAs, paywalls, or anti-bot protections, and honor opt-out requests.
