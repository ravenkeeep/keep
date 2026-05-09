/** GLOBAL CONFIGURATION **/
// This automatically switches between your local server and your deployed backend
window.API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? "http://localhost:5000/api" 
  : "https://your-backend-api.onrender.com/api"; // TODO: Replace with your actual Render backend URL

let path = window.location.pathname.split("/").pop() || "index.html";
// Normalize clean URLs for routing logic
if (path === "dashboard") path = "index.html";
if (path && !path.includes(".")) path += ".html";

const user = localStorage.getItem("keepup_user");

  // Inject Global Background Glow (Subtle radial purple)
  if (!document.getElementById('global-bg-glow')) {
    const glow = document.createElement('div');
    glow.id = 'global-bg-glow';
    glow.className = "fixed inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(147,51,234,0.1),transparent_50%)] pointer-events-none z-[-1]";
    document.body.prepend(glow);
    
    // Ensure body has base theme classes
    document.body.classList.add('bg-[#0b0b0f]', 'text-white', 'font-sans', 'selection:bg-purple-500/30');
  }

  // 1. Render Header
  const header = document.querySelector("header");
  if (header) {
    // This line makes the navbar sticky on all pages
    header.className = "flex flex-wrap items-center justify-between px-4 md:px-8 py-4 border-b border-gray-800 sticky top-0 bg-[#0b0b0f]/80 backdrop-blur-md z-50 gap-y-4";
    const navLinks = [
      { name: "Dashboard", href: "index.html" },
      { name: "Watchlist", href: "watchlist.html" },
      { name: "For You", href: "foryou.html" },
      { name: "Blog", href: "blog.html" },
      { name: "Discuss", href: "discuss.html" },
    ];

    const isLanding = path === "landing.html";
    
    // Consistent Logo Rendering
    const logoHtml = `
      <a href="index.html" class="flex items-center gap-2 group">
        <div class="bg-purple-600 p-1.5 rounded-lg group-hover:rotate-12 transition-transform"><i class="fa-solid fa-tv text-white text-xs"></i></div>
...

...
      <p class="text-gray-600 text-xs">© 2024 KeepUp. All cinematic rights reserved. Powered by TMDB.</p>
    `;
  }

  // 3. Page Protection
  const publicPages = ["landing.html", "login.html", "blog.html"];
  if (!user && !publicPages.includes(path)) {
    window.location.href = "landing.html";
  }

  // 4. Global UI Updates (e.g., display name for dashboard)
  const nameDisplay = document.getElementById("display-name");
  if (nameDisplay && user) {
    nameDisplay.innerText = user.split("@")[0];
  }

  // Update For You personalized text
  const recText = document.getElementById("personal-recommendation-text");
  if (recText && user) {
    recText.innerText = `AI recommendations for ${user.split("@")[0]} based on 0 tracked shows & ratings`;
  }

  // 5. Load Dashboard Specific Data if on index.html
  if (path === "index.html" && user) {
    loadDashboardStatsAndTrending(user);
  }
...
    // Safe updates: only update if elements are present on the current page
    const watchingEl = document.getElementById("stat-watching");