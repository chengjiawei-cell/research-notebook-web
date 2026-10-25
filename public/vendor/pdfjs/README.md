# Mozilla PDF.js 6.4.299

Vendored from the official `pdfjs-dist@6.4.299` npm distribution: https://www.npmjs.com/package/pdfjs-dist/v/6.4.299

- `pdf.min.mjs` and `pdf.worker.min.mjs`: legacy browser build for broader compatibility.
- `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`: rendering resources from the same release; original font and codec licenses are retained.
- `text_layer.css`: the text layer block from the official `web/pdf_viewer.css`.

PDF.js is licensed under Apache-2.0; see `LICENSE`. The reader does not load the full viewer application, scripting manager or annotation editor.
