from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from threading import Lock
from time import strftime
from typing import Any, Dict, List, Optional, Tuple

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline


class ModelService:
    def __init__(self, dataset_path: Path) -> None:
        self.dataset_path = dataset_path
        self._lock = Lock()
        self._model: Optional[Pipeline] = None
        self._summary: Dict[str, Any] = {}
        self._last_dataset_mtime: Optional[float] = None

    def _load_dataset(self) -> List[Tuple[str, str]]:
        if not self.dataset_path.exists():
            raise FileNotFoundError(f"Training dataset not found: {self.dataset_path}")

        rows: List[Tuple[str, str]] = []
        with self.dataset_path.open("r", encoding="utf-8", newline="") as csv_file:
            reader = csv.DictReader(csv_file)
            for row in reader:
                text = (row.get("text") or "").strip()
                label = (row.get("label") or "").strip()
                if text and label:
                    rows.append((text, label))

        if len(rows) < 10:
            raise ValueError("Dataset is too small. Add at least 10 labeled rows.")
        return rows

    def _build_pipeline(self) -> Pipeline:
        return Pipeline(
            steps=[
                (
                    "vectorizer",
                    TfidfVectorizer(
                        lowercase=True,
                        ngram_range=(1, 2),
                        min_df=1,
                        max_features=5000,
                    ),
                ),
                (
                    "classifier",
                    LogisticRegression(
                        max_iter=2000,
                        random_state=42,
                    ),
                ),
            ]
        )

    def train(self, force: bool = False) -> Dict[str, Any]:
        with self._lock:
            mtime = self.dataset_path.stat().st_mtime if self.dataset_path.exists() else None
            already_fresh = (
                self._model is not None
                and not force
                and self._last_dataset_mtime is not None
                and mtime == self._last_dataset_mtime
            )
            if already_fresh:
                return self._summary

            dataset = self._load_dataset()
            texts = [text for text, _ in dataset]
            labels = [label for _, label in dataset]
            counts = Counter(labels)

            if len(counts) < 2:
                raise ValueError("At least 2 unique classes are required in the training dataset.")
            if any(count < 2 for count in counts.values()):
                raise ValueError("Each class needs at least 2 rows for train/test split.")

            x_train, x_test, y_train, y_test = train_test_split(
                texts,
                labels,
                test_size=0.25,
                random_state=42,
                stratify=labels,
            )

            eval_model = self._build_pipeline()
            eval_model.fit(x_train, y_train)
            predictions = eval_model.predict(x_test)
            accuracy = float(accuracy_score(y_test, predictions))

            final_model = self._build_pipeline()
            final_model.fit(texts, labels)
            self._model = final_model
            self._last_dataset_mtime = mtime
            self._summary = {
                "trained_at": strftime("%Y-%m-%d %H:%M:%S UTC"),
                "dataset_path": str(self.dataset_path),
                "dataset_rows": len(dataset),
                "train_rows": len(x_train),
                "test_rows": len(x_test),
                "labels": dict(sorted(counts.items())),
                "test_accuracy": round(accuracy, 4),
            }
            return self._summary

    def predict(self, text: str) -> Dict[str, Any]:
        if not text:
            return {"label": "unknown", "confidence": 0.0}

        if self._model is None:
            self.train(force=False)

        assert self._model is not None
        probabilities = self._model.predict_proba([text])[0]
        labels = list(self._model.named_steps["classifier"].classes_)
        best_idx = max(range(len(probabilities)), key=lambda idx: probabilities[idx])
        return {
            "label": labels[best_idx],
            "confidence": round(float(probabilities[best_idx]), 4),
        }

    def summary(self) -> Dict[str, Any]:
        if not self._summary:
            return self.train(force=False)
        return self._summary

