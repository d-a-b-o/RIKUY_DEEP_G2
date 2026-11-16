"""Validate a trusted Vercel preview before any bypass secret is made available."""

import json
import os
import re
import urllib.request
from urllib.parse import urlsplit


def validate(event, project, repository, prs):
    deployment = event["deployment"]
    status = event["deployment_status"]
    if status["state"] != "success" or deployment.get("production_environment"):
        return None
    if deployment.get("creator", {}).get("login") != "vercel[bot]":
        return None
    if deployment.get("environment", "").lower() != "preview":
        return None
    url = status.get("environment_url", "")
    if any(ord(c) < 33 or ord(c) > 126 for c in url):
        raise ValueError("Invalid URL characters")
    parsed = urlsplit(url)
    if not re.fullmatch(r"[a-z0-9-]+", project):
        raise ValueError("DAST_VERCEL_PROJECT must be the Vercel project slug")
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(
            re.escape(project) + r"-[a-z0-9-]+\.vercel\.app", parsed.hostname or ""
        )
    ):
        raise ValueError("Untrusted preview URL")
    for pr in prs:
        if (
            pr["state"] == "open"
            and pr["head"]["sha"] == deployment["sha"]
            and pr["head"]["repo"]["full_name"] == repository
            and pr["base"]["repo"]["full_name"] == repository
        ):
            return {
                "url": url.rstrip("/"),
                "pr": str(pr["number"]),
                "sha": deployment["sha"],
            }
    return None


def main():
    event = json.load(open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8"))
    repo = os.environ["GITHUB_REPOSITORY"]
    sha = event["deployment"]["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid commit")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/commits/{sha}/pulls",
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        prs = json.load(response)
    result = validate(event, os.environ["VERCEL_PROJECT"], repo, prs)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("allowed=" + str(bool(result)).lower() + "\n")
        for key, value in (result or {}).items():
            output.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
