# KeepUp

KeepUp is a premium, high-fidelity movie and TV show tracking web application. It integrates with **The Movie Database (TMDB) API** for search and metadata discovery, and uses **Supabase** for user authentication, watchlist synchronization, social group chats, and TV show episode tracking.

---

## 🌟 Key Features

*   **Watchlist Manager**: Track movies and TV shows across standard status categories (*Planning to Watch*, *Watching*, *Completed*, *On Hold*, *Dropped*).
*   **Show Tracker Accordion**: Incremental episode logging, auto-completing preceding episodes, and season-based accordions in details modals.
*   **Watch Statistics**: High-fidelity charts showing Total Watch Time, Completed Titles, Episodes Logged, Status Distribution, and Genre Breakdowns.
*   **Monthly Wrapped**: Relive your watch history month by month! An interactive, full-screen, story-like slideshow (inspired by Spotify Wrapped) highlighting your minutes spent, completed movies, top TV shows, and top genres for any active month, featuring copy-to-clipboard sharing.
*   **Liquid Glass Theme**: A gorgeous, frosted glassmorphism visual layout spanning across all screens and components (top navigation, side drawer, cards, forms, and overlays) with responsive mobile overrides.
*   **Can't Decide? Pick for Me!**: Random picker engine matching watchlist entries.
*   **Social Dashboard**: Connect with friends, create watch groups, and chat in real-time.

---

## 🛠️ Technologies Used

*   **Frontend**: Vanilla HTML5, Vanilla CSS3 (Liquid Glass layout, custom animations), Vanilla ES6 JavaScript.
*   **Backend Services**: Supabase (Database, Auth, RLS Policies).
*   **APIs**: TMDB API Proxy serverless functions.

---

## ⚙️ Setup & Deployment

1.  **Database Schema**: Execute [supabase_social.sql](supabase_social.sql) inside your Supabase SQL Editor.
2.  **Environment Variables**:
    Configure `TMDB_API_KEY` on Vercel or your local environment.
3.  **Run Locally**: Open `index.html` in any modern web browser.
