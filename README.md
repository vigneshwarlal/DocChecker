# Document Semantic Consistency Checker
Python-backed extraction and ML analysis for uploaded certificates.

## What changed
- Upload extraction now runs through a Python backend (`/api/extract`).
- A text classifier is trained from `data/certificate_training_data.csv`.
- Analysis runs in Python (`/api/analyze`) and sends verdict + flags to the same UI.
- Existing UI layout is unchanged.

## Run locally
1) Install dependencies:
```bash
python -m pip install -r requirements.txt
```
2) Start the app:
```bash
python server.py
```
3) Open:
```bash
http://127.0.0.1:8080
```

## Backend pipeline
- File text extraction from `.txt`, `.pdf`, and image uploads.
- Regex-based field extraction for name, DOB, parents, income, address, caste, school, class, passing year, and issue date.
- ML model training/testing using scikit-learn (TF-IDF + Logistic Regression).
- Cross-document semantic consistency checks with scoring and anomaly flags.

## API endpoints
- `GET /api/health` — backend + model status.
- `POST /api/extract` — upload one file, return extracted text/fields/model prediction.
- `POST /api/analyze` — submit documents array, return final report used by UI.
- `POST /api/train` — force retraining from dataset.

## Notes
- Image OCR requires local `pytesseract` support on the machine.
- If backend is unavailable, frontend falls back to browser-side extraction/analysis.
