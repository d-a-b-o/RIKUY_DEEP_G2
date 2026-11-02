"""La celda de Colab incluye el gate probado y el runner procesa todas las muestras."""

import ast
import json
import shutil
import struct
import subprocess
from pathlib import Path

import pytest
from ml import quality_gate


def last_cell():
    notebook = Path(__file__).resolve().parents[2] / "RIKUY_DEEP_G2.ipynb"
    return next(
        "".join(cell["source"])
        for cell in json.loads(notebook.read_text(encoding="utf-8"))["cells"]
        if "def run_golden_quality_gate(" in "".join(cell["source"])
    )


def test_notebook_contains_same_policy_as_tested_module():
    source = Path(quality_gate.__file__).read_text(encoding="utf-8")
    expected = {
        node.name: ast.dump(node, include_attributes=False)
        for node in ast.parse(source).body
        if isinstance(node, ast.FunctionDef)
    }
    actual = {
        node.name: ast.dump(node, include_attributes=False)
        for node in ast.parse(last_cell()).body
        if isinstance(node, ast.FunctionDef)
    }
    for name, definition in expected.items():
        assert actual[name] == definition
    assert "PUBLICATION_ALLOWED = False" in last_cell()
    assert "assert_publication_ready" in actual


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js no está instalado")
def test_javascript_runner_covers_all_golden_ids_in_order(tmp_path):
    """Probar protocolo/recorrido con un motor simulado; no afirmar paridad del modelo real."""
    tree = ast.parse(last_cell())
    assignment = next(
        node
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "GOLDEN_JS_RUNNER" for t in node.targets)
    )
    javascript = ast.literal_eval(assignment.value)
    module = tmp_path / "node_modules" / "@tensorflow" / "tfjs"
    module.mkdir(parents=True)
    (module / "index.js").write_text(
        """
module.exports = {
  setBackend: async () => {}, ready: async () => {},
  tensor: (values, shape) => ({values, shape, dispose() {}}),
  loadGraphModel: async () => ({
    executeAsync: async input => ({size: 1, data: async () => [input.values[0]]}),
    dispose() {}
  }),
  dispose() {}
};
""",
        encoding="utf-8",
    )
    samples = []
    for i in range(195):
        filename = f"input_{i:04}.bin"
        (tmp_path / filename).write_bytes(struct.pack("<f", 0.9 if i >= 78 else 0.1))
        samples.append({"id": f"sample-{i}", "shape": [1, 1, 1, 1], "tensor_file": filename})
    (tmp_path / "samples.json").write_text(json.dumps(samples), encoding="utf-8")
    runner = tmp_path / "runner.cjs"
    runner.write_text(javascript, encoding="utf-8")
    result = subprocess.run(
        [shutil.which("node"), str(runner), "http://localhost/model.json", str(tmp_path)],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    predictions = json.loads((tmp_path / "js_predictions.json").read_text(encoding="utf-8"))
    assert [p["id"] for p in predictions] == [s["id"] for s in samples]
    assert predictions[0]["tfjs"] == pytest.approx(0.1)
    assert predictions[-1]["tfjs"] == pytest.approx(0.9)
    assert "195/195" in result.stdout
