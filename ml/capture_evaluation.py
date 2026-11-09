"""RIKDP-254: medir el modelo original sobre >=100 capturas etiquetadas por una persona."""

import argparse
import hashlib
import platform
from pathlib import Path

import numpy as np
from ml.preprocessing import preprocess_image
from ml.regression import write_json
from ml.workflow import check_artifacts, file_hash, read_json, scores
from PIL import Image, ImageOps

CLASSES = {"ok_front": 0, "def_front": 1}


def capture_pixel_hash(path):
    with Image.open(path) as raw:
        pixels = ImageOps.exif_transpose(raw).convert("RGB")
        return hashlib.sha256(str(pixels.size).encode() + pixels.tobytes()).hexdigest()


def validate_capture_manifest(path):
    path = Path(path).resolve()
    manifest = read_json(path)
    if (
        manifest.get("schema_version") != 1
        or not manifest.get("device")
        or manifest.get("label_source") != "human_labels_from_printed_sources"
    ):
        raise ValueError("Declarar dispositivo y etiquetas humanas de los originales impresos.")
    rows = manifest.get("rows", [])
    if len(rows) < 100 or {r.get("label") for r in rows} != {0, 1}:
        raise ValueError("Se requieren >=100 capturas y ambas clases.")
    ids, hashes, pixel_hashes, paths = set(), set(), set(), set()
    for row in rows:
        image = (path.parent / row["path"]).resolve()
        if not image.is_relative_to(path.parent) or image in paths:
            raise ValueError("Ruta de captura inválida o repetida.")
        if (
            not row.get("id")
            or row["id"] in ids
            or type(row["label"]) is not int
            or row["label"] not in CLASSES.values()
        ):
            raise ValueError("Identificador repetido o etiqueta inválida.")
        checksum = file_hash(image)
        if checksum != row.get("sha256") or checksum in hashes:
            raise ValueError("Captura modificada o duplicada: no cuenta como muestra nueva.")
        pixel_hash = capture_pixel_hash(image)
        if pixel_hash != row.get("pixel_sha256") or pixel_hash in pixel_hashes:
            raise ValueError("Píxeles modificados o duplicados aunque cambien los metadatos del archivo.")
        ids.add(row["id"])
        hashes.add(checksum)
        pixel_hashes.add(pixel_hash)
        paths.add(image)
    return manifest


def prepare(directory, device):
    directory = Path(directory).resolve()
    target = directory / "manifest.json"
    if target.exists():
        raise ValueError("El manifiesto ya existe; consérvalo y valida sus capturas.")
    rows = []
    for name, label in CLASSES.items():
        for path in sorted((directory / name).rglob("*")):
            if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                relative = path.relative_to(directory).as_posix()
                rows.append(
                    {
                        "id": relative,
                        "path": relative,
                        "label": label,
                        "sha256": file_hash(path),
                        "pixel_sha256": capture_pixel_hash(path),
                    }
                )
    temporary = directory / "manifest.pending.json"
    if temporary.exists():
        raise ValueError("Revisa el manifiesto temporal existente antes de preparar otro.")
    try:
        write_json(
            temporary,
            {"schema_version": 1, "device": device, "label_source": "human_labels_from_printed_sources", "rows": rows},
        )
        validate_capture_manifest(temporary)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return target


def capture_tensor(path):
    with Image.open(path) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
        size = min(image.size)
        x, y = (image.width - size) // 2, (image.height - size) // 2
        return preprocess_image(image.crop((x, y, x + size, y + size)))[None, ...]


def compare_metrics(baseline, captured):
    return {
        "accuracy_drop_percentage_points": 100 * (baseline["accuracy"] - captured["accuracy"]),
        "recall_drop_percentage_points": 100 * (baseline["recall"] - captured["recall"]),
    }


def measure(manifest_path, run, baseline_path):
    import tensorflow as tf

    manifest_path, run = Path(manifest_path).resolve(), Path(run).resolve()
    manifest = validate_capture_manifest(manifest_path)
    completed = read_json(run / "completed.json")
    check_artifacts(run, completed)
    baseline = read_json(baseline_path)
    threshold = read_json(run / "validation.json")["threshold"]
    if (
        baseline.get("passed") is not True
        or baseline.get("sample_count") != 195
        or baseline.get("keras_sha256") != file_hash(run / "best.keras")
        or baseline.get("run_identity") != completed["identity"]
        or baseline.get("threshold") != threshold
    ):
        raise ValueError("La referencia no corresponde al mismo modelo original, test y umbral.")
    model = tf.keras.models.load_model(run / "best.keras", compile=False, safe_mode=True)
    probabilities = []
    for row in manifest["rows"]:
        output = np.asarray(model(capture_tensor(manifest_path.parent / row["path"]), training=False))
        if output.shape != (1, 1) or not np.isfinite(output).all() or output.min() < 0 or output.max() > 1:
            raise ValueError("Salida sigmoid inválida.")
        probabilities.append(float(output[0, 0]))
    metrics = scores([r["label"] for r in manifest["rows"]], probabilities, threshold)
    return {
        "passed": True,
        "scope": "captured_printed_images_python_inference",
        "capture_origin_verified_by": None,
        "capture_origin": "user_declared_webcam_or_phone",
        "device": manifest["device"],
        "sample_count": len(probabilities),
        "class_counts": {name: sum(r["label"] == label for r in manifest["rows"]) for name, label in CLASSES.items()},
        "metrics": metrics,
        "baseline_metrics": baseline["independent_sklearn_metrics"],
        "metric_changes": compare_metrics(baseline["independent_sklearn_metrics"], metrics),
        "meets_original_targets": metrics["accuracy"] >= 0.97 and metrics["recall"] >= 0.95,
        "threshold_from_validation": threshold,
        "keras_sha256": file_hash(run / "best.keras"),
        "run_identity": completed["identity"],
        "manifest_sha256": file_hash(manifest_path),
        "baseline_report_sha256": file_hash(baseline_path),
        "source_sha256": file_hash(Path(__file__)),
        "preprocessing_sha256": file_hash(Path(__file__).with_name("preprocessing.py")),
        "runtime": {"python": platform.python_version(), "tensorflow": tf.__version__},
        "predictions": [
            {"id": r["id"], "label": r["label"], "probability": p, "prediction": int(p >= threshold)}
            for r, p in zip(manifest["rows"], probabilities, strict=True)
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", help="Carpeta con ok_front/ y def_front/ etiquetadas por una persona")
    parser.add_argument("--device", help="Webcam/celular y condiciones de captura")
    parser.add_argument("--manifest")
    parser.add_argument("--run")
    parser.add_argument("--baseline", default="docs/evidencias/RIKDP-131-metricas.json")
    parser.add_argument("--output", default="reports/captures/RIKDP-254.json")
    args = parser.parse_args()
    try:
        if args.prepare:
            if not args.device or args.manifest or args.run:
                raise ValueError("Preparar requiere --device y excluye --manifest/--run.")
            print(f"Manifiesto validado: {prepare(args.prepare, args.device)}")
            return 0
        if not args.manifest or not args.run:
            raise ValueError("Evaluar requiere --manifest y --run.")
        write_json(args.output, measure(args.manifest, args.run, args.baseline))
        return 0
    except Exception as exc:
        write_json(args.output, {"passed": False, "status": "incomplete", "error": str(exc)})
        print(f"Evaluación incompleta: {exc}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
