# Transparent Space — Demo showcase (recruiter copy)

This is a **portfolio / recruiter** copy of Transparent Space focused on the **Demo** dashboard and Blueprint design system.

## Live

**Live:** https://transparent-space-demo.vercel.app

Open that URL — it **auto-enters `/demo`** with no email, password, or inbox required.

**GitHub:** https://github.com/mtfonseca1204/transparent-space-demo

## Local

```bash
cp .env.presentation.example .env.local
npm install
npm run dev
```

Open http://localhost:3000 — you land on the Demo dashboard automatically.

## Design system slides

Static presentation HTML (also deployed separately if needed):

- `docs/design-system-presentation.html`

## Notes

- Demo data is **synthetic fixtures** (`lib/demo/*`), not live chain data.
- `PRESENTATION_DEMO_AUTH=true` enables no-login Demo entry. Do **not** turn this on for the main production Transparent Space project.
- Crons are disabled in this copy (`vercel.json`) so it can run on Vercel Hobby.
