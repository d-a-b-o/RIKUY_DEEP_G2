"""Fail CI on any CodeQL finding with security-severity >= 7.0."""

import json
import math
import sys
from pathlib import Path


def check(directory: Path) -> int:
    files = sorted(directory.glob('*.sarif'))
    if not files:
        raise ValueError('No se generaron archivos SARIF; no se puede aprobar el análisis.')
    findings = 0
    for path in files:
        report = json.loads(path.read_text(encoding='utf-8'))
        runs = report.get('runs', [])
        if not runs:
            raise ValueError(f'{path.name}: reporte sin runs.')
        for run in runs:
            driver = run['tool']['driver']
            if driver.get('name') != 'CodeQL':
                raise ValueError(f'{path.name}: se esperaba un reporte CodeQL.')
            for invocation in run.get('invocations', []):
                if invocation.get('executionSuccessful') is False:
                    raise ValueError(f'{path.name}: ejecución de CodeQL incompleta.')
            tool = run['tool']
            rules = {}
            for rule in driver.get('rules', []):
                rules[rule['id']] = rule
            for extension in tool.get('extensions', []):
                for rule in extension.get('rules', []):
                    rules[rule['id']] = rule
            for result in run.get('results', []):
                rule_id = result['ruleId']
                if rule_id not in rules:
                    raise ValueError(f'{rule_id}: regla ausente en el SARIF.')
                rule = rules[rule_id]
                severity = rule.get('properties', {}).get('security-severity')
                if severity is None:
                    continue  # Non-security queries have no CVSS score.
                score = float(severity)
                if not math.isfinite(score) or not 0 <= score <= 10:
                    raise ValueError(f'{rule_id}: severidad inválida.')
                if score >= 7.0:
                    findings += 1
                    # Do not interpolate repository-controlled messages in annotations.
    if findings:
        print(f'::error::CodeQL encontró {findings} hallazgo(s) con severidad >= 7.0.')
        return 1
    print('CodeQL: sin hallazgos altos o críticos.')
    return 0


def main() -> int:
    try:
        return check(Path(sys.argv[1]))
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        print('::error::No se pudo validar el reporte CodeQL. Revisar el análisis y los SARIF.')
        return 1


if __name__ == '__main__':
    sys.exit(main())
