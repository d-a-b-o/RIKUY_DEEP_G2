"""RIKDP-85: measure existing Python vs real Chromium/TF.js preprocessing.

No checkpoint, fitting, application server, database or remote assets are needed.
Exit 1 means tensor parity failed; exit 2 means the comparison was incomplete.
"""

import argparse
import base64
import hashlib
import importlib.metadata
import json
import os
import platform
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from ml.preprocessing import make_tf_dataset, preprocess_image
from PIL import Image

ATOL = 1e-6
INPUT = {"width": 400, "height": 400, "channels": 3, "scale": 1 / 255, "offset": 0}


def compare_tensors(reference, actual):
    if reference.shape != (1, 400, 400, 3) or actual.shape != reference.shape:
        raise ValueError("Forma de entrada distinta de [1,400,400,3]")
    if reference.dtype != np.float32 or actual.dtype != np.float32:
        raise ValueError("Se requiere float32 en ambos caminos")
    for array in (reference, actual):
        if not np.isfinite(array).all() or array.min() < 0 or array.max() > 1:
            raise ValueError("Tensor no finito o fuera de [0,1]")
    delta = np.abs(reference - actual)
    return {
        "passed": bool(np.all(delta <= ATOL)),
        "max_absolute_difference": float(delta.max()),
        "mean_absolute_difference": float(delta.mean()),
        "channels_over_tolerance": int(np.count_nonzero(delta > ATOL)),
        "shape": list(actual.shape),
        "dtype": str(actual.dtype),
    }


def square_fixtures(directory):
    """Non-uniform patterns exercise resizing, not only easy constant-color inputs."""
    cases = []
    for size in (400, 512):
        y, x = np.indices((size, size))
        patterns = {
            "rgb": np.broadcast_to(np.array([255, 0, 51], dtype=np.uint8), (size, size, 3)),
            "gradient": np.stack(
                [x * 255 // (size - 1), y * 255 // (size - 1), (x + y) * 255 // (2 * (size - 1))], axis=-1
            ).astype(np.uint8),
            "edges": np.repeat((((x // 3 + y // 3) % 2) * 255)[..., None], 3, axis=-1).astype(np.uint8),
        }
        for name, pixels in patterns.items():
            path = directory / f"{name}-{size}.png"
            Image.fromarray(pixels).save(path)
            cases.append(path)
    return cases


def browser_tensor(page, path):
    uri = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
    result = page.evaluate(
        """async ({src, input}) => {
          const image = new Image(); image.src = src; await image.decode();
          const canvas = document.createElement('canvas');
          pt1Draw(image, canvas, input);
          const tensor = pt1Tensor(canvas, input);
          try {
            const values = await tensor.data();
            const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
            const chunks = [];
            for (let i = 0; i < bytes.length; i += 8192) {
              chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
            }
            return {shape: tensor.shape, dtype: tensor.dtype, data: btoa(chunks.join(''))};
          } finally { tensor.dispose(); }
        }""",
        {"src": uri, "input": INPUT},
    )
    if result["dtype"] != "float32" or result["shape"] != [1, 400, 400, 3]:
        raise ValueError("Contrato TensorFlow.js incompatible")
    return np.frombuffer(base64.b64decode(result["data"], validate=True), dtype="<f4").reshape(result["shape"])


def measure(root):
    # Imports remain lazy: the lightweight ML test suite needs neither browser nor TensorFlow.
    import tensorflow as tf
    from playwright.sync_api import sync_playwright

    harness = subprocess.run(
        ["node", str(root / "ml/parity_browser.cjs"), str(root / "apps/web")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
        check=True,
    )
    scripts = json.loads(harness.stdout)
    results = []
    with tempfile.TemporaryDirectory(prefix="rikdp-85-") as temporary, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.add_script_tag(path=scripts["core"])
            page.add_script_tag(path=scripts["backend"])
            page.add_script_tag(type="module", content=scripts["source"])
            page.wait_for_function("typeof globalThis.pt1Tensor === 'function'")
            ready = page.evaluate("async () => {const ok = await tf.setBackend('cpu'); await tf.ready(); return ok;}")
            if not ready:
                raise RuntimeError("Backend CPU de TensorFlow.js no disponible")
            for path in square_fixtures(Path(temporary)):
                actual = browser_tensor(page, path)
                training, _ = next(iter(make_tf_dataset([path], [0], training=False, batch_size=1)))
                case = {
                    "id": path.stem,
                    "image_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "pil_vs_browser": compare_tensors(preprocess_image(path)[None, ...], actual),
                    "training_vs_browser": compare_tensors(training.numpy(), actual),
                }
                results.append(case)
                print(
                    f"{path.stem}: PIL={case['pil_vs_browser']['passed']}; TF={case['training_vs_browser']['passed']}"
                )
            browser_version = browser.version
        finally:
            browser.close()
    sources = [
        "ml/preprocessing.py",
        "apps/web/src/lib/model/preprocess.ts",
        "apps/web/src/lib/model/loader.ts",
        "ml/preprocessing_parity.py",
        "ml/parity_browser.cjs",
    ]
    return {
        "task": "RIKDP-85",
        "status": "completed",
        "passed": all(c[key]["passed"] for c in results for key in ("pil_vs_browser", "training_vs_browser")),
        "absolute_tolerance": ATOL,
        "relative_tolerance": 0,
        "input": INPUT,
        "runtime": {
            "python": platform.python_version(),
            "tensorflow": tf.__version__,
            "tfjs": scripts["tfjs_version"],
            "chromium": browser_version,
            "backend": "cpu",
            "platform": platform.system(),
            "playwright": importlib.metadata.version("playwright"),
            "pillow": importlib.metadata.version("pillow"),
        },
        "sources_sha256": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in sources},
        "cases": results,
    }


def run(root, output):
    output.mkdir(parents=True, exist_ok=True)
    try:
        report = measure(root)
        exit_code = 0 if report["passed"] else 1
    except Exception as error:
        report = {
            "task": "RIKDP-85",
            "status": "incomplete",
            "passed": False,
            "error_type": type(error).__name__,
            "error": str(error)[:2000],
        }
        exit_code = 2
    (output / "RIKDP-85.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"RIKDP-85: status={report['status']}; passed={report['passed']}; exit={exit_code}")
    return exit_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("reports/preprocessing-parity"))
    args = parser.parse_args()
    return run(Path(__file__).resolve().parents[1], args.output)


if __name__ == "__main__":
    os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    raise SystemExit(main())
