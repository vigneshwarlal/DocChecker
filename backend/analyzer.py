from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from .extractor import extract_all_fields
from .model_service import ModelService


def _normalize(value: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() else " " for ch in (value or "")).split())


def _levenshtein(a: str, b: str) -> int:
    a, b = _normalize(a), _normalize(b)
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost))
        previous = current
    return previous[-1]


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    a_norm, b_norm = _normalize(a), _normalize(b)
    if a_norm == b_norm:
        return 1.0

    max_len = max(len(a_norm), len(b_norm))
    if max_len == 0:
        return 1.0

    char_sim = 1.0 - (_levenshtein(a_norm, b_norm) / max_len)
    tokens_a = set(a_norm.split())
    tokens_b = set(b_norm.split())
    token_union = tokens_a | tokens_b
    token_intersection = tokens_a & tokens_b
    token_sim = (len(token_intersection) / len(token_union)) if token_union else 0.0
    return max(char_sim, token_sim)


def _parse_year(value: str) -> int | None:
    if not value:
        return None
    for token in value.replace("/", " ").replace("-", " ").replace(".", " ").split():
        if token.isdigit() and len(token) == 4:
            year = int(token)
            if 1900 <= year <= 2100:
                return year
    return None


def _normalized_date(value: str) -> str | None:
    if not value:
        return None
    parts = value.replace("-", "/").replace(".", "/").split("/")
    if len(parts) < 3:
        return value.strip().lower()

    try:
        day = int(parts[0])
        month = int(parts[1])
        year = int(parts[2]) if len(parts[2]) == 4 else 2000 + int(parts[2])
    except ValueError:
        return value.strip().lower()
    return f"{day:02d}/{month:02d}/{year}"


def _flag(result: Dict[str, Any], severity: str, category: str, title: str, description: str) -> None:
    result["flags"].append(
        {
            "severity": severity,
            "category": category,
            "title": title,
            "description": description,
        }
    )


def _compare_field(
    docs: List[Dict[str, Any]],
    result: Dict[str, Any],
    field_key: str,
    field_label: str,
    threshold: float,
) -> None:
    docs_with_values = [doc for doc in docs if doc["fields"].get(field_key)]
    if len(docs_with_values) < 2:
        return

    for idx in range(len(docs_with_values) - 1):
        left = docs_with_values[idx]
        right = docs_with_values[idx + 1]
        left_value = str(left["fields"][field_key])
        right_value = str(right["fields"][field_key])
        score = round(_similarity(left_value, right_value), 2)
        is_match = score >= threshold

        result["field_comparisons"].append(
            {
                "field": field_label,
                "values": {
                    left["title"]: left_value,
                    right["title"]: right_value,
                },
                "match": is_match,
                "similarity_score": score,
            }
        )

        if is_match:
            _flag(
                result,
                "ok",
                "Semantic Similarity",
                f"{field_label} consistent ({int(score * 100)}% match)",
                f"{left['title']} and {right['title']} have semantically matching {field_label.lower()} values.",
            )
            continue

        critical = field_key == "dob" or (field_key == "name" and score < 0.6)
        _flag(
            result,
            "critical" if critical else "warning",
            f"{field_label} Mismatch",
            f"{field_label} mismatch between {left['title']} and {right['title']}",
            f"Detected difference in {field_label.lower()} values ({left_value} vs {right_value}) with {int(score * 100)}% similarity.",
        )


def _check_age_grade(docs: List[Dict[str, Any]], result: Dict[str, Any]) -> None:
    dob_year = None
    standard = None
    for doc in docs:
        if dob_year is None and doc["fields"].get("dob"):
            dob_year = _parse_year(str(doc["fields"]["dob"]))
        if standard is None and doc["fields"].get("standard"):
            standard = str(doc["fields"]["standard"]).lower()
    if dob_year is None or not standard:
        return

    current_year = datetime.utcnow().year
    age = current_year - dob_year
    ranges = {
        "12": (16, 20),
        "xii": (16, 20),
        "11": (15, 19),
        "xi": (15, 19),
        "10": (14, 18),
        "x": (14, 18),
        "9": (13, 17),
        "ix": (13, 17),
    }

    expected = None
    for key, value in ranges.items():
        if key in standard:
            expected = value
            break

    if expected is None:
        return

    if expected[0] <= age <= expected[1]:
        _flag(
            result,
            "ok",
            "Age-Grade Consistency",
            f"Age and class look consistent ({age} years)",
            f"Age estimate falls in the expected range ({expected[0]}–{expected[1]} years).",
        )
    else:
        _flag(
            result,
            "critical",
            "Age-Grade Inconsistency",
            f"Age-class mismatch detected ({age} years)",
            f"Extracted DOB implies {age} years, outside expected {expected[0]}–{expected[1]} years for the stated class.",
        )


def _check_income_plausibility(docs: List[Dict[str, Any]], result: Dict[str, Any]) -> None:
    income_doc = next((doc for doc in docs if doc["fields"].get("_incomeNum")), None)
    if not income_doc:
        return

    income = int(income_doc["fields"]["_incomeNum"])
    text = (income_doc.get("content") or "").lower()
    conflict_terms = [
        "vehicle",
        "car",
        "registered vehicle",
        "bungalow",
        "villa",
        "factory",
        "commercial",
        "3 bedroom",
        "three bedroom",
    ]
    found = [term for term in conflict_terms if term in text]

    if income < 150000 and found:
        _flag(
            result,
            "critical",
            "Income Inconsistency",
            "Income declaration conflicts with asset indicators",
            f"Declared income ₹{income:,} conflicts with extracted asset-related terms: {', '.join(found)}.",
        )
    elif income >= 500000:
        _flag(
            result,
            "warning",
            "Income Review",
            "Higher income declaration detected",
            f"Declared annual income ₹{income:,} may affect quota or scholarship eligibility.",
        )
    else:
        _flag(
            result,
            "ok",
            "Income Plausibility",
            "Income declaration appears internally consistent",
            f"Declared annual income ₹{income:,} does not show obvious internal conflict.",
        )


def _check_date_anomalies(docs: List[Dict[str, Any]], result: Dict[str, Any]) -> None:
    birth_year = None
    for doc in docs:
        dob = doc["fields"].get("dob")
        if dob:
            birth_year = _parse_year(str(dob))
            if birth_year:
                break

    current_year = datetime.utcnow().year
    for doc in docs:
        cert_date = doc["fields"].get("certDate")
        cert_year = _parse_year(str(cert_date)) if cert_date else None
        if not cert_year:
            continue

        if birth_year and cert_year < birth_year:
            _flag(
                result,
                "critical",
                "Date Anomaly",
                f"Certificate year {cert_year} predates birth year {birth_year}",
                f"{doc['title']} has an issue year earlier than extracted birth year, which is not plausible.",
            )
        elif cert_year > current_year:
            _flag(
                result,
                "warning",
                "Date Anomaly",
                f"Future-dated certificate year ({cert_year})",
                f"{doc['title']} appears to have a future issue year and should be reviewed.",
            )


def _check_model_predictions(docs: List[Dict[str, Any]], result: Dict[str, Any]) -> None:
    for doc in docs:
        prediction = doc.get("prediction") or {}
        label = prediction.get("label", "unknown")
        confidence = float(prediction.get("confidence", 0.0))

        if label == "unrelated_document":
            _flag(
                result,
                "critical",
                "Document Type Classification",
                f"{doc['title']} does not look like a certificate",
                f"Trained model predicted '{label}' with {round(confidence * 100)}% confidence.",
            )
        elif confidence < 0.35:
            _flag(
                result,
                "warning",
                "Model Confidence",
                f"Low model confidence for {doc['title']}",
                f"Document type confidence is only {round(confidence * 100)}%, suggesting poor text quality or OCR noise.",
            )
        else:
            _flag(
                result,
                "ok",
                "Model Confidence",
                f"Model identified {doc['title']} as {label}",
                f"Document classifier confidence: {round(confidence * 100)}%.",
            )


def analyze_documents(documents: List[Dict[str, Any]], model_service: ModelService) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "extracted_fields": {},
        "field_comparisons": [],
        "flags": [],
        "summary": {
            "critical_count": 0,
            "warning_count": 0,
            "ok_count": 0,
            "info_count": 0,
        },
        "model_test": model_service.summary(),
    }

    processed_docs: List[Dict[str, Any]] = []
    for idx, doc in enumerate(documents, start=1):
        title = (doc.get("title") or f"Document {idx}").strip()
        content = (doc.get("content") or "").strip()
        if not content:
            continue

        fields = doc.get("fields")
        if not isinstance(fields, dict) or not fields:
            fields = extract_all_fields(content)

        prediction = model_service.predict(content)
        fields["_predictedDocType"] = prediction["label"]
        fields["_predictionConfidence"] = prediction["confidence"]
        result["extracted_fields"][title] = fields

        processed_docs.append(
            {
                "title": title,
                "content": content,
                "fields": fields,
                "prediction": prediction,
            }
        )

    if len(processed_docs) < 2:
        _flag(
            result,
            "critical",
            "Input Validation",
            "Insufficient valid documents",
            "At least two documents with extractable text are required for cross-document checks.",
        )
    else:
        _compare_field(processed_docs, result, "name", "Student Name", threshold=0.82)
        _compare_field(processed_docs, result, "dob", "Date of Birth", threshold=0.9)
        _compare_field(processed_docs, result, "father", "Father's Name", threshold=0.82)
        _compare_field(processed_docs, result, "mother", "Mother's Name", threshold=0.82)
        _compare_field(processed_docs, result, "address", "Address", threshold=0.75)
        _check_age_grade(processed_docs, result)
        _check_income_plausibility(processed_docs, result)
        _check_date_anomalies(processed_docs, result)
        _check_model_predictions(processed_docs, result)

    for item in result["flags"]:
        severity = item.get("severity")
        if severity == "critical":
            result["summary"]["critical_count"] += 1
        elif severity == "warning":
            result["summary"]["warning_count"] += 1
        elif severity == "ok":
            result["summary"]["ok_count"] += 1
        else:
            result["summary"]["info_count"] += 1

    critical_count = result["summary"]["critical_count"]
    warning_count = result["summary"]["warning_count"]
    if critical_count >= 2:
        result["summary"]["verdict"] = "REJECT"
        result["summary"]["verdict_reason"] = f"{critical_count} critical inconsistencies detected."
    elif critical_count == 1 or warning_count >= 2:
        result["summary"]["verdict"] = "NEEDS_REVIEW"
        result["summary"]["verdict_reason"] = "Potential discrepancies detected; manual verification is recommended."
    else:
        result["summary"]["verdict"] = "PASS"
        result["summary"]["verdict_reason"] = "Documents look semantically consistent based on extracted fields and model checks."

    return result

