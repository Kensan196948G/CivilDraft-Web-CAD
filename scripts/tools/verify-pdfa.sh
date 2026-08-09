#!/usr/bin/env bash
# PDF/A 適合検証（verapdf）。電子納品の「自動断定」はせず、検証結果と人間確認の手順を示す。
#
# 使い方:
#   scripts/tools/verify-pdfa.sh <file.pdf>
# 環境変数:
#   VERAPDF_BIN - verapdf 実行ファイルパス（既定: verapdf）
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <file.pdf>" >&2
  exit 2
fi

PDF_FILE="$1"
if [[ ! -f "$PDF_FILE" ]]; then
  echo "ERROR: ファイルが見つかりません: $PDF_FILE" >&2
  exit 2
fi

VERAPDF_BIN="${VERAPDF_BIN:-verapdf}"
if ! command -v "$VERAPDF_BIN" >/dev/null 2>&1; then
  echo "ERROR: verapdf が見つかりません。docs/pdfa-verification.md のインストール手順を確認してください。" >&2
  exit 3
fi

echo "== verapdf 検証: $PDF_FILE =="
"$VERAPDF_BIN" --format mrr "$PDF_FILE"
echo
echo "注意: 検証結果は機械判定です。電子納品では必ず発注者要領・検査職員の最終確認を受けてください。"
