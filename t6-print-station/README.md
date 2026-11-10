# T6 Print Station

Android app for the **T6** payment terminal. It prints, on the T6's built-in
receipt printer, the receipts that the DPRNK web app sends to it
(Agent bancaire → Historique des paiements → Reçu → **Imprimer le reçu**).

How it works:

1. In the web app, *Imprimer le reçu* files a print job in Firestore
   (`printJobs`, status `pending`) addressed to the chosen T6.
2. This app, running on the T6, signs in with a DPRNK officer account,
   reports the T6 as online (`printStations`) and checks for its jobs every
   2.5 seconds.
3. It lays the receipt out for the paper width (58 or 80 mm), prints it as an
   image on the paired Bluetooth printer **VirtualBtPrinter** (ESC/POS), and
   marks the job `printed` — or `failed` with the reason. The web app shows
   that status live.

## Build

The APK is built by GitHub Actions (`ci/build-apk.yml` — in the GitHub repository it lives at `.github/workflows/build-apk.yml`) on every
push to `main`; it is published as the release **latest**
(`T6-Print-Station.apk`). Locally: `gradle assembleDebug` (Gradle 8.7+, JDK 17,
Android SDK 34).

## Set up on the T6

1. Install `T6-Print-Station.apk` (allow installing from this source).
2. Open **T6 Print Station**, allow *Nearby devices* (Bluetooth) and notifications.
3. Sign in with a DPRNK account (an active officer account).
4. Check the printer is **VirtualBtPrinter**, the paper width, and print the test page.
5. Tap **Démarrer la réception des reçus**. Leave *Démarrer automatiquement* on.
