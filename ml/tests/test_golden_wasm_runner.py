"""Ejecutar el runner del notebook con un graph-model mínimo real, sin HTTP."""

import ast
import base64
import json
import os
import shutil
import struct
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("bias_shape", [None, [1], [1, 1, 1, 1]])
def test_local_graph_shards_wasm_and_checkpoint_resume(tmp_path, bias_shape):
    root = Path(__file__).resolve().parents[2]
    node = shutil.which("node")
    if node is None:
        pytest.skip("La integración requiere Node.js y dependencias TF.js de apps/web")
    env = {**os.environ, "NODE_PATH": str(root / "apps/web/node_modules")}
    available = subprocess.run(
        [
            node,
            "-e",
            "require('@tensorflow/tfjs-core');require('@tensorflow/tfjs-converter');require('@tensorflow/tfjs-backend-wasm')",
        ],
        env=env,
        capture_output=True,
        timeout=30,
    )
    if available.returncode:
        pytest.skip("Instalar dependencias de apps/web para ejecutar la integración WASM")
    notebook = json.loads((root / "RIKUY_DEEP_G2.ipynb").read_text(encoding="utf-8"))
    source = next("".join(c["source"]) for c in notebook["cells"] if "GOLDEN_JS_RUNNER =" in "".join(c["source"]))
    assignment = next(
        n
        for n in ast.parse(source).body
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "GOLDEN_JS_RUNNER" for t in n.targets)
    )
    runner = tmp_path / "runner.cjs"
    runner.write_text(
        "global.fetch = () => { throw Error('HTTP prohibido en esta prueba'); };\n"
        + ast.literal_eval(assignment.value),
        encoding="utf-8",
    )
    graph = {
        "format": "graph-model",
        "modelTopology": {
            "node": [
                {
                    "name": "input",
                    "op": "Placeholder",
                    "attr": {
                        "dtype": {"type": "DT_FLOAT"},
                        "shape": {"shape": {"dim": [{"size": "1"}, {"size": "1"}]}},
                    },
                },
                {
                    "name": "weight",
                    "op": "Const",
                    "attr": {
                        "dtype": {"type": "DT_FLOAT"},
                        "value": {
                            "tensor": {"dtype": "DT_FLOAT", "tensorShape": {"dim": [{"size": "1"}, {"size": "1"}]}}
                        },
                    },
                },
                {
                    "name": "output",
                    "op": "MatMul",
                    "input": ["input", "weight"],
                    "attr": {"T": {"type": "DT_FLOAT"}, "transpose_a": {"b": False}, "transpose_b": {"b": False}},
                },
            ],
            "versions": {"producer": 1},
        },
        "weightsManifest": [
            {"paths": ["first.bin", "second.bin"], "weights": [{"name": "weight", "shape": [1, 1], "dtype": "float32"}]}
        ],
    }
    input_shape = [1, 1]
    expected, changed_expected = 0.5, 0.25
    weight = struct.pack("<f", 0.25)
    if bias_shape is not None:
        # Reproduce la convolución fusionada del ResNet con sesgo 1D y 4D.
        def tensor_shape(shape):
            return {"dim": [{"size": str(d)} for d in shape]}

        def encoded(value):
            return base64.b64encode(value.encode()).decode()

        input_shape = [1, 1, 1, 1]
        nodes = graph["modelTopology"]["node"]
        nodes[0]["attr"]["shape"] = {"shape": tensor_shape(input_shape)}
        nodes[1]["attr"]["value"]["tensor"]["tensorShape"] = tensor_shape(input_shape)
        graph["weightsManifest"][0]["weights"][0]["shape"] = input_shape
        nodes.insert(
            2,
            {
                "name": "bias",
                "op": "Const",
                "attr": {
                    "dtype": {"type": "DT_FLOAT"},
                    "value": {"tensor": {"dtype": "DT_FLOAT", "tensorShape": tensor_shape(bias_shape)}},
                },
            },
        )
        nodes[-1] = {
            "name": "output",
            "op": "_FusedConv2D",
            "input": ["input", "weight", "bias"],
            "attr": {
                "T": {"type": "DT_FLOAT"},
                "num_args": {"i": "1"},
                "strides": {"list": {"i": ["1"] * 4}},
                "dilations": {"list": {"i": ["1"] * 4}},
                "padding": {"s": encoded("VALID")},
                "data_format": {"s": encoded("NHWC")},
                "fused_ops": {"list": {"s": [encoded("BiasAdd"), encoded("Relu")]}},
            },
        }
        graph["weightsManifest"][0]["weights"].append({"name": "bias", "shape": bias_shape, "dtype": "float32"})
        weight += struct.pack("<f", 0.125)
        expected, changed_expected = 0.625, 0.375
    (tmp_path / "model.json").write_text(json.dumps(graph), encoding="utf-8")
    (tmp_path / "first.bin").write_bytes(weight[:2])
    (tmp_path / "second.bin").write_bytes(weight[2:])
    (tmp_path / "input.bin").write_bytes(struct.pack("<f", 2.0))
    (tmp_path / "samples.json").write_text(
        json.dumps([{"id": "one", "tensor_file": "input.bin", "shape": input_shape}]), encoding="utf-8"
    )

    def run():
        return subprocess.run(
            [node, str(runner), str(tmp_path / "model.json"), str(tmp_path)],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )

    if bias_shape == [1, 1, 1, 1]:
        # Sin el adaptador, el kernel instalado debe reproducir el error de Colab.
        patched = runner.read_text(encoding="utf-8")
        start, end = patched.index("tf.registerOp('_FusedConv2D'"), patched.index("const sha =")
        runner.write_text(patched[:start] + patched[end:], encoding="utf-8")
        original = run()
        assert original.returncode != 0
        assert "FusedConv2D only supports rank-1 bias but got rank 4" in original.stderr
        runner.write_text(patched, encoding="utf-8")

    first = run()
    assert first.returncode == 0, first.stderr
    assert json.loads((tmp_path / "js_predictions.json").read_text())[0]["tfjs"] == expected
    second = run()
    assert second.returncode == 0, second.stderr
    assert "reutilizada" in second.stdout
    # Una modificación del tensor no puede reutilizar la predicción anterior.
    (tmp_path / "input.bin").write_bytes(struct.pack("<f", 1.0))
    changed = run()
    assert changed.returncode == 0, changed.stderr
    assert "reutilizada" not in changed.stdout
    assert json.loads((tmp_path / "js_predictions.json").read_text())[0]["tfjs"] == changed_expected
    if bias_shape is not None:
        (tmp_path / "input.bin").write_bytes(struct.pack("<f", -2.0))
        activated = run()
        assert activated.returncode == 0, activated.stderr
        assert json.loads((tmp_path / "js_predictions.json").read_text())[0]["tfjs"] == 0.0
    (tmp_path / "first.bin").unlink()
    assert run().returncode != 0
