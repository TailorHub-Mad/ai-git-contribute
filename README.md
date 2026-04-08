## AI Impact Dashboard

This project is a Next.js + Tailwind dashboard to track team GitHub contribution trends and correlate them with AI tool launch markers.

### Features
- Track GitHub users in a local JSON file on your machine.
- Build team daily mean contribution series.
- Show 7-day moving average.
- Overlay built-in AI milestone reference lines on the chart.
- Refresh contribution data on-demand with no server or browser cache layer.

### GitHub token
Users can paste their own GitHub personal access token directly into the dashboard UI.

If you also want a server-side fallback, create a `.env.local` file:

```bash
GITHUB_TOKEN=your_github_personal_access_token
```

The token must be allowed to query the GitHub GraphQL API.

### Run

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
