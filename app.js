/**
 * GLOBAL CONFIGURATION
 * Replace the URL below with your actual deployed Render backend URL
 */
window.API_BASE = "https://your-backend-name.onrender.com/api";

document.addEventListener("DOMContentLoaded", () => {
  const user = localStorage.getItem("keepup_user");
  const path = window.location.pathname.split("/").pop();

  // 1. Initial Auth Check & Redirects
  if (!user && (path === "index.html" || path === "dashboard.html" || path === "watchlist.html" || path === "")) {
    // If not logged in and trying to access private pages, go to landing
    window.location.href = "landing.html";
    return;
  }

  // 2. Inject Navigation (Fixes the "No Options" issue)
  renderLayout();

  // Update Display Name if element exists (Dashboard specific)
  const nameEl = document.getElementById("display-name");
  if (nameEl && user) {
    const name = user.split("@")[0];
    nameEl.innerText = name.charAt(0).toUpperCase() + name.slice(1);
  }

  function renderLayout() {
    const header = document.querySelector('header');
    if (!header) return;

    header.innerHTML = `
      <nav class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-[#0b0b0f]/80 backdrop-blur-md sticky top-0 z-50">
        <div class="flex items-center gap-2 cursor-pointer" onclick="window.location.href='index.html'">
          <div class="bg-purple-600 p-1.5 rounded-lg"><i class="fa-solid fa-tv text-white"></i></div>
          <h1 class="text-xl font-bold tracking-tighter text-white">KeepUp</h1>
        </div>
        <div class="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
          <a href="index.html" class="hover:text-white transition-colors">Dashboard</a>
          <a href="watchlist.html" class="hover:text-white transition-colors">Watchlist</a>
          <a href="foryou.html" class="hover:text-white transition-colors">For You</a>
          <a href="discuss.html" class="hover:text-white transition-colors">Discuss</a>
        </div>
        <div class="flex items-center gap-4">
          ${user ? 
            `<span class="text-xs text-gray-400 hidden lg:inline">${user}</span>
             <button onclick="logout()" class="text-xs text-red-500 hover:text-red-400 ml-4 transition-colors">Logout</button>` : 
            `<a href="login.html" class="bg-purple-600 px-4 py-2 rounded-lg text-sm font-semibold text-white">Login</a>`
          }
        </div>
      </nav>
    `;
  }

  // 3. Page Specific Logic
  if (path === "index.html" || path === "dashboard.html" || path === "") {
    loadTrendingContent();
  }

  if (path === "details.html") {
    loadMovieDetails();
  }
});

window.logout = () => {
  localStorage.removeItem("keepup_user");
  window.location.href = "landing.html";
};

  async function loadTrendingContent() {
    const API_BASE = window.API_BASE || "http://localhost:5000/api/tmdb";
    try {
      // We call our backend instead of TMDB directly to keep the API Key safe
      const response = await fetch(`${API_BASE}/trending?type=movie&time_window=day`);
      
      if (!response.ok) throw new Error("Backend connection failed");
      
      const data = await response.json();
      displayMovies(data.results, "trending-grid");
    } catch (error) {
      console.error("Error loading dashboard:", error);
      const container = document.getElementById("trending-grid");