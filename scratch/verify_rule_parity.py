#!/usr/bin/env python3
"""
Verify selector and property parity between main.css and main.preview.css
for all Phase 2 Global Components.
"""
import re

with open('assets/css/main.css', 'r', encoding='utf-8') as f:
    main_css = f.read()

with open('assets/css/main.preview.css', 'r', encoding='utf-8') as f:
    preview_css = f.read()

def normalize(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.DOTALL)
    css = re.sub(r'\s+', ' ', css)
    return css

# Check critical selectors are present in preview_css
critical_selectors = [
    # Header
    '.header-dynamic',
    '.header-dynamic:hover',
    '.header-dynamic::before',
    '.header-logo',
    '.header-logo .logo_img',
    '.header-logo .logo_img_sm',
    '.header-spacer',
    '.header-items',
    '.header-items .header-item',
    '.header-items .header-item-right',
    '.header-cv-btn',
    '.nav-link-custom',
    '.nav-link-custom:hover',
    '.nav-link-custom.active',
    '.header-langs',
    '.langs-items',
    '.langs-item',
    '.header-dynamic.header-small',
    'html[tp-theme=tp-theme-light] .header-dynamic',
    'html[tp-theme=tp-theme-light] .header-small .header-items .header-item:first-child .nav-link-custom',

    # Footer
    '.tp-footer-3__img',
    '.tp-footer-3__shape-1',
    '.tp-footer-3__overlay-bg',
    '.tp-footer-3__widget',
    '.tp-footer-3__title',
    '.tp-footer-3__text p',
    '.tp-footer-3__link a',
    '.tp-footer-3__menu ul li a',
    '.tp-footer-3__logo img',
    '.tp-copyright-3__border-top',
    '.tp-copyright-3__left p',
    '.tp-copyright-3__social ul li a',

    # Theme toggle & back to top
    '.change-theme-bottom',
    '.back-to-top-wrapper',
    '.back-to-top-btn',
    '.tp-theme-toggle',
    '.tp-theme-toggle-main',
    '.tp-theme-toggle-main.light-active .tp-theme-toggle-slide',
    '.tp-theme-toggle-main.dark-active .tp-theme-toggle-slide',
    '.tp-theme-toggle-dark',
    '.tp-theme-toggle-light',
    'html[tp-theme=tp-theme-light] .tp-theme-toggle-main',
    'html[tp-theme=tp-theme-light] .tp-theme-toggle-slide',

    # Buttons
    '.tp-btn',
    '.tp-btn-white',
    '.tp-btn-blue',
    '.tp-btn-border-sm',
    '.tp-btn-border-md',
    '.tp-btn-pink-large',
    '.tp-btn-black-lg',
    'html[tp-theme=tp-theme-light] .tp-btn-white',
    'html[tp-theme=tp-theme-light] .tp-btn-blue:hover',
    'html[tp-theme=tp-theme-light] .ab-hero__btn-box .tp-btn-border-sm',
    'html[tp-theme=tp-theme-light] .porfolio-details__right-btn .tp-btn-border-md',
    'html[tp-theme=tp-theme-light] .blog-list__btn .tp-btn-black-lg',

    # Preloader
    '#loading',
    '#loading-center',
    '#loading-center-absolute',
    '.preloader__bar',
    '.preloader__bar-inner',
    '.preloader__logo',
    '.preloader__title',
    '.preloader__title-2',
    '.preloader__loading',
    '#tp-loading-number',

    # Cursor
    'body.tp-magic-cursor #magic-cursor',
    '#magic-cursor',
    '#ball',
    '#ball .ball-view',
    '#ball .ball-drag',
    '#ball.ball-close-enabled',
    '#ball .ball-close',
    '.tp-magnetic-wrap',
    'html[tp-theme=tp-theme-light] #ball',

    # Forms
    '.nice-select',
    '.nice-select .list',
    '.nice-select .option',
    '.tp-contact-2__title',
    '.tp-contact-2__top-info',
    '.tp-contact-2__input input',
    '.tp-contact-2__input .input-field~.focus-border',
    '.tp-contact-2__textarea textarea',
    '.tp-contact-2__select',
    '.tp-contact-2__btn',
    'html[tp-theme=tp-theme-light] .tp-contact-2__input input',
    'html[tp-theme=tp-theme-light] .tp-contact-2__select .nice-select span.current',

    # Section Title
    '.tp-section-subtitle',
    '.tp-section-subtitle-1',
    '.tp-section-subtitle-4',
    '.tp-section-subtitle-bg',
    '.tp-section-title',
    '.tp-section-title-3',
    '.tp-section-title-4',
    '.tp-section-title-wrapper p',
    '.tp-section-title-inner',
    'html[tp-theme=tp-theme-dark] .tp-section-subtitle',
    'html[tp-theme=tp-theme-light] .tp-section-title',
    'html[tp-theme=tp-theme-light] .tp-section-subtitle-bg',
]

missing = []
for sel in critical_selectors:
    # Look for selector before {
    escaped = re.escape(sel)
    pattern = rf'(?:^|[\s,}}]){escaped}[\s,{{]'
    if not re.search(pattern, preview_css):
        missing.append(sel)

print(f"Audited {len(critical_selectors)} critical selectors across all 8 global components:")
if missing:
    print(f"FAILED: {len(missing)} selectors missing:")
    for m in missing:
        print(f"  - {m}")
else:
    print(f"SUCCESS: 100% of {len(critical_selectors)} critical selectors present in main.preview.css!")
