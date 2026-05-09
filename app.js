      { name: "Watchlist", href: "watchlist.html" },
      { name: "For You", href: "foryou.html" },
      { name: "Blog", href: "blog.html" },
      { name: "Discuss", href: "discuss.html" },
    ];

    const isLanding = path === "landing.html";
    
    // Consistent Logo Rendering
...
  }

  // Update For You personalized text
  const recText = document.getElementById("personal-recommendation-text");
  if (recText && user) {
    recText.innerText = `AI recommendations for ${user.split("@")[0]} based on 0 tracked shows & ratings`;
  }

  // 5. Load Dashboard Specific Data if on index.html
  if (path === "index.html" || path === "dashboard.html" || path === "") {
    loadTrendingContent();
  }

  if (path === "details.html") {
    loadMovieDetails();
  }

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
      if (container) container.innerHTML = "<p>Unable to load content at this time.</p>";
    }
  }

  function displayMovies(movies, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = movies.slice(0, 12).map(movie => `
      <div class="movie-card" onclick="window.location.href='details.html?id=${movie.id}'">
        <div class="poster-container">
          <img src="https://image.tmdb.org/t/p/w500${movie.poster_path}" alt="${movie.title}" loading="lazy">
          <span class="score">${movie.vote_average.toFixed(1)}</span>
        </div>
        <div class="movie-details">
          <h4>${movie.title}</h4>
          <p>${movie.release_date ? movie.release_date.split('-')[0] : 'Coming Soon'}</p>
        </div>
      </div>
    `).join('');
  }

  async function loadMovieDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const movieId = urlParams.get('id');
    
    if (!movieId) {
      window.location.href = 'index.html';
      return;
    }

    const API_BASE = window.API_BASE || "http://localhost:5000/api/tmdb";
    try {
      const response = await fetch(`${API_BASE}/movie/${movieId}`);
      if (!response.ok) throw new Error("Movie not found");
      const movie = await response.json();

      // Update UI (Assuming these IDs exist in your details.html)
      if (document.getElementById("movie-title")) document.getElementById("movie-title").innerText = movie.title;
      if (document.getElementById("movie-overview")) document.getElementById("movie-overview").innerText = movie.overview;
      if (document.getElementById("movie-poster")) {
        document.getElementById("movie-poster").src = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
      }

      // Render Trailer
      const trailer = movie.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      const trailerContainer = document.getElementById("trailer-container");
      if (trailerContainer && trailer) {
        trailerContainer.innerHTML = Array.isArray(trailer) ? '' : `
          <div class="bg-[#12121a] p-4 rounded-2xl border border-gray-800 shadow-2xl animate-fade-in-up">
            <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
              <i class="fa-solid fa-play text-purple-500 text-sm"></i> Official Trailer
            </h3>
            <iframe class="w-full aspect-video rounded-xl border border-gray-800/50 hover:border-purple-500/30 transition-colors" 
              src="https://www.youtube.com/embed/${trailer.key}" 
              frameborder="0" allowfullscreen></iframe>
          </div>`;
      }

      // Render Cast (Top 6)
      const castList = document.getElementById("cast-list");
      if (castList && movie.credits.cast) {
        castList.innerHTML = movie.credits.cast.slice(0, 6).map(person => `
          <div class="text-center group">
            <img src="${person.profile_path ? 'https://image.tmdb.org/t/p/w185' + person.profile_path : 'https://via.placeholder.com/185x278?text=No+Image'}" 
                 alt="${person.name}" 
                 class="w-16 h-16 md:w-20 md:h-20 rounded-full object-cover mx-auto border-2 border-gray-800 group-hover:border-purple-500 transition-all duration-300 group-hover:scale-105 shadow-lg">
            <p class="mt-2 text-xs font-semibold text-white truncate w-24 mx-auto">${person.name}</p>
            <p class="text-[10px] text-gray-500 truncate w-24 mx-auto">${person.character}</p>
          </div>
        `).join('');
      }

    } catch (error) {
      console.error("Error loading movie details:", error);
    }
  }

  // AI Suggestion Logic
  window.handleGetSuggestions = async () => {
    const container = document.getElementById("trending-dashboard");
    if (!container) return;

    // Show Loading State
    container.innerHTML = `
      <div class="col-span-full py-10 text-center animate-pulse">
        <i class="fa-solid fa-wand-magic-sparkles text-purple-500 text-3xl mb-4"></i>
        <p class="text-gray-400">AI is curating your personalized list...</p>
      </div>`;

    try {
      const res = await fetch('http://localhost:5000/api/ai/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist: ["Inception", "Interstellar"] }) // Placeholder for actual user data
      });
      const data = await res.json();
      
      if (data.suggestions) {
        container.innerHTML = data.suggestions.map(item => `
          <div class="group cursor-pointer animate-fade-in-up" onclick="window.location.href='details.html?id=${item.id}'">
            <div class="relative aspect-[2/3] rounded-xl overflow-hidden border border-gray-800 group-hover:border-purple-500 transition-all duration-300">
              <img src="https://image.tmdb.org/t/p/w500${item.poster_path}" alt="${item.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
              <div class="absolute top-2 right-2 bg-purple-600 text-[10px] font-bold px-2 py-1 rounded-md shadow-lg shadow-purple-900/50">AI PICK</div>
            </div>
            <p class="mt-2 text-xs font-medium truncate text-gray-400 group-hover:text-purple-400 transition-colors">${item.title}</p>
          </div>
        `).join("");
      }
    } catch (err) {
      container.innerHTML = `<p class="text-red-400 text-xs italic">Failed to get AI suggestions. Try again later.</p>`;
    }
  };

  // Search functionality handler
  window.handleSearch = async (query) => {
    if (!query) return;
    try {
      const response = await fetch(`http://localhost:5000/api/tmdb/search?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      // Handle rendering search results...
      console.log("Found:", data.results);
    } catch (error) {
      console.error("Search failed:", error);
    }
  };