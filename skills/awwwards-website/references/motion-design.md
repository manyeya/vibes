# Reference: Premium Motion Design & GSAP

Motion is the lifeblood of an award-winning site. It should feel organic, physics-based, and intentional.

## 1. Easing: The Secret to "Premium"
**NEVER use linear easing.** High-end motion uses custom easing curves to give elements "weight".
- **Ease-Out**: Best for UI elements that need to feel responsive.
- **Expo.Out / Power4.Out**: Standard for "Awwwards" style reveals—fast start, very long tail.
- **Custom Bezier**: Use `cubic-bezier(.77,0,.175,1)` for an elegant, dramatic feel.

## 2. GSAP "Awwwards" Patterns

### The "Liquid" Reveal
Use `clip-path` to make sections feel like they are flowing into view.
```javascript
gsap.to(".section", {
  clipPath: "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)",
  duration: 1.5,
  ease: "expo.out"
});
```

### Advanced Parallax
Assign different speeds to layers to create depth.
```javascript
gsap.to(".layer-fast", {
  y: -200,
  scrollTrigger: { scrub: true }
});
gsap.to(".layer-slow", {
  y: -50,
  scrollTrigger: { scrub: true }
});
```

### Scrubbing vs. Toggling
- **Scrub**: Link animation progress directly to scroll position. Best for parallax.
- **ToggleActions**: Fire an animation when it enters the viewport. Best for text reveals.

## 3. Performance Best Practices
- **Use `will-change: transform`**: Hint the browser for hardware acceleration.
- **Transform > Layout**: Always animate `x`, `y`, `scale`, and `rotation` instead of `top`, `left`, `width`, or `height` to avoid expensive layout paints.
- **Batching**: Use `ScrollTrigger.batch()` for lists/grids to animate many elements efficiently as they scroll into view.
