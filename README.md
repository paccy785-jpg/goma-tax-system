# Goma Revenue Portal (DPRNK)

Tax administration web application — **patente** (business license tax),
property tax (impôt foncier), rental income tax (impôt locatif), cash
reconciliation, treasury deposits, certificates, and audits.

- React 19 + TypeScript + Vite 6
- TailwindCSS 4 (single `@theme` colour system)
- Firebase 12 (Firestore + Auth) with offline persistence
- Firebase security rules enforce the maker-checker approval flow on the server

## Prerequisites

- Node.js 20+
- Firebase project with Firestore and Authentication enabled

## Development

```bash
npm install
npm run dev
```

`vite` starts the dev server at `http://localhost:3000`.

## Firestore setup

```bash
firebase login
firebase init firestore
firebase deploy --only firestore:rules,firestore:indexes
```

Copy `firebase-applet-config.json` into your Firebase project console as the
web app's configuration and set `firestoreDatabaseId` to match your database.

## Production

```bash
npm run build
firebase hosting:deploy        # if Firebase Hosting is configured
# or
npx vite preview
```

## Architecture notes

- Every fiscal write that mints a record derives its document id from the
  record's own business fields, so duplicated requests (double-clicks, offline
  retries, two tabs) land on the same document instead of creating duplicates.
- Auditing is append-only: entries cannot be modified or deleted in the rules.
- Payment receipt numbers advance monotonically from a Firestore counter;
  `runTransaction` is required for every payment, void, and treasury deposit.
- The 15% locatif rate is pinned in code **and** in the rules; changing the
  constant will silently break saving — the two live in the same file.

## License

Proprietary — City of Goma Revenue Command.
