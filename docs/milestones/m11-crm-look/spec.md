# M11. Callit in the CRM's look

- Status: **Panel built and live 13 November 2026** on the owner's go-ahead ("fix the theme sync with CRM"), taken from the CRM's own stylesheet; screenshots in `screens/`. App colours built, shipping with the next app release (0.5.2). Defaults used for C1 to C3: sidebar like the CRM, panel plus app colours, ReapLift's logo with "Callit".
- Owner: unassigned
- Starts after: none (panel and app styling only)
- External prerequisites: two or three screenshots of the CRM's main pages from the client, to confirm what they see matches the CRM's code

## Outcome

The Callit panel, and the app where it makes sense, look like part of ReapLift's CRM: the same colours, fonts, icons, buttons, tables and sidebar. A manager moving between the CRM and Callit sees one product.

## What the CRM uses (read from its code, `reaplift/crm-laravel`, 12 November 2026)

| | CRM | Callit today |
| --- | --- | --- |
| Template | Bootstrap 5 admin template ("NiceAdmin" layout: left sidebar, top header, cards) | Hand-written CSS, top tabs |
| Main colour | Purple `#92419a` (buttons, active items) | Purple `#4b2bd6` |
| Headings | Navy `#012970` | Near-black |
| Links, highlights | Blue `#4154f1`; orange accent `#ff7d09` | Purple |
| Page background | `#f6f9ff` | `#f6f7f9` |
| Fonts | Open Sans (text), Nunito and Poppins (headings, sidebar) | System font |
| Icons | Google Material Icons (sidebar), Bootstrap Icons | None |
| Layout | Left sidebar with icons and labels, top header with the user menu | Top tabs |

The CRM's pages mix several older themes (some pages also carry Font Awesome, Remix Icon and Boxicons). Callit follows the main layout (`layouts.page`), which 86 of its pages use.

## Proposed design (to approve)

- **Panel:** a left sidebar like the CRM's, with Material icons (Dashboard, Call history, Reports, Employees, Teams, Settings), and a top header with the company name and user menu. Colours, fonts and button and table styles taken from the CRM. The dashboard cards and tiles keep their layout in the new colours.
- **App:** the CRM's purple as the main colour, and Poppins for headings. The app keeps Android's own controls (Material 3), because a website's look doesn't carry over to phone screens one to one.
- **Design first:** a design page with the panel's Dashboard, Call history and Settings in the CRM's look, beside a screenshot of the CRM, for the client to approve.

## Scope

In: panel theme (colours, fonts, icons, sidebar, buttons, tables, forms), app colours and heading font, the install page and login page.

Out: changes to the CRM itself; a theme picker; per-company branding (each company's own logo and colours), which can come later if a client asks.

## What was built (13 November 2026)

- **Panel:**
  - **Look and layout:** the CRM's peach-to-lavender background image, a floating white sidebar with ReapLift's logo and Material icons, translucent content area, Poppins (self-hosted, so the panel still loads nothing from other sites).
  - **Colours:** purple buttons and active items, navy page titles, pink-edged cards; dashboard figures in the CRM's orange, with its purple gradient on hover.
  - **Narrow screens:** the sidebar becomes a bar at the top.
- **App:** a Callit theme in the CRM's purple and orange (`ui/Theme.kt`) for the main screens and the after-call pop-up.
- Screens: `screens/login.png`, `dashboard.png`, `calls.png`, `settings.png`, `phone.png` (local test data).

## Open questions (default in brackets; built with the defaults, change on request)

- C1. Use the CRM's sidebar layout, or keep Callit's top tabs in the CRM's colours? [Sidebar, like the CRM.]
- C2. Should the app change too, or only the panel? [Both: the panel fully, the app's colours and heading font.]
- C3. Callit's own logo, or the CRM's/ReapLift's? [ReapLift's logo with "Callit".]

## Demo

Side by side in a browser: the CRM's leads page and Callit's dashboard. The colours, fonts, icons, buttons and sidebar match. The panel works at phone width.
