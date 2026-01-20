---
name: awwwards-website
description: Instructions and best practices for creating advanced, award-winning websites in a single HTML file (no React) with focus on immersive UX, premium motion, and high-end aesthetics.
---

# Awwwards Website Skill (Single-File Elite)

This skill provides a definitive framework for building high-end, immersive websites that aim for technical and design excellence, all contained within a single `index.html` file.

## Strategic Storytelling Framework

Award-winning sites are not "pages"; they are **experiences**. Prioritize this narrative structure:

1.  **The Hook (Hero)**: A visually explosive entry that sets the tone instantly. Must include a primary reveal (e.g., text splitting, mask reveal).
2.  **The Setup (Narrative)**: A section that introduces the core message through kinetic typography and smooth transitions.
3.  **The Journey (Chapters)**: Use at least 3 distinct "chapters" (sections) each with a unique visual trick (Parallax, Horizontal Scroll, Masking).
4.  **The Climax (Showcase)**: The most interactive part—an immersive gallery, a 3D-effect product showcase, or a complex motion sequence.
5.  **The Resolution (Footer)**: A high-impact closing that leaves a lasting impression, often with an oversized "magnetic" call-to-action.

## Mandatory Premium Sections

**NEVER generate less than 7 sections.** Every section must have a unique interactive hook:

| Section | Interactive Hook | Visual Pattern |
| :--- | :--- | :--- |
| **01. Hero** | Liquid reveal / Large SplitText | Oversized Typography + Masking |
| **02. Brand Narrative**| Scroll-triggered opacity fading | Floating decorative elements |
| **03. Core Expertise** | Interactive Bento Grid | Hover-active glow / glassmorphism |
| **04. Process/Legacy** | Horizontal sticky scroll | Large background numbers (Parallax) |
| **05. Immersive Gallery**| Canvas based drag or Tilt effect | Mixed Aspect Ratios / Grainy masks |
| **06. Testimonial** | Magnetic text tracking cursor | Minimalist fluid scaling |
| **07. Grand Finale** | Full-screen liquid CTA | Inverted colors / Massive Footer |

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

### 5. Liquid Mask Reveal (GSAP)
Use this for high-impact section entries:
```javascript
gsap.to(".mask-el", {
  clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
  duration: 1.5,
  ease: "expo.out",
  scrollTrigger: { trigger: ".target", start: "top 80%" }
});
```

## Cinematic Excellence & Forbidden Patterns

- **[FORBIDDEN]** Simple block backgrounds. **[USE]** Gradients, grainy textures, and noise overlays.
- **[FORBIDDEN]** Standard scroll. **[USE]** Lenis for smooth momentum-based scrolling.
- **[FORBIDDEN]** Static images. **[USE]** Parallax (GSAP ScrollTrigger) and subtle CSS scale on scroll.
- **[FORBIDDEN]** Standard links. **[USE]** Magnetic buttons that track the cursor with a spring effect.

## References & Deep Dives

For detailed blueprints and technical deep dives, refer to the following local resources:

- **[Cinematic Storytelling](file:///Users/manyeya/Documents/Code/Open-source/vibes/skills/awwwards-website/references/storytelling.md)**: Narrative flow and scrollytelling.
- **[Motion Design & GSAP](file:///Users/manyeya/Documents/Code/Open-source/vibes/skills/awwwards-website/references/motion-design.md)**: Easing, parallax, and liquid reveals.
- **[Typography & Editorial Layout](file:///Users/manyeya/Documents/Code/Open-source/vibes/skills/awwwards-website/references/typography.md)**: Fluid type and kinetic text.
- **[Organic Interaction](file:///Users/manyeya/Documents/Code/Open-source/vibes/skills/awwwards-website/references/interaction.md)**: Magnetic effects and custom cursors.
- **[Assets & Visual Polish](file:///Users/manyeya/Documents/Code/Open-source/vibes/skills/awwwards-website/references/assets.md)**: Typography pairing, noise textures, and media strategy.

---
Think of every page as a **piece of art**. The goal is a 10/10 Creative Excellence score.

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
