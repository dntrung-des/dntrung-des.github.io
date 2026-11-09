#!/usr/bin/env python3
"""
Bundle Modular CSS into main.preview.css
Resolves @import statements in assets/css/src/index.css into a single flat file.
"""
import os
import re
import sys

SRC_DIR = 'assets/css/src'
INDEX_FILE = os.path.join(SRC_DIR, 'index.css')
OUTPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else 'assets/css/main.css'

def bundle():
    with open(INDEX_FILE, 'r', encoding='utf-8') as f:
        index_content = f.read()

    def replace_import(match):
        rel_path = match.group(1) or match.group(2)
        full_path = os.path.normpath(os.path.join(SRC_DIR, rel_path))
        if os.path.exists(full_path):
            with open(full_path, 'r', encoding='utf-8') as sf:
                content = sf.read().strip()
            return f"/* >>> BEGIN {rel_path} >>> */\n{content}\n/* <<< END {rel_path} <<< */"
        else:
            print(f"Warning: imported file not found: {full_path}")
            return f"/* Missing: {rel_path} */"

    bundled_body = re.sub(
        r'@import\s+(?:url\([\'"]?([^\'")]+)[\'"]?\)|[\'"]([^\'")]+)[\'"]);',
        replace_import,
        index_content
    )

    header = ("/* ==========================================================================\n"
              "   PRODUCTION CSS BUNDLE (Generated from assets/css/src/)\n"
              "   DO NOT EDIT DIRECTLY. Source files are in assets/css/src/\n"
              "   ========================================================================== */\n\n")

    final_css = header + bundled_body
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
        out.write(final_css)

    o = final_css.count('{')
    c = final_css.count('}')
    line_count = len(final_css.splitlines())
    print(f"Bundled successfully to {OUTPUT_FILE}:")
    print(f"  Total lines : {line_count}")
    print(f"  Brace count : open={o}, close={c}, diff={o-c}")
    assert o == c, "Error: Brace imbalance in bundled file!"

if __name__ == '__main__':
    bundle()
