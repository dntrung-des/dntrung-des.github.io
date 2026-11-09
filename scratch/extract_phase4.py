#!/usr/bin/env python3
"""
Clean-Sheet CSS Extraction - Phase 4: Portfolio Archive
Extracts confirmed KEEP Portfolio CSS into assets/css/src/5-portfolio/
"""
import os

with open('assets/css/main.css', 'r', encoding='utf-8') as f:
    main_lines = f.readlines()

def get_slice(start_1idx, end_1idx):
    return ''.join(main_lines[start_1idx - 1 : end_1idx])

out_dir = 'assets/css/src/5-portfolio'
os.makedirs(out_dir, exist_ok=True)

# --------------------------------------------------------------------------
# 1. _portfolio-tabs.css
# --------------------------------------------------------------------------
tabs_content = (
    "/* ==========================================================================\n"
    "   5-portfolio/_portfolio-tabs.css\n"
    "   Portfolio Archive Category Tabs, Filter Buttons & Header Layout\n"
    "   ========================================================================== */\n\n"
    "/* --------------------------------------------------------------------------\n"
    "   1. Header, Subtitle, Title & Category Filter Tabs\n"
    "   -------------------------------------------------------------------------- */\n"
    + get_slice(5683, 5842).strip() + "\n\n"
    "/* --------------------------------------------------------------------------\n"
    "   2. Portfolio Tabs Light Theme Overrides\n"
    "   -------------------------------------------------------------------------- */\n"
    + get_slice(10081, 10107).strip() + "\n\n"
    + get_slice(10123, 10127).strip() + "\n"
)

# --------------------------------------------------------------------------
# 2. _portfolio-grid.css
# --------------------------------------------------------------------------
grid_content = (
    "/* ==========================================================================\n"
    "   5-portfolio/_portfolio-grid.css\n"
    "   Portfolio Project Grid, Thumbnails, Hover Meta & Shared Project Showcase\n"
    "   ========================================================================== */\n\n"
    "/* --------------------------------------------------------------------------\n"
    "   1. Portfolio Typography & Transitions\n"
    "   -------------------------------------------------------------------------- */\n"
    ".tp-portfolio-meta-arrow::before,\n"
    ".tp-portfolio-meta-arrow svg,\n"
    ".tp-portfolio-meta-2 span,\n"
    ".tp-portfolio-title,\n"
    ".tp-portfolio-item-2 .tp-portfolio-view span,\n"
    ".tp-portfolio-title-2,\n"
    ".tp-portfolio-view-btn-3 span {\n"
    "  -webkit-transition: all 0.3s 0s ease-out;\n"
    "  -moz-transition: all 0.3s 0s ease-out;\n"
    "  -ms-transition: all 0.3s 0s ease-out;\n"
    "  -o-transition: all 0.3s 0s ease-out;\n"
    "  transition: all 0.3s 0s ease-out;\n"
    "}\n\n"
    ".tp-portfolio-title,\n"
    ".tp-portfolio-item-2 .tp-portfolio-view span,\n"
    ".tp-portfolio-meta-2 span,\n"
    ".tp-portfolio-title-2,\n"
    ".tp-portfolio-view-btn-3 span {\n"
    "  font-family: var(--tp-ff-dmsans);\n"
    "}\n\n"
    ".tp-portfolio-thumb-img {\n"
    "  position: absolute;\n"
    "  top: 0;\n"
    "  left: 0;\n"
    "  width: 100%;\n"
    "  height: 100%;\n"
    "  -webkit-transition: all 0.3s 0s ease-out;\n"
    "  -moz-transition: all 0.3s 0s ease-out;\n"
    "  -ms-transition: all 0.3s 0s ease-out;\n"
    "  -o-transition: all 0.3s 0s ease-out;\n"
    "  transition: all 0.3s 0s ease-out;\n"
    "}\n\n"
    "/* --------------------------------------------------------------------------\n"
    "   2. Small Category Badge (Cards)\n"
    "   -------------------------------------------------------------------------- */\n"
    + get_slice(6069, 6086).strip() + "\n\n"
    "/* --------------------------------------------------------------------------\n"
    "   3. Portfolio Cards, Grid Layout, Hover Overlays & Section 3 Showcase\n"
    "   -------------------------------------------------------------------------- */\n"
    + get_slice(7853, 8272).strip() + "\n\n"
    "/* --------------------------------------------------------------------------\n"
    "   4. Portfolio Grid Light Theme Overrides\n"
    "   -------------------------------------------------------------------------- */\n"
    + get_slice(9667, 9690).strip() + "\n\n"
    + get_slice(9976, 9983).strip() + "\n\n"
    + get_slice(10113, 10117).strip() + "\n"
)

files = {
    '_portfolio-tabs.css': tabs_content,
    '_portfolio-grid.css': grid_content,
}

print('Writing files and verifying brace balance...')
for fname, content in files.items():
    filepath = os.path.join(out_dir, fname)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')
    
    o = content.count('{')
    c = content.count('}')
    lines_count = len(content.splitlines())
    print(f'  {fname:<22}: {lines_count:>4} lines, {{={o:>3}, }}={c:>3}, diff={o-c:>2}')
    assert o == c, f'Brace imbalance in {fname}!'

print('All Phase 4 Portfolio files written and verified successfully!')
