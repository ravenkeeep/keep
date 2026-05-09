/** GLOBAL CONFIGURATION **/
window.API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? "http://localhost:5000/api" 
  : "https://keepup-backend-g1hz.onrender.com/api";

let path = window.location.pathname.split("/").pop() || "index.html";
if (path === "dashboard") path = "index.html";
if (path && !path.includes(".")) path += ".html";

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
...
  }

  // Update For You personalized text
  const recText = document.getElementById("personal-recommendation-text");
  if (recText && user) {
    recText.innerText = `AI recommendations for ${user.split("@")[0]} based on 0 tracked shows & ratings`;
  }

  // 5. Load Dashboard Specific Data if on index.html