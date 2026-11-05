"""Validate the final CI gate, including only explicitly permitted skipped jobs."""

import json
import os
import sys

JOBS = {"changes", "web", "ml", "convenciones", "archivos", "dependencias", "codeql", "gitleaks"}


def validate(needs, event, author_type):
    if event not in {"pull_request", "push", "workflow_dispatch"}:
        raise ValueError("Evento de CI no reconocido")
    if set(needs) != JOBS:
        raise ValueError("Faltan jobs esperados o el contrato de CI cambió")
    for job, data in needs.items():
        if data["result"] not in {"success", "skipped"}:
            raise ValueError(f"El job {job} no terminó correctamente")
    for job in ("changes", "codeql", "gitleaks"):
        if needs[job]["result"] != "success":
            raise ValueError(f"El job obligatorio {job} fue omitido")
    outputs = needs["changes"]["outputs"]
    for job in ("web", "ml"):
        if outputs[job] not in {"true", "false"}:
            raise ValueError("Filtro de rutas ausente o inválido")
        required = outputs[job] == "true" or event == "workflow_dispatch"
        if required and needs[job]["result"] != "success":
            raise ValueError(f"El job {job} debía ejecutarse y fue omitido")
    if event == "pull_request":
        for job in ("archivos", "dependencias"):
            if needs[job]["result"] != "success":
                raise ValueError(f"El control de PR {job} fue omitido")
        if author_type not in {"User", "Bot"}:
            raise ValueError("Tipo de autor de PR ausente o inválido")
        has_changes = outputs["web"] == "true" or outputs["ml"] == "true"
        if author_type != "Bot" and has_changes and needs["convenciones"]["result"] != "success":
            raise ValueError("Se omitió la comprobación de convenciones")


def main():
    try:
        validate(json.loads(os.environ["NEEDS_JSON"]), os.environ["EVENT_NAME"],
                 os.environ.get("AUTHOR_TYPE", ""))
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        print(f"::error::CI bloqueado: {error}")
        return 1
    print("CI aprobado: controles obligatorios correctos y omisiones justificadas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
