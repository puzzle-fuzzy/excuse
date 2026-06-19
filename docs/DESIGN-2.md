---
name: Monolith Creative
colors:
  surface: '#fbf8ff'
  surface-dim: '#dbd8e6'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f2ff'
  surface-container: '#efecfa'
  surface-container-high: '#e9e6f4'
  surface-container-highest: '#e3e1ef'
  on-surface: '#1b1b24'
  on-surface-variant: '#334b4f'
  inverse-surface: '#302f3a'
  inverse-on-surface: '#f2effd'
  outline: '#637b80'
  outline-variant: '#b1cbd0'
  surface-tint: '#6349c2'
  primary: '#6349c2'
  on-primary: '#ffffff'
  primary-container: '#e7deff'
  on-primary-container: '#4b2da8'
  inverse-primary: '#cbbeff'
  secondary: '#1c6586'
  on-secondary: '#ffffff'
  secondary-container: '#c4e7ff'
  on-secondary-container: '#004c69'
  tertiary: '#575991'
  on-tertiary: '#ffffff'
  tertiary-container: '#e1e0ff'
  on-tertiary-container: '#3f4178'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e7deff'
  primary-fixed-dim: '#cbbeff'
  on-primary-fixed: '#1e0060'
  on-primary-fixed-variant: '#4b2da8'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#8fcef4'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#13144a'
  on-tertiary-fixed-variant: '#3f4178'
  background: '#fbf8ff'
  on-background: '#1b1b24'
  surface-variant: '#e3e1ef'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: '0'
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.1em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1'
    letterSpacing: 0.02em
  headline-md-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.2'
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-page: 32px
  panel-padding: 24px
  component-gap: 8px
---

## Brand & Style

The design system is engineered for professional creative workflows, prioritizing extreme focus and instrumental precision. The brand personality has shifted to a "Gallery Light" aesthetic—vibrant yet organized. It acts as a sophisticated, high-energy frame for creative content, utilizing a more expressive color palette to inject personality into a structured environment.

The aesthetic is rooted in **Modern Professionalism** with organic vibrancy. It avoids the austerity of typical creative tools in favor of a welcoming, light-filled studio feel. The goal is to evoke the feeling of a premium physical workspace—clean, high-energy, and reliable. The target audience is senior editors and designers who require a clear, high-contrast environment that aids differentiation through color.

## Colors

The palette has transitioned from a strictly achromatic scale to a vibrant "Fruit Salad" color variant, optimized for a light-mode interface.

- **Primary Canvas (#fcf8ff):** A clean, paper-like base that provides a neutral but warm foundation.
- **Surface (#f1edf4):** Used for primary interface panels and sidebars to provide soft structural separation.
- **Elevated Surface (#ffffff):** Reserved for floating menus or active content containers to make them pop against the background.
- **Primary Action (#3a1698):** A deep, authoritative violet used for primary buttons and critical focus states.
- **Secondary/Tertiary Accents:** Muted blues (#3c7ea0) and violets (#7072ac) are used to categorize tools and indicate secondary interactive states.
- **Neutral Outlines (#777682):** Used for borders and secondary labels to maintain structural integrity without visual clutter.

The palette remains balanced to prevent visual fatigue while utilizing semantic color to improve navigation speed.

## Typography

This design system utilizes **Inter** exclusively to maintain a systematic, utilitarian feel. The hierarchy is driven by weight shifts and generous tracking rather than dramatic size changes.

- **Tracking:** Headlines should use slightly negative tracking (-1% to -2%) for a compact, "set" look. Labels and small metadata should use standard or slightly increased tracking (+2%) to maintain legibility on light backgrounds.
- **Weight:** Use `500` (Medium) for UI headings and `400` (Regular) for data. Reserve `600` (Semi-bold) for display titles and primary navigation.
- **Uppercase:** Use sparingly for section headers (`label-caps`) to create a clear architectural break between content areas.

## Layout & Spacing

The layout philosophy is a **Fixed-Panel Grid**, mirroring professional editing suites like DaVinci Resolve or Ableton Live. 

- **Grid:** A 12-column system is used for settings and dashboards, but the core workbench uses a 4-panel split (Left Sidebar, Main Stage, Right Inspector, Bottom Timeline/Status).
- **Rhythm:** All spacing is based on a 4px baseline.
- **Borders:** Panels are separated by 1px solid borders using the Neutral palette (#777682 at low opacity).
- **Adaptation:** On mobile, sidebars collapse into a bottom sheet or a full-screen overlay, maintaining the clean, outlined language.

## Elevation & Depth

In this design system, depth is communicated through **Tonal Layering** and **Soft Shadows**, prioritizing clarity over flatness.

- **Stacking:** The further "forward" an element is, the more it moves toward pure white (#ffffff) against the slightly tinted background.
- **Outlines:** Use 1px solid strokes for all containers to maintain the architectural feel.
- **Shadows:** Subtle, diffused ambient shadows are used for floating elements like popovers and modals to separate them from the primary workspace panels.

## Shapes

The design system utilizes a **Pill-shaped (Level 3)** approach, reflecting the modern and organic update to the brand identity.

- **Containers:** All main panels and windows feature a 1rem to 3rem corner radius to create a softer, more sophisticated aesthetic.
- **Interactive Elements:** Buttons and input fields use a full "pill" radius, providing a tactile and friendly quality to the creative workbench.

## Components

- **Buttons:** 
  - *Primary:* Solid Deep Violet background, White text, Pill-shaped. 
  - *Secondary:* 1px Border (#3c7ea0), Deep Violet text, no fill. 
  - *Ghost:* No border, Slate Blue text (#3c7ea0), soft tint fill on hover.
- **Inputs:** 1px border (#777682), White background, Pill-shaped. On focus, border changes to Primary Deep Violet (#3a1698).
- **Chips/Labels:** Small, 11px uppercase or 12px mixed-case text, pill-shaped with light tinted background fills.
- **Lists:** Moderate-density, 40px height per row to accommodate rounded corners. Hover state is a soft background shift to #f1edf4. 
- **Icons:** Use *Material Symbols (Rounded)*. Stroke weight should be medium (400) to align with the rounded shape language of the UI.
- **Tooltips:** Soft white background, 1px neutral border, subtle shadow.