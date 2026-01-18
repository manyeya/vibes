---
name: awwwards-website
description: Instructions and best practices for creating advanced, award-winning websites with a focus on immersive UX, high-end aesthetics, and fluid animations.
---

# Awwwards Website Skill

This skill provides a comprehensive framework for building websites that aim for the highest levels of design and technical excellence, specifically targeting "Site of the Day" quality on platforms like Awwwards.

## Core Principles

1. **Visual Excellence**: Every pixel matters. Use high-quality typography, balanced color palettes, and perfect spacing.
2. **Immersive Interaction**: Go beyond static layouts. Implement smooth scrolling, meaningful micro-animations, and interactive elements that respond to user input.
3. **Impeccable Performance**: High-end visuals must not compromise speed. Optimize assets, use hardware-accelerated animations (WebGL/GPU), and ensure fast load times.
4. **Fluid Motion**: Use physics-based animations (GSAP, Framer Motion) for a natural and premium feel.

## Recommended Tech Stack

- **Framework**: Next.js (App Router)
- **Styling**: Vanilla CSS or Tailwind CSS (only if requested)
- **Animations**: [GSAP](https://gsap.com/) (GreenSock Animation Platform)
- **Smooth Scroll**: [Lenis](https://github.com/darkroomengineering/lenis) or [Locomotive Scroll](https://locomotivemtl.github.io/locomotive-scroll/)
- **Gestures/Physics**: [Framer Motion](https://www.framer.com/motion/)
- **3D/WebGL**: [Three.js](https://threejs.org/) / [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- **Typography**: Optimized fonts (Inter, Montserrat, or custom variable fonts)

## Key "Awwwards" Features to Implement

### 1. Smooth Scrolling & Parallax
Always use a library like Lenis to normalize scroll behavior across browsers. Implement parallax effects on images and sections to add depth.

### 2. Custom Magnetic Cursors
Create custom cursors that react to hover states, often with a "magnetic" pull towards buttons and interactive elements.

### 3. Page Transitions
Use `AnimatePresence` (Framer Motion) or GSAP Flip to create seamless transitions between pages, avoiding harsh reloads.

### 4. Typography-led Design
Large, bold titles with custom masking or reveal animations are a staple of award-winning sites.

### 5. Micro-interactions
Subtle hover effects, progress bars, and feedback loops make the site feel "alive."

## Best Practices

- **Mobile First, Desktop Premium**: Ensure the site is fully functional on mobile, but push the boundaries of what's possible on desktop.
- **Accessibility (a11y)**: High-end design must be inclusive. Use proper ARIA labels, semantic HTML, and keyboard navigation support.
- **Asset Optimization**: Use WebP/AVIF for images and woff2 for fonts. Lazy load non-critical assets.
- **Consistent Grid**: Adhere to a strict grid system (usually 12 or 16 columns) for visual harmony.

## Tools and Assets
Check the `assets/` directory for starter templates and `scripts/` for helper utilities.
