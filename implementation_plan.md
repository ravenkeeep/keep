# Implementation Plan — Show Tracking Polish & Release Radar

This plan outlines the enhancements to synchronize and polish the TV show episode tracking feature and activate a premium Release Radar section on the homepage.

## Proposed Changes

### 1. Styling & UI Layer

#### [MODIFY] [styles.css](file:///c:/Users/degoat/Desktop/projects/official/styles.css)

*   **Move Show Tracking Styles out of JS:** Create CSS rules for `.show-tracking-row` and `.track-btn` so they are fully styled via stylesheets instead of inline script styles. This will include clean hover effects and a glassmorphic background matching the premium dark theme.
*   **Smooth Accordion Transitions:** Modify `.season-content` to transition smoothly when expanded instead of abruptly snapping from `display: none` to `display: block`.
*   **Countdown Badge Styling:** Design a sleek countdown badge (`.radar-countdown-badge`) for the Release Radar cards with subtle animations and indicator glows.

---

### 2. Logic & Synchronization Layer

#### [MODIFY] [script.js](file:///c:/Users/degoat/Desktop/projects/official/script.js)

#### **A. Show Tracking Polish & Sync**
*   **Update Card increment/decrement buttons:**
    *   When clicking `+` on episode (e.g. S1E1 ➔ S1E2): Increment the database progress AND insert the newly watched episode into `user_watched_episodes` (plus automatically mark all preceding episodes in that season as watched).
    *   When clicking `-` on episode (e.g. S1E2 ➔ S1E1): Decrement progress AND delete S1E2 from `user_watched_episodes`.
    *   When changing seasons via card: Reset the active progress episode count to 1 and update `user_watched_episodes` accordingly.
*   **Update Modal Checkbox changes:**
    *   When checking/unchecking a checkbox inside the details modal:
        *   Determine the highest season and episode checked as watched.
        *   Automatically update the watchlist item's progress (`season`, `episode`) in the database and local cache to keep the card progress in sync.

#### **B. Release Radar Activation & Details**
*   **Activate on Load:** Invoke `loadReleaseRadar()` during home page initialization (inside the `DOMContentLoaded` recommendations wrapper).
*   **Add Premium Countdown Badges:** Render a live countdown label on each Release Radar card by calling `calculateDaysUntilRelease()`.
*   **Ensure Correct Actions:** Verify that "Add to Watchlist" and "Play Trailer" buttons function correctly on all Release Radar cards.

---

## Verification Plan

### Automated Tests
* Run syntax/linter checks on `script.js` to ensure no syntax errors are introduced:
  `node --check script.js`

### Manual Verification
1.  **Release Radar:** Open the home page. The Release Radar section should display a scrollable track of upcoming movies and on-the-air shows with glowing countdown badges (e.g., "Releases in 3 days"). Clicking "Add to Watchlist" should instantly add the item.
2.  **Card Progress Sync:** Increment episode count on a TV show card in the watchlist. Open the show's detail modal; the episodes up to the new count should be checked.
3.  **Checkbox Sync:** Open a show's details modal. Uncheck or check episodes. Close the modal; the card's Season and Episode labels should automatically reflect the highest checked episode.
4.  **Accordion Animation:** Expand/collapse seasons in the details modal. The accordion should slide open smoothly.
