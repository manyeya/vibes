---
name: awwwards-website
description: Instructions and best practices for creating advanced, award-winning websites in a single HTML file (no React) with focus on immersive UX, premium motion, and high-end aesthetics.
---

# Awwwards Website Skill (Single-File Elite)

This skill provides a definitive framework for building high-end, immersive websites that aim for technical and design excellence, all contained within a single `index.html` file.

## Core Principles

0. **Experimental Inspiration**: Draw deeply from [Codrops](https://tympanus.net/codrops/) for experimental UI patterns, creative motion, and technical "blueprints."
1. **Self-Contained Power**: Standalone `index.html`. No build steps. No `node_modules`.
2. **Kinetic Typography**: Text shouldn't just be there; it should arrive. Use reveal animations and fluid scaling.
3. **Organic Interaction**: Use magnetic effects, custom cursors, and physics-based momentum (Lenis).
4. **Visual Depth**: Layering, glassmorphism, grainy textures, and subtle noise to avoid a "flat" digital look.

## Premium Tech Stack (via CDN)

Always use these latest versions for maximum features and stability:

- **Core Motion**: [GSAP 3.x](https://gsap.com/) (`https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js`)
- **Scroll Hijacking**: [Lenis](https://github.com/darkroomengineering/lenis) (`https://unpkg.com/lenis@1.1.18/dist/lenis.min.js`)
- **Scroll Triggers**: [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) (`https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js`)
- **Text Splitting**: [SplitType](https://github.com/lukePeavey/SplitType) (`https://unpkg.com/split-type`) — *Essential for character/line reveals.*

## Advanced Design Patterns

### 1. Fluid Typography & Spacing
Use `clamp()` for truly responsive, award-winning type:
```css
:root {
  --fluid-h1: clamp(3rem, 10vw, 8rem);
  --fluid-p: clamp(1rem, 1.5vw, 1.25rem);
}
```

### 2. Grainy Texture (The "Film" Look)
Add a subtle noise overlay to the `body` or specific sections:
```css
.noise {
  position: fixed;
  top: 0; left: 0; width: 100%; height: 100%;
  z-index: 9999; pointer-events: none;
  opacity: 0.05;
  background-image: url("data:image/svg+xml,..."); /* SVG noise pattern */
}
```

### 3. Magnetic Interaction (GSAP)
Apply to buttons and links for a premium feel:
```javascript
const magnetic = (el) => {
  el.addEventListener('mousemove', (e) => {
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = e.clientX - (left + width / 2);
    const y = e.clientY - (top + height / 2);
    gsap.to(el, { x: x * 0.3, y: y * 0.3, duration: 0.5 });
  });
  el.addEventListener('mouseleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.5 }));
};
```

### 4. Custom Responsive Cursor
A custom circle cursor that expands on hover is a staple of Awwwards designs.

## Implementation Workflow

1. **Structure**: Semantic HTML with clean class naming (BEM or similar).
2. **Style**: Define a strict color palette and spacing system in `:root`.
3. **Animate**: 
   - Initialize `Lenis` first.
   - Use `SplitType` for all headline reveals.
   - Set up `ScrollTrigger` for parallax and scroll-reveal triggers.
4. **Polish**: Add magnetic buttons, noise overlays, and smooth page transitions (even in a single file via ID navigation).

## Final Template Reference

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Name | Awwwards Experience</title>
    <!-- CSS Reset & Premium Styles -->
    <style>
        :root { --accent: #ff4d00; --bg: #0f0f0f; --text: #f0f0f0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: var(--bg); color: var(--text); overflow-x: hidden; font-family: 'Inter', sans-serif; }
        .reveal { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }
    </style>
</head>
<body>
    <div class="noise"></div>
    <main data-scroll-container>
        <!-- Sections go here -->
    </main>

    <!-- JS Stack -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
    <script src="https://unpkg.com/lenis@1.1.18/dist/lenis.min.js"></script>
    <script src="https://unpkg.com/split-type"></script>
    <script>
        // Start Lenis
        const lenis = new Lenis();
        function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
        requestAnimationFrame(raf);

        // Advanced Logic
    </script>
</body>
</html>
```
