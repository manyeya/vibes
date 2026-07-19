---
name: design-taste-frontend
description: Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check.
source: Reconstructed from Leonxlnx/taste-skill (https://github.com/Leonxlnx/taste-skill) public docs/spec. Replace with the official `npx skills add Leonxlnx/taste-skill --skill "design-taste-frontend"` output for exact v2 behavior.
---

# tasteskill: Anti-Slop Frontend Skill (v2)

> Landing pages and portfolios that do not look like every other AI-generated site.

## 0. MANDATE
Default LLM frontends are templated, symmetric, and safe to the point of boredom.
This skill overrides that bias. Before writing a single line of CSS, you infer the
*right* design direction from the brief, then enforce metric-driven rules so the
output is distinctive, motion-rich, and engineered — not generic.

## 1. ACTIVE BASELINE CONFIGURATION
Set three dials per project. Do not ship without them.

* `DESIGN_VARIANCE`: 8  (1 = perfect symmetry, 10 = artsy chaos)
* `MOTION_INTENSITY`: 6  (1 = static, 10 = cinematic magic physics)
* `VISUAL_DENSITY`: 4    (1 = art-gallery airy, 10 = pilot-cockpit packed)

**AI Instruction:** The standard baseline for all generations is strictly set above.
Push variance up for expressive/agency work; pull density down for premium/luxury.

## 2. WORKFLOW
1. **Read the brief first.** Infer the aesthetic direction (SaaS minimalist, agency
   experimental, premium consumer, editorial, dark-tech, luxury…). Never default.
2. **Audit-first on redesigns.** Compare against the existing site; list what is
   templated/cheap before changing anything.
3. **Strict pre-flight check** (see §4) before finalizing.
4. **Ship** with hardware-accelerated CSS, balanced component architecture, and
   intentional spacing.

## 3. ANTI-SLOP RULES
- Ban 6-line text wraps in hero/display type — go editorial and wide.
- Use gapless bento grids with intentional asymmetry.
- Real design-system tokens (spacing scale, type scale, color) — no magic numbers.
- Generous section spacing; let the page breathe.
- Motion must mean something: pinning, stacking, scrubbing via GSAP ScrollTrigger.
- Inline micro-images / texture (grain, noise) to avoid flat digital look.

## 4. PRE-FLIGHT CHECKLIST (all must pass)
- [ ] Design direction explicitly chosen from the brief (not defaulted)
- [ ] DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY dials set & justified
- [ ] No generic centered hero with one CTA and a stock gradient
- [ ] Type scale uses `clamp()`; spacing uses a token scale
- [ ] At least one scroll-driven motion (pin / scrub / reveal)
- [ ] No placeholder lorem; real, sourced or plausible content
- [ ] Single self-contained file where required (no build step) OR clean component tree

## 5. WHEN TO USE
Landing pages, portfolios, product/startup sites, event/cause pages, and redesigns.
Pairs well with Awwwards-style immersive builds.
