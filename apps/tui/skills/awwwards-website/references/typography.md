# Reference: Typography & Editorial Layout

In high-end design, typography is often the lead visual element, not just a way to deliver text.

## 1. Fluid Typography (`clamp`)
Eliminate media-query-based sizing. Use the viewport to scale type perfectly between mobile and desktop.
```css
h1 {
  font-size: clamp(3rem, 12vw, 10rem);
  line-height: 0.9;
  letter-spacing: -0.05em;
}
```

## 2. Kinetic Typography
Text that "arrives."
- **SplitType**: Break text into lines, words, or characters.
- **GSAP Stagger**: Animate pieces sequentially for a "ripple" effect.
```javascript
const text = new SplitType('#header');
gsap.from(text.chars, {
  y: 100,
  opacity: 0,
  stagger: 0.05,
  ease: "back.out"
});
```

## 3. Editorial Layout Patterns
- **Oversized Headlines**: Headlines that take up the majority of the hero section.
- **Negative Space**: Use generous whitespace to create "breathing room" and focal points.
- **Mix Aspect Ratios**: Use a mix of portrait and landscape images to create a magazine-like feel.
- **Mixed Fonts**: Pair a high-end Serif for titles with a clean Sans-Serif for body text (e.g., *Editorial New* + *Inter*).

## 4. Hierarchy Hacks
- **The "Hero Index"**: Small, secondary labels next to massive titles.
- **Floating Labels**: Decorative text (dates, tags) that moves independently of the main block on scroll.
