# Reference: Assets & Visual Polish

In the **Vibes Single-File Elite** workflow, assets are the difference between a "flat" site and a "premium experience." This guide covers how to manage media, typography, and textures.

## 1. The `assets/` Directory
The `assets/` folder in this skill contains pre-configured resources to speed up development:
- **[premium-base.css](file:///Users/manyeya/Documents/Code/Open-source/vibes/skills/awwwards-website/assets/premium-base.css)**: A normalized CSS reset optimized for Lenis (smooth scroll) and custom cursors.

## 2. Premium Typography
Award-winning sites avoid default system fonts. Always use high-contrast pairings:
- **Display (Headlines)**: Use fonts with unique personalities like *Outfit*, *Playfair Display*, or *Syncopate*.
- **Body**: Use highly legible, modern Sans-Serifs like *Inter* or *Manrope*.
- **Implementation**: Load via Google Fonts CDN or Adobe Fonts.
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Outfit:wght@900&display=swap" rel="stylesheet">
```

## 3. Visual Textures (Grain & Noise)
To avoid a "clinical" digital look, add an organic texture overlay.
- **SVG Noise**: Use a small, tiled SVG as a fixed background overlay.
```css
.noise-overlay {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.04;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}
```

## 4. Image Strategy
- **Unsplash/Pexels**: For high-quality placeholders. Use the Unsplash Source API for dynamic high-res imagery.
- **Lazy Loading**: Always use `loading="lazy"` for off-screen assets.
- **Aspect Ratios**: Use `aspect-ratio` to prevent layout shifts during scrollytelling.

## 5. CSS Glassmorphism
Use backdrop filters to add layering and depth to your sections.
```css
.glass-panel {
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
}
```
