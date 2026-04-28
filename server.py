from __future__ import annotations

from pathlib import Path
from time import perf_counter
from typing import Any, Dict, List

from flask import Flask, jsonify, request, send_from_directory

from backend.analyzer import analyze_documents, refine_model_prediction
from backend.extractor import extract_all_fields, extract_text_from_upload, ocr_available
from backend.model_service import ModelService

ROOT_DIR = Path(__file__).resolve().parent
DATASET_PATH = ROOT_DIR / "data" / "certificate_training_data.csv"

model_service = ModelService(DATASET_PATH)
model_service.train(force=False)

app = Flask(__name__, static_folder=str(ROOT_DIR), static_url_path="")


@app.route("/api/health", methods=["GET"])
def api_health() -> Any:
    return jsonify(
        {
            "status": "ok",
            "model": model_service.summary(),
            "ocr_available": ocr_available(),
        }
    )


@app.route("/api/train", methods=["POST"])
def api_train() -> Any:
    summary = model_service.train(force=True)
    return jsonify({"status": "trained", "model": summary})


@app.route("/api/extract", methods=["POST"])
def api_extract() -> Any:
    uploaded_file = request.files.get("file")
    if uploaded_file is None:
        return jsonify({"error": "Missing file in form-data under 'file' key."}), 400

    payload = uploaded_file.read()
    if not payload:
        return jsonify({"error": "Uploaded file is empty."}), 400

    started_at = perf_counter()
    extracted = extract_text_from_upload(
        filename=uploaded_file.filename or "uploaded_document",
        content=payload,
        mime_type=uploaded_file.mimetype or "",
    )
    model_prediction = model_service.predict(extracted.text)
    model_prediction = refine_model_prediction(
        title=extracted.filename,
        content=extracted.text,
        fields=extracted.fields,
        prediction=model_prediction,
    )
    elapsed_ms = int((perf_counter() - started_at) * 1000)

    return jsonify(
        {
            "name": extracted.filename,
            "text": extracted.text,
            "fields": extracted.fields,
            "model_prediction": model_prediction,
            "processing": {
                "method": extracted.method,
                "warnings": extracted.warnings,
                "elapsed_ms": elapsed_ms,
            },
            "model_test": model_service.summary(),
        }
    )


@app.route("/api/analyze", methods=["POST"])
def api_analyze() -> Any:
    body = request.get_json(silent=True) or {}
    raw_documents = body.get("documents") or []
    if not isinstance(raw_documents, list) or len(raw_documents) < 2:
        return jsonify({"error": "Provide at least two documents in 'documents' array."}), 400

    documents: List[Dict[str, Any]] = []
    for idx, raw in enumerate(raw_documents, start=1):
        if not isinstance(raw, dict):
            continue
        title = (raw.get("title") or raw.get("name") or f"Document {idx}").strip()
        content = (raw.get("content") or "").strip()
        if not content:
            continue
        fields = raw.get("fields")
        if not isinstance(fields, dict) or not fields:
            fields = extract_all_fields(content)
        documents.append({"title": title, "content": content, "fields": fields})

    if len(documents) < 2:
        return jsonify({"error": "Not enough valid documents with extractable text."}), 400

    result = analyze_documents(documents, model_service=model_service)
    return jsonify(result)


@app.route("/", methods=["GET"])
def index() -> Any:
    return send_from_directory(ROOT_DIR, "index.html")


@app.route("/<path:asset_path>", methods=["GET"])
def static_assets(asset_path: str) -> Any:
    if asset_path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404

    requested = ROOT_DIR / asset_path
    if requested.exists() and requested.is_file():
        return send_from_directory(ROOT_DIR, asset_path)
    return send_from_directory(ROOT_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, debug=False)

