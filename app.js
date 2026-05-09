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
...
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


  window.logout = () => {
    localStorage.removeItem("keepup_user");
    window.location.href = "landing.html";
  };

  // AI Suggestion Logic
  window.handleGetSuggestions = async () => {
