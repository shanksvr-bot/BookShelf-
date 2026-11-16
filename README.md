# BookShelf PWA

A first working prototype of the BookShelf iPhone web app.

## Use on iPhone
1. Put these files on a web host that serves HTTPS.
2. Open the site in Safari on your iPhone.
3. Tap Share -> Add to Home Screen.
4. Open BookShelf from the Home Screen.

## What works
- Local book library using browser localStorage
- ISBN-10/ISBN-13 manual lookup
- Camera barcode scanning where Safari/browser BarcodeDetector support is available
- Open Library ISBN lookup
- Cover images
- Owned / Want to Buy / Reading / Read status
- Search and duplicate detection
- Store, price, and notes fields

## Important
The camera and network lookup need HTTPS when deployed. The app stores the library locally in the browser on the device. The first version uses Open Library for book metadata.
