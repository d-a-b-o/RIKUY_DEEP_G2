# RIKDP-101 · Ejecutar las dos réplicas en Colab

El usuario ejecutará este ensayo en su sesión con GPU. No se declara aprobado
hasta obtener el JSON de comparación. Entrena dos modelos de prueba nuevos;
no sustituye el seleccionado ni publica pesos. Conserva los artefactos en Drive.

Antes de la celda, sincronizar los cambios revisados de esta rama en el
repositorio montado en Drive. Deben estar disponibles los módulos actuales
`ml/reproducibility.py`, `ml/regression.py`, `ml/workflow.py` y `ml/preprocessing.py`,
además del dataset original y `data/prepared/manifest.json`. Usar el entorno
de entrenamiento original de Colab; no instalar el entorno de inferencia CPU
encima de la sesión GPU. No hay que ejecutar todo el notebook ni hacer otro split.

Celda de Colab, tras montar Drive y activar GPU:

```python
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path('/content/drive/MyDrive/ColabNotebooks/RIKUY_DEEP_G2')
REFERENCE = ROOT / 'models/experiments/mobilenetv2_af731904844ed80545ae'
OUTPUT = ROOT / 'reports/reproducibility/RIKDP-101.json'

for required in (
    ROOT / 'ml/reproducibility.py',
    ROOT / 'ml/regression.py',
    ROOT / 'ml/workflow.py',
    ROOT / 'ml/preprocessing.py',
    ROOT / 'data/prepared/manifest.json',
    REFERENCE / 'started.json',
):
    assert required.is_file(), f'Falta sincronizar o recuperar: {required}'

gpu = subprocess.run(
    [sys.executable, '-c',
     'import tensorflow as tf; '
     'assert tf.config.list_physical_devices("GPU"), "Activa GPU en Colab"'],
    check=True,
)

environment = os.environ.copy()
environment['PYTHONHASHSEED'] = '42'
environment['TF_DETERMINISTIC_OPS'] = '1'
environment['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'

# Detectar errores de importación antes de iniciar ningún entrenamiento.
probe = subprocess.run(
    [sys.executable, '-c',
     'import ml.reproducibility as r; print("Módulo cargado:", r.__file__)'],
    cwd=ROOT, env=environment, capture_output=True, text=True,
)
print(probe.stdout)
if probe.returncode != 0:
    print(probe.stderr)
    raise RuntimeError('Falló la importación. Corregir el traceback mostrado antes de entrenar.')

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
LOG = OUTPUT.with_suffix('.log')
process = subprocess.Popen(
    [sys.executable, '-m', 'ml.reproducibility', '--train-twice',
     '--root', str(ROOT), '--reference', str(REFERENCE), '--output', str(OUTPUT)],
    cwd=ROOT,
    env=environment,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)
with LOG.open('w', encoding='utf-8') as log:
    for line in process.stdout:
        print(line, end='', flush=True)
        log.write(line)
        log.flush()
exit_code = process.wait()
if not OUTPUT.is_file():
    detail = LOG.read_text(encoding='utf-8')[-6000:]
    raise RuntimeError(f'No se generó el reporte; salida {exit_code}. Log: {LOG}\n{detail}')
report = json.loads(OUTPUT.read_text(encoding='utf-8'))
print(json.dumps(report, indent=2, ensure_ascii=False))
assert exit_code == 0 and report.get('passed') is True, (
    'RIKDP-101 no aprobado: revisar diferencias o evidencia incompleta'
)
```

Las dos réplicas usarán semilla 42, arquitectura MobileNetV2, augmentation,
batch size 16, learning rate 1e-4, dropout 0.30, fracción 0.15 y hasta 10 épocas
por réplica, con los mismos callbacks del entrenamiento original. Early stopping
puede reducir las épocas. No se ajustan parámetros tras ver el resultado.

El ensayo usa etiquetas `pt1-repro-1/2`; las corridas nuevas quedan bajo
`models/experiments/`. No ejecutar repetidamente el ensayo como si fueran fits
nuevos: si ya existen, comparar sus carpetas con `--left` y `--right` como se
explica en [el procedimiento](pt1-cierre.md#reproducibilidad--rikdp-101).

Conservar `RIKDP-101.json`, los dos `started.json`, `completed.json`,
`history.csv` y `validation.json`. Los pesos permanecen en Drive/DVC. Para
revisión basta compartir el JSON final y las rutas de las dos corridas;
no subir los checkpoints a GitHub. Si falla la ejecución, compartir el JSON
igualmente: código 1 significa diferencia de métricas; código 2, ensayo incompleto.

Si el proceso termina sin JSON, todavía no hay un resultado de comparación:
puede haber fallado al importar un módulo, iniciarse Python o escribir el reporte.
El traceback y `RIKDP-101.log` determinan la causa; no interpretar únicamente
el código 1 como diferencia de métricas cuando el reporte no existe.
