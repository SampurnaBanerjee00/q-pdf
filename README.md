# Q PDF

A free, client-side PDF toolkit that runs entirely in your browser. No files are uploaded to any server — all processing happens locally using [pdf-lib](https://pdf-lib.js.org/) and [pdf.js](https://mozilla.github.io/pdf.js/).

## Features

### Merge PDF
Combine multiple PDF files into a single document. Drag to reorder files before merging.

### Image to PDF
Convert PNG and JPG images into a PDF document with two layout modes:
- **One per page** — each image fills a full page with configurable fit, position, and margin
- **Grid / Passport** — arrange 1–36 images per page with presets (1, 2, 4, 6, 8, 9, 12, 16, 20, 24, 36). A single image repeats across all slots (passport style). Adjustable spacing between cells.

### Split PDF
Extract or split pages from a PDF with three modes:
- **Extract Pages** — click to select specific pages
- **Page Range** — extract a contiguous range (e.g., pages 3–7)
- **Split Every N** — split the PDF into multiple files, each containing N pages

### Rotate PDF
Rotate pages by 90°, 180°, or 270°. Apply to all pages, odd pages only, or even pages only.

### Resize PDF
Change page size (A4, A3, A5, Letter, Legal, Tabloid, Executive, B4, B5) with orientation toggle (Portrait / Landscape) and content scaling (50%–200%).

### Reorder Pages
Drag and drop page thumbnails to reorder pages. Thumbnails are generated using pdf.js.

## Watermark & Security

- **Free download** — includes a "Made by Q PDF" logo watermark in the bottom-left corner of every page
- **No watermark** — enter the security key to download a clean PDF without the watermark

## Setup

No build step required. Open `index.html` directly in your browser or serve the files with any static server.

```
# Option 1: Open directly
open index.html

# Option 2: Use a local server
npx serve .
# or
python -m http.server 8000
```

## File Structure

```
q-pdf/
├── index.html      # App structure, icons, modals
├── styles.css      # Styling, variables, responsive layout
├── script.js       # Core logic, state management, PDF processing
├── logo.png        # App logo (used in header and watermark)
├── favicon.png     # Browser tab icon
└── README.md       # This file
```

## Dependencies

Loaded via CDN (no npm install needed):
- **pdf-lib** v1.17.1 — PDF creation and manipulation
- **pdf.js** v3.11.174 — PDF rendering for thumbnails and previews

## Browser Support

Works in all modern browsers:
- Google Chrome
- Mozilla Firefox
- Microsoft Edge
- Apple Safari

## Privacy

All processing happens locally in your browser. No files are uploaded to any server. Your documents never leave your device.

## License

Free to use. Built with Q PDF.
