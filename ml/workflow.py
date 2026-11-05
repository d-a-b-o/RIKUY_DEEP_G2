"""Etapas reutilizables del notebook. Importar este módulo no ejecuta comandos."""

import hashlib
import importlib.metadata
import importlib.util
import json
import math
import random
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

CLASSES = {"ok_front": 0, "def_front": 1}
EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def file_hash(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    """Publicar el marcador sólo cuando está completo; no dejar JSON truncado."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


@dataclass(frozen=True)
class Config:
    root: Path
    seed: int = 42
    batch_size: int = 16
    epochs: int = 35
    hpo_epochs: int = 10
    augmentation: bool = True
    target_recall: float = 0.95
    experiment_tag: str = "v1"
    dataset: str = "ravirajsinh45/real-life-industrial-dataset-of-casting-product"

    def __post_init__(self):
        object.__setattr__(self, "root", Path(self.root).resolve())
        if not (self.root / "ml" / "preprocessing.py").is_file():
            raise ValueError("root debe apuntar al repositorio RIKUY_DEEP_G2 existente.")
        if self.batch_size < 1 or self.epochs < 1 or self.hpo_epochs < 1 or not 0 < self.target_recall <= 1:
            raise ValueError("batch_size/epochs deben ser positivos; target_recall en (0,1].")

    @property
    def raw(self):
        return self.root / "data" / "casting_data"

    @property
    def prepared(self):
        return self.root / "data" / "prepared"


def preflight(config, stages):
    """Validar el plan completo antes de descargar, entrenar o publicar."""
    allowed = {"download", "prepare", "eda", "cnn", "cnn_no_aug", "hpo", "evaluate", "dvc_data", "dvc_models"}
    unknown = set(stages) - allowed
    if unknown:
        raise ValueError(f"Etapas desconocidas: {sorted(unknown)}")
    enabled = {name for name, enabled in stages.items() if enabled}
    packages = set()
    if enabled & {"prepare", "eda", "cnn", "cnn_no_aug", "hpo", "evaluate"}:
        packages.update(("numpy", "PIL"))
    if enabled & {"cnn", "cnn_no_aug", "hpo", "evaluate"}:
        packages.update(("tensorflow", "sklearn"))
    if "eda" in enabled:
        packages.update(("pandas", "matplotlib"))
    if "download" in enabled and not config.raw.exists():
        packages.add("kagglehub")
    missing = [name for name in sorted(packages) if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError(f"Faltan dependencias: {', '.join(missing)}. Instala ml/requirements-train.txt.")
    if enabled & {"dvc_data", "dvc_models"}:
        if not (config.root / ".dvc").is_dir() or not shutil.which("dvc"):
            raise RuntimeError("DVC debe estar instalado e inicializado en root.")
    if enabled & {"prepare", "eda", "cnn", "cnn_no_aug", "hpo", "evaluate"}:
        if not config.raw.exists() and "download" not in enabled:
            raise FileNotFoundError("No hay datos locales. Activa download o recupera data con DVC.")
    if enabled & {"eda", "cnn", "cnn_no_aug", "hpo", "evaluate"}:
        if not (config.prepared / "manifest.json").exists() and "prepare" not in enabled:
            raise FileNotFoundError("No hay manifiesto. Activa prepare primero.")
    return {name: ("EJECUTAR / reutilizar si coincide" if stages[name] else "omitir") for name in stages}


def download_dataset(config):
    """Una sola copia canónica; nunca mezclar una descarga con datos parciales."""
    if config.raw.exists():
        inventory(config)  # rechazar clases vacías y archivos corruptos
        return config.raw
    import kagglehub

    downloaded = Path(kagglehub.dataset_download(config.dataset))
    candidates = [downloaded, downloaded / "casting_512x512", downloaded / "casting_512x512" / "casting_512x512"]
    source = next((p for p in candidates if all((p / c).is_dir() for c in CLASSES)), None)
    if source is None:
        raise FileNotFoundError(f"No se encontraron las clases 512x512 en {downloaded}.")
    pending = config.raw.with_name("casting_data.pending")
    if pending.exists():
        raise RuntimeError(f"Descarga interrumpida: revisa {pending} antes de reintentar.")
    pending.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, pending)
    pending.rename(config.raw)
    inventory(config)
    return config.raw


def inventory(config):
    """Validación completa y huella por contenido RGB; detecta duplicados recodificados."""
    from PIL import Image

    rows, seen = [], {}
    for class_name, label in CLASSES.items():
        paths = sorted(p for p in (config.raw / class_name).rglob("*") if p.suffix.lower() in EXTENSIONS)
        if not paths:
            raise ValueError(f"Clase vacía o ausente: {class_name}")
        for path in paths:
            with Image.open(path) as image:
                image = image.convert("RGB")
                image.load()  # forzar decodificación, no sólo leer cabecera
                pixel_hash = hashlib.sha256(str(image.size).encode() + image.tobytes()).hexdigest()
                width, height = image.size
            if pixel_hash in seen and seen[pixel_hash] != label:
                raise ValueError(f"La misma imagen tiene etiquetas contradictorias: {path}")
            seen[pixel_hash] = label
            rows.append(
                {
                    "path": path.relative_to(config.root).as_posix(),
                    "label": label,
                    "class_name": class_name,
                    "sha256": file_hash(path),
                    "pixel_hash": pixel_hash,
                    "width": width,
                    "height": height,
                }
            )
    return rows


def prepare_data(config):
    """Split fijo 70/15/15 por imagen RGB única; no generar copias JPEG procesadas."""
    rows = inventory(config)
    identity = digest({"rows": rows, "seed": config.seed, "split_algorithm": 1})
    path = config.prepared / "manifest.json"
    if path.exists():
        old = read_json(path)
        if old["identity"] == identity:
            validate_manifest(config, old)
            return old
        raise RuntimeError(
            "Los datos/semilla cambiaron. Conserva el manifiesto anterior con DVC y "
            "retira data/prepared explícitamente antes de crear otro split."
        )
    unique = {row["pixel_hash"]: row.copy() for row in rows}
    result = []
    rng = random.Random(config.seed)
    for label in CLASSES.values():
        group = sorted((r for r in unique.values() if r["label"] == label), key=lambda r: r["path"])
        if len(group) < 7:
            raise ValueError("Se requieren al menos 7 imágenes únicas por clase para 70/15/15.")
        rng.shuffle(group)
        n_test = n_val = max(1, round(len(group) * 0.15))
        for i, row in enumerate(group):
            row["split"] = "test" if i < n_test else "validation" if i < n_test + n_val else "train"
            result.append(row)
    manifest = {
        "identity": identity,
        "seed": config.seed,
        "source_rows": rows,
        "rows_digest": digest(result),
        "duplicates_removed": len(rows) - len(unique),
        "rows": result,
    }
    validate_manifest(config, manifest)
    write_json(path, manifest)
    return manifest


def validate_manifest(config, manifest):
    """Fallar antes de entrenar si cambió el inventario, el contenido o el split."""
    current = inventory(config)
    if manifest.get("rows_digest") != digest(manifest["rows"]):
        raise ValueError("El contenido del manifiesto fue modificado.")
    expected = digest({"rows": current, "seed": config.seed, "split_algorithm": 1})
    if manifest["identity"] != expected or current != manifest["source_rows"]:
        raise ValueError("El dataset ya no coincide con el manifiesto. No se entrenará con datos mezclados.")
    hashes = set()
    source = {r["pixel_hash"]: r for r in current}
    for row in manifest["rows"]:
        original = source.get(row["pixel_hash"])
        if original is None or any(row[k] != original[k] for k in original):
            raise ValueError("Fila del manifiesto no coincide con la fuente.")
        if row["pixel_hash"] in hashes or row["split"] not in {"train", "validation", "test"}:
            raise ValueError("Duplicados o partición inválida en manifiesto.")
        hashes.add(row["pixel_hash"])
    if hashes != set(source):
        raise ValueError("El manifiesto omite imágenes únicas.")
    for split in ("train", "validation", "test"):
        if {r["label"] for r in manifest["rows"] if r["split"] == split} != {0, 1}:
            raise ValueError(f"{split} debe contener ambas clases.")


def load_manifest(config):
    path = config.prepared / "manifest.json"
    if not path.is_file():
        raise FileNotFoundError("Ejecuta prepare_data antes de esta etapa.")
    manifest = read_json(path)
    validate_manifest(config, manifest)
    return manifest


def show_eda(config):
    import matplotlib.pyplot as plt
    import pandas as pd

    manifest = load_manifest(config)
    frame = pd.DataFrame(manifest["rows"])
    print(frame.groupby(["split", "class_name"]).size().unstack(fill_value=0))
    print(frame.groupby("class_name")[["width", "height"]].agg(["min", "median", "max"]))
    print("Duplicados RGB excluidos:", manifest["duplicates_removed"])
    frame.groupby(["split", "class_name"]).size().unstack().plot.bar(title="Particiones sin duplicados RGB")
    plt.tight_layout()
    plt.show()
    return frame


def command(config, args, timeout=600):
    """Sin shell, cwd explícito, timeout y errores que detienen el flujo."""
    result = subprocess.run(args, cwd=config.root, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f"Falló {args[0]} {args[1]}: {result.stderr or result.stdout}")
    return result.stdout


def version_with_dvc(config, target, push=False, remote=None):
    """No pull, init, cambios de remoto ni Git implícitos. Reintenta push aunque add no cambie."""
    target = Path(target).resolve()
    relative = target.relative_to(config.root)
    if not target.exists() or not (config.root / ".dvc").is_dir() or not shutil.which("dvc"):
        raise ValueError("DVC o target no disponibles.")
    if push:
        if not remote:
            raise ValueError("Indica remote explícitamente antes de publicar.")
        remotes = command(config, ["dvc", "remote", "list"])
        if remote not in {line.split()[0] for line in remotes.splitlines() if line.split()}:
            raise ValueError(f"Remoto DVC no configurado: {remote}")
    pointer = Path(str(relative) + ".dvc").as_posix()
    # Evitar outputs anidados; data se sigue versionando con el data.dvc existente.
    for parent in target.parents:
        if parent == config.root:
            break
        if Path(str(parent) + ".dvc").exists():
            raise ValueError(f"Output DVC anidado bajo {parent}; versiona el padre.")
    changed = not (config.root / pointer).exists()
    if not changed:
        changed = bool(json.loads(command(config, ["dvc", "status", pointer, "--json"])))
    if changed:
        command(config, ["dvc", "add", relative.as_posix()])
    if push:
        pending = json.loads(command(config, ["dvc", "status", pointer, "--cloud", "--remote", remote, "--json"]))
        if pending:
            command(config, ["dvc", "push", pointer, "--remote", remote], timeout=3600)
    return {"pointer": pointer, "updated": changed, "push_requested": push}


def runtime_versions():
    return {name: importlib.metadata.version(name) for name in ("tensorflow", "numpy", "scikit-learn", "pillow")}


def datasets(config, manifest, augmentation=False):
    from ml.preprocessing import make_tf_dataset

    output = {}
    for split in ("train", "validation", "test"):
        rows = [r for r in manifest["rows"] if r["split"] == split]
        output[split] = make_tf_dataset(
            [config.root / r["path"] for r in rows],
            [r["label"] for r in rows],
            training=split == "train",
            augment=augmentation and split == "train",
            batch_size=config.batch_size,
            seed=config.seed,
        )
    return output


def build_model(kind, learning_rate, dropout, fraction):
    import tensorflow as tf

    layers = tf.keras.layers
    inputs = tf.keras.Input((400, 400, 3))
    if kind == "cnn":
        x = inputs
        for filters in (32, 64, 128, 128):
            x = layers.Conv2D(filters, 3, padding="same", use_bias=False)(x)
            x = layers.BatchNormalization()(x)
            x = layers.Activation("relu")(x)
            x = layers.MaxPooling2D()(x)
        x = layers.GlobalAveragePooling2D()(x)
        x = layers.Dense(128, activation="relu")(x)
    elif kind == "mobilenetv2":
        base = tf.keras.applications.MobileNetV2(include_top=False, weights="imagenet", input_shape=(400, 400, 3))
        base.trainable = True
        cutoff = len(base.layers) - math.ceil(len(base.layers) * fraction)
        for i, layer in enumerate(base.layers):
            layer.trainable = i >= cutoff and not isinstance(layer, layers.BatchNormalization)
        x = base(layers.Rescaling(2.0, offset=-1)(inputs), training=False)
        x = layers.GlobalAveragePooling2D()(x)
    else:
        raise ValueError(f"Arquitectura desconocida: {kind}")
    outputs = layers.Dense(1, activation="sigmoid")(layers.Dropout(dropout)(x))
    model = tf.keras.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate),
        loss="binary_crossentropy",
        metrics=[tf.keras.metrics.BinaryAccuracy(name="accuracy"), tf.keras.metrics.AUC(curve="PR", name="auc_pr")],
    )
    return model


def choose_threshold(y, probabilities, target_recall):
    import numpy as np
    from sklearn.metrics import precision_recall_curve

    precision, recall, thresholds = precision_recall_curve(y, probabilities)
    valid = np.flatnonzero(recall[:-1] >= target_recall)
    index = int(valid[np.argmax(precision[valid])])
    return float(thresholds[index])


def scores(y, probabilities, threshold):
    import numpy as np
    from sklearn.metrics import (
        accuracy_score,
        average_precision_score,
        brier_score_loss,
        confusion_matrix,
        f1_score,
        precision_score,
        recall_score,
        roc_auc_score,
    )

    prediction = (np.asarray(probabilities) >= threshold).astype(int)
    return {
        "accuracy": float(accuracy_score(y, prediction)),
        "recall": float(recall_score(y, prediction)),
        "precision": float(precision_score(y, prediction, zero_division=0)),
        "f1": float(f1_score(y, prediction)),
        "average_precision": float(average_precision_score(y, probabilities)),
        "roc_auc": float(roc_auc_score(y, probabilities)),
        "brier": float(brier_score_loss(y, probabilities)),
        "confusion_matrix_0_ok_1_defect": confusion_matrix(y, prediction, labels=[0, 1]).tolist(),
    }


def check_artifacts(directory, record):
    for name, checksum in record["artifacts"].items():
        if not (directory / name).is_file() or file_hash(directory / name) != checksum:
            raise ValueError(f"Artefacto ausente/modificado: {directory / name}")


def train(config, kind="cnn", augmentation=None, learning_rate=1e-3, dropout=0.35, fraction=0.15):
    """Reutilizar corrida completa por huella; una corrida interrumpida exige un nuevo tag."""
    import tensorflow as tf

    if kind not in {"cnn", "mobilenetv2"} or learning_rate <= 0 or not 0 <= dropout < 1 or not 0 <= fraction <= 1:
        raise ValueError("Hiperparámetros inválidos.")
    manifest = load_manifest(config)
    augmentation = config.augmentation if augmentation is None else augmentation
    params = {
        **asdict(config),
        "root": None,
        "kind": kind,
        "augmentation": augmentation,
        "learning_rate": learning_rate,
        "dropout": dropout,
        "fraction": fraction,
    }
    code = {p.name: file_hash(p) for p in (Path(__file__), config.root / "ml/preprocessing.py")}
    identity = digest({"params": params, "manifest": manifest, "code": code, "versions": runtime_versions()})
    directory = config.root / "models" / "experiments" / f"{kind}_{identity[:20]}"
    completed = directory / "completed.json"
    if completed.exists():
        record = read_json(completed)
        check_artifacts(directory, record)
        return directory
    # mkdir exclusivo impide entrenar simultáneamente o pisar una corrida fallida.
    directory.parent.mkdir(parents=True, exist_ok=True)
    directory.mkdir(exist_ok=False)
    environment = sorted(f"{d.metadata['Name']}=={d.version}" for d in importlib.metadata.distributions())
    write_json(
        directory / "started.json",
        {
            "identity": identity,
            "params": params,
            "versions": runtime_versions(),
            "environment": environment,
            "code": code,
            "manifest": manifest,
        },
    )
    tf.keras.backend.clear_session()
    tf.keras.utils.set_random_seed(config.seed)
    tf.config.experimental.enable_op_determinism()
    ds = datasets(config, manifest, augmentation)
    labels = [r["label"] for r in manifest["rows"] if r["split"] == "train"]
    class_weight = {label: len(labels) / (2 * labels.count(label)) for label in (0, 1)}
    model = build_model(kind, learning_rate, dropout, fraction)
    model.fit(
        ds["train"],
        validation_data=ds["validation"],
        epochs=config.hpo_epochs if kind == "mobilenetv2" else config.epochs,
        class_weight=class_weight,
        callbacks=[
            tf.keras.callbacks.ModelCheckpoint(
                str(directory / "best.keras"), monitor="val_auc_pr", mode="max", save_best_only=True
            ),
            tf.keras.callbacks.EarlyStopping(monitor="val_auc_pr", mode="max", patience=4),
            tf.keras.callbacks.ReduceLROnPlateau(monitor="val_auc_pr", mode="max", patience=2),
            tf.keras.callbacks.CSVLogger(str(directory / "history.csv")),
        ],
        verbose=2,
    )
    model = tf.keras.models.load_model(directory / "best.keras")
    probabilities = model.predict(ds["validation"], verbose=0).ravel()
    y = [r["label"] for r in manifest["rows"] if r["split"] == "validation"]
    threshold = choose_threshold(y, probabilities, config.target_recall)
    write_json(directory / "validation.json", {"threshold": threshold, **scores(y, probabilities, threshold)})
    write_json(
        completed,
        {
            "identity": identity,
            "artifacts": {
                name: file_hash(directory / name)
                for name in ("best.keras", "history.csv", "validation.json", "started.json")
            },
        },
    )
    return directory


def run_hpo(config):
    """Sólo validation selecciona el candidato. Cada corrida se puede reutilizar."""
    trials = [(1e-4, 0.15, 0.30), (5e-5, 0.25, 0.40), (2e-5, 0.35, 0.30), (1e-5, 0.50, 0.50)]
    directories = [
        train(config, "mobilenetv2", learning_rate=lr, fraction=fraction, dropout=dropout)
        for lr, fraction, dropout in trials
    ]
    return select_model(config, directories)


def select_model(config, directories):
    """Comparar candidatos sin consultar test."""

    def rank(directory):
        value = read_json(Path(directory) / "validation.json")
        return value["recall"] >= config.target_recall, value["accuracy"], value["average_precision"]

    if not directories:
        raise ValueError("No hay candidatos. Entrena uno o indica una corrida existente.")
    return max(map(Path, directories), key=rank)


def evaluate(config, directory):
    """Evaluación explícita, posterior a selección; reutiliza reporte verificado."""
    import tensorflow as tf

    directory = Path(directory)
    manifest = load_manifest(config)
    record = read_json(directory / "completed.json")
    check_artifacts(directory, record)
    started = read_json(directory / "started.json")
    if started["manifest"] != manifest:
        raise ValueError("El split del modelo no coincide con el dataset actual.")
    report = directory / "test.json"
    if report.exists():
        cached = read_json(report)
        if cached["run_identity"] != record["identity"]:
            raise ValueError("Reporte test no corresponde al modelo.")
        return cached
    model = tf.keras.models.load_model(directory / "best.keras")
    probabilities = model.predict(datasets(config, manifest)["test"], verbose=0).ravel()
    y = [r["label"] for r in manifest["rows"] if r["split"] == "test"]
    threshold = read_json(directory / "validation.json")["threshold"]
    metrics = {
        "run_identity": record["identity"],
        "threshold_from_validation": threshold,
        **scores(y, probabilities, threshold),
    }
    write_json(report, metrics)
    return metrics
