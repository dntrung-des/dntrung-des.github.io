#!/usr/bin/env python3
"""
Clean-Sheet CSS Extraction - Phase 2: Global Components
Extracts confirmed KEEP Global Components into assets/css/src/3-global/
"""
import os

with open('assets/css/main.css', 'r', encoding='utf-8') as f:
    main_lines = f.readlines()

def get_slice(start_1idx, end_1idx):
    return ''.join(main_lines[start_1idx - 1 : end_1idx])

out_dir = 'assets/css/src/3-global'
os.makedirs(out_dir, exist_ok=True)

# --------------------------------------------------------------------------
# 1. _header.css
# --------------------------------------------------------------------------
header_content = f"""/* ==========================================================================
   3-global/_header.css
   Dynamic Floating Header (Navigation pill, logo states, responsive, light theme)
   ========================================================================== */

{get_slice(5444, 5674).strip()}

/* --------------------------------------------------------------------------
   Header Light Theme Overrides
   -------------------------------------------------------------------------- */

{get_slice(9888, 9890).strip()}

{get_slice(9896, 9898).strip()}
"""

# --------------------------------------------------------------------------
# 2. _footer.css
# --------------------------------------------------------------------------
footer_content = f"""/* ==========================================================================
   3-global/_footer.css
   Footer Style 2 (tp-footer-3, widgets, links, social, copyright, responsive)
   ========================================================================== */

{get_slice(6158, 6475).strip()}
"""

# --------------------------------------------------------------------------
# 3. _theme-toggle.css
# --------------------------------------------------------------------------
theme_toggle_content = f"""/* ==========================================================================
   3-global/_theme-toggle.css
   Theme Switcher & Back To Top Floating Action Controls
   ========================================================================== */

{get_slice(927, 1180).strip()}

/* --------------------------------------------------------------------------
   Theme Toggle Light Theme Overrides
   -------------------------------------------------------------------------- */

{get_slice(9558, 9570).strip()}

{get_slice(9760, 9768).strip()}

{get_slice(9922, 9925).strip()}
"""

# --------------------------------------------------------------------------
# 4. _buttons.css
# --------------------------------------------------------------------------
buttons_content = f"""/* ==========================================================================
   3-global/_buttons.css
   Active Global Button Components (.tp-btn, .tp-btn-white, .tp-btn-blue,
   .tp-btn-border-sm, .tp-btn-border-md, .tp-btn-pink-large, .tp-btn-black-lg)
   ========================================================================== */

/* Button Transitions */
{get_slice(43, 53).strip()}

/* Button SVG Vertical Alignment */
{get_slice(81, 89).strip()}

/* Base Button (tp-btn) */
{get_slice(1184, 1198).strip()}

/* Pink Large Pill Button (tp-btn-pink-large) */
{get_slice(1830, 1880).strip()}

/* Black Large Pill Button (tp-btn-black-lg) */
{get_slice(1907, 1952).strip()}

/* White Pill Button (tp-btn-white) */
{get_slice(1954, 2020).strip()}

/* Blue Pill Button (tp-btn-blue) */
{get_slice(2101, 2160).strip()}

/* Border Medium Pill Button (tp-btn-border-md) */
{get_slice(2162, 2189).strip()}

/* Border Small Pill Button (tp-btn-border-sm) */
{get_slice(2191, 2230).strip()}

/* --------------------------------------------------------------------------
   Buttons Light Theme Overrides
   -------------------------------------------------------------------------- */

{get_slice(9769, 9776).strip()}

{get_slice(9926, 9946).strip()}

{get_slice(9955, 9958).strip()}

{get_slice(9988, 9993).strip()}

{get_slice(10067, 10076).strip()}

{get_slice(10118, 10121).strip()}
"""

# --------------------------------------------------------------------------
# 5. _preloader.css
# --------------------------------------------------------------------------
preloader_content = f"""/* ==========================================================================
   3-global/_preloader.css
   Preloader Screen, Progress Bar, Logo Animation & Typography Keyframes
   ========================================================================== */

{get_slice(3847, 4180).strip()}
"""

# --------------------------------------------------------------------------
# 6. _cursor.css
# --------------------------------------------------------------------------
cursor_content = f"""/* ==========================================================================
   3-global/_cursor.css
   Magic Cursor & Follower Ball (#magic-cursor, #ball, drag, view, magnetic)
   ========================================================================== */

{get_slice(5309, 5441).strip()}
"""

# --------------------------------------------------------------------------
# 7. _forms.css
# --------------------------------------------------------------------------
forms_content = f"""/* ==========================================================================
   3-global/_forms.css
   Form Controls: Custom Nice Select & Contact Section 2 Form Inputs
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Nice Select Custom Dropdowns
   -------------------------------------------------------------------------- */
{get_slice(4256, 4443).strip()}

/* --------------------------------------------------------------------------
   2. Contact Section 2 Form Controls & Fieldsets
   -------------------------------------------------------------------------- */
{get_slice(8873, 9184).strip()}

/* --------------------------------------------------------------------------
   3. Form Light Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9805, 9874).strip()}
"""

# --------------------------------------------------------------------------
# 8. _section-title.css
# --------------------------------------------------------------------------
section_title_content = f"""/* ==========================================================================
   3-global/_section-title.css
   Typography System for Section Headings, Subtitles, Background Stroke & Badges
   ========================================================================== */

{get_slice(4808, 5041).strip()}

/* --------------------------------------------------------------------------
   Section Title Dark Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9539, 9548).strip()}

/* --------------------------------------------------------------------------
   Section Title Light Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9603, 9606).strip()}

{get_slice(9640, 9649).strip()}
"""

files = {
    '_header.css': header_content,
    '_footer.css': footer_content,
    '_theme-toggle.css': theme_toggle_content,
    '_buttons.css': buttons_content,
    '_preloader.css': preloader_content,
    '_cursor.css': cursor_content,
    '_forms.css': forms_content,
    '_section-title.css': section_title_content,
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

print('All 8 global component files written and verified successfully!')
