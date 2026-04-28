# Document Semantic Consistency Checker
### 100% Local — No API Key Required

This application runs entirely in your browser. No data is sent to any server.
No API key, no account, no internet connection needed after the page loads.

---

## How to Run

**Option A — Just open the file (simplest):**
Double-click `index.html` in your file manager or drag it into any browser.

**Option B — Local server (recommended for production use):**
```bash
cd doc-checker
python3 -m http.server 8080
# Open http://localhost:8080
```

That's it. No installation, no npm, no build step.

---

## How It Works (No API Key Needed)

The NLP engine (`js/nlp.js`) runs 100% in the browser using:

| Technique | What it does |
|---|---|
| **Regex entity extraction** | Pulls name, DOB, father name, mother name, income, address, caste, school, standard, certificate dates from document text |
| **Levenshtein distance** | Measures character-level edit distance between field values |
| **Token-set (Jaccard) similarity** | Handles reordered names like "RAMESH KUMAR" vs "KUMAR RAMESH" |
| **Age-grade logic** | Calculates student age from DOB, checks against expected range for stated class |
| **Income plausibility** | Flags low-income declarations that coexist with asset/lifestyle keywords |
| **Date anomaly detection** | Catches certificate dates before birth year, future dates, retroactive issues |

---

## Best Results — Use .txt Files

The app reads document content as text. For best extraction accuracy:

1. **PDFs** — Open in any PDF reader → File → Save as Text (.txt) → Upload the .txt
2. **Images** — Use a free OCR tool like [ocr.space](https://ocr.space) or Google Docs → copy text → save as .txt
3. **Demo** — Click "Load demo scenario" to instantly see a full analysis with 4 pre-built documents

---

## Supported Field Extraction

Automatically detects and extracts:
- Student name
- Date of Birth
- Father's name / Mother's name
- Address / Residential details
- Annual family income
- Community / Caste
- School / Institution name
- Standard / Class
- Year of passing
- Certificate issue date

---

## File Structure

```
doc-checker/
├── index.html          ← App shell
├── css/
│   └── style.css       ← Full styles (auto dark mode)
├── js/
│   ├── nlp.js          ← Entire NLP engine (Levenshtein, entity extraction, fraud checks)
│   ├── demo-data.js    ← Pre-built 4-document demo scenario
│   └── app.js          ← UI controller
└── README.md
```

---

## Privacy

All processing happens locally in your browser.
No documents, no extracted fields, no results are ever sent anywhere.

---

## Fraud Detection Checks

| Check | Trigger |
|---|---|
| Name mismatch | Similarity < 82% across documents |
| DOB mismatch | Any difference in DOB across documents |
| Age-grade inconsistency | Student age outside expected range for stated class |
| Income vs assets | Low income + vehicle/property ownership keywords |
| Certificate date anomaly | Issue date before birth year, or future-dated certificate |
| Father's name mismatch | Similarity < 82% (catches spelling variants like KRISHNAMURTHY vs KRISHNAMURTY) |
