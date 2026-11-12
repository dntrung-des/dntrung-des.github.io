#!/usr/bin/env python3
"""
Clean-Sheet CSS Extraction - Phase 3: Homepage
Extracts confirmed KEEP Homepage CSS into assets/css/src/4-homepage/
"""
import os

with open('assets/css/main.css', 'r', encoding='utf-8') as f:
    main_lines = f.readlines()

def get_slice(start_1idx, end_1idx):
    return ''.join(main_lines[start_1idx - 1 : end_1idx])

out_dir = 'assets/css/src/4-homepage'
os.makedirs(out_dir, exist_ok=True)

# --------------------------------------------------------------------------
# 1. _hero.css
# --------------------------------------------------------------------------
hero_content = f"""/* ==========================================================================
   4-homepage/_hero.css
   Homepage Hero Section, Rotating Headline, Parallax Elements & Social Icons
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Animated Rotating Headline
   -------------------------------------------------------------------------- */
{get_slice(5171, 5306).strip()}

/* --------------------------------------------------------------------------
   2. Hero Section 3 Layout, Grids & Responsive Styles
   -------------------------------------------------------------------------- */
{get_slice(6477, 7181).strip()}

/* --------------------------------------------------------------------------
   3. Hero Light Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9571, 9574).strip()}

{get_slice(9750, 9758).strip()}

{get_slice(9879, 9881).strip()}

{get_slice(9892, 9894).strip()}

{get_slice(9900, 9921).strip()}

{get_slice(9960, 9975).strip()}
"""

# --------------------------------------------------------------------------
# 2. _services.css
# --------------------------------------------------------------------------
services_content = f"""/* ==========================================================================
   4-homepage/_services.css
   Services Section 3, Panel Pinning, Matter.js Physics Canvas & Scrolling Text
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Services 3 Base & Panel Area
   -------------------------------------------------------------------------- */
{get_slice(7182, 7276).strip()}

/* --------------------------------------------------------------------------
   2. Services Capsule Matter.js Area & Background Scrolling Text
   -------------------------------------------------------------------------- */
{get_slice(7432, 7695).strip()}

/* --------------------------------------------------------------------------
   3. Services Light Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9575, 9580).strip()}

{get_slice(9595, 9597).strip()}

{get_slice(9882, 9886).strip()}

{get_slice(9947, 9949).strip()}

{get_slice(9951, 9953).strip()}
"""

# --------------------------------------------------------------------------
# 3. _accordion.css
# --------------------------------------------------------------------------
accordion_content = f"""/* ==========================================================================
   4-homepage/_accordion.css
   Base Accordion & Services Interactive FAQ / Service Detail Accordion
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Base Accordion Controls & States
   -------------------------------------------------------------------------- */
{get_slice(4447, 4643).strip()}

/* --------------------------------------------------------------------------
   2. Services Accordion Customized Layout & Expand States
   -------------------------------------------------------------------------- */
{get_slice(7277, 7430).strip()}

/* --------------------------------------------------------------------------
   3. Accordion Light Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9608, 9638).strip()}
"""

# --------------------------------------------------------------------------
# 4. _about.css
# --------------------------------------------------------------------------
about_content = f"""/* ==========================================================================
   4-homepage/_about.css
   Homepage About Section, Bio, Facts Counter & Award List
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. About Section Layout & Responsive Queries
   -------------------------------------------------------------------------- */
{get_slice(7696, 7850).strip()}

/* --------------------------------------------------------------------------
   2. About Theme Overrides (Dark & Light)
   -------------------------------------------------------------------------- */
{get_slice(9535, 9537).strip()}

{get_slice(9651, 9665).strip()}
"""

# --------------------------------------------------------------------------
# 5. _skills.css
# --------------------------------------------------------------------------
skills_content = f"""/* ==========================================================================
   4-homepage/_skills.css
   Skills Area, Interactive Design/Dev Tabs & Dynamic #lineMarker Slider
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Base Tabs Layout
   -------------------------------------------------------------------------- */
{get_slice(4646, 4657).strip()}

/* --------------------------------------------------------------------------
   2. Skills Grid & #lineMarker Navigation Pill
   -------------------------------------------------------------------------- */
{get_slice(8759, 8870).strip()}

/* --------------------------------------------------------------------------
   3. Skills Light Theme Overrides
   -------------------------------------------------------------------------- */
{get_slice(9691, 9736).strip()}
"""

files = {
    '_hero.css': hero_content,
    '_services.css': services_content,
    '_accordion.css': accordion_content,
    '_about.css': about_content,
    '_skills.css': skills_content,
}

print('Writing files and verifying brace balance...')
for fname, content in files.items():
    filepath = os.path.join(out_dir, fname)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')
    
    o = content.count('{')
    c = content.count('}')
    lines_count = len(content.splitlines())
    print(f'  {fname:<20}: {lines_count:>4} lines, {{={o:>3}, }}={c:>3}, diff={o-c:>2}')
    assert o == c, f'Brace imbalance in {fname}!'

print('All 5 Homepage files written and verified successfully!')
