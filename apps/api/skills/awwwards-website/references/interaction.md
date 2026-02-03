# Reference: Organic Interaction & UI Physics

Interaction should feel physical and "organic" rather than digital and static.

## 1. Magnetic Elements
Buttons and links should exert a "pull" on the cursor as it nears them.
- **Spring Physics**: Use GSAP to animate the element toward the cursor with a slight overshoot.
- **Inertia**: When the cursor leaves, the element should bounce back to its original position naturally.

## 2. Custom Responsive Cursors
A standard pointer is too generic for award-winning sites.
- **The "Follower"**: A circle that follows the cursor with a slight delay (`lerp`).
- **Contextual Change**: The cursor should expand, change color, or display text (e.g., "VIEW", "DRAG") depending on what it is hovering over.

## 3. Surface Polish
- **Noise Overlays**: A subtle fixed noise layer (film grain) adds texture and depth to the entire screen.
- **Glassmorphism**: Use `backdrop-filter: blur()` for overlays to maintain visual context.
- **Physics-Based Scroll**: Use Lenis to give the page a sense of "weight" and "friction."

## 4. Micro-Interactions
- **Magnetic Buttons**: Elements that "stick" to the mouse.
- **Reveals on Hover**: Hidden info that slides in smoothly when hovered.
- **Sound (Optional)**: Very subtle micro-click sounds for button interactions (standard in premium "web experiences").
