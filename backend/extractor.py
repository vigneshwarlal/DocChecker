from __future__ import annotations

import os
import re
import shutil
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional dependency during import
    PdfReader = None

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional dependency during import
    Image = None

try:
    import pytesseract
except Exception:  # pragma: no cover - optional dependency during import
    pytesseract = None


@dataclass
class ExtractedDocument:
    filename: str
    text: str
    method: str
    warnings: List[str] = field(default_factory=list)
    fields: Dict[str, Any] = field(default_factory=dict)


FIELD_PATTERNS: Dict[str, List[re.Pattern[str]]] = {
    "name": [
        re.compile(r"(?:student\s*name|name of (?:the )?student|candidate name|name)\s*[:\-]\s*([^\n]{2,80})", re.IGNORECASE),
        re.compile(r"(?:^|\n)\s*name\s*[:\-]\s*([^\n]{2,80})", re.IGNORECASE),
        re.compile(r"(?:name of the candidate)\s+([A-Z][A-Za-z\s\.\-]{2,80})", re.IGNORECASE),
        re.compile(r"(?:this is to certify that)\s+([A-Z][A-Za-z\s\.\-]{2,80})", re.IGNORECASE),
    ],
    "dob": [
        re.compile(r"(?:date of birth|d\.?\s*o\.?\s*b\.?|born on|birth date)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})", re.IGNORECASE),
        re.compile(r"(?:date of birth|d\.?\s*o\.?\s*b\.?)\s*[:\-]?\s*(\d{1,2}\s+[a-zA-Z]{3,12}\s+\d{4})", re.IGNORECASE),
    ],
    "father": [
        re.compile(r"(?:father(?:'s)? name|name of (?:the )?father|s\/o|son of|father)\s*[:\-]\s*([^\n]{2,80})", re.IGNORECASE),
    ],
    "mother": [
        re.compile(r"(?:mother(?:'s)? name|name of (?:the )?mother|d\/o|daughter of|mother)\s*[:\-]\s*([^\n]{2,80})", re.IGNORECASE),
    ],
    "income": [
        re.compile(r"(?:annual|family|yearly|total)?\s*income[^\n]{0,30}?(?:rs\.?|inr|₹)?\s*([\d,]{3,15})", re.IGNORECASE),
        re.compile(r"(?:rs\.?|inr|₹)\s*([\d,]{3,15})\s*(?:\/\-|only|per annum|pa|per year)?", re.IGNORECASE),
    ],
    "address": [
        re.compile(r"(?:address|resident of|residing at|permanent address)\s*[:\-]\s*([^\n]{8,180})", re.IGNORECASE),
    ],
    "caste": [
        re.compile(r"(?:community|caste|sub.?caste|belongs to)\s*[:\-]\s*([^\n]{2,80})", re.IGNORECASE),
    ],
    "school": [
        re.compile(r"(?:school|institution|college|school name)\s*[:\-]\s*([^\n]{4,120})", re.IGNORECASE),
        re.compile(r"(?:schoolname)\s*[:\-]?\s*([^\n]{4,120})", re.IGNORECASE),
        re.compile(r"(?:^|\n)\s*school\s+(?!examinations\b)(?!board\b)([A-Z0-9][A-Za-z0-9\s\.\,\-\(\)]{4,120})", re.IGNORECASE),
    ],
    "board": [
        re.compile(r"((?:state|central)\s+board\s+of\s+[a-z\s]{2,40})", re.IGNORECASE),
        re.compile(r"((?:cbse|icse|isc|tn\s*state\s*board|state board)\b[^\n]{0,20})", re.IGNORECASE),
    ],
    "standard": [
        re.compile(r"(?:standard|class|std|grade)\s*[:\-]?\s*([A-Za-z0-9\(\)\-\s]{1,24})", re.IGNORECASE),
        re.compile(r"(\d+(?:st|nd|rd|th)|xii|xi|x|ix|viii)\s+(?:standard|class|std)", re.IGNORECASE),
    ],
    "yearPassing": [
        re.compile(r"(?:year of passing|passed|examination year|month\/year)\s*[:\-]?\s*((?:19|20)\d{2})", re.IGNORECASE),
    ],
    "certDate": [
        re.compile(r"(?:date of issue|issued on|issue date|certificate date)\s*[:\-]\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[a-zA-Z]{3,12}\s+\d{4})", re.IGNORECASE),
    ],
}


def _normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip(" \t\r\n:;-")


def _normalize_document_text(value: str) -> str:
    raw = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in raw.split("\n"):
        cleaned = re.sub(r"\s+", " ", line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines).strip()


def _extract_name_fallback(text: str) -> Optional[str]:
    if not text:
        return None
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    anchors = ("name of the candidate", "this is to certify that", "candidate name", "name")
    for line in lines:
        lowered = line.lower()
        for anchor in anchors:
            if anchor not in lowered:
                continue
            idx = lowered.find(anchor)
            tail = line[idx + len(anchor):].strip(" :-|_")
            if not tail:
                continue
            # Keep only likely person-name characters and normalize spacing.
            cleaned = re.sub(r"[^A-Za-z\s\.\-]", " ", tail)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            tokens = [token for token in cleaned.split() if token]
            if len(tokens) >= 2:
                return cleaned.upper()
    return None


def _decode_text(content: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1", "cp1252"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="ignore")


def _extract_text_from_pdf(content: bytes, warnings: List[str]) -> str:
    if PdfReader is None:
        warnings.append("PDF text extraction dependency is unavailable. Install pypdf.")
        return ""

    try:
        reader = PdfReader(BytesIO(content))
    except Exception as exc:
        warnings.append(f"Could not parse PDF: {exc}")
        return ""

    chunks: List[str] = []
    for page_idx, page in enumerate(reader.pages, start=1):
        try:
            page_text = (page.extract_text() or "").strip()
        except Exception as exc:
            warnings.append(f"Failed reading page {page_idx}: {exc}")
            continue

        if page_text:
            chunks.append(page_text)
        else:
            warnings.append(f"Page {page_idx} had no machine-readable text.")
    return "\n\n".join(chunks).strip()


def _extract_text_from_image(content: bytes, warnings: List[str]) -> str:
    if Image is None or pytesseract is None:
        warnings.append("Image OCR dependencies are unavailable. Install pillow and pytesseract.")
        return ""

    try:
        _configure_tesseract_cmd()
        image = Image.open(BytesIO(content))
        text = pytesseract.image_to_string(image, lang="eng")
        return (text or "").strip()
    except Exception as exc:
        warnings.append(f"Image OCR failed: {exc}")
        return ""


def _configure_tesseract_cmd() -> None:
    if pytesseract is None:
        return
    configured = getattr(pytesseract.pytesseract, "tesseract_cmd", None)
    if configured and str(configured).strip() and Path(str(configured)).exists():
        return

    from_path = shutil.which("tesseract")
    if from_path:
        pytesseract.pytesseract.tesseract_cmd = from_path
        return

    candidate_paths = [
        Path("C:/Program Files/Tesseract-OCR/tesseract.exe"),
        Path("C:/Program Files (x86)/Tesseract-OCR/tesseract.exe"),
        Path(os.path.expandvars(r"%LOCALAPPDATA%/Programs/Tesseract-OCR/tesseract.exe")),
    ]
    for candidate in candidate_paths:
        if candidate.exists():
            pytesseract.pytesseract.tesseract_cmd = str(candidate)
            return


def _tesseract_engine_available() -> bool:
    if pytesseract is None:
        return False
    try:
        _configure_tesseract_cmd()
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def extract_all_fields(text: str) -> Dict[str, Any]:
    fields: Dict[str, Any] = {}
    if not text:
        return fields

    for key, patterns in FIELD_PATTERNS.items():
        extracted_value: Optional[str] = None
        for pattern in patterns:
            match = pattern.search(text)
            if match and match.group(1):
                extracted_value = _normalize_whitespace(match.group(1))
                extracted_value = re.split(
                    r"\b(date of birth|dob|father(?:'s)? name|mother(?:'s)? name|register number|school(?: name)?|income|community|caste|address|district|examination)\b",
                    extracted_value,
                    maxsplit=1,
                    flags=re.IGNORECASE,
                )[0].strip(" ,:;-")
                if extracted_value:
                    break
        if extracted_value:
            fields[key] = extracted_value

    if "name" not in fields:
        fallback_name = _extract_name_fallback(text)
        if fallback_name:
            fields["name"] = fallback_name

    if "dob" in fields:
        year_match = re.search(r"((?:19|20)\d{2})", fields["dob"])
        if year_match:
            fields["_dobYear"] = int(year_match.group(1))

    if "income" in fields:
        numeric = re.sub(r"[^\d]", "", fields["income"])
        if numeric:
            try:
                fields["_incomeNum"] = int(numeric)
            except ValueError:
                pass

    return fields


def extract_text_from_upload(filename: str, content: bytes, mime_type: str = "") -> ExtractedDocument:
    warnings: List[str] = []
    name = filename or "uploaded_file"
    extension = Path(name).suffix.lower()
    method = "text-decode"

    if extension == ".txt" or mime_type == "text/plain":
        text = _decode_text(content)
        method = "txt"
    elif extension == ".pdf" or mime_type == "application/pdf":
        text = _extract_text_from_pdf(content, warnings)
        method = "pdf"
    elif mime_type.startswith("image/") or extension in {".png", ".jpg", ".jpeg", ".bmp", ".gif", ".webp", ".tif", ".tiff"}:
        text = _extract_text_from_image(content, warnings)
        method = "image-ocr"
    else:
        text = _decode_text(content)
        method = "fallback-decode"
        warnings.append("Unsupported extension treated as plain text.")

    text = _normalize_document_text(text) if text else ""
    if not text:
        text = f"Document: {name}\n[No text could be extracted from this file.]"

    fields = extract_all_fields(text)
    return ExtractedDocument(filename=name, text=text, method=method, warnings=warnings, fields=fields)


def ocr_available() -> bool:
    return Image is not None and _tesseract_engine_available()

