"""Decisión del quality gate: sólo evidencia completa, nunca el booleano de una muestra."""

import math


def probability(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 1


def binary_metrics(labels, probabilities, threshold):
    predictions = [int(value >= threshold) for value in probabilities]
    tp = sum(label == 1 and predicted == 1 for label, predicted in zip(labels, predictions, strict=True))
    tn = sum(label == 0 and predicted == 0 for label, predicted in zip(labels, predictions, strict=True))
    fp = sum(label == 0 and predicted == 1 for label, predicted in zip(labels, predictions, strict=True))
    fn = sum(label == 1 and predicted == 0 for label, predicted in zip(labels, predictions, strict=True))
    return {
        "accuracy": (tp + tn) / len(labels),
        "recall": tp / (tp + fn),
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "confusion_matrix_0_ok_1_defect": [[tn, fp], [fn, tp]],
    }


def evaluate_quality_gate(rows, predictions, threshold, expected_count=195):
    """Política HU25: accuracy >=97%, recall >=95%, <=2 discrepancias y error <=1e-4.

    rows fija los IDs/etiquetas del conjunto dorado; predictions debe cubrirlo exactamente.
    La tolerancia numérica se comprueba aparte del número de cambios de clasificación.
    """
    report = {
        "passed": False,
        "scope": "python_vs_tfjs_cpu_preprocessed_tensors",
        "policy": {
            "expected_count": expected_count,
            "min_accuracy": 0.97,
            "min_defect_recall": 0.95,
            "max_classification_discrepancies": 2,
            "max_probability_difference": 1e-4,
        },
        "sample_count": len(rows),
        "threshold": threshold,
        "golden_rows": rows,
        "predictions": predictions,
        "failures": [],
    }
    failures = report["failures"]
    if not probability(threshold) or threshold in (0, 1):
        failures.append("Umbral inválido.")
    ids = [row["id"] for row in rows]
    prediction_ids = [row["id"] for row in predictions]
    if len(rows) != expected_count or len(set(ids)) != len(rows):
        failures.append("El conjunto dorado no tiene el tamaño esperado o contiene IDs repetidos.")
    if {row["label"] for row in rows} != {0, 1}:
        failures.append("El conjunto dorado debe contener ambas clases con etiquetas 0 y 1.")
    if len(predictions) != len(rows) or len(set(prediction_ids)) != len(predictions) or set(ids) != set(prediction_ids):
        failures.append("Predicciones ausentes, repetidas o ajenas al conjunto dorado.")
    if any(not probability(row.get(key)) for row in predictions for key in ("python", "tfjs")):
        failures.append("Probabilidad ausente, no finita o fuera de [0,1].")
    if failures:
        return report
    indexed = {row["id"]: row for row in predictions}
    labels = [row["label"] for row in rows]
    python_values = [indexed[key]["python"] for key in ids]
    js_values = [indexed[key]["tfjs"] for key in ids]
    differences = [abs(a - b) for a, b in zip(python_values, js_values, strict=True)]
    mismatches = [key for key in ids if (indexed[key]["python"] >= threshold) != (indexed[key]["tfjs"] >= threshold)]
    report.update(
        python=binary_metrics(labels, python_values, threshold),
        tensorflowjs=binary_metrics(labels, js_values, threshold),
        max_absolute_difference=max(differences),
        mean_absolute_difference=sum(differences) / len(differences),
        classification_discrepancies=len(mismatches),
        discrepancy_ids=mismatches,
    )
    for backend in ("python", "tensorflowjs"):
        if report[backend]["accuracy"] < 0.97:
            failures.append(f"{backend}: accuracy inferior a 97%.")
        if report[backend]["recall"] < 0.95:
            failures.append(f"{backend}: recall de defectos inferior a 95%.")
    if len(mismatches) > 2:
        failures.append("Más de 2 discrepancias de clasificación.")
    if max(differences) > 1e-4:
        failures.append("Diferencia numérica superior a 1e-4.")
    report["passed"] = not failures
    return report


def require_quality_gate(report, model_sha256, golden_sha256, golden_rows):
    """Llamar inmediatamente antes del publicador; rechazar reportes de otro modelo/dataset."""
    if report.get("passed") is not True or report.get("failures") != []:
        raise RuntimeError("Publicación bloqueada: quality gate fallido o incompleto.")
    if report.get("model_sha256") != model_sha256 or report.get("golden_sha256") != golden_sha256:
        raise RuntimeError("Publicación bloqueada: el modelo o el conjunto dorado cambió después de validarlo.")
    if report.get("golden_rows") != golden_rows:
        raise RuntimeError(
            "Publicación bloqueada: la evidencia no contiene las imágenes/etiquetas del conjunto actual."
        )
    if report.get("sample_count") != 195 or report.get("classification_discrepancies", 196) > 2:
        raise RuntimeError("Publicación bloqueada: evidencia incompleta de paridad.")
    recalculated = evaluate_quality_gate(
        report.get("golden_rows", []), report.get("predictions", []), report.get("threshold")
    )
    if not recalculated["passed"]:
        raise RuntimeError("Publicación bloqueada: las predicciones guardadas no superan el gate.")
