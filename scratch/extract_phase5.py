#!/usr/bin/env python3
"""
Clean-Sheet CSS Extraction — Phase 5: Case Study
Generates:
  - assets/css/src/6-case-study/_showcase-pin.css
  - assets/css/src/6-case-study/_case-details.css
  - assets/css/src/6-case-study/_case-nav.css

Updates assets/css/src/index.css and runs bundle_preview.py
"""
import os
import subprocess

CASE_STUDY_DIR = 'assets/css/src/6-case-study'
os.makedirs(CASE_STUDY_DIR, exist_ok=True)

SHOWCASE_PIN_CSS = """/* ==========================================================================
   CASE STUDY: PROJECT SHOWCASE & PANEL PINNING
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Showcase Panel Pinning & Image Styles
   -------------------------------------------------------------------------- */
.porfolio-details__thumb-box .tp-portfolio-item-3 img {
  border-radius: 0px;
}

/* --------------------------------------------------------------------------
   2. Showcase Light Theme Overrides
   -------------------------------------------------------------------------- */
html[tp-theme=tp-theme-light] .tp-project-3__area {
  background-color: var(--tp-common-white);
}

html[tp-theme=tp-theme-light] .tp-project-3__area .tp-section-title-3 {
  color: var(--tp-common-black-5);
}

html[tp-theme=tp-theme-light] .porfolio-details__overview-wrapper {
  background-color: #F6F9FF;
}
"""

CASE_DETAILS_CSS = """/* ==========================================================================
   CASE STUDY: DETAILS, METADATA & HERO SCROLL
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Case Study Hero Scroll Indicator Animation
   -------------------------------------------------------------------------- */
@keyframes scroll-up-down {
  0% {
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
  }

  100% {
    -webkit-transform: translate3d(0, 10px, 0);
    transform: translate3d(0, 10px, 0);
  }
}

/* --------------------------------------------------------------------------
   2. Scroll-Down Indicator Component
   -------------------------------------------------------------------------- */
.tp-hero-3__scrool-down {
  display: flex;
  align-items: center;
  flex-direction: column;
  position: absolute;
  bottom: 80px;
  left: 100px;
}

@media only screen and (min-width: 1400px) and (max-width: 1599px) {
  .tp-hero-3__scrool-down {
    left: 40px;
  }
}

@media only screen and (min-width: 992px) and (max-width: 1199px) {
  .tp-hero-3__scrool-down {
    left: 30px;
  }
}

.tp-hero-3__scrool-down .text {
  font-weight: 500;
  font-size: 14px;
  line-height: 18px;
  text-transform: uppercase;
  color: #FFFFFF;
  transform: rotate(-90deg);
  margin-bottom: 30px;
}

.tp-hero-3__scrool-down span svg {
  -webkit-animation: scroll_anim 3s infinite;
  animation: scroll_anim 3s infinite;
}

.porfolio-details__color-customize .tp-hero-3__scrool-down .text {
  color: var(--tp-common-white);
}

.porfolio-details__color-customize .tp-hero-3__scrool-down {
  left: 20px;
}

.porfolio-details__color-customize .tp-hero-3__scrool-down span svg {
  animation: scroll-up-down 1s cubic-bezier(0.455, 0.03, 0.515, 0.955) infinite alternate;
  animation-delay: 0s;
  -webkit-animation-delay: 0.75s;
  animation-delay: 0.75s;
}

/* --------------------------------------------------------------------------
   3. Case Details Hero Image & Layout
   -------------------------------------------------------------------------- */
.porfolio-details__hero-img {
  height: 955px;
  overflow: hidden;
}

@media only screen and (min-width: 1200px) and (max-width: 1399px),
only screen and (min-width: 992px) and (max-width: 1199px) {
  .porfolio-details__hero-img {
    height: 800px;
  }
}

@media only screen and (min-width: 768px) and (max-width: 991px) {
  .porfolio-details__hero-img {
    height: 700px;
  }
}

@media (max-width: 767px) {
  .porfolio-details__hero-img {
    height: 500px;
  }
}

.porfolio-details__hero-img img {
  margin-top: -50px;
  height: 1200px;
  width: 100%;
  object-fit: cover;
}

@media only screen and (min-width: 768px) and (max-width: 991px),
(max-width: 767px) {
  .porfolio-details__left-info {
    margin-bottom: 70px;
  }
}

.porfolio-details__left-info-title {
  font-weight: 500;
  font-size: 26px;
  line-height: 18px;
  color: var(--tp-common-white);
  font-family: var(--tp-ff-didoneright);
  padding-bottom: 5px;
}

.porfolio-details__left-content {
  margin-bottom: 45px;
}

.porfolio-details__left-content span {
  font-weight: 400;
  font-size: 18px;
  line-height: 14px;
  color: rgba(255, 255, 255, 0.5);
  display: block;
  margin-bottom: 15px;
}

.porfolio-details__right-info p {
  font-weight: 400;
  font-size: 18px;
  line-height: 28px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 45px;
}

@media (max-width: 767px) {
  .porfolio-details__right-info p {
    font-size: 15px;
  }
}

.porfolio-details__right-info .tp-section-title-4 {
  line-height: 1.1;
}

.porfolio-details__overview-thumb {
  overflow: hidden;
  position: relative;
  width: auto;
  height: 100%;
}

.porfolio-details__overview-title {
  font-weight: 500;
  font-size: 40px;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--tp-common-white);
  font-family: var(--tp-ff-didoneright);
}

.porfolio-details__overview-right p {
  font-weight: 300;
  font-size: 30px;
  line-height: 40px;
  color: var(--tp-common-white);
  font-family: var(--tp-ff-didoneright);
  margin-bottom: 40px;
}

@media (max-width: 767px) {
  .porfolio-details__overview-right p {
    font-size: 24px;
    line-height: 30px;
  }
}

.porfolio-details__overview-list ul li {
  list-style-type: none;
  position: relative;
  padding-left: 17px;
  font-weight: 400;
  font-size: 18px;
  line-height: 1;
  color: var(--tp-common-white);
  margin-bottom: 20px;
}

@media (max-width: 767px) {
  .porfolio-details__overview-list ul li {
    font-size: 14px;
  }
}

.porfolio-details__overview-list ul li:last-child {
  margin-bottom: 0;
}

.porfolio-details__overview-list ul li::after {
  position: absolute;
  top: 7px;
  left: 0;
  height: 5px;
  width: 5px;
  background-color: var(--tp-common-white);
  content: "";
  border-radius: 50%;
}

.porfolio-details__result {
  padding-bottom: 30px;
  margin-bottom: 30px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.porfolio-details__result .child-1 {
  font-weight: 500;
  font-size: 70px;
  line-height: 1;
  letter-spacing: -0.01em;
  color: var(--tp-common-white);
  font-family: var(--tp-ff-didoneright);
  margin-right: 15px;
}

.porfolio-details__result .child-1 em {
  font-style: normal;
  width: 120px;
}

@media (max-width: 767px) {
  .porfolio-details__result .child-1 {
    font-size: 40px;
  }
}

.porfolio-details__result .child-2 {
  font-weight: 400;
  font-size: 18px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 0;
}

@media (max-width: 767px) {
  .porfolio-details__result .child-2 {
    font-size: 16px;
  }
}

/* --------------------------------------------------------------------------
   4. Case Details Light Theme Overrides
   -------------------------------------------------------------------------- */
html[tp-theme=tp-theme-light] .tp-hero-3__scrool-down .text {
  color: var(--tp-common-black-5);
}

html[tp-theme=tp-theme-light] .tp-hero-3__scrool-down span svg {
  filter: invert(100%) sepia(32%) saturate(304%) hue-rotate(200deg) brightness(105%) contrast(100%);
}

html[tp-theme=tp-theme-light] .porfolio-details__info-wrap {
  background-color: #F6F9FF;
}

html[tp-theme=tp-theme-light] .porfolio-details__left-info-title {
  color: var(--tp-common-black-5);
}

html[tp-theme=tp-theme-light] .porfolio-details__left-content span {
  color: #676B72;
}

html[tp-theme=tp-theme-light] .porfolio-details__right-title-box .tp-section-subtitle-4 {
  color: var(--tp-common-black-5);
}

html[tp-theme=tp-theme-light] .porfolio-details__right-title-box .tp-section-title-4 {
  color: var(--tp-common-black-5);
}

html[tp-theme=tp-theme-light] .porfolio-details__right-info p {
  color: #676B72;
}

html[tp-theme=tp-theme-light] .porfolio-details__right-btn .tp-btn-border-md {
  color: var(--tp-common-black-5);
  border: 1.5px solid rgba(0, 19, 47, 0.1);
}

html[tp-theme=tp-theme-light] .porfolio-details__right-btn .tp-btn-border-md:hover {
  background-color: var(--tp-common-black-5);
  color: var(--tp-common-white);
}
"""

CASE_NAV_CSS = """/* ==========================================================================
   CASE STUDY: NAVIGATION & FOOTER CONTROLS
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Case Navigation Preserved Rules
   -------------------------------------------------------------------------- */
/* Preserved case study navigation rule */
.postbox-details__area .porfolio-details__navigation-wrap {
  margin-top: 0px;
}

/* --------------------------------------------------------------------------
   2. Case Navigation Layout & Links
   -------------------------------------------------------------------------- */
.porfolio-details__navigation-wrap {
  margin-top: 350px;
}

@media only screen and (min-width: 768px) and (max-width: 991px),
only screen and (min-width: 576px) and (max-width: 767px),
(max-width: 767px) {
  .porfolio-details__navigation-wrap {
    margin-top: 100px;
  }
}

@media (max-width: 767px) {
  .porfolio-details__navigation-content {
    margin-bottom: 30px;
  }
}

@media (max-width: 767px) {
  .porfolio-details__navigation-content.next {
    margin-top: 30px;
  }
}

.porfolio-details__navigation-content.next a span {
  margin-left: 0;
  margin-right: 10px;
}

.porfolio-details__navigation-content a {
  color: var(--tp-common-white);
  font-family: var(--tp-ff-dmsans);
  font-weight: 400;
  font-size: 13px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 10px;
  display: inline-block;
  background-image: -webkit-radial-gradient(#fff, #fff), -webkit-radial-gradient(#fff, #fff);
  background-image: -moz-radial-gradient(#fff, #fff), -moz-radial-gradient(#fff, #fff);
  background-image: -ms-radial-gradient(#fff, #fff), -ms-radial-gradient(#fff, #fff);
  background-image: -o-radial-gradient(#fff, #fff), -o-radial-gradient(#fff, #fff);
  background-image: radial-gradient(#fff, #fff), radial-gradient(#fff, #fff);
  background-size: 0% 1px, 0 1px;
  background-position: 100% 100%, 0 91%;
  background-repeat: no-repeat;
}

.porfolio-details__navigation-content a:hover {
  background-size: 0 1px, 100% 1px;
}

.porfolio-details__navigation-content a span {
  margin-left: 10px;
}

.porfolio-details__navigation-content h4 {
  margin-bottom: 0;
  font-weight: 500;
  font-size: 36px;
  line-height: 1;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  color: var(--tp-common-white);
  font-family: var(--tp-ff-didoneright);
}

@media only screen and (min-width: 992px) and (max-width: 1199px) {
  .porfolio-details__navigation-content h4 {
    font-size: 30px;
  }
}

@media only screen and (min-width: 768px) and (max-width: 991px) {
  .porfolio-details__navigation-content h4 {
    font-size: 25px;
  }
}

@media (max-width: 767px) {
  .porfolio-details__navigation-content h4 {
    font-size: 20px;
  }
}

.porfolio-details__navigation-area .porfolio-details__navigation-wrap {
  margin-top: 0;
}

/* --------------------------------------------------------------------------
   3. Case Navigation Bar SVG Icons
   -------------------------------------------------------------------------- */
.porfolio-details__navigation-bar span svg .path-1 {
  color: var(--tp-common-white);
}

.porfolio-details__navigation-bar span svg .path-2 {
  color: var(--tp-common-white);
}

.porfolio-details__navigation-bar.porfolio-details__navigation-bar-2 span svg .path-1 {
  color: var(--tp-cream-2);
}

.porfolio-details__navigation-bar.porfolio-details__navigation-bar-2 span svg .path-2 {
  color: var(--tp-cream-2);
}

/* --------------------------------------------------------------------------
   4. Case Navigation Light Theme Overrides
   -------------------------------------------------------------------------- */
html[tp-theme=tp-theme-light] .porfolio-details__navigation-content h4 {
  color: var(--tp-common-black-5);
}

html[tp-theme=tp-theme-light] .porfolio-details__navigation-content a {
  color: var(--tp-common-black-5);
  background-image: -webkit-radial-gradient(#000, #000), -webkit-radial-gradient(#000, #000);
  background-image: -moz-radial-gradient(#000, #000), -moz-radial-gradient(#000, #000);
  background-image: -ms-radial-gradient(#000, #000), -ms-radial-gradient(#000, #000);
  background-image: -o-radial-gradient(#000, #000), -o-radial-gradient(#000, #000);
  background-image: radial-gradient(#000, #000), radial-gradient(#000, #000);
}

html[tp-theme=tp-theme-light] .porfolio-details__navigation-bar span svg .path-1 {
  color: var(--tp-common-black);
}

html[tp-theme=tp-theme-light] .porfolio-details__navigation-bar span svg .path-2 {
  color: var(--tp-common-black);
}

html[tp-theme=tp-theme-light] .porfolio-details__navigation-bar-2 span svg .path-1 {
  color: var(--tp-common-black);
}

html[tp-theme=tp-theme-light] .porfolio-details__navigation-bar-2 span svg .path-2 {
  color: var(--tp-common-black);
}
"""

files = {
    os.path.join(CASE_STUDY_DIR, '_showcase-pin.css'): SHOWCASE_PIN_CSS,
    os.path.join(CASE_STUDY_DIR, '_case-details.css'): CASE_DETAILS_CSS,
    os.path.join(CASE_STUDY_DIR, '_case-nav.css'): CASE_NAV_CSS,
}

for path, content in files.items():
    o = content.count('{')
    c = content.count('}')
    assert o == c, f"Brace mismatch in {path}: {o} vs {c}"
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content.strip() + '\n')
    lines = len(content.strip().splitlines())
    print(f"Created {path}: {lines} lines, {o} rule blocks (brace diff=0)")

# Update assets/css/src/index.css
INDEX_CSS = """/* ==========================================================================
   PORTFOLIO DESIGN SYSTEM & MODULAR CSS ENTRY POINT
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Tokens (Fonts, Custom Properties, Design Tokens)
   -------------------------------------------------------------------------- */
@import url("1-tokens/_fonts.css");
@import url("1-tokens/_variables.css");

/* --------------------------------------------------------------------------
   2. Foundation (Resets, Typography Base, Global Utilities)
   -------------------------------------------------------------------------- */
@import url("2-foundation/_reset.css");
@import url("2-foundation/_base.css");
@import url("2-foundation/_utilities.css");

/* --------------------------------------------------------------------------
   3. Global Components (Header, Footer, Controls, Base UI Elements)
   -------------------------------------------------------------------------- */
@import url("3-global/_header.css");
@import url("3-global/_footer.css");
@import url("3-global/_theme-toggle.css");
@import url("3-global/_buttons.css");
@import url("3-global/_preloader.css");
@import url("3-global/_cursor.css");
@import url("3-global/_forms.css");
@import url("3-global/_section-title.css");

/* --------------------------------------------------------------------------
   4. Homepage Components (Hero, Services, Accordion, About, Skills)
   -------------------------------------------------------------------------- */
@import url("4-homepage/_hero.css");
@import url("4-homepage/_services.css");
@import url("4-homepage/_accordion.css");
@import url("4-homepage/_about.css");
@import url("4-homepage/_skills.css");

/* --------------------------------------------------------------------------
   5. Portfolio Components (Tabs, Filter Controls, Project Grid, Cards)
   -------------------------------------------------------------------------- */
@import url("5-portfolio/_portfolio-tabs.css");
@import url("5-portfolio/_portfolio-grid.css");

/* --------------------------------------------------------------------------
   6. Case Study Components (Showcase Pin, Details, Navigation)
   -------------------------------------------------------------------------- */
@import url("6-case-study/_showcase-pin.css");
@import url("6-case-study/_case-details.css");
@import url("6-case-study/_case-nav.css");
"""

with open('assets/css/src/index.css', 'w', encoding='utf-8') as f:
    f.write(INDEX_CSS)

print("Updated assets/css/src/index.css")

# Bundle into main.preview.css
res = subprocess.run(['python3', 'scratch/bundle_preview.py'], capture_output=True, text=True)
print(res.stdout)
if res.stderr:
    print(res.stderr)
