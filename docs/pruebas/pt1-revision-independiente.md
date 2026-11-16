# RIKDP-131 · Revisión independiente de métricas

La tarea requiere que una persona distinta del autor del modelo revise el test
reservado. Una ejecución automatizada aprobada no sustituye esa revisión. No se
ha registrado un revisor ni una aceptación ficticia.

## Evidencia nueva pendiente

Usar la corrida ResNet seleccionada por el notebook y el manifiesto nuevo. No hay métricas acreditadas
hasta ejecutar test. Se requieren 195 imágenes reservadas, recall >=95 % y accuracy >=97 %.
El umbral se calibra exclusivamente con validation. Los informes anteriores fueron retirados.

## Inferencia nueva sin entrenar

El revisor puede repetir la evaluación completa con `ml/independent_metrics.py`.
Este comando no llama a `evaluate`, no reutiliza `test.json`, no selecciona
otro modelo ni ajusta el umbral. Verifica la corrida y los datos, predice las
195 imágenes reservadas sin augmentation y recalcula con scikit-learn.

Antes de Colab, copiar el nuevo `ml/independent_metrics.py` del repositorio a
`ml/` de Drive. Los módulos `workflow.py`, `preprocessing.py` y `regression.py`
deben estar sincronizados con esta rama. La corrida y el dataset ya restaurados
permanecen en Drive. No reinstalar TensorFlow CPU sobre la sesión GPU.

Celda de Colab para el revisor:

```python
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/content/drive/MyDrive/ColabNotebooks/RIKUY_DEEP_G2')
SELECTION = json.loads((ROOT / 'data/prepared/final-selection.json').read_text())
RUN = ROOT / 'models/experiments' / SELECTION['selected']
OUTPUT = ROOT / 'reports/independent-metrics/RIKDP-131.json'
assert (ROOT / 'ml/independent_metrics.py').is_file(), 'Copia primero el módulo nuevo a Drive'

result = subprocess.run(
    [sys.executable, '-m', 'ml.independent_metrics', '--root', str(ROOT),
     '--run', str(RUN), '--output', str(OUTPUT)],
    cwd=ROOT, text=True, capture_output=True,
)
print(result.stdout)
print(result.stderr)
assert OUTPUT.is_file(), 'No hay reporte; revisar el error anterior'
report = json.loads(OUTPUT.read_text(encoding='utf-8'))
print(json.dumps(report, indent=2, ensure_ascii=False))
assert result.returncode == 0 and report.get('passed') is True
```

La predicción puede producir pequeñas diferencias numéricas por versión/backend;
se deben revisar las métricas y su matriz. La salida del comando exige recall
>=95 % y accuracy >=97 %. Si falla, se conserva el reporte y se analiza la causa:
no se cambia el umbral para aprobar el test.

## Registro de aceptación que falta completar

El revisor debe comprobar modelo, hash, origen y aislamiento del test, etiquetas,
matriz, métricas y ausencia de ajuste al test; después registrar en Jira o en
una revisión firmada:

| Campo | Valor por completar |
| --- | --- |
| Autor del modelo | Andre Chumbiraico |
| Revisor distinto del autor | Pendiente |
| Fecha de revisión | Pendiente |
| Commit y ruta/URL del reporte revisado | Pendiente |
| Accuracy, recall y matriz comprobadas | Pendiente |
| Conclusión y observaciones | Pendiente |

El reporte conserva `human_independent_reviewer=null` hasta contar con una
aceptación real. Compartir el JSON nuevo y el registro de revisión para formalizar
el cierre; no subir los pesos a GitHub.
