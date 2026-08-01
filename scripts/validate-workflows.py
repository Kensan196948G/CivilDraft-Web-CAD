#!/usr/bin/env python3
"""Validate GitHub Actions workflow YAML files.

Catches syntax errors like the 2026-08-02 synthetic-monitoring.yml bug where
an unindented multi-line string made the whole workflow file unparseable and
caused incorrect push-trigger registration.

Note: PyYAML (YAML 1.1) parses the unquoted `on:` key as boolean True, so both
the quoted and unquoted forms are accepted here.
"""

from __future__ import annotations

import glob
import sys

import yaml


def main() -> int:
    errors: list[str] = []
    paths = sorted(glob.glob(".github/workflows/*.yml"))
    if not paths:
        errors.append("no workflow files found under .github/workflows/")
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
        except Exception as exc:  # noqa: BLE001 - report any parse failure
            errors.append(f"{path}: YAML parse error: {exc}")
            continue
        if not isinstance(doc, dict):
            errors.append(f"{path}: root must be a mapping")
            continue
        triggers = [key for key in ("on", True, '"on"') if key in doc]
        if not triggers:
            errors.append(f"{path}: missing trigger key (on:)")
        if "jobs" not in doc:
            errors.append(f"{path}: missing jobs")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"OK: {len(paths)} workflow YAML file(s) valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
