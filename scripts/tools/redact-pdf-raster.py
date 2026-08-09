#!/usr/bin/env python3
"""
CivilDraft-Web-CAD — PDF 画像墨消しツール（ラスタライズ方式）

テキスト・画像を含む全ページを高解像度でラスタライズし、指定矩形を黒塗りして
再出力する。これにより「コンテンツストリームの物理削除では対応できない
埋め込み画像内の文字」も墨消しできる。

前提: poppler-utils（pdftoppm）と Pillow がインストールされている
  - Ubuntu:  sudo apt-get install poppler-utils python3-pil

使い方:
  python3 scripts/tools/redact-pdf-raster.py in.pdf out.pdf \
    --rect 80,80,320,48 --rect 80,180,320,48 --page 1 --dpi 200
  # --page を省略すると全ページへ適用

注意:
  - 出力は「全ページ画像化された PDF」であり、テキスト選択・検索は不可になる。
  - 座標は PDF ユーザー空間（左下原点・ポイント）で指定する。
  - このツールは発注者・検査職員による最終確認を前提とする（適合の自動断定なし）。
"""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw


def parse_rect(value: str) -> tuple[float, float, float, float]:
    parts = value.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--rect は x,y,w,h の形式で指定してください")
    return tuple(float(part) for part in parts)  # type: ignore[return-value]


def main() -> int:
    parser = argparse.ArgumentParser(description="PDF 画像墨消し（ラスタライズ方式）")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--rect", action="append", type=parse_rect, required=True,
                        help="墨消し矩形 x,y,w,h（PDF ポイント・左下原点）。複数指定可")
    parser.add_argument("--page", type=int, default=None,
                        help="適用ページ番号（1 始まり）。省略時は全ページ")
    parser.add_argument("--dpi", type=int, default=200, help="ラスタライズ解像度（既定 200）")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERROR: 入力ファイルがありません: {args.input}", file=sys.stderr)
        return 1

    # ページ数を取得（pdfinfo が無い場合は pdftoppm の出力数で判定）
    try:
        info = subprocess.run(
            ["pdfinfo", str(args.input)],
            capture_output=True, text=True, check=True,
        )
        page_count = 0
        for line in info.stdout.splitlines():
            if line.startswith("Pages:"):
                page_count = int(line.split(":")[1].strip())
        if page_count == 0:
            raise ValueError("pdfinfo でページ数を取得できません")
    except (FileNotFoundError, ValueError) as err:
        print(f"ERROR: pdfinfo が必要です（poppler-utils）: {err}", file=sys.stderr)
        return 1

    pages = list(range(1, page_count + 1)) if args.page is None else [args.page]
    if any(page < 1 or page > page_count for page in pages):
        print(f"ERROR: --page は 1〜{page_count} の範囲で指定してください", file=sys.stderr)
        return 1

    images: list[Image.Image] = []
    with tempfile.TemporaryDirectory(prefix="civildraft-redact-") as tmp:
        for page in pages:
            prefix = Path(tmp) / f"page-{page}"
            subprocess.run(
                [
                    "pdftoppm", "-r", str(args.dpi),
                    "-f", str(page), "-l", str(page),
                    "-singlefile", "-png", str(args.input), str(prefix),
                ],
                check=True,
            )
            png = prefix.with_suffix(".png")
            if not png.exists():
                print(f"ERROR: ページ {page} のレンダリングに失敗しました", file=sys.stderr)
                return 1
            image = Image.open(png).convert("RGB")
            draw = ImageDraw.Draw(image)
            scale = args.dpi / 72.0
            page_h_pdf = image.height / scale
            for x, y, w, h in args.rect:
                px = x * scale
                py = (page_h_pdf - (y + h)) * scale
                draw.rectangle([px, py, px + w * scale, py + h * scale], fill="black")
            images.append(image)

    if len(images) == 1:
        images[0].save(args.output, "PDF", resolution=args.dpi)
    else:
        images[0].save(
            args.output, "PDF", resolution=args.dpi,
            save_all=True, append_images=images[1:],
        )
    print(f"OK: {len(images)} ページをラスタライズし、{len(args.rect)} 矩形を墨消ししました: {args.output}")
    print("注意: 出力 PDF は画像化されておりテキスト選択・検索はできません。最終確認は人間が行ってください。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
