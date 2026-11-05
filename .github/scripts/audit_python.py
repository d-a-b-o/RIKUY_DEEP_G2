"""Audit each ML requirements file, blocking high/critical or incomplete audits."""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

SEVERITIES = {"low": 1, "moderate": 2, "high": 3, "critical": 4}


def github_json(path):
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "RIKDP-279-pip-audit",
    }
    if token := os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    request = Request(f"https://api.github.com{path}", headers=headers)
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def severity_for(vuln, fetch=github_json):
    identifiers = [vuln["id"], *vuln.get("aliases", [])]
    ghsa = sorted({x for x in identifiers if re.fullmatch(r"GHSA-[a-z0-9-]+", x)})
    records = []
    for identifier in ghsa:
        try:
            records.append(fetch(f"/advisories/{quote(identifier, safe='')}"))
        except HTTPError as error:
            if error.code != 404:
                raise
    if not records:
        for identifier in sorted(set(identifiers)):
            if re.fullmatch(r"CVE-\d{4}-\d+", identifier):
                records.extend(fetch(f"/advisories?cve_id={identifier}&per_page=100"))
    if not records:
        raise ValueError("No hay aviso de GitHub con severidad disponible")
    for record in records:
        if record.get("severity") == "medium":
            record["severity"] = "moderate"
    # Never infer 'low' from an absent score, withdrawn notice or unknown label.
    if any(r.get("severity") not in SEVERITIES or r.get("withdrawn_at") for r in records):
        raise ValueError("Severidad desconocida o aviso retirado: requiere revisión")
    level = max((r["severity"] for r in records), key=SEVERITIES.__getitem__)
    return level, sorted({r["ghsa_id"] for r in records})


def evaluate(report, lookup):
    dependencies = report["dependencies"]
    if not isinstance(dependencies, list) or not dependencies:
        raise ValueError("Reporte sin dependencias auditadas")
    findings = []
    for dependency in dependencies:
        if "skip_reason" in dependency:
            raise ValueError("pip-audit omitió una dependencia")
        name, version = dependency["name"], dependency["version"]
        if not isinstance(dependency["vulns"], list):
            raise ValueError("Lista de vulnerabilidades inválida")
        for vuln in dependency["vulns"]:
            severity, advisories = lookup(vuln)
            findings.append({
                "package": name, "version": version, "id": vuln["id"],
                "severity": severity, "advisories": advisories,
                "fix_versions": vuln["fix_versions"],
                "blocking": SEVERITIES[severity] >= SEVERITIES["high"],
            })
    return findings


def audit(requirements_dir, output, runner=subprocess.run, fetch=github_json):
    files = sorted(requirements_dir.glob("requirements-*.txt"))
    if not files:
        raise ValueError("No se encontraron requirements-*.txt")
    output.mkdir(parents=True, exist_ok=True)
    cache = {}

    def lookup(vuln):
        key = tuple(sorted({vuln["id"], *vuln.get("aliases", [])}))
        if key not in cache:
            cache[key] = severity_for(vuln, fetch)
        return cache[key]

    summary = {"threshold": "high", "files": [], "approved": False}
    for requirements in files:
        entry = {"requirements": requirements.name, "findings": [], "error": None}
        summary["files"].append(entry)
        report_path = output / f"{requirements.stem}.json"
        # Avoid accidentally evaluating a report from a previous execution.
        report_path.unlink(missing_ok=True)
        command = [
            sys.executable, "-m", "pip_audit", "-r", str(requirements.resolve()),
            "--format=json", "--aliases=on", "--desc=off", "--progress-spinner=off",
            "--output", str(report_path.resolve()), "--strict",
        ]
        try:
            result = runner(command, timeout=900, check=False)
            if result.returncode not in (0, 1):
                raise ValueError("pip-audit terminó con un error operativo")
            report = json.loads(report_path.read_text(encoding="utf-8"))
            findings = evaluate(report, lookup)
            if (result.returncode == 1) != bool(findings):
                raise ValueError("Salida de pip-audit inconsistente con el reporte")
            entry["findings"] = findings
        except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
            # Do not print arbitrary exception content (may contain credentials/URLs).
            entry["error"] = type(error).__name__
            print(f"Auditoría incompleta: {requirements.name}; revisar logs y reporte.")
    blocked = any(
        entry["error"] or any(f["blocking"] for f in entry["findings"])
        for entry in summary["files"]
    )
    summary["approved"] = not blocked
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    for entry in summary["files"]:
        counts = {level: sum(f["severity"] == level for f in entry["findings"]) for level in SEVERITIES}
        print(f"{entry['requirements']}: {counts}; error={entry['error']}")
    return int(blocked)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requirements-dir", type=Path, default=Path("ml"))
    parser.add_argument("--output", type=Path, default=Path("reports/pip-audit"))
    args = parser.parse_args()
    try:
        return audit(args.requirements_dir, args.output)
    except (OSError, ValueError, KeyError, TypeError):
        print("Auditoría Python incompleta; no se puede aprobar CI.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
