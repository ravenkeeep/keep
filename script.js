// Ensure supabaseClient is referenceable within this script's scope, with a mock fallback to prevent reference and type errors if CDN loads fail.
var supabaseClient = window.supabaseClient || {
    auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
    },
    from: () => ({
        select: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('Supabase not initialized') }) }),
        insert: () => Promise.resolve({ data: null, error: new Error('Supabase not initialized') }),
        update: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('Supabase not initialized') }) }),
        delete: () => ({ eq: () => Promise.resolve({ data: null, error: new Error('Supabase not initialized') }) })
    })
};

// ===== TMDB Client-Side Caching System =====
const TMDB_CACHE_NAME = 'keepup-tmdb-cache';

function getTTLForUrl(urlStr) {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const FIVE_MINS_MS = 5 * 60 * 1000;
    
    if (urlStr.includes('/search/')) {
        return FIVE_MINS_MS;
    }
    if (urlStr.includes('/popular') || urlStr.includes('/upcoming') || urlStr.includes('/on_the_air') || urlStr.includes('/trending/')) {
        return FOUR_HOURS_MS;
    }
    return DAY_MS;
}

async function getCachedTMDBResponse(url) {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(TMDB_CACHE_NAME);
        const response = await cache.match(url);
        if (!response) return null;
        
        const timestamp = response.headers.get('x-cache-timestamp');
        if (timestamp) {
            const age = Date.now() - parseInt(timestamp, 10);
            const ttl = getTTLForUrl(url);
            if (age > ttl) {
                await cache.delete(url);
                return null;
            }
        }
        return response;
    } catch (e) {
        console.warn('Failed to retrieve from TMDB cache:', e);
        return null;
    }
}

async function cacheTMDBResponse(url, response) {
    if (typeof caches === 'undefined' || !response.ok) return;
    try {
        const cache = await caches.open(TMDB_CACHE_NAME);
        const clonedResponse = response.clone();
        const blob = await clonedResponse.blob();
        
        const headers = new Headers(clonedResponse.headers);
        headers.set('x-cache-timestamp', Date.now().toString());
        
        const cachedResponse = new Response(blob, {
            status: clonedResponse.status,
            statusText: clonedResponse.statusText,
            headers: headers
        });
        
        await cache.put(url, cachedResponse);
    } catch (e) {
        console.warn('Failed to save to TMDB cache:', e);
    }
}

// Intercept fetch calls in production to route them through our secure serverless API proxy.
// This hides the TMDB API key from being exposed to the user's browser.
const originalFetch = window.fetch;
window.fetch = async function(input, init) {
    const isTMDB = typeof input === 'string' && (input.includes('api.themoviedb.org/3/') || input.includes('/api/tmdb'));
    const isGet = !init || !init.method || init.method.toUpperCase() === 'GET';
    
    if (isTMDB && isGet) {
        const cachedResponse = await getCachedTMDBResponse(input);
        if (cachedResponse) {
            return cachedResponse.clone();
        }
    }

    let fetchUrl = input;
    if (typeof input === 'string' && input.includes('api.themoviedb.org/3/')) {
        const isLocal = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' || 
                        window.location.hostname === '[::1]' ||
                        !window.location.hostname.includes('.') ||
                        window.location.hostname.startsWith('192.168.') ||
                        window.location.hostname.startsWith('10.') ||
                        window.location.hostname.startsWith('172.') ||
                        window.location.protocol === 'file:';
        
        if (!isLocal) {
            try {
                const url = new URL(input);
                const path = url.pathname.replace(/^\/3\//, ''); 
                url.searchParams.delete('api_key');
                fetchUrl = `/api/tmdb?path=${encodeURIComponent(path)}&${url.searchParams.toString()}`;
            } catch (e) {
                console.error('Failed to rewrite TMDB URL:', e);
            }
        }
    }

    try {
        const response = await originalFetch(fetchUrl, init);
        if (isTMDB && isGet && response.ok) {
            await cacheTMDBResponse(input, response);
        }
        return response;
    } catch (error) {
        throw error;
    }
};

const API_KEY = 'aa66208ff74001c7ebbc20de6d68c11d';

// Cached DOM references (safe if elements missing on a page)
const $ = (id) => document.getElementById(id);
const body = document.body;

function isTVShow(mediaType) {
    if (!mediaType) return false;
    const clean = mediaType.toLowerCase().trim();
    return clean === 'show' || clean === 'tv';
}

function isMovieItem(mediaType) {
    if (!mediaType) return true;
    const clean = mediaType.toLowerCase().trim();
    return clean === 'movie';
}

function renderSkeletonLoaders() {
    if (!watchlistWrapper) return;
    let skeletonHTML = '<div class="skeleton-grid">';
    for (let i = 0; i < 4; i++) {
        skeletonHTML += `
            <div class="skeleton-card">
                <div class="skeleton-img shimmer"></div>
                <div class="skeleton-title shimmer"></div>
                <div class="skeleton-meta shimmer"></div>
                <div class="skeleton-text shimmer"></div>
                <div class="skeleton-actions">
                    <div class="skeleton-btn shimmer"></div>
                    <div class="skeleton-btn shimmer"></div>
                </div>
            </div>
        `;
    }
    skeletonHTML += '</div>';
    watchlistWrapper.innerHTML = skeletonHTML;
    watchlistWrapper.classList.remove('empty');
}

// Diagnostic: report script load
console.log('[keepup] script.js loaded');

// Custom Toast Notification System
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    
    let iconHTML = '';
    if (type === 'success') iconHTML = '<span class="toast-icon">✓</span>';
    else if (type === 'error') iconHTML = '<span class="toast-icon">✗</span>';
    else if (type === 'warning') iconHTML = '<span class="toast-icon">!</span>';
    else iconHTML = '<span class="toast-icon">i</span>';
    
    toast.innerHTML = iconHTML + '<div>' + message + '</div>';
    container.appendChild(toast);
    
    toast.offsetHeight; // trigger reflow
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
            if (container.children.length === 0) {
                container.remove();
            }
        }, 300);
    }, 3500);
}


// Fetch and cache TMDB genre mapping (id -> name)
async function fetchGenres() {
    if (window._tmdbGenres) return window._tmdbGenres;
    try {
        const url = `https://api.themoviedb.org/3/genre/movie/list?api_key=${API_KEY}`;
        const r = await fetch(url);
        const j = await r.json();
        const list = j.genres || [];
        window._tmdbGenres = {};
        list.forEach(g => { if (g && g.id != null) window._tmdbGenres[g.id] = g.name; });
        return window._tmdbGenres;

    } catch (err) {
        console.error('Error fetching TMDB genres', err);
        window._tmdbGenres = window._tmdbGenres || {};
        return window._tmdbGenres;
    }
}

const searchInput = $('search-input');
const searchButton = $('search-button');
const resultsSection = $('results-section');
const resultsWrapper = $('search-results-wrapper');
const recommendationsWrapper = $('recommendations-wrapper');
const watchlistWrapper = $('watchlist-wrapper');
const releaseRadarWrapper = $('release-radar-wrapper');
const searchProgress = $('search-progress');
const searchProgressBar = $('search-progress-bar');
const watchlistProgress = $('watchlist-progress');
const watchlistProgressBar = $('watchlist-progress-bar');
const watchlistCompletionText = $('watchlist-completion-text');
const watchlistCompletionBar = $('watchlist-completion-bar');
const upcomingReleasesSection = $('upcoming-releases-section');
const upcomingReleasesList = $('upcoming-releases-list');
const pickRandomSection = $('pick-random-section');
const pickRandomButton = $('pick-random-button');
let heroInterval = null;
const tonightChoiceCard = $('tonight-choice-card');
const tonightChoiceContent = $('tonight-choice-content');

function showSearchProgress() {
    if (searchProgress && searchProgressBar) {
        searchProgress.style.display = 'block';
        searchProgressBar.style.width = '20%';
        searchProgress.setAttribute('aria-valuenow', '20');
    }
}

// Video modal helpers: open/close with YouTube key
function openVideoModal(youtubeKey) {
    const videoModal = document.getElementById('video-modal');
    const videoIframe = document.getElementById('video-iframe');
    if (!videoModal || !videoIframe) return;
    const src = `https://www.youtube-nocookie.com/embed/${youtubeKey}?autoplay=1&rel=0`;
    videoIframe.src = src;
    videoModal.classList.add('show');
    videoModal.setAttribute('aria-hidden', 'false');
}

function closeVideoModal() {
    const videoModal = document.getElementById('video-modal');
    const videoIframe = document.getElementById('video-iframe');
    if (!videoModal || !videoIframe) return;
    videoIframe.src = '';
    videoModal.classList.remove('show');
    videoModal.setAttribute('aria-hidden', 'true');
}

// Delegated handlers for modal close (works regardless of script placement)
document.addEventListener('click', (ev) => {
    const modal = document.getElementById('video-modal');
    if (!modal) return;
    if (ev.target && ev.target.id === 'video-modal-close') {
        closeVideoModal();
    } else if (ev.target === modal) {
        closeVideoModal();
    }
});

document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
        const modal = document.getElementById('video-modal');
        if (modal && modal.classList.contains('show')) closeVideoModal();
    }
});

// Prefetch trailer keys when hovering over movie cards and play on click
document.addEventListener('mouseover', async (e) => {
    const el = e.target;
    const card = el && el.closest ? el.closest('.movie-card') : null;
    if (!card) return;
    if (card.dataset.trailerPrefetched) return;
    const movieId = card.dataset.movieId || card.getAttribute('data-movie-id');
    if (!movieId) return;
    const mediaType = card.getAttribute('data-media-type') || card.dataset.mediaType || 'movie';
    const path = isTVShow(mediaType) ? 'tv' : 'movie';
    try {
        const vurl = `https://api.themoviedb.org/3/${path}/${movieId}/videos?api_key=${API_KEY}`;
        const vr = await fetch(vurl);
        const vdata = await vr.json();
        const vids = vdata.results || [];
        const trailer = vids.find(v => /trailer/i.test(v.type) && /youtube/i.test(v.site)) || vids.find(v => /youtube/i.test(v.site));
        if (trailer && trailer.key) {
            card.dataset.trailerKey = trailer.key;
        }
    } catch (err) {
        // ignore prefetch errors
    }
    card.dataset.trailerPrefetched = '1';
});

function handlePlayTrailer(key, movieId, mediaType = 'movie') {
    if (key) {
        if (window.location.protocol === 'file:') {
            window.open(`https://www.youtube.com/watch?v=${key}`, '_blank');
        } else {
            openVideoModal(key);
        }
    } else if (movieId) {
        (async () => {
            try {
                const path = isTVShow(mediaType) ? 'tv' : 'movie';
                const vurl = `https://api.themoviedb.org/3/${path}/${movieId}/videos?api_key=${API_KEY}`;
                const vr = await fetch(vurl);
                const vdata = await vr.json();
                const vids = vdata.results || [];
                const trailer = vids.find(v => /trailer/i.test(v.type) && /youtube/i.test(v.site)) || vids.find(v => /youtube/i.test(v.site));
                if (trailer && trailer.key) {
                    if (window.location.protocol === 'file:') {
                        window.open(`https://www.youtube.com/watch?v=${trailer.key}`, '_blank');
                    } else {
                        openVideoModal(trailer.key);
                    }
                } else {
                    showToast('Trailer not available', 'warning');
                }
            } catch (err) {
                console.error('Error fetching trailer on click', err);
            }
        })();
    }
}

document.addEventListener('click', (e) => {
    const el = e.target;
    const btn = el && el.closest ? el.closest('.play-trailer') : null;
    if (!btn) return;
    const card = btn.closest('.movie-card');
    const key = card?.dataset.trailerKey;
    const movieId = card?.dataset.movieId || card?.getAttribute('data-movie-id');
    const mediaType = card?.getAttribute('data-media-type') || card?.dataset.mediaType || 'movie';
    handlePlayTrailer(key, movieId, mediaType);
});

function hideSearchProgress() {
    if (searchProgress && searchProgressBar) {
        searchProgressBar.style.width = '100%';
        searchProgress.setAttribute('aria-valuenow', '100');
        setTimeout(() => {
            if (searchProgress) {
                searchProgress.style.display = 'none';
            }
            if (searchProgressBar) {
                searchProgressBar.style.width = '0%';
                searchProgress.setAttribute('aria-valuenow', '0');
            }
        }, 250);
    }
}

function showWatchlistProgress() {
    if (watchlistProgress && watchlistProgressBar) {
        watchlistProgress.style.display = 'block';
        watchlistProgressBar.style.width = '20%';
        watchlistProgress.setAttribute('aria-valuenow', '20');
    }
}

function hideWatchlistProgress() {
    if (watchlistProgress && watchlistProgressBar) {
        watchlistProgressBar.style.width = '100%';
        watchlistProgress.setAttribute('aria-valuenow', '100');
        setTimeout(() => {
            if (watchlistProgress) {
                watchlistProgress.style.display = 'none';
            }
            if (watchlistProgressBar) {
                watchlistProgressBar.style.width = '0%';
                watchlistProgress.setAttribute('aria-valuenow', '0');
            }
        }, 250);
    }
}

if (searchButton) {
    searchButton.addEventListener('click', () => {
        const query = (searchInput?.value || '').trim();
        if (query) searchMovies(query);
    });
}

// -------------------- Live search suggestions (debounced) --------------------
function debounce(fn, wait = 300) {
    let t;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

// ensure search-controls is positioned for absolute dropdown
if (searchInput) {
    const sc = document.getElementById('search-controls');
    if (sc) {
        sc.style.position = 'relative';
        let suggestionsEl = document.getElementById('search-suggestions');
        if (!suggestionsEl) {
            suggestionsEl = document.createElement('div');
            suggestionsEl.id = 'search-suggestions';
            suggestionsEl.className = 'search-suggestions';
            sc.appendChild(suggestionsEl);
        }

    let suggestionIndex = -1;
    let currentSuggestions = [];

    async function fetchSuggestions(query) {
        if (!query || query.length < 2) {
            suggestionsEl.innerHTML = '';
            currentSuggestions = [];
            suggestionIndex = -1;
            return;
        }
        try {
            const url = `https://api.themoviedb.org/3/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}&page=1&include_adult=false`;
            const r = await fetch(url);
            const j = await r.json();
            const results = (j.results || [])
                .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
                .slice(0, 6);
            currentSuggestions = results;
            renderSuggestions(results);
        } catch (err) {
            console.error('Suggestion fetch error', err);
        }
    }

    function renderSuggestions(results) {
        if (!results || results.length === 0) {
            suggestionsEl.innerHTML = '';
            suggestionIndex = -1;
            return;
        }
        suggestionsEl.innerHTML = results.map((m, idx) => {
            const isTV = m.media_type === 'tv';
            const title = isTV ? m.name : m.title;
            const date = isTV ? m.first_air_date : m.release_date;
            const year = date ? ` (${date.split('-')[0]})` : '';
            const poster = m.poster_path ? `https://image.tmdb.org/t/p/w92${m.poster_path}` : 'https://via.placeholder.com/64x96?text=?';
            const typeLabel = isTV ? ' [Show]' : ' [Movie]';
            return `<div class="suggestion-item" data-idx="${idx}" data-movie-id="${m.id}" data-media-type="${isTV ? 'show' : 'movie'}"><img src="${poster}" alt="${title}" loading="lazy" /><div class="suggestion-meta"><div class="suggestion-title">${title}${year}<span style="font-size:0.8em; color:var(--text-muted); font-weight:normal;">${typeLabel}</span></div><div class="suggestion-overview">${(m.overview||'').slice(0,60)}</div></div></div>`;
        }).join('');
        suggestionIndex = -1;
    }

    const debouncedFetch = debounce(fetchSuggestions, 300);

    searchInput.addEventListener('input', (e) => {
        const q = (e.target.value || '').trim();
        debouncedFetch(q);
    });

    // click on suggestion -> run search with that title
    document.addEventListener('click', (e) => {
        const si = e.target.closest ? e.target.closest('.suggestion-item') : null;
        if (!si) {
            // click outside suggestions: hide
            if (!e.target.closest || !e.target.closest('#search-controls')) {
                suggestionsEl.innerHTML = '';
            }
            return;
        }
        const idx = Number(si.dataset.idx || -1);
        const item = currentSuggestions[idx];
        if (item) {
            const title = item.media_type === 'tv' ? item.name : item.title;
            searchInput.value = title;
            suggestionsEl.innerHTML = '';
            searchMovies(title);
        }
    });

    // keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
        const items = suggestionsEl.querySelectorAll('.suggestion-item');
        
        if (e.key === 'Enter') {
            if (items && items.length > 0 && suggestionIndex >= 0 && suggestionIndex < currentSuggestions.length) {
                e.preventDefault();
                const movie = currentSuggestions[suggestionIndex];
                if (movie) {
                    const title = movie.media_type === 'tv' ? movie.name : movie.title;
                    searchInput.value = title;
                    suggestionsEl.innerHTML = '';
                    searchMovies(title);
                }
            } else {
                const query = (searchInput.value || '').trim();
                if (query) {
                    e.preventDefault();
                    suggestionsEl.innerHTML = '';
                    searchMovies(query);
                }
            }
            return;
        }

        if (e.key === 'Escape') {
            suggestionsEl.innerHTML = '';
            return;
        }

        if (!items || items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
            updateSuggestionHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            suggestionIndex = Math.max(suggestionIndex - 1, 0);
            updateSuggestionHighlight(items);
        }
    });

    function updateSuggestionHighlight(items) {
        items.forEach((it, i) => {
            it.classList.toggle('active', i === suggestionIndex);
            if (i === suggestionIndex) {
                it.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });
    }
    }
}

if (recommendationsWrapper) {
    (async () => {
        try {
            console.log('[keepup] initializing recommendations/hero');
            await fetchGenres();
            // after genres loaded, render sections
            try { loadRecommendations(); } catch (e) { console.error('loadRecommendations error', e); }
            try { loadWatchStatistics(); } catch (e) { console.error('loadWatchStatistics error', e); }
            try { loadUpcomingReleases(); } catch (e) { console.error('loadUpcomingReleases error', e); }
            try { loadNextEpisodesCountdown(); } catch (e) { console.error('loadNextEpisodesCountdown error', e); }
            try { loadUpcomingMoviesCountdown(); } catch (e) { console.error('loadUpcomingMoviesCountdown error', e); }
            try { loadHeroBanner(); } catch (e) { console.error('loadHeroBanner error', e); }
            try { loadReleaseRadar(); } catch (e) { console.error('loadReleaseRadar error', e); }

            // populate existing cards' badges (if any were pre-rendered)
            setTimeout(() => {
                document.querySelectorAll('.movie-card[data-genre-ids]').forEach(card => {
                    try {
                        const ids = JSON.parse(card.getAttribute('data-genre-ids') || '[]');
                        const bc = card.querySelector('.genre-badges');
                        if (bc) {
                            bc.innerHTML = ids.slice(0,3).map(id => `<span class="genre-badge">${window._tmdbGenres[id] || ''}</span>`).join('');
                        }
                    } catch (e) { console.warn('badge populate error', e); }
                });
            }, 120);
        } catch (err) {
            console.error('[keepup] initialization error', err);
            // fallback: still render
            try { loadRecommendations(); } catch (e) { console.error('loadRecommendations error', e); }
            try { loadWatchStatistics(); } catch (e) { console.error('loadWatchStatistics error', e); }
            try { loadUpcomingReleases(); } catch (e) { console.error('loadUpcomingReleases error', e); }
            try { loadNextEpisodesCountdown(); } catch (e) { console.error('loadNextEpisodesCountdown error', e); }
            try { loadUpcomingMoviesCountdown(); } catch (e) { console.error('loadUpcomingMoviesCountdown error', e); }
            try { loadHeroBanner(); } catch (e) { console.error('loadHeroBanner error', e); }
            try { loadReleaseRadar(); } catch (e) { console.error('loadReleaseRadar error', e); }
        }
    })();
}

if (pickRandomButton) {
    pickRandomButton.addEventListener('click', pickTonightChoice);
}

const closeTonightChoice = $('close-tonight-choice');
if (closeTonightChoice) {
    closeTonightChoice.addEventListener('click', () => {
        if (tonightChoiceCard) tonightChoiceCard.style.display = 'none';
    });
}

// Nav / sidebar search toggle
const navSearchToggle = $('nav-search-toggle');
const sidebarSearchToggle = $('sidebar-search-toggle');
const searchControls = $('search-controls');
const navSearchInput = searchInput;
const sidebarToggle = $('sidebar-toggle');
const sidebar = $('sidebar');
const overlayEl = $('overlay');

// debounced icon updater to avoid repeated lucide calls
let _iconTimer = null;
function scheduleIconUpdate() {
    if (_iconTimer) clearTimeout(_iconTimer);
    _iconTimer = setTimeout(() => {
        if (window.lucide) lucide.createIcons();
        _iconTimer = null;
    }, 80);
}

if (navSearchToggle && searchControls) {
    navSearchToggle.addEventListener('click', (e) => {
        const isVisible = searchControls.style.display === 'flex' || searchControls.style.display === 'block';
        searchControls.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) setTimeout(() => navSearchInput?.focus(), 120);
        // toggle icon safely by resetting innerHTML
        navSearchToggle.innerHTML = isVisible ? '<i data-lucide="search"></i>' : '<i data-lucide="x"></i>';
        scheduleIconUpdate();
    });
}

function setSidebarExpanded(expanded, persist = true) {
    if (!sidebar || !sidebarToggle) return;

    sidebar.classList.toggle('expanded', expanded);
    sidebar.classList.toggle('collapsed', !expanded);
    document.body.classList.toggle('sidebar-open', expanded);
    sidebarToggle.setAttribute('aria-expanded', String(expanded));
    sidebar.setAttribute('aria-hidden', String(!expanded));

    if (!expanded && searchControls) {
        searchControls.style.display = 'none';
        if (sidebarSearchToggle) {
            sidebarSearchToggle.innerHTML = '<i data-lucide="search"></i>';
        }
    }

    if (persist) {
        localStorage.setItem('keepup_sidebar_expanded', String(expanded));
    }

    scheduleIconUpdate();
}

if (sidebarSearchToggle && searchControls) {
    sidebarSearchToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sidebar && !sidebar.classList.contains('expanded')) {
            setSidebarExpanded(true);
        }

        const isVisible = searchControls.style.display === 'block';
        searchControls.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) setTimeout(() => navSearchInput?.focus(), 120);
        sidebarSearchToggle.innerHTML = isVisible ? '<i data-lucide="search"></i>' : '<i data-lucide="x"></i>';
        scheduleIconUpdate();
    });
}

if (sidebarToggle && sidebar) {
    const saved = localStorage.getItem('keepup_sidebar_expanded');
    setSidebarExpanded(saved === 'true', false);

    sidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setSidebarExpanded(!sidebar.classList.contains('expanded'));
    });

    document.addEventListener('click', (ev) => {
        if (!sidebar.contains(ev.target) && !sidebarToggle.contains(ev.target) && sidebar.classList.contains('expanded')) {
            setSidebarExpanded(false);
        }
    });

    if (overlayEl) {
        if (overlayEl.parentElement !== document.body) {
            document.body.appendChild(overlayEl);
        }

        overlayEl.addEventListener('click', () => {
            if (sidebar.classList.contains('expanded')) {
                setSidebarExpanded(false);
            }
        });
    }
}

// Account icon toggle: show/hide compact account panel
const accountIconBtn = document.getElementById('account-icon-btn');
const accountPanel = document.getElementById('account-panel');

if (accountIconBtn && accountPanel) {
    accountIconBtn.addEventListener('click', (e) => {
        if (sidebar && !sidebar.classList.contains('expanded')) {
            setSidebarExpanded(true);
        }

        const isOpen = accountPanel.classList.toggle('show');
        accountIconBtn.setAttribute('aria-expanded', String(isOpen));
        accountPanel.setAttribute('aria-hidden', String(!isOpen));
        if (isOpen && window.lucide) lucide.createIcons();
        e.stopPropagation();
    });

    // close when clicking outside
    document.addEventListener('click', (ev) => {
        if (!accountPanel.contains(ev.target) && !accountIconBtn.contains(ev.target)) {
            if (accountPanel.classList.contains('show')) {
                accountPanel.classList.remove('show');
                accountIconBtn.setAttribute('aria-expanded', 'false');
                accountPanel.setAttribute('aria-hidden', 'true');
            }
        }
    });

    // close on escape
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            if (accountPanel.classList.contains('show')) {
                accountPanel.classList.remove('show');
                accountIconBtn.setAttribute('aria-expanded', 'false');
                accountPanel.setAttribute('aria-hidden', 'true');
            }
        }
    });
}

// Hide-on-scroll for nav/search: hide header nav when scrolling down, show when scrolling up
(function() {
    // Robust hide-on-scroll: hides nav when scrolling down, shows when scrolling up
    let lastScroll = window.scrollY || 0;
    let ticking = false;
    const headerEl = document.querySelector('header');
    const minScrollToHide = 60; // don't hide immediately on small scrolls
    const delta = 8; // minimal movement to consider
    let isHidden = false;

    function handleScroll() {
        const st = window.scrollY || 0;
        if (Math.abs(st - lastScroll) <= delta) {
            ticking = false;
            return;
        }

        if (st > lastScroll && st > minScrollToHide) {
            // scrolling down
            if (!isHidden) {
                headerEl && headerEl.classList.add('nav-hidden');
                isHidden = true;
            }
        } else {
            // scrolling up
            if (isHidden) {
                headerEl && headerEl.classList.remove('nav-hidden');
                isHidden = false;
            }
        }

        lastScroll = st <= 0 ? 0 : st;
        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(handleScroll);
            ticking = true;
        }
    }, { passive: true });

    // ensure nav visible on resize/orientation changes
    window.addEventListener('resize', () => {
        headerEl && headerEl.classList.remove('nav-hidden');
        isHidden = false;
    });
    window.addEventListener('orientationchange', () => {
        headerEl && headerEl.classList.remove('nav-hidden');
        isHidden = false;
    });
})();


async function searchMovies(query) {
    showSearchProgress();
    const url = `https://api.themoviedb.org/3/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        const filteredResults = (data.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv');
        displayResults(filteredResults);
    } catch (error) {
        console.error('Error fetching data from TMDB:', error);
        if (resultsSection) {
            resultsSection.style.display = 'block';
        }
        if (resultsWrapper) {
            resultsWrapper.innerHTML = '<p>Something went wrong. Please try again later.</p>';
        }
    } finally {
        hideSearchProgress();
    }
}

function displayResults(movies) {
    if (!resultsWrapper) return;
    if (resultsSection) {
        resultsSection.style.display = 'block';
        // Smoothly scroll the screen to the search results section
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    resultsWrapper.innerHTML = ''; // Clear previous results

    if (!movies || movies.length === 0) {
        resultsWrapper.innerHTML = '<p>No items found.</p>';
        return;
    }

    movies.forEach(movie => {
        const isTV = movie.media_type === 'tv';
        const title = isTV ? movie.name : movie.title;
        const date = isTV ? movie.first_air_date : movie.release_date;
        const typeLabel = `<span style="font-size:0.75rem; font-weight:600; text-transform:uppercase; padding:2px 6px; border-radius:4px; background:${isTV ? 'rgba(168,85,247,0.2)' : 'rgba(59,130,246,0.2)'}; color:${isTV ? '#c084fc' : '#60a5fa'}; border:1px solid ${isTV ? 'rgba(168,85,247,0.3)' : 'rgba(59,130,246,0.3)'};">${isTV ? 'Show' : 'Movie'}</span>`;
        const mediaTypeStr = isTV ? 'show' : 'movie';

        const movieElement = document.createElement('div');
        movieElement.className = 'movie-card';
        movieElement.setAttribute('data-movie-id', movie.id);
        movieElement.setAttribute('data-media-type', mediaTypeStr);
        const ratingPct = Math.round(((movie.vote_average||0)/10)*100);
        const genreBadges = (movie.genre_ids || []).slice(0,3).map(id => (window._tmdbGenres && window._tmdbGenres[id]) ? `<span class="genre-badge">${window._tmdbGenres[id]}</span>` : '').join('');
        movieElement.setAttribute('data-genre-ids', JSON.stringify(movie.genre_ids || []));
        movieElement.innerHTML = `
            <h3>${title} (${date ? date.split('-')[0] : 'N/A'})</h3>
            <div class="meta-row">
                <div style="display:flex; align-items:center; gap:8px;">
                    ${typeLabel}
                    <div class="genre-badges">${genreBadges}</div>
                </div>
                <div class="rating" style="--rating-percent:${ratingPct}%;"><div class="rating-ring" aria-hidden="true"></div><div class="rating-value">${(movie.vote_average||0).toFixed(1)}/10</div></div>
            </div>
            <img src="https://image.tmdb.org/t/p/w200${movie.poster_path}" alt="${title}" onerror="this.src='https://via.placeholder.com/200x300?text=No+Poster'">
            <p>${movie.overview || ''}</p>
            <div class="card-mobile-info"></div>
            <div class="card-actions">
                <button class="add-to-watchlist-btn"><i data-lucide="plus-circle"></i> Add to Watchlist</button>
                <button class="play-trailer secondary"><i data-lucide="play-circle"></i> Play Trailer</button>
            </div>
        `;

        const addBtn = movieElement.querySelector('.add-to-watchlist-btn');
        if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); addToWatchlist(movie); });
        movieElement.addEventListener('click', () => openWatchlistModal(movie));
        resultsWrapper.appendChild(movieElement);
        // async: populate providers icons
        populateProvidersOnCard(movieElement, movie.id);
    });
    if (window.lucide) {
        lucide.createIcons();
    }
}

function displayRecommendations(movies) {
    if (!recommendationsWrapper) {
        return;
    }

    recommendationsWrapper.innerHTML = '';

    if (!movies || movies.length === 0) {
        recommendationsWrapper.innerHTML = '<p>No recommendations available.</p>';
        return;
    }

    movies.slice(0, 6).forEach(movie => {
        const isTV = isTVShow(movie.media_type) || (!movie.media_type && movie.name);
        const title = isTV ? movie.name : movie.title;
        const date = isTV ? movie.first_air_date : movie.release_date;
        const mediaTypeStr = isTV ? 'show' : 'movie';

        const movieElement = document.createElement('div');
        movieElement.className = 'movie-card';
        movieElement.setAttribute('data-movie-id', movie.id);
        movieElement.setAttribute('data-media-type', mediaTypeStr);
        const ratingPct = Math.round(((movie.vote_average||0)/10)*100);
        const genreBadges = (movie.genre_ids || []).slice(0,3).map(id => (window._tmdbGenres && window._tmdbGenres[id]) ? `<span class="genre-badge">${window._tmdbGenres[id]}</span>` : '').join('');
        movieElement.setAttribute('data-genre-ids', JSON.stringify(movie.genre_ids || []));
        movieElement.innerHTML = `
            <h3>${title} (${date ? date.split('-')[0] : 'N/A'})</h3>
            <div class="meta-row">
                <div class="genre-badges">${genreBadges}</div>
                <div class="rating" style="--rating-percent:${ratingPct}%;"><div class="rating-ring" aria-hidden="true"></div><div class="rating-value">${(movie.vote_average||0).toFixed(1)}/10</div></div>
            </div>
            <img src="https://image.tmdb.org/t/p/w200${movie.poster_path}" alt="${title}" onerror="this.src='https://via.placeholder.com/200x300?text=No+Poster'">
            <p>${movie.overview || ''}</p>
            <div class="card-mobile-info"></div>
            <div class="card-actions">
                <button class="add-to-watchlist-btn"><i data-lucide="plus-circle"></i> Add to Watchlist</button>
                <button class="play-trailer secondary"><i data-lucide="play-circle"></i> Play Trailer</button>
            </div>
        `;

        const addBtn = movieElement.querySelector('.add-to-watchlist-btn');
        if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); addToWatchlist(movie); });
        movieElement.addEventListener('click', () => openWatchlistModal(movie));
        recommendationsWrapper.appendChild(movieElement);
        // async: populate providers icons
        populateProvidersOnCard(movieElement, movie.id);
    });
    if (window.lucide) {
        lucide.createIcons();
    }
}

async function loadRecommendations() {
    if (!recommendationsWrapper) {
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
        // Show popular movies if not logged in
        try {
            const url = `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=1`;
            const response = await fetch(url);
            const data = await response.json();
            displayRecommendations(data.results || []);
        } catch (error) {
            console.error('Error fetching popular movies:', error);
            recommendationsWrapper.innerHTML = '<p>Unable to load recommendations.</p>';
        }
        return;
    }

    // Load user's watchlist (including media_type)
    try {
        const { data: watchlistData, error } = await supabaseClient
            .from('watchlist')
            .select('movie_id, media_type')
            .eq('user_id', user.id)
            .limit(5);

        if (error || !watchlistData || watchlistData.length === 0) {
            // Fallback to popular if no watchlist
            const url = `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=1`;
            const response = await fetch(url);
            const data = await response.json();
            displayRecommendations(data.results || []);
            return;
        }

        // Fetch recommendations based on watched movies/shows
        const allRecommendations = [];
        const seenIds = new Set();

        for (const item of watchlistData) {
            try {
                const path = isTVShow(item.media_type) ? 'tv' : 'movie';
                const url = `https://api.themoviedb.org/3/${path}/${item.movie_id}/recommendations?api_key=${API_KEY}&page=1`;
                const response = await fetch(url);
                const data = await response.json();

                if (data.results) {
                    data.results.forEach(m => {
                        if (!seenIds.has(m.id)) {
                            seenIds.add(m.id);
                            m.media_type = isTVShow(item.media_type) ? 'tv' : 'movie';
                            allRecommendations.push(m);
                        }
                    });
                }
            } catch (err) {
                console.error(`Error fetching recommendations for ${item.media_type || 'movie'} ${item.movie_id}:`, err);
            }
        }

        if (allRecommendations.length === 0) {
            // Fallback to popular
            const url = `https://api.themoviedb.org/3/movie/popular?api_key=${API_KEY}&page=1`;
            const response = await fetch(url);
            const data = await response.json();
            displayRecommendations(data.results || []);
        } else {
            displayRecommendations(allRecommendations);
        }
    } catch (error) {
        console.error('Error loading personalized recommendations:', error);
        recommendationsWrapper.innerHTML = '<p>Unable to load recommendations.</p>';
    }
}

async function loadReleaseRadar() {
    const radarWrapper = $('release-radar-wrapper');
    const radarSection = $('release-radar-section');
    if (!radarWrapper || !radarSection) return;

    try {
        let movies = [];
        let showsMapped = [];
        try {
            const movieUrl = `https://api.themoviedb.org/3/movie/upcoming?api_key=${API_KEY}&language=en-US&page=1`;
            const r = await fetch(movieUrl);
            const d = await r.json();
            movies = d.results || [];
        } catch (e) {
            console.error('Error fetching upcoming movies:', e);
        }
        try {
            const tvUrl = `https://api.themoviedb.org/3/tv/on_the_air?api_key=${API_KEY}&language=en-US&page=1`;
            const r = await fetch(tvUrl);
            const d = await r.json();
            const rawShows = d.results || [];

            // Fetch details for shows in parallel to find the next episode's actual air date
            const showDetailsPromises = rawShows.slice(0, 15).map(async (s) => {
                try {
                    const detailUrl = `https://api.themoviedb.org/3/tv/${s.id}?api_key=${API_KEY}`;
                    const res = await fetch(detailUrl);
                    if (res.ok) {
                        const details = await res.json();
                        return { ...s, details };
                    }
                } catch (e) {
                    console.error(`Error fetching details for show ${s.id}:`, e);
                }
                return s;
            });

            const showsWithDetails = await Promise.all(showDetailsPromises);
            showsMapped = showsWithDetails
                .filter(s => s.poster_path)
                .map(s => {
                    let releaseDate = s.first_air_date;
                    let episodeInfo = '';
                    if (s.details && s.details.next_episode_to_air) {
                        releaseDate = s.details.next_episode_to_air.air_date;
                        const epNum = s.details.next_episode_to_air.episode_number;
                        const sNum = s.details.next_episode_to_air.season_number;
                        episodeInfo = ` (S${sNum}E${epNum})`;
                    }
                    return {
                        ...s,
                        title: s.name + episodeInfo,
                        release_date: releaseDate,
                        name: s.name,
                        first_air_date: s.first_air_date,
                        media_type: 'show'
                    };
                })
                .filter(s => s.release_date && calculateDaysUntilRelease(s.release_date) >= 0);
        } catch (e) {
            console.error('Error fetching on the air shows:', e);
        }

        const moviesMapped = movies
            .filter(m => m.poster_path && m.release_date)
            .map(m => ({
                ...m,
                media_type: 'movie'
            }))
            .filter(m => calculateDaysUntilRelease(m.release_date) >= 0);

        const combined = [...moviesMapped, ...showsMapped];
        combined.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));
        const list = combined.slice(0, 15);

        if (list.length === 0) {
            radarSection.style.display = 'none';
            return;
        }

        radarSection.style.display = 'block';
        radarWrapper.innerHTML = '';

        list.forEach(movie => {
            const movieElement = document.createElement('div');
            movieElement.className = 'movie-card';
            movieElement.setAttribute('data-movie-id', movie.id);
            movieElement.setAttribute('data-media-type', movie.media_type);
            const ratingPct = Math.round(((movie.vote_average||0)/10)*100);
            const genreBadges = (movie.genre_ids || []).slice(0, 2).map(id => (window._tmdbGenres && window._tmdbGenres[id]) ? `<span class="genre-badge">${window._tmdbGenres[id]}</span>` : '').join('');
            movieElement.setAttribute('data-genre-ids', JSON.stringify(movie.genre_ids || []));
            
            const isTV = isTVShow(movie.media_type);
            const typeLabel = `<span class="genre-badge" style="background:${isTV ? 'rgba(168,85,247,0.2)' : 'rgba(59,130,246,0.2)'}; color:${isTV ? '#c084fc' : '#60a5fa'}; border:1px solid ${isTV ? 'rgba(168,85,247,0.3)' : 'rgba(59,130,246,0.3)'};">${isTV ? 'Show' : 'Movie'}</span>`;

            const daysUntil = calculateDaysUntilRelease(movie.release_date);
            let countdownBadgeHTML = '';
            
            if (daysUntil === 0) {
                countdownBadgeHTML = `<div class="radar-countdown-badge airs-today"><i data-lucide="calendar"></i> Today 🎉</div>`;
            } else if (daysUntil === 1) {
                countdownBadgeHTML = `<div class="radar-countdown-badge upcoming"><i data-lucide="calendar"></i> Tomorrow</div>`;
            } else if (daysUntil > 1) {
                countdownBadgeHTML = `<div class="radar-countdown-badge upcoming"><i data-lucide="calendar"></i> In ${daysUntil} Days</div>`;
            } else {
                countdownBadgeHTML = `<div class="radar-countdown-badge released"><i data-lucide="check-circle-2"></i> Released</div>`;
            }

            movieElement.innerHTML = `
                ${countdownBadgeHTML}
                <h3>${movie.title} (${movie.release_date ? movie.release_date.split('-')[0] : 'N/A'})</h3>
                <div class="meta-row">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        ${typeLabel}
                        <div class="genre-badges">${genreBadges}</div>
                    </div>
                    <div class="rating" style="--rating-percent:${ratingPct}%;"><div class="rating-ring" aria-hidden="true"></div><div class="rating-value">${(movie.vote_average||0).toFixed(1)}/10</div></div>
                </div>
                <img src="https://image.tmdb.org/t/p/w200${movie.poster_path}" alt="${movie.title}" onerror="this.src='https://via.placeholder.com/200x300?text=No+Poster'">
                <p>${movie.overview || ''}</p>
                <div class="card-mobile-info"></div>
                <div class="card-actions">
                    <button class="add-to-watchlist-btn"><i data-lucide="plus-circle"></i> Add to Watchlist</button>
                    <button class="play-trailer secondary"><i data-lucide="play-circle"></i> Play Trailer</button>
                </div>
            `;

            const addBtn = movieElement.querySelector('.add-to-watchlist-btn');
            if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); addToWatchlist(movie); });
            movieElement.addEventListener('click', () => openWatchlistModal(movie));
            radarWrapper.appendChild(movieElement);
            populateProvidersOnCard(movieElement, movie.id);
        });

        // Initialize scroll arrows functionality
        const leftArrow = $('radar-arrow-left');
        const rightArrow = $('radar-arrow-right');
        if (leftArrow && rightArrow) {
            const updateRadarArrows = () => {
                leftArrow.classList.toggle('hidden', radarWrapper.scrollLeft <= 10);
                rightArrow.classList.toggle('hidden', radarWrapper.scrollLeft + radarWrapper.clientWidth >= radarWrapper.scrollWidth - 10);
            };
            leftArrow.onclick = () => { radarWrapper.scrollBy({ left: -520, behavior: 'smooth' }); };
            rightArrow.onclick = () => { radarWrapper.scrollBy({ left: 520, behavior: 'smooth' }); };
            radarWrapper.addEventListener('scroll', updateRadarArrows);
            window.addEventListener('resize', updateRadarArrows);
            setTimeout(updateRadarArrows, 120);
        }

        if (window.lucide) {
            lucide.createIcons();
        }
    } catch (err) {
        console.error('Error loading Release Radar:', err);
        radarSection.style.display = 'none';
    }
}

async function addToWatchlist(movie) {
    if (!window.supabaseClient) {
        showToast('Supabase is not initialized yet.', 'error');
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
        showToast('Please sign in to save items.', 'warning');
        return;
    }

    // Check if item already exists in watchlist
    const { data: existing, error: checkError } = await supabaseClient
        .from('watchlist')
        .select('id')
        .eq('user_id', user.id)
        .eq('movie_id', movie.id)
        .single();

    if (existing) {
        showToast('This item is already in your watchlist.', 'info');
        return;
    }

    const isTV = movie.media_type === 'tv' || movie.media_type === 'show' || (!movie.title && !!movie.name);
    const mediaType = isTV ? 'show' : 'movie';
    const title = isTV ? movie.name : movie.title;
    const releaseDate = isTV ? movie.first_air_date : movie.release_date;

    const { error } = await supabaseClient.from('watchlist').insert([
        {
            user_id: user.id,
            movie_id: movie.id,
            title: title,
            release_date: releaseDate,
            poster_path: movie.poster_path,
            overview: movie.overview,
            status: 'planning_to_watch',
            media_type: mediaType,
            season: isTV ? 1 : null,
            episode: isTV ? 1 : null,
        },
    ]);

    if (error) {
        console.error('Error saving to watchlist:', error);
        showToast(error.message, 'error');
        return;
    }

    // Invalidate local cache
    try {
        localStorage.removeItem(`watchlist_cache_${user.id}`);
    } catch (e) {
        console.error('Error invalidating cache:', e);
    }

    showToast('Added to watchlist!', 'success');
    loadWatchlist();
    if (window.loadWatchStatistics) {
        window.loadWatchStatistics();
    }
    if (window.loadUpcomingMoviesCountdown) {
        window.loadUpcomingMoviesCountdown();
    }

    // Check if it belongs to a collection and suggest other movies in the saga
    checkMovieCollection(movie);
}

async function checkMovieCollection(movie) {
    if (!window.supabaseClient) return;
    
    const isTV = movie.media_type === 'tv' || movie.media_type === 'show' || (!movie.title && !!movie.name);
    if (isTV) return;

    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) return;

        // Fetch full movie details to check belongs_to_collection
        const detailsUrl = `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${API_KEY}`;
        const response = await fetch(detailsUrl);
        if (!response.ok) return;
        const details = await response.json();

        if (details.belongs_to_collection) {
            const collectionId = details.belongs_to_collection.id;
            const collectionName = details.belongs_to_collection.name;

            // Fetch the collection details
            const collectionUrl = `https://api.themoviedb.org/3/collection/${collectionId}?api_key=${API_KEY}`;
            const collResponse = await fetch(collectionUrl);
            if (!collResponse.ok) return;
            const collectionData = await collResponse.json();
            const parts = collectionData.parts || [];

            // Fetch user's current watchlist to exclude already-added movies
            const { data: watchlistData, error: watchlistError } = await supabaseClient
                .from('watchlist')
                .select('movie_id')
                .eq('user_id', user.id);

            if (watchlistError) throw watchlistError;

            const existingMovieIds = new Set((watchlistData || []).map(item => Number(item.movie_id)));
            // Exclude the movie we just added as well
            existingMovieIds.add(Number(movie.id));

            // Exclude any movies that are already in the watchlist or have no poster
            const moviesToAdd = parts.filter(p => !existingMovieIds.has(Number(p.id)) && p.poster_path);

            if (moviesToAdd.length > 0) {
                // Sort chronologically ascending
                moviesToAdd.sort((a, b) => new Date(a.release_date || 0) - new Date(b.release_date || 0));
                showCollectionSuggestionModal(collectionName, details.title, moviesToAdd, user.id);
            }
        }
    } catch (err) {
        console.error('Error in saga checkMovieCollection:', err);
    }
}

function showCollectionSuggestionModal(collectionName, currentMovieTitle, moviesToAdd, userId) {
    // Remove any existing collection suggestion modal first
    const existingModal = document.getElementById('collection-suggestion-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'collection-suggestion-modal';
    modal.className = 'collection-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const moviesHtml = moviesToAdd.map((m, idx) => {
        const year = m.release_date ? ` (${m.release_date.split('-')[0]})` : '';
        const posterUrl = m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : 'https://via.placeholder.com/100x150?text=No+Poster';
        return `
            <div class="collection-movie-item">
                <label class="collection-movie-label">
                    <input type="checkbox" class="collection-checkbox" data-movie-id="${m.id}" checked />
                    <img src="${posterUrl}" alt="${m.title}" class="collection-movie-poster" />
                    <div class="collection-movie-info">
                        <span class="collection-movie-title">${m.title}${year}</span>
                        <span class="collection-movie-overview">${m.overview || 'No description available.'}</span>
                    </div>
                </label>
            </div>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="collection-modal-content">
            <button class="collection-modal-close" id="close-collection-modal" aria-label="Close modal">&times;</button>
            <div class="collection-modal-header">
                <h2><i data-lucide="library"></i> Sequel Suggestion</h2>
                <p>Since you added <strong>${currentMovieTitle}</strong>, would you like to add other movies from <strong>${collectionName}</strong> to your watchlist?</p>
            </div>
            <div class="collection-movies-list">
                ${moviesHtml}
            </div>
            <div class="collection-modal-actions">
                <button id="add-collection-btn" class="primary">Add Selected to Watchlist</button>
                <button id="skip-collection-btn" class="secondary">No Thanks</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.classList.remove('show');
        document.removeEventListener('keydown', handleKeyDown);
        setTimeout(() => modal.remove(), 300);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleKeyDown);

    document.getElementById('close-collection-modal').onclick = closeModal;
    document.getElementById('skip-collection-btn').onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };

    document.getElementById('add-collection-btn').onclick = async () => {
        const checkboxes = modal.querySelectorAll('.collection-checkbox:checked');
        const selectedIds = Array.from(checkboxes).map(cb => Number(cb.dataset.movieId));
        const selectedMovies = moviesToAdd.filter(m => selectedIds.includes(Number(m.id)));

        if (selectedMovies.length > 0) {
            closeModal();
            showToast(`Adding ${selectedMovies.length} movies to watchlist...`, 'info');

            let successCount = 0;
            for (const m of selectedMovies) {
                const { error } = await supabaseClient.from('watchlist').insert([
                    {
                        user_id: userId,
                        movie_id: m.id,
                        title: m.title,
                        release_date: m.release_date,
                        poster_path: m.poster_path,
                        overview: m.overview,
                        status: 'planning_to_watch',
                        media_type: 'movie',
                        season: null,
                        episode: null,
                    },
                ]);
                if (!error) successCount++;
            }

            if (successCount > 0) {
                showToast(`Added ${successCount} movies to watchlist!`, 'success');
                loadWatchlist();
                if (window.loadWatchStatistics) {
                    window.loadWatchStatistics();
                }
            }
        } else {
            closeModal();
        }
    };

    // Trigger reflow to apply css transitions
    modal.offsetHeight;
    modal.classList.add('show');

    if (window.lucide) {
        lucide.createIcons();
    }
}

function buildStatusSelect(currentStatus, itemId) {
    const statuses = [
        { value: 'planning_to_watch', label: 'Planning to Watch' },
        { value: 'watching', label: 'Watching' },
        { value: 'completed', label: 'Completed' },
        { value: 'on_hold', label: 'On Hold' },
        { value: 'dropped', label: 'Dropped' },
    ];

    const container = document.createElement('div');
    container.className = 'watchlist-status-control';

    const label = document.createElement('label');
    label.textContent = 'Status: ';
    label.htmlFor = `watchlist-status-${itemId}`;

    const select = document.createElement('select');
    select.id = `watchlist-status-${itemId}`;
    select.innerHTML = statuses
        .map(status => `
            <option value="${status.value}" ${status.value === currentStatus ? 'selected' : ''}>
                ${status.label}
            </option>
        `)
        .join('');
    select.addEventListener('change', async () => {
        const previousValue = currentStatus;
        const newValue = select.value;
        const updated = await updateWatchlistStatus(itemId, newValue);
        if (!updated) {
            select.value = previousValue;
        } else {
            // Update the status badge in the modal if the modal is currently showing this item
            const modal = document.getElementById('watchlist-modal');
            if (modal && modal.classList.contains('show') && modal.dataset.currentItemId === String(itemId)) {
                const statusBadge = document.getElementById('modal-status-badge');
                if (statusBadge) {
                    statusBadge.className = `meta-badge status-${newValue}`;
                    let statusIcon = 'eye';
                    if (newValue === 'completed') statusIcon = 'check-circle';
                    else if (newValue === 'planning_to_watch' || newValue === 'planning') statusIcon = 'calendar';
                    else if (newValue === 'on_hold') statusIcon = 'pause-circle';
                    else if (newValue === 'dropped') statusIcon = 'x-circle';
                    
                    const statusText = newValue.replace(/_/g, ' ');
                    statusBadge.innerHTML = `<i data-lucide="${statusIcon}"></i> ${statusText}`;
                    if (window.lucide) {
                        lucide.createIcons();
                    }
                }
            }
        }
    });

    container.appendChild(label);
    container.appendChild(select);
    return container;
}

window._quickWatchesOnly = false;
window._watchlistRuntimes = {};

async function preloadWatchlistRuntimes(items) {
    if (!items || items.length === 0) return;
    const promises = items.map(async (item) => {
        const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
        if (window._watchlistRuntimes[cacheKey] !== undefined) {
            return;
        }

        try {
            const isTV = isTVShow(item.media_type);
            const endpoint = isTV ? `tv/${item.movie_id}` : `movie/${item.movie_id}`;
            const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${API_KEY}`;
            const res = await fetch(url);
            if (!res.ok) return;
            const details = await res.json();
            
            if (isTV) {
                const runtimes = details.episode_run_time || [];
                const minRuntime = runtimes.length > 0 ? Math.min(...runtimes) : 0;
                window._watchlistRuntimes[cacheKey] = {
                    runtime: minRuntime,
                    isQuick: minRuntime > 0 && minRuntime <= 20
                };
            } else {
                const runtime = details.runtime || 0;
                window._watchlistRuntimes[cacheKey] = {
                    runtime,
                    isQuick: runtime > 0 && runtime < 90
                };
            }
        } catch (err) {
            console.error('Error preloading runtime for item:', item.movie_id, err);
        }
    });

    await Promise.all(promises);
}

// --- Caching helpers ---
function loadCachedWatchlist(userId) {
    try {
        const cached = localStorage.getItem(`watchlist_cache_${userId}`);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        console.error('Error loading watchlist cache:', e);
        return null;
    }
}

function saveWatchlistCache(userId, data) {
    try {
        localStorage.setItem(`watchlist_cache_${userId}`, JSON.stringify(data));
    } catch (e) {
        console.error('Error saving watchlist cache:', e);
    }
}

function loadCachedWatchedEpisodes(userId) {
    try {
        const cached = localStorage.getItem(`watched_episodes_cache_${userId}`);
        return cached ? JSON.parse(cached) : null;
    } catch (e) {
        console.error('Error loading watched episodes cache:', e);
        return null;
    }
}

function saveWatchedEpisodesCache(userId, data) {
    try {
        localStorage.setItem(`watched_episodes_cache_${userId}`, JSON.stringify(data));
    } catch (e) {
        console.error('Error saving watched episodes cache:', e);
    }
}

function isDataDifferent(oldList, newList) {
    if (!oldList || !newList) return true;
    if (oldList.length !== newList.length) return true;
    for (let i = 0; i < oldList.length; i++) {
        const o = oldList[i];
        const n = newList[i];
        if (o.id !== n.id ||
            o.movie_id !== n.movie_id ||
            o.status !== n.status ||
            o.season !== n.season ||
            o.episode !== n.episode ||
            o.title !== n.title ||
            o.release_date !== n.release_date ||
            o.poster_path !== n.poster_path) {
            return true;
        }
    }
    return false;
}

function isWatchedEpsDifferent(oldEps, newEps) {
    if (!oldEps || !newEps) return true;
    if (oldEps.length !== newEps.length) return true;
    const oldKeys = new Set(oldEps.map(e => `${e.watchlist_id}_${e.season_number}_${e.episode_number}`));
    for (let i = 0; i < newEps.length; i++) {
        const e = newEps[i];
        if (!oldKeys.has(`${e.watchlist_id}_${e.season_number}_${e.episode_number}`)) {
            return true;
        }
    }
    return false;
}

function renderSkeletons() {
    if (!watchlistWrapper) return;
    watchlistWrapper.innerHTML = '';
    watchlistWrapper.classList.remove('empty');

    const row = document.createElement('div');
    row.className = 'carousel-row watchlist-category';
    row.innerHTML = `<h3>Loading Watchlist...</h3>`;

    const track = document.createElement('div');
    track.className = 'carousel-track';

    for (let i = 0; i < 4; i++) {
        const skeletonCard = document.createElement('div');
        skeletonCard.className = 'skeleton-card';
        skeletonCard.innerHTML = `
            <div class="skeleton-img"></div>
            <div class="skeleton-title"></div>
            <div class="skeleton-meta"></div>
            <div class="skeleton-text"></div>
            <div class="skeleton-actions">
                <div class="skeleton-btn"></div>
                <div class="skeleton-btn"></div>
            </div>
        `;
        track.appendChild(skeletonCard);
    }
    row.appendChild(track);
    watchlistWrapper.appendChild(row);
}

function processAndRenderWatchlist(data, watchedEps, isMoviesPage, isShowsPage) {
    window._watchedEpisodesMap = {};
    if (watchedEps) {
        watchedEps.forEach(ep => {
            window._watchedEpisodesMap[ep.watchlist_id] = window._watchedEpisodesMap[ep.watchlist_id] || new Set();
            window._watchedEpisodesMap[ep.watchlist_id].add(`${ep.season_number}_${ep.episode_number}`);
        });
    }

    let filteredData = data || [];
    if (isMoviesPage) {
        filteredData = filteredData.filter(item => isMovieItem(item.media_type));
    } else if (isShowsPage) {
        filteredData = filteredData.filter(item => isTVShow(item.media_type));
    }

    if (filteredData.length === 0) {
        const itemType = isShowsPage ? 'shows' : 'movies';
        watchlistWrapper.innerHTML = `<p>Your watchlist is empty. Add ${itemType} from search or recommendations.</p>`;
        watchlistWrapper.classList.add('empty');
        hideWatchlistProgress();
        updateCompletionProgress([]);
        return;
    }

    updateCompletionProgress(filteredData);
    window._preloadRuntimesPromise = preloadWatchlistRuntimes(filteredData);

    const categories = {
        planning_to_watch: { title: 'Planning to Watch', items: [] },
        watching: { title: 'Watching', items: [] },
        completed: { title: 'Completed', items: [] },
        on_hold: { title: 'On Hold', items: [] },
        dropped: { title: 'Dropped', items: [] },
    };

    filteredData.forEach(item => {
        const normalizedStatus = item.status || 'watching';
        const category = categories[normalizedStatus] || categories.watching;
        category.items.push(item);
    });

    watchlistWrapper.innerHTML = '';
    watchlistWrapper.classList.remove('empty');

    // store categories for filtering and render via helper
    window._watchlistCategories = categories;
    renderFilterControls(categories);
    renderWatchlistFromCategories(categories);
    hideWatchlistProgress();
}

async function loadWatchlist() {
    if (!watchlistWrapper) {
        return;
    }

    showWatchlistProgress();

    if (!window.supabaseClient) {
        watchlistWrapper.innerHTML = '<p>Unable to load watchlist.</p>';
        hideWatchlistProgress();
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
        watchlistWrapper.innerHTML = '<p>Sign in to see your watchlist.</p>';
        hideWatchlistProgress();
        return;
    }

    const isMoviesPage = window.location.pathname.includes('movies.html');
    const isShowsPage = window.location.pathname.includes('shows.html');

    // 1. Try to load from local cache instantly
    const cachedWatchlist = loadCachedWatchlist(user.id);
    const cachedWatchedEps = loadCachedWatchedEpisodes(user.id);

    if (cachedWatchlist !== null && cachedWatchedEps !== null) {
        processAndRenderWatchlist(cachedWatchlist, cachedWatchedEps, isMoviesPage, isShowsPage);
    } else {
        renderSkeletons();
    }

    // 2. Fetch fresh data from Supabase in the background
    try {
        const watchlistPromise = supabaseClient
            .from('watchlist')
            .select('id, movie_id, title, release_date, poster_path, overview, status, media_type, season, episode, created_at, completed_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        const watchedEpsPromise = supabaseClient
            .from('user_watched_episodes')
            .select('watchlist_id, season_number, episode_number')
            .eq('user_id', user.id);

        const [watchlistResult, watchedEpsResult] = await Promise.all([watchlistPromise, watchedEpsPromise]);

        if (watchlistResult.error) {
            console.error('Error fetching watchlist background sync:', watchlistResult.error);
            if (cachedWatchlist === null) {
                watchlistWrapper.innerHTML = '<p>Unable to load watchlist.</p>';
                hideWatchlistProgress();
                updateCompletionProgress([]);
            }
            return;
        }

        const freshWatchlist = watchlistResult.data || [];
        const freshWatchedEps = watchedEpsResult.data || [];

        // Check if there is a difference between cached data and fresh data
        const watchlistDiff = isDataDifferent(cachedWatchlist, freshWatchlist);
        const watchedEpsDiff = isWatchedEpsDifferent(cachedWatchedEps, freshWatchedEps);

        if (watchlistDiff || watchedEpsDiff || cachedWatchlist === null || cachedWatchedEps === null) {
            // Update cache and re-render
            saveWatchlistCache(user.id, freshWatchlist);
            saveWatchedEpisodesCache(user.id, freshWatchedEps);
            processAndRenderWatchlist(freshWatchlist, freshWatchedEps, isMoviesPage, isShowsPage);
        } else {
            // Even if same, ensure stats are up to date
            let filteredData = freshWatchlist;
            if (isMoviesPage) {
                filteredData = filteredData.filter(item => isMovieItem(item.media_type));
            } else if (isShowsPage) {
                filteredData = filteredData.filter(item => isTVShow(item.media_type));
            }
            updateCompletionProgress(filteredData);
            window._preloadRuntimesPromise = preloadWatchlistRuntimes(filteredData);
            hideWatchlistProgress();
        }
    } catch (err) {
        console.error('Background sync failed:', err);
        hideWatchlistProgress();
    }
}

function calculateProgress(allMovies) {
    const total = allMovies.length;
    if (total === 0) return 0;

    const completedCount = allMovies.filter(movie => movie.status === 'completed').length;
    const percentage = Math.round((completedCount / total) * 100);
    return percentage;
}

// --- Watchlist rendering & filter helpers ---
let watchlistFilter = 'all';

function renderFilterControls(categories) {
    const container = document.getElementById('watchlist-filters');
    if (!container) return;
    container.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.textContent = 'All';
    allBtn.dataset.filter = 'all';
    allBtn.classList.add(watchlistFilter === 'all' ? 'active' : '');
    allBtn.addEventListener('click', () => {
        watchlistFilter = 'all';
        updateFilterButtons(container);
        renderWatchlistFromCategories(window._watchlistCategories || {});
    });
    container.appendChild(allBtn);

    Object.entries(categories).forEach(([key, cat]) => {
        const btn = document.createElement('button');
        btn.textContent = cat.title;
        btn.dataset.filter = key;
        if (watchlistFilter === key) btn.classList.add('active');
        btn.addEventListener('click', () => {
            watchlistFilter = key;
            updateFilterButtons(container);
            renderWatchlistFromCategories(window._watchlistCategories || {});
        });
        container.appendChild(btn);
    });

    // Render Quick Watches Toggle Button
    const quickBtn = document.createElement('button');
    quickBtn.id = 'quick-watches-toggle';
    quickBtn.className = 'quick-watches-btn';
    quickBtn.dataset.filter = 'quick';
    if (window._quickWatchesOnly) quickBtn.classList.add('active');
    quickBtn.innerHTML = `<i data-lucide="zap"></i> Quick Watches`;
    
    quickBtn.addEventListener('click', async () => {
        window._quickWatchesOnly = !window._quickWatchesOnly;
        quickBtn.classList.toggle('active', window._quickWatchesOnly);
        
        let currentItems = [];
        Object.values(categories).forEach(cat => {
            currentItems.push(...(cat.items || []));
        });

        if (window._quickWatchesOnly) {
            const isLoaded = currentItems.every(item => {
                const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
                return window._watchlistRuntimes && window._watchlistRuntimes[cacheKey] !== undefined;
            });
            
            if (!isLoaded) {
                watchlistWrapper.innerHTML = `
                    <div class="watchlist-loading" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:3rem; gap:1rem; color:var(--text-muted);">
                        <div class="spinner" style="width:24px; height:24px; border:2px solid rgba(255,255,255,0.1); border-top-color:var(--primary-color); border-radius:50%; animation:spin 0.8s linear infinite;"></div>
                        <p>Scanning watchlist runtimes...</p>
                    </div>
                `;
                if (window._preloadRuntimesPromise) {
                    await window._preloadRuntimesPromise;
                }
            }
        }
        
        renderWatchlistFromCategories(window._watchlistCategories || {});
    });
    container.appendChild(quickBtn);

    // Render Pick for Me Button
    const pickBtn = document.createElement('button');
    pickBtn.id = 'watchlist-pick-random';
    pickBtn.className = 'watchlist-pick-random-btn';
    pickBtn.dataset.filter = 'pick';
    pickBtn.innerHTML = `<i data-lucide="dices"></i> Pick for Me`;
    
    pickBtn.addEventListener('click', () => {
        const visibleItems = [];
        Object.entries(categories).forEach(([key, category]) => {
            if (!category.items || category.items.length === 0) return;
            if (watchlistFilter !== 'all' && watchlistFilter !== key) return;
            
            let items = category.items;
            if (window._quickWatchesOnly) {
                items = items.filter(item => {
                    const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
                    const cached = window._watchlistRuntimes && window._watchlistRuntimes[cacheKey];
                    return cached && cached.isQuick;
                });
            }
            items.forEach(i => visibleItems.push(i));
        });

        if (visibleItems.length === 0) {
            showToast("No matching items in your watchlist to pick from!", "warning");
            return;
        }

        const randomIndex = Math.floor(Math.random() * visibleItems.length);
        const selected = visibleItems[randomIndex];
        openWatchlistModal(selected);
    });
    container.appendChild(pickBtn);

    if (window.lucide) {
        lucide.createIcons();
    }
}

function updateFilterButtons(container) {
    const buttons = Array.from(container.querySelectorAll('button'));
    buttons.forEach(b => {
        const f = b.dataset.filter || (b.textContent === 'All' ? 'all' : undefined);
        if (f === 'quick' || f === 'pick') return;
        b.classList.toggle('active', f === watchlistFilter);
    });
}

function renderWatchlistFromCategories(categories) {
    if (!watchlistWrapper) return;
    watchlistWrapper.innerHTML = '';
    
    // Build a single flat list of visible items so they render inside one grid
    const visibleItems = [];
    Object.entries(categories).forEach(([key, category]) => {
        if (!category.items || category.items.length === 0) return;
        if (watchlistFilter !== 'all' && watchlistFilter !== key) return;
        
        let items = category.items;
        if (window._quickWatchesOnly) {
            items = items.filter(item => {
                const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
                const cached = window._watchlistRuntimes && window._watchlistRuntimes[cacheKey];
                return cached && cached.isQuick;
            });
        }
        items.forEach(i => visibleItems.push(i));
    });

    if (visibleItems.length === 0) {
        if (window._quickWatchesOnly) {
            watchlistWrapper.innerHTML = '<p>No quick watches found in your watchlist.</p>';
        } else {
            watchlistWrapper.innerHTML = '<p>No items match the selected category.</p>';
        }
        watchlistWrapper.classList.add('empty');
        if (window.lucide) lucide.createIcons();
        return;
    }

    const isMoviesPage = window.location.pathname.includes('movies.html');
    const isShowsPage = window.location.pathname.includes('shows.html');

    // Helper to create and bind a single watchlist movie-card element
    function createCardElement(item) {
        const card = document.createElement('div');
        card.className = 'movie-card';
        card.setAttribute('data-movie-id', item.movie_id || item.id);
        card.setAttribute('data-media-type', item.media_type || 'movie');
        
        const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
        const cached = window._watchlistRuntimes && window._watchlistRuntimes[cacheKey];
        const runtimeStr = cached && cached.runtime ? ` · ${cached.runtime}m` : '';

        card.innerHTML = `
            <img src="https://image.tmdb.org/t/p/w300${item.poster_path}" alt="${item.title}" onerror="this.src='https://via.placeholder.com/200x300?text=No+Poster'">
            <h4>${item.title}</h4>
            <div class="meta-row"><div class="genre-badges"></div><div class="rating" style="--rating-percent:0%;"><div class="rating-ring" aria-hidden="true"></div><div class="rating-value">-</div></div></div>
            <div class="short-meta">${item.release_date ? item.release_date.split('-')[0] : 'N/A'}${runtimeStr} · <span class="status-badge status-${item.status || 'watching'}">${(item.status || 'watching').replace(/_/g,' ')}</span></div>
            <p>${(item.overview || '').slice(0, 90)}${(item.overview && item.overview.length > 90) ? '…' : ''}</p>
            <div class="card-mobile-info"></div>
            <div class="card-actions"></div>
        `;

        // If it is a TV show, inject season/episode tracking controls
        if (isTVShow(item.media_type)) {
            const mobInfo = card.querySelector('.card-mobile-info');
            if (mobInfo) {
                mobInfo.textContent = `S${item.season || 1} · E${item.episode || 1}`;
            }
            const trackingRow = document.createElement('div');
            trackingRow.className = 'show-tracking-row';
            trackingRow.innerHTML = `
                <div class="show-tracking-label">Progress:</div>
                <div class="show-tracking-val-container">
                    <div class="show-tracking-item">
                        <span>S:</span>
                        <button class="track-btn dec-season">-</button>
                        <span class="season-val">${item.season || 1}</span>
                        <button class="track-btn inc-season">+</button>
                    </div>
                    <div class="show-tracking-item">
                        <span>E:</span>
                        <button class="track-btn dec-episode">-</button>
                        <span class="episode-val">${item.episode || 1}</span>
                        <button class="track-btn inc-episode">+</button>
                    </div>
                </div>
            `;

            const decS = trackingRow.querySelector('.dec-season');
            const incS = trackingRow.querySelector('.inc-season');
            const decE = trackingRow.querySelector('.dec-episode');
            const incE = trackingRow.querySelector('.inc-episode');

            decS.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newVal = Math.max(1, (item.season || 1) - 1);
                if (newVal !== item.season) {
                    try {
                        const { data: sessionData } = await supabaseClient.auth.getSession();
                        const user = sessionData?.session?.user;
                        if (user) {
                            const cachedEps = loadCachedWatchedEpisodes(user.id) || [];
                            const isAlreadyWatched = cachedEps.some(w => w.watchlist_id === item.id && w.season_number === newVal && w.episode_number === 1);
                            if (!isAlreadyWatched) {
                                await toggleEpisodeWatchedState(item.id, item.movie_id, newVal, 1, true);
                                cachedEps.push({
                                    watchlist_id: item.id,
                                    season_number: newVal,
                                    episode_number: 1
                                });
                                saveWatchedEpisodesCache(user.id, cachedEps);
                            }
                        }
                    } catch (err) {
                        console.error('Error updating watched episodes on season decrement:', err);
                    }
                    await updateShowProgress(item.id, newVal, 1);
                }
            });
            incS.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newVal = (item.season || 1) + 1;
                try {
                    const { data: sessionData } = await supabaseClient.auth.getSession();
                    const user = sessionData?.session?.user;
                    if (user) {
                        const cachedEps = loadCachedWatchedEpisodes(user.id) || [];
                        const isAlreadyWatched = cachedEps.some(w => w.watchlist_id === item.id && w.season_number === newVal && w.episode_number === 1);
                        if (!isAlreadyWatched) {
                            await toggleEpisodeWatchedState(item.id, item.movie_id, newVal, 1, true);
                            cachedEps.push({
                                watchlist_id: item.id,
                                season_number: newVal,
                                episode_number: 1
                            });
                            saveWatchedEpisodesCache(user.id, cachedEps);
                        }
                    }
                } catch (err) {
                    console.error('Error updating watched episodes on season increment:', err);
                }
                await updateShowProgress(item.id, newVal, 1);
            });
            decE.addEventListener('click', async (e) => {
                e.stopPropagation();
                const oldVal = item.episode || 1;
                const newVal = Math.max(1, oldVal - 1);
                if (newVal !== oldVal) {
                    try {
                        const { data: sessionData } = await supabaseClient.auth.getSession();
                        const user = sessionData?.session?.user;
                        if (user) {
                            await toggleEpisodeWatchedState(item.id, item.movie_id, item.season || 1, oldVal, false);
                            let cachedEps = loadCachedWatchedEpisodes(user.id) || [];
                            cachedEps = cachedEps.filter(w => !(w.watchlist_id === item.id && w.season_number === (item.season || 1) && w.episode_number === oldVal));
                            saveWatchedEpisodesCache(user.id, cachedEps);
                        }
                    } catch (err) {
                        console.error('Error deleting watched episode on decrement:', err);
                    }
                    await updateShowProgress(item.id, item.season || 1, newVal);
                }
            });
            incE.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newVal = (item.episode || 1) + 1;
                try {
                    const { data: sessionData } = await supabaseClient.auth.getSession();
                    const user = sessionData?.session?.user;
                    if (user) {
                        const cachedEps = loadCachedWatchedEpisodes(user.id) || [];
                        const season = item.season || 1;
                        for (let ep = 1; ep <= newVal; ep++) {
                            const isAlreadyWatched = cachedEps.some(w => w.watchlist_id === item.id && w.season_number === season && w.episode_number === ep);
                            if (!isAlreadyWatched) {
                                await toggleEpisodeWatchedState(item.id, item.movie_id, season, ep, true);
                                cachedEps.push({
                                    watchlist_id: item.id,
                                    season_number: season,
                                    episode_number: ep
                                });
                            }
                        }
                        saveWatchedEpisodesCache(user.id, cachedEps);
                    }
                } catch (err) {
                    console.error('Error inserting watched episode on increment:', err);
                }
                await updateShowProgress(item.id, item.season || 1, newVal);
            });

            card.insertBefore(trackingRow, card.querySelector('.card-actions'));
        }

        const cardActions = card.querySelector('.card-actions');
        const playBtn = document.createElement('button'); playBtn.className = 'secondary play-trailer'; playBtn.innerHTML = '<i data-lucide="play-circle"></i> Play Trailer'; cardActions.appendChild(playBtn);
        try { cardActions.appendChild(buildStatusSelect(item.status || 'watching', item.id)); } catch (e) {}
        const detailsBtn = document.createElement('button'); detailsBtn.className = 'secondary view-details'; detailsBtn.textContent = 'Details'; detailsBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openWatchlistModal(item); }); cardActions.appendChild(detailsBtn);
        const deleteBtn = document.createElement('button'); deleteBtn.type='button'; deleteBtn.className='danger'; deleteBtn.innerHTML='<i data-lucide="trash-2"></i>'; deleteBtn.addEventListener('click', (e)=>{ e.stopPropagation(); deleteWatchlistItem(item.id); }); cardActions.appendChild(deleteBtn);

        card.addEventListener('click', () => openWatchlistModal(item));
        populateCardWithDetails(card, item.movie_id || item.id);
        populateProvidersOnCard(card, item.movie_id || item.id);

        return card;
    }

    if (watchlistFilter === 'all') {
        // Render categories as horizontal carousel rows per category (Netflix-style)
        Object.entries(categories).forEach(([key, category]) => {
            if (!category.items || category.items.length === 0) return;

            let itemsToRender = category.items;
            if (window._quickWatchesOnly) {
                itemsToRender = itemsToRender.filter(item => {
                    const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
                    const cached = window._watchlistRuntimes && window._watchlistRuntimes[cacheKey];
                    return cached && cached.isQuick;
                });
            }

            if (itemsToRender.length === 0) return;

            const row = document.createElement('div');
            row.className = 'carousel-row watchlist-category';
            row.innerHTML = `<h3>${category.title} (${itemsToRender.length})</h3>`;

            const track = document.createElement('div');
            track.className = 'carousel-track';

            itemsToRender.forEach(item => {
                const card = createCardElement(item);
                track.appendChild(card);
            });

            // Arrows
            const left = document.createElement('button'); left.className='carousel-arrow left'; left.innerHTML = '<i data-lucide="chevron-left"></i>'; left.addEventListener('click', () => { track.scrollBy({ left: -520, behavior: 'smooth' }); });
            const right = document.createElement('button'); right.className='carousel-arrow right'; right.innerHTML = '<i data-lucide="chevron-right"></i>'; right.addEventListener('click', () => { track.scrollBy({ left: 520, behavior: 'smooth' }); });

            row.appendChild(left);
            row.appendChild(track);
            row.appendChild(right);
            watchlistWrapper.appendChild(row);

            // show/hide arrows depending on scroll
            function updateArrows() {
                left.classList.toggle('hidden', track.scrollLeft <= 10);
                right.classList.toggle('hidden', track.scrollLeft + track.clientWidth >= track.scrollWidth - 10);
            }
            track.addEventListener('scroll', updateArrows);
            window.addEventListener('resize', updateArrows);
            setTimeout(updateArrows, 120);
        });
    } else {
        // Render single category as vertical wrapping grid
        const category = categories[watchlistFilter];
        if (category) {
            let itemsToRender = category.items;
            if (window._quickWatchesOnly) {
                itemsToRender = itemsToRender.filter(item => {
                    const cacheKey = `${item.media_type || 'movie'}_${item.movie_id}`;
                    const cached = window._watchlistRuntimes && window._watchlistRuntimes[cacheKey];
                    return cached && cached.isQuick;
                });
            }

            if (itemsToRender.length > 0) {
                const header = document.createElement('h3');
                header.style.margin = '0';
                header.style.padding = '0.5rem 1.25rem';
                header.style.fontSize = '1.05rem';
                header.style.color = 'var(--primary-color)';
                header.style.fontFamily = "'Outfit', sans-serif";
                header.style.letterSpacing = '0.02em';
                header.textContent = `${category.title} (${itemsToRender.length})`;
                watchlistWrapper.appendChild(header);

                const grid = document.createElement('div');
                grid.className = 'watchlist-grid';
                grid.style.padding = '0 1.25rem';

                itemsToRender.forEach(item => {
                    const card = createCardElement(item);
                    grid.appendChild(card);
                });

                watchlistWrapper.appendChild(grid);
            }
        }
    }

    if (window.lucide) lucide.createIcons();
}

/* ===== Hero banner: fetch top trending movie and render backdrop + actions ===== */
async function loadHeroBanner() {
    const hero = $('hero-banner');
    if (!hero) return;
    if (heroInterval) {
        clearInterval(heroInterval);
        heroInterval = null;
    }
    try {
        const url = `https://api.themoviedb.org/3/trending/movie/day?api_key=${API_KEY}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const movies = (data && data.results ? data.results.filter(m => m.backdrop_path).slice(0, 5) : []) || [];
        if (movies.length === 0) {
            hero.setAttribute('aria-hidden', 'true');
            return;
        }

        let currentIndex = 0;
        const indicatorsContainer = $('hero-indicators');

        function displayHeroMovie(movie) {
            const imageUrl = `https://image.tmdb.org/t/p/original${movie.backdrop_path}`;
            hero.style.backgroundImage = `url('${imageUrl}')`;
            const titleEl = $('hero-title');
            const overviewEl = $('hero-overview');
            if (titleEl) titleEl.textContent = movie.title || movie.name || '';
            if (overviewEl) overviewEl.textContent = (movie.overview || '').slice(0, 280);
            hero.setAttribute('aria-hidden', 'false');

            const trailerBtn = $('hero-trailer-btn');
            const addBtn = $('hero-add-watchlist');

            if (trailerBtn) {
                trailerBtn.onclick = async () => {
                    try {
                        const vurl = `https://api.themoviedb.org/3/movie/${movie.id}/videos?api_key=${API_KEY}`;
                        const vr = await fetch(vurl);
                        const vdata = await vr.json();
                        const vids = vdata.results || [];
                        const trailer = vids.find(v => /trailer/i.test(v.type) && /youtube/i.test(v.site)) || vids.find(v => /youtube/i.test(v.site));
                        if (trailer && trailer.key) {
                            if (window.location.protocol === 'file:') {
                                window.open(`https://www.youtube.com/watch?v=${trailer.key}`, '_blank');
                            } else {
                                openVideoModal(trailer.key);
                            }
                        } else {
                            showToast('Trailer not available', 'warning');
                        }
                    } catch (err) {
                        console.error('Error loading trailer:', err);
                        showToast('Unable to load trailer.', 'error');
                    }
                };
            }

            if (addBtn) {
                addBtn.onclick = async () => {
                    const movieObj = {
                        id: movie.id,
                        title: movie.title || movie.name,
                        release_date: movie.release_date || movie.first_air_date,
                        poster_path: movie.poster_path || movie.backdrop_path,
                        overview: movie.overview || '',
                    };
                    try {
                        await addToWatchlist(movieObj);
                    } catch (e) {
                        console.error('Add to watchlist failed', e);
                    }
                };
            }
        }

        function updateIndicators() {
            if (indicatorsContainer) {
                const dots = indicatorsContainer.querySelectorAll('.hero-indicator');
                dots.forEach((dot, idx) => {
                    dot.classList.toggle('active', idx === currentIndex);
                });
            }
        }

        function startHeroCycle() {
            if (heroInterval) clearInterval(heroInterval);
            if (movies.length > 1) {
                heroInterval = setInterval(() => {
                    currentIndex = (currentIndex + 1) % movies.length;
                    displayHeroMovie(movies[currentIndex]);
                    updateIndicators();
                }, 6000);
            }
        }

        // Render indicators
        if (indicatorsContainer) {
            indicatorsContainer.innerHTML = '';
            movies.forEach((_, idx) => {
                const dot = document.createElement('div');
                dot.className = `hero-indicator ${idx === currentIndex ? 'active' : ''}`;
                dot.addEventListener('click', () => {
                    currentIndex = idx;
                    displayHeroMovie(movies[currentIndex]);
                    updateIndicators();
                    startHeroCycle();
                });
                indicatorsContainer.appendChild(dot);
            });
        }

        // Show first movie
        displayHeroMovie(movies[currentIndex]);
        startHeroCycle();

    } catch (error) {
        console.error('Error loading hero banner:', error);
        hero.setAttribute('aria-hidden', 'true');
    }
}

async function populateCardWithDetails(card, movieId) {
    try {
        if (!movieId) return;
        const mediaType = card.getAttribute('data-media-type') || 'movie';
        const path = isTVShow(mediaType) ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${path}/${movieId}?api_key=${API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) return;
        const movie = await response.json();
        
        // Update rating
        const ratingVal = movie.vote_average || 0;
        const ratingPct = Math.round((ratingVal / 10) * 100);
        const ratingEl = card.querySelector('.rating');
        if (ratingEl) {
            ratingEl.style.setProperty('--rating-percent', `${ratingPct}%`);
            const valEl = ratingEl.querySelector('.rating-value');
            if (valEl) valEl.textContent = `${ratingVal.toFixed(1)}/10`;
        }

        // Update genres
        const badgeContainer = card.querySelector('.genre-badges');
        if (badgeContainer && movie.genres) {
            badgeContainer.innerHTML = movie.genres.slice(0, 3).map(g => `<span class="genre-badge">${g.name}</span>`).join('');
        }
    } catch (err) {
        console.error('Error populating card details:', err);
    }
}

async function populateProvidersOnCard(card, movieId) {
    try {
        if (!movieId) return;
        const mediaType = card.getAttribute('data-media-type') || 'movie';
        const path = isTVShow(mediaType) ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${path}/${movieId}/watch/providers?api_key=${API_KEY}`;
        const response = await fetch(url);
        if (!response.ok) return;
        const data = await response.json();
        const results = data.results || {};
        
        // Try US first, then fall back to any available country's flatrate
        let providerList = [];
        if (results.US && results.US.flatrate) {
            providerList = results.US.flatrate;
        } else {
            for (const country in results) {
                if (results[country] && results[country].flatrate) {
                    providerList = results[country].flatrate;
                    break;
                }
            }
        }
        
        if (providerList.length === 0) return;
        
        const metaRow = card.querySelector('.meta-row');
        if (!metaRow) return;
        
        let providersDiv = metaRow.querySelector('.providers');
        if (!providersDiv) {
            providersDiv = document.createElement('div');
            providersDiv.className = 'providers';
            
            const ratingEl = metaRow.querySelector('.rating');
            if (ratingEl) {
                metaRow.insertBefore(providersDiv, ratingEl);
            } else {
                metaRow.appendChild(providersDiv);
            }
        }
        
        providersDiv.innerHTML = providerList.slice(0, 3).map(p => {
            const logoUrl = `https://image.tmdb.org/t/p/w92${p.logo_path}`;
            return `<img src="${logoUrl}" alt="${p.provider_name}" title="${p.provider_name}" onerror="this.remove()">`;
        }).join('');
        
    } catch (err) {
        console.error('Error populating watch providers:', err);
    }
}



function updateCompletionProgress(allMovies) {
    const percentage = calculateProgress(allMovies);
    if (watchlistCompletionText) {
        watchlistCompletionText.textContent = `${percentage}%`;
    }
    if (watchlistCompletionBar) {
        watchlistCompletionBar.style.width = `${percentage}%`;
    }
}

function calculateDaysUntilRelease(releaseDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const release = new Date(releaseDate);
    release.setHours(0, 0, 0, 0);
    const diffTime = release - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

async function loadUpcomingReleases() {
    if (!upcomingReleasesSection || !upcomingReleasesList) {
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
        upcomingReleasesSection.style.display = 'none';
        if (pickRandomSection) {
            pickRandomSection.style.display = 'none';
        }
        return;
    }

    if (pickRandomSection) {
        pickRandomSection.style.display = 'block';
    }

    try {
        // Get user's watchlist
        const { data: watchlistData, error: watchlistError } = await supabaseClient
            .from('watchlist')
            .select('movie_id, title, release_date, media_type')
            .eq('user_id', user.id);

        if (watchlistError || !watchlistData) {
            return;
        }

        // Get today's date and next week's date
        const today = new Date();
        const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Fetch upcoming movies
        const upcomingMoviesUrl = `https://api.themoviedb.org/3/movie/upcoming?api_key=${API_KEY}&page=1&page=2`;
        const upcomingMoviesResponse = await fetch(upcomingMoviesUrl);
        const upcomingMoviesData = await upcomingMoviesResponse.json();
        const upcomingMovies = upcomingMoviesData.results || [];

        // Fetch on-the-air shows
        const onTheAirUrl = `https://api.themoviedb.org/3/tv/on_the_air?api_key=${API_KEY}&page=1`;
        const onTheAirResponse = await fetch(onTheAirUrl);
        const onTheAirData = await onTheAirResponse.json();
        const onTheAirShows = onTheAirData.results || [];

        // Find matches
        const upcomingInWatchlist = [];

        watchlistData.forEach(watchlistItem => {
            const isTV = isTVShow(watchlistItem.media_type);
            if (!isTV) {
                // Check movies
                upcomingMovies.forEach(movie => {
                    if (movie.id === watchlistItem.movie_id && movie.release_date) {
                        const daysUntil = calculateDaysUntilRelease(movie.release_date);
                        if (daysUntil >= 0 && daysUntil <= 7) {
                            upcomingInWatchlist.push({
                                title: movie.title || watchlistItem.title,
                                releaseDate: movie.release_date,
                                daysUntil,
                                type: 'movie'
                            });
                        }
                    }
                });
            } else {
                // Check shows
                onTheAirShows.forEach(show => {
                    if (show.id === watchlistItem.movie_id && show.first_air_date) {
                        const daysUntil = calculateDaysUntilRelease(show.first_air_date);
                        if (daysUntil >= 0 && daysUntil <= 7) {
                            upcomingInWatchlist.push({
                                title: show.name || watchlistItem.title,
                                releaseDate: show.first_air_date,
                                daysUntil,
                                type: 'show'
                            });
                        }
                    }
                });
            }
        });

        if (upcomingInWatchlist.length === 0) {
            upcomingReleasesSection.style.display = 'none';
            return;
        }

        // Sort by days until release
        upcomingInWatchlist.sort((a, b) => a.daysUntil - b.daysUntil);

        // Display banner
        upcomingReleasesList.innerHTML = upcomingInWatchlist
            .map(item => {
                const releaseText = item.daysUntil === 0 ? 'TODAY! 🎉' : `in ${item.daysUntil} day${item.daysUntil !== 1 ? 's' : ''}`;
                return `<p style="margin: 8px 0; color: #856404;"><strong>${item.title}</strong> releases ${releaseText}</p>`;
            })
            .join('');

        upcomingReleasesSection.style.display = 'block';
    } catch (error) {
        console.error('Error loading upcoming releases:', error);
    }
}

async function loadNextEpisodesCountdown() {
    const nextEpisodesSection = $('next-episodes-section');
    const nextEpisodesList = $('next-episodes-list');
    if (!nextEpisodesSection || !nextEpisodesList) return;

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
        nextEpisodesSection.style.display = 'none';
        return;
    }

    try {
        // Query watchlist for TV shows with 'watching' status
        const { data: watchlistData, error: watchlistError } = await supabaseClient
            .from('watchlist')
            .select('movie_id, title, status, media_type')
            .eq('user_id', user.id)
            .eq('status', 'watching');

        const tvShows = (watchlistData || []).filter(item => isTVShow(item.media_type));

        if (watchlistError || tvShows.length === 0) {
            nextEpisodesSection.style.display = 'none';
            return;
        }

        const countdowns = [];

        // Fetch details from TMDB for each watching show
        for (const item of tvShows) {
            try {
                const showId = item.movie_id;
                const url = `https://api.themoviedb.org/3/tv/${showId}?api_key=${API_KEY}`;
                const response = await fetch(url);
                if (!response.ok) continue;
                const showData = await response.json();

                const nextEp = showData.next_episode_to_air;
                if (nextEp && nextEp.air_date) {
                    const daysUntil = calculateDaysUntilRelease(nextEp.air_date);
                    if (daysUntil >= 0) {
                        countdowns.push({
                            showTitle: showData.name || item.title,
                            episodeName: nextEp.name,
                            episodeNumber: nextEp.episode_number,
                            seasonNumber: nextEp.season_number,
                            airDate: nextEp.air_date,
                            daysUntil: daysUntil
                        });
                    }
                }
            } catch (err) {
                console.error(`Error loading countdown for show ${item.movie_id}:`, err);
            }
        }

        if (countdowns.length === 0) {
            nextEpisodesSection.style.display = 'none';
            return;
        }

        // Sort chronologically (closest first)
        countdowns.sort((a, b) => a.daysUntil - b.daysUntil);

        nextEpisodesList.innerHTML = countdowns.map(cd => {
            const epCode = `S${String(cd.seasonNumber).padStart(2, '0')}E${String(cd.episodeNumber).padStart(2, '0')}`;
            const formattedDate = new Date(cd.airDate).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            
            let badgeClass = 'countdown-days-badge';
            let badgeText = '';
            if (cd.daysUntil === 0) {
                badgeClass += ' airs-today';
                badgeText = 'Airs Today! 🎉';
            } else if (cd.daysUntil === 1) {
                badgeText = 'Airs Tomorrow!';
            } else {
                badgeText = `Airs in ${cd.daysUntil} days`;
            }

            return `
                <div class="countdown-card">
                    <div class="countdown-show-title" title="${cd.showTitle}">${cd.showTitle}</div>
                    <div class="countdown-episode-info">${epCode} · ${cd.episodeName || 'Upcoming Episode'}</div>
                    <div class="${badgeClass}">
                        <i data-lucide="calendar"></i> ${badgeText}
                    </div>
                    <div class="countdown-air-date">Air Date: ${formattedDate}</div>
                </div>
            `;
        }).join('');

        nextEpisodesSection.style.display = 'block';

        if (window.lucide) {
            lucide.createIcons();
        }

    } catch (error) {
        console.error('Error loading next episodes countdowns:', error);
        nextEpisodesSection.style.display = 'none';
    }
}

async function getWatchlistChoices() {
    if (!window.supabaseClient) {
        return [];
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) {
        return [];
    }

    const { data, error } = await supabaseClient
        .from('watchlist')
        .select('movie_id, title, release_date, poster_path, overview, status, media_type, season, episode')
        .eq('user_id', user.id)
        .in('status', ['planning_to_watch', 'watching']);

    if (error || !data) {
        console.error('Error loading watchlist choices:', error);
        return [];
    }

    return data;
}

function buildTonightChoiceCard(item) {
    if (!tonightChoiceContent || !tonightChoiceCard) {
        return;
    }

    const releaseLabel = item.release_date ? `Release: ${item.release_date}` : 'Release date unknown';
    tonightChoiceContent.innerHTML = `
        <div style="display:flex; flex-wrap: wrap; gap: 18px; align-items:flex-start;">
            <div style="flex: 0 0 160px;">
                <img src="https://image.tmdb.org/t/p/w300${item.poster_path}" alt="${item.title}" style="width: 100%; border-radius: 8px;" onerror="this.src='https://via.placeholder.com/300x450?text=No+Image'" />
            </div>
            <div style="flex: 1; min-width: 220px;">
                <h3 style="margin-top: 0;">${item.title}</h3>
                <p style="margin: 8px 0 4px; font-weight: bold; font-size: 0.9rem; color: var(--text-muted);">${releaseLabel}</p>
                <p style="margin: 0 0 12px; line-height: 1.6;">${item.overview || 'No description available.'}</p>
                <p style="margin: 0;"><span class="status-badge status-${item.status || 'watching'}">Status: ${(item.status || 'watching').replace(/_/g, ' ')}</span></p>
            </div>
        </div>
    `;
    tonightChoiceCard.style.display = 'block';
    if (window.lucide) {
        lucide.createIcons();
    }
}

async function pickTonightChoice() {
    const choices = await getWatchlistChoices();
    if (!choices || choices.length === 0) {
        if (tonightChoiceContent) {
            tonightChoiceContent.innerHTML = '<p style="margin: 0;">Add something to your watchlist with status "Planning to Watch" or "Watching" first.</p>';
        }
        if (tonightChoiceCard) {
            tonightChoiceCard.style.display = 'block';
        }
        return;
    }

    const randomIndex = Math.floor(Math.random() * choices.length);
    const selected = choices[randomIndex];
    buildTonightChoiceCard(selected);
}

async function markAllEpisodesAsWatched(watchlistId, showId) {
    if (!window.supabaseClient) return;
    
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) return;

        // Fetch show details from TMDB
        const showUrl = `https://api.themoviedb.org/3/tv/${showId}?api_key=${API_KEY}`;
        const res = await fetch(showUrl);
        if (!res.ok) throw new Error('Failed to fetch show details from TMDB');
        const showData = await res.json();
        
        // Fetch already watched episodes from Supabase
        const { data: watchedEpisodes, error: watchedError } = await supabaseClient
            .from('user_watched_episodes')
            .select('season_number, episode_number')
            .eq('watchlist_id', watchlistId);
            
        if (watchedError) throw watchedError;
        
        const watchedSet = new Set(
            (watchedEpisodes || []).map(ep => `${ep.season_number}_${ep.episode_number}`)
        );
        
        const bulkInsertData = [];
        const seasons = (showData.seasons || []).filter(s => s.season_number > 0);
        
        let maxSeason = 1;
        let maxEpisode = 1;
        
        seasons.forEach(season => {
            const seasonNum = season.season_number;
            const episodeCount = season.episode_count;
            for (let epNum = 1; epNum <= episodeCount; epNum++) {
                if (!watchedSet.has(`${seasonNum}_${epNum}`)) {
                    bulkInsertData.push({
                        watchlist_id: watchlistId,
                        user_id: user.id,
                        tmdb_show_id: showId,
                        season_number: seasonNum,
                        episode_number: epNum
                    });
                }
                if (seasonNum > maxSeason) {
                    maxSeason = seasonNum;
                    maxEpisode = epNum;
                } else if (seasonNum === maxSeason && epNum > maxEpisode) {
                    maxEpisode = epNum;
                }
            }
        });
        
        if (bulkInsertData.length > 0) {
            const { error: insertError } = await supabaseClient
                .from('user_watched_episodes')
                .insert(bulkInsertData);
            if (insertError) throw insertError;
            
            // Update local cache
            const cachedEps = loadCachedWatchedEpisodes(user.id) || [];
            bulkInsertData.forEach(item => {
                cachedEps.push({
                    watchlist_id: item.watchlist_id,
                    season_number: item.season_number,
                    episode_number: item.episode_number
                });
            });
            saveWatchedEpisodesCache(user.id, cachedEps);
        }
        
        await updateShowProgress(watchlistId, maxSeason, maxEpisode);
        
        // Update UI inside the modal if it's currently showing
        const modal = document.getElementById('watchlist-modal');
        if (modal && modal.classList.contains('show') && modal.dataset.currentItemId === String(watchlistId)) {
            const cachedWatchlist = loadCachedWatchlist(user.id);
            const showItem = cachedWatchlist ? cachedWatchlist.find(i => i.id === watchlistId) : null;
            if (showItem) {
                showItem.season = maxSeason;
                showItem.episode = maxEpisode;
                setupEpisodesTracker(showItem);
            }
        }
    } catch (err) {
        console.error('Error marking all episodes as watched:', err);
    }
}

async function updateWatchlistStatus(id, status) {
    if (!window.supabaseClient) {
        showToast('Unable to update status right now.', 'error');
        return false;
    }

    let oldCache = null;
    let userId = null;
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (user) {
            userId = user.id;
            const cached = loadCachedWatchlist(user.id);
            if (cached) {
                oldCache = JSON.parse(JSON.stringify(cached));
                const item = cached.find(i => i.id === id);
                if (item) {
                    item.status = status;
                    if (status === 'completed') {
                        item.completed_at = new Date().toISOString();
                    } else {
                        item.completed_at = null;
                    }
                    saveWatchlistCache(user.id, cached);
                    
                    const isMoviesPage = window.location.pathname.includes('movies.html');
                    const isShowsPage = window.location.pathname.includes('shows.html');
                    const cachedWatchedEps = loadCachedWatchedEpisodes(user.id) || [];
                    processAndRenderWatchlist(cached, cachedWatchedEps, isMoviesPage, isShowsPage);
                }
            }
        }
    } catch (e) {
        console.error('Optimistic cache update failed:', e);
    }

    const updateObj = { status };
    if (status === 'completed') {
        updateObj.completed_at = new Date().toISOString();
    } else {
        updateObj.completed_at = null;
    }

    const { error } = await supabaseClient
        .from('watchlist')
        .update(updateObj)
        .eq('id', id);

    if (error) {
        console.error('Error updating watchlist status:', error);
        showToast('Unable to update status. Please try again.', 'error');
        if (oldCache && userId) {
            saveWatchlistCache(userId, oldCache);
            const isMoviesPage = window.location.pathname.includes('movies.html');
            const isShowsPage = window.location.pathname.includes('shows.html');
            const cachedWatchedEps = loadCachedWatchedEpisodes(userId) || [];
            processAndRenderWatchlist(oldCache, cachedWatchedEps, isMoviesPage, isShowsPage);
        }
        return false;
    }

    if (status === 'completed' && userId) {
        try {
            const cached = loadCachedWatchlist(userId);
            const item = cached ? cached.find(i => i.id === id) : null;
            if (item && isTVShow(item.media_type)) {
                await markAllEpisodesAsWatched(item.id, item.movie_id);
            }
        } catch (err) {
            console.error('Failed to mark all episodes as completed on status change:', err);
        }
    }

    if (window.loadWatchStatistics) {
        window.loadWatchStatistics();
    }
    if (window.loadUpcomingMoviesCountdown) {
        window.loadUpcomingMoviesCountdown();
    }
    return true;
}

async function deleteWatchlistItem(id) {
    if (!window.supabaseClient) {
        showToast('Unable to delete item right now.', 'error');
        return;
    }

    let oldCache = null;
    let userId = null;
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (user) {
            userId = user.id;
            const cached = loadCachedWatchlist(user.id);
            if (cached) {
                oldCache = JSON.parse(JSON.stringify(cached));
                const updatedCache = cached.filter(i => i.id !== id);
                saveWatchlistCache(user.id, updatedCache);
                
                const isMoviesPage = window.location.pathname.includes('movies.html');
                const isShowsPage = window.location.pathname.includes('shows.html');
                const cachedWatchedEps = loadCachedWatchedEpisodes(user.id) || [];
                processAndRenderWatchlist(updatedCache, cachedWatchedEps, isMoviesPage, isShowsPage);
            }
        }
    } catch (e) {
        console.error('Optimistic cache delete failed:', e);
    }

    const { error } = await supabaseClient.from('watchlist').delete().eq('id', id);
    if (error) {
        console.error('Error deleting watchlist item:', error);
        showToast('Unable to delete the item. Please try again.', 'error');
        if (oldCache && userId) {
            saveWatchlistCache(userId, oldCache);
            const isMoviesPage = window.location.pathname.includes('movies.html');
            const isShowsPage = window.location.pathname.includes('shows.html');
            const cachedWatchedEps = loadCachedWatchedEpisodes(userId) || [];
            processAndRenderWatchlist(oldCache, cachedWatchedEps, isMoviesPage, isShowsPage);
        }
        return;
    }

    if (window.loadWatchStatistics) {
        window.loadWatchStatistics();
    }
    if (window.loadUpcomingMoviesCountdown) {
        window.loadUpcomingMoviesCountdown();
    }
}

async function loadWatchStatistics() {
    const statsSection = $('watch-statistics-section');
    if (!statsSection) return;

    if (!window.supabaseClient) {
        statsSection.style.display = 'none';
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
        statsSection.style.display = 'none';
        return;
    }

    try {
        // Fetch all watchlist items with movie_id included
        const { data: watchlistItems, error: watchlistError } = await supabaseClient
            .from('watchlist')
            .select('movie_id, title, media_type, status, created_at, completed_at, poster_path')
            .eq('user_id', user.id);

        if (watchlistError) throw watchlistError;

        // Fetch all user watched episodes
        const { data: watchedEpisodes, error: episodesError } = await supabaseClient
            .from('user_watched_episodes')
            .select('id, watchlist_id, tmdb_show_id, season_number, episode_number, watched_at')
            .eq('user_id', user.id);

        if (episodesError) throw episodesError;

        const watchlist = watchlistItems || [];
        const episodes = watchedEpisodes || [];

        // Initialize/update Monthly Wrapped selection & banner
        if (typeof initMonthlyWrapped === 'function') {
            initMonthlyWrapped(watchlist, episodes);
        }

        // 1. Completed titles
        const completedTitlesCount = watchlist.filter(item => item.status === 'completed').length;

        // 2. Episodes logged
        const episodesLoggedCount = episodes.length;

        // 3. Estimated watch time (Movies completed * 120m + Episodes * 45m)
        const completedMoviesCount = watchlist.filter(item => (!item.media_type || item.media_type === 'movie') && item.status === 'completed').length;
        const totalMinutes = (completedMoviesCount * 120) + (episodesLoggedCount * 45);
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        const watchTimeStr = `${days}d ${hours}h ${minutes}m`;

        // Update card text
        const statsWatchTime = $('stats-watch-time');
        const statsCompletedTitles = $('stats-completed-titles');
        const statsEpisodesLogged = $('stats-episodes-logged');
        
        if (statsWatchTime) statsWatchTime.textContent = watchTimeStr;
        if (statsCompletedTitles) statsCompletedTitles.textContent = completedTitlesCount;
        if (statsEpisodesLogged) statsEpisodesLogged.textContent = episodesLoggedCount;

        // 4. Status distribution
        const statusCounts = {
            planning_to_watch: 0,
            watching: 0,
            completed: 0,
            on_hold: 0,
            dropped: 0
        };
        watchlist.forEach(item => {
            const status = item.status || 'watching';
            if (statusCounts[status] !== undefined) {
                statusCounts[status]++;
            }
        });

        const totalItems = watchlist.length;
        const statusBarWrapper = $('status-bar-wrapper');
        const statusLegend = $('status-legend');
        
        if (statusBarWrapper && statusLegend) {
            statusBarWrapper.innerHTML = '';
            statusLegend.innerHTML = '';
            
            const statuses = [
                { key: 'completed', label: 'Completed', class: 'status-completed', color: '#10b981' },
                { key: 'watching', label: 'Watching', class: 'status-watching', color: '#3b82f6' },
                { key: 'planning_to_watch', label: 'Planning to Watch', class: 'status-planning', color: '#64748b' },
                { key: 'on_hold', label: 'On Hold', class: 'status-on_hold', color: '#f59e0b' },
                { key: 'dropped', label: 'Dropped', class: 'status-dropped', color: '#ef4444' }
            ];
            
            statuses.forEach(status => {
                const count = statusCounts[status.key] || 0;
                const pct = totalItems > 0 ? (count / totalItems) * 100 : 0;
                
                if (pct > 0) {
                    const segment = document.createElement('div');
                    segment.className = `status-bar-segment ${status.class}`;
                    segment.style.width = `${pct}%`;
                    segment.title = `${status.label}: ${count} (${Math.round(pct)}%)`;
                    statusBarWrapper.appendChild(segment);
                }
                
                const legendItem = document.createElement('div');
                legendItem.className = 'status-legend-item';
                legendItem.innerHTML = `
                    <span class="status-legend-color" style="background-color: ${status.color}"></span>
                    <span>${status.label}: ${count}</span>
                `;
                statusLegend.appendChild(legendItem);
            });
        }

        // 5. Genre breakdown (for completed items)
        const completedItems = watchlist.filter(item => item.status === 'completed');
        const genreBreakdownCard = $('genre-breakdown-card');
        
        if (genreBreakdownCard) {
            if (completedItems.length === 0) {
                genreBreakdownCard.style.display = 'none';
            } else {
                // Ensure cache is initialized
                window._movieDetailsCache = window._movieDetailsCache || {};
                
                const fetchPromises = completedItems.map(async (item) => {
                    const movieId = item.movie_id;
                    const mediaType = item.media_type || 'movie';
                    const path = isTVShow(mediaType) ? 'tv' : 'movie';
                    
                    if (window._movieDetailsCache[movieId]) {
                        return window._movieDetailsCache[movieId];
                    }
                    
                    try {
                        const url = `https://api.themoviedb.org/3/${path}/${movieId}?api_key=${API_KEY}`;
                        const r = await fetch(url);
                        if (r.ok) {
                            const details = await r.json();
                            window._movieDetailsCache[movieId] = details;
                            return details;
                        }
                    } catch (e) {
                        console.error(`Error fetching genres for ${mediaType} ${movieId}:`, e);
                    }
                    return null;
                });

                const detailsResults = await Promise.all(fetchPromises);
                const genreCounts = {};

                detailsResults.forEach(details => {
                    if (details && details.genres) {
                        details.genres.forEach(g => {
                            genreCounts[g.name] = (genreCounts[g.name] || 0) + 1;
                        });
                    }
                });

                const totalGenreTags = Object.values(genreCounts).reduce((a, b) => a + b, 0);

                if (totalGenreTags === 0) {
                    genreBreakdownCard.style.display = 'none';
                } else {
                    const sortedGenres = Object.entries(genreCounts)
                        .map(([name, count]) => ({ name, count, pct: (count / totalGenreTags) * 100 }))
                        .sort((a, b) => b.count - a.count);

                    let chartData = [];
                    if (sortedGenres.length > 5) {
                        chartData = sortedGenres.slice(0, 4);
                        const otherCount = sortedGenres.slice(4).reduce((sum, g) => sum + g.count, 0);
                        const otherPct = (otherCount / totalGenreTags) * 100;
                        chartData.push({ name: 'Other', count: otherCount, pct: otherPct });
                    } else {
                        chartData = sortedGenres;
                    }

                    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];
                    let currentAngle = 0;
                    const gradientParts = [];

                    chartData.forEach((slice, idx) => {
                        const color = colors[idx % colors.length];
                        const nextAngle = currentAngle + slice.pct;
                        gradientParts.push(`${color} ${currentAngle.toFixed(1)}% ${nextAngle.toFixed(1)}%`);
                        currentAngle = nextAngle;
                    });

                    const gradientStr = `conic-gradient(${gradientParts.join(', ')})`;
                    const pieChart = $('genre-pie-chart');
                    if (pieChart) {
                        pieChart.style.background = gradientStr;
                    }

                    const legend = $('genre-legend');
                    if (legend) {
                        legend.innerHTML = chartData.map((slice, idx) => {
                            const color = colors[idx % colors.length];
                            return `
                                <div class="genre-legend-item">
                                    <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0;">
                                        <span class="genre-legend-color" style="color: ${color}; background-color: ${color};"></span>
                                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${slice.name}</span>
                                    </div>
                                    <span>${Math.round(slice.pct)}%</span>
                                </div>
                            `;
                        }).join('');
                    }

                    genreBreakdownCard.style.display = 'flex';
                }
            }
        }

        // Show section
        statsSection.style.display = 'block';

        // Re-init lucide icons inside the section
        if (window.lucide) {
            lucide.createIcons();
        }
    } catch (err) {
        console.error('Error loading watch statistics:', err);
        statsSection.style.display = 'none';
    }
}

async function loadUpcomingMoviesCountdown() {
    const countdownSection = $('upcoming-movies-countdown-section');
    const countdownList = $('upcoming-movies-countdown-list');
    if (!countdownSection || !countdownList) return;

    if (!window.supabaseClient) {
        countdownSection.style.display = 'none';
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
        countdownSection.style.display = 'none';
        return;
    }

    try {
        // Query watchlist for movies with 'planning_to_watch' status
        const { data: watchlistData, error: watchlistError } = await supabaseClient
            .from('watchlist')
            .select('movie_id, title, release_date, media_type, status, poster_path')
            .eq('user_id', user.id)
            .eq('media_type', 'movie')
            .eq('status', 'planning_to_watch');

        if (watchlistError) throw watchlistError;

        const upcomingMovies = [];

        if (watchlistData && watchlistData.length > 0) {
            watchlistData.forEach(movie => {
                if (movie.release_date) {
                    const daysUntil = calculateDaysUntilRelease(movie.release_date);
                    if (daysUntil >= 0) {
                        upcomingMovies.push({
                            title: movie.title,
                            releaseDate: movie.release_date,
                            daysUntil: daysUntil,
                            posterPath: movie.poster_path
                        });
                    }
                }
            });
        }

        if (upcomingMovies.length === 0) {
            countdownSection.style.display = 'none';
            return;
        }

        // Sort chronologically (closest release date first)
        upcomingMovies.sort((a, b) => a.daysUntil - b.daysUntil);

        countdownList.innerHTML = upcomingMovies.map(movie => {
            const formattedDate = new Date(movie.releaseDate).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            
            let badgeClass = 'countdown-days-badge';
            let badgeText = '';
            if (movie.daysUntil === 0) {
                badgeClass += ' airs-today';
                badgeText = 'Releases Today! 🎉';
            } else if (movie.daysUntil === 1) {
                badgeText = 'Releases Tomorrow!';
            } else {
                badgeText = `Releases in ${movie.daysUntil} days`;
            }

            const posterUrl = movie.posterPath ? `https://image.tmdb.org/t/p/w200${movie.posterPath}` : '';

            return `
                <div class="countdown-card movie-countdown-card">
                    ${posterUrl ? `<img src="${posterUrl}" alt="${movie.title}" />` : ''}
                    <div style="flex: 1; min-width: 0;">
                        <div class="countdown-show-title" title="${movie.title}">${movie.title}</div>
                        <div class="${badgeClass}" style="margin: 4px 0;">
                            <i data-lucide="calendar"></i> ${badgeText}
                        </div>
                        <div class="countdown-air-date">Release Date: ${formattedDate}</div>
                    </div>
                </div>
            `;
        }).join('');

        countdownSection.style.display = 'block';

        if (window.lucide) {
            lucide.createIcons();
        }

    } catch (err) {
        console.error('Error loading upcoming movies countdown:', err);
        countdownSection.style.display = 'none';
    }
}

window.loadWatchlist = loadWatchlist;
window.loadWatchStatistics = loadWatchStatistics;
window.loadPendingRequests = loadPendingRequests;
window.loadUserGroups = loadUserGroups;
window.loadUpcomingReleases = loadUpcomingReleases;
window.loadNextEpisodesCountdown = loadNextEpisodesCountdown;
window.loadUpcomingMoviesCountdown = loadUpcomingMoviesCountdown;

// Modal helpers
const watchlistModal = document.getElementById('watchlist-modal');
const modalPoster = document.getElementById('modal-poster');
const modalTitle = document.getElementById('modal-title');
const modalMeta = document.getElementById('modal-meta');
const modalOverview = document.getElementById('modal-overview');
const modalClose = document.getElementById('modal-close');
const modalDelete = document.getElementById('modal-delete');
const modalGenres = document.getElementById('modal-genres');
const modalRating = document.getElementById('modal-rating');
const modalProviders = document.getElementById('modal-providers');
const modalPlayTrailer = document.getElementById('modal-play-trailer');
const modalAddWatchlist = document.getElementById('modal-add-watchlist');

// Initialize in-memory cache for season episodes
window._seasonEpisodesCache = window._seasonEpisodesCache || {};

function openWatchlistModal(item) {
    if (!watchlistModal) return;
    
    // Save current item ID on modal for status dropdown instant sync
    watchlistModal.dataset.currentItemId = item.id || '';
    
    modalPoster.src = `https://image.tmdb.org/t/p/w400${item.poster_path}`;
    modalPoster.onerror = function() { this.src = 'https://via.placeholder.com/300x450?text=No+Image'; };
    modalTitle.textContent = `${item.title} ${item.release_date ? '('+item.release_date.split('-')[0]+')' : ''}`;
    const isTV = isTVShow(item.media_type);
    const mediaType = item.media_type || (isTV ? 'tv' : 'movie');
    
    // Construct rich meta badges
    modalMeta.innerHTML = '';
    
    // 1. Media Type Badge
    const typeBadge = document.createElement('span');
    typeBadge.className = `meta-badge badge-${mediaType}`;
    const typeIcon = isTV ? 'tv' : 'film';
    typeBadge.innerHTML = `<i data-lucide="${typeIcon}"></i> ${isTV ? 'TV Show' : 'Movie'}`;
    modalMeta.appendChild(typeBadge);
    
    // 2. Status Badge (if in watchlist)
    if (item.id) {
        const statusBadge = document.createElement('span');
        statusBadge.className = `meta-badge status-${item.status || 'watching'}`;
        statusBadge.id = 'modal-status-badge';
        
        let statusIcon = 'eye';
        if (item.status === 'completed') statusIcon = 'check-circle';
        else if (item.status === 'planning_to_watch' || item.status === 'planning') statusIcon = 'calendar';
        else if (item.status === 'on_hold') statusIcon = 'pause-circle';
        else if (item.status === 'dropped') statusIcon = 'x-circle';
        
        const statusText = (item.status || 'watching').replace(/_/g, ' ');
        statusBadge.innerHTML = `<i data-lucide="${statusIcon}"></i> ${statusText}`;
        modalMeta.appendChild(statusBadge);
        
        // 3. Episode / Season progress badge (if TV Show)
        if (isTV) {
            const trackingBadge = document.createElement('span');
            trackingBadge.className = 'meta-badge badge-tracking';
            trackingBadge.id = 'modal-tracking-badge';
            trackingBadge.innerHTML = `<i data-lucide="hash"></i> S${item.season || 1} · E${item.episode || 1}`;
            modalMeta.appendChild(trackingBadge);
        }
    }
    
    modalOverview.textContent = item.overview || 'No description available.';
    
    // Clear/reset dynamic details
    if (modalGenres) modalGenres.innerHTML = '';
    if (modalRating) {
        modalRating.style.setProperty('--rating-percent', '0%');
        const valEl = modalRating.querySelector('.rating-value');
        if (valEl) valEl.textContent = '-';
    }
    if (modalProviders) modalProviders.innerHTML = '';
    if (modalPlayTrailer) modalPlayTrailer.style.display = 'none';
    const modalStatusContainer = document.getElementById('modal-status-container');
    if (modalStatusContainer) modalStatusContainer.style.display = 'none';

    const movieId = item.movie_id || item.id;
    const path = isTVShow(mediaType) ? 'tv' : 'movie';

    if (movieId) {
        const detailsUrl = `https://api.themoviedb.org/3/${path}/${movieId}?api_key=${API_KEY}`;
        const providersUrl = `https://api.themoviedb.org/3/${path}/${movieId}/watch/providers?api_key=${API_KEY}`;
        const videosUrl = `https://api.themoviedb.org/3/${path}/${movieId}/videos?api_key=${API_KEY}`;

        Promise.all([
            fetch(detailsUrl).then(r => r.ok ? r.json() : null),
            fetch(providersUrl).then(r => r.ok ? r.json() : null),
            fetch(videosUrl).then(r => r.ok ? r.json() : null)
        ]).then(([details, providersData, videosData]) => {
            if (details) {
                if (modalGenres && details.genres) {
                    modalGenres.innerHTML = details.genres.slice(0, 3).map(g => `<span class="genre-badge">${g.name}</span>`).join('');
                }
                if (modalRating) {
                    const ratingVal = details.vote_average || 0;
                    const ratingPct = Math.round((ratingVal / 10) * 100);
                    modalRating.style.setProperty('--rating-percent', `${ratingPct}%`);
                    const valEl = modalRating.querySelector('.rating-value');
                    if (valEl) valEl.textContent = `${ratingVal.toFixed(1)}/10`;
                }
            }
            if (providersData && modalProviders) {
                const results = providersData.results || {};
                let providerList = [];
                if (results.US && results.US.flatrate) {
                    providerList = results.US.flatrate;
                } else {
                    for (const country in results) {
                        if (results[country] && results[country].flatrate) {
                            providerList = results[country].flatrate;
                            break;
                        }
                    }
                }
                if (providerList.length > 0) {
                    modalProviders.innerHTML = providerList.slice(0, 3).map(p => {
                        const logoUrl = `https://image.tmdb.org/t/p/w92${p.logo_path}`;
                        return `<img src="${logoUrl}" alt="${p.provider_name}" title="${p.provider_name}" onerror="this.remove()">`;
                    }).join('');
                }
            }
            if (videosData && modalPlayTrailer) {
                const results = videosData.results || [];
                const trailer = results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
                if (trailer && trailer.key) {
                    modalPlayTrailer.style.display = '';
                    modalPlayTrailer.onclick = () => {
                        handlePlayTrailer(trailer.key, movieId, mediaType);
                    };
                }
            }
            if (window.lucide) {
                lucide.createIcons();
            }
        }).catch(err => {
            console.error('Error loading modal extra details:', err);
        });
    }

    // Hide episodes container by default
    const epContainer = document.getElementById('modal-episodes-container');
    if (epContainer) {
        epContainer.style.display = 'none';
    }

    if (isTV && item.id) {
        setupEpisodesTracker(item);
    }

    watchlistModal.classList.add('show');
    watchlistModal.setAttribute('aria-hidden', 'false');
    watchlistModal.scrollTop = 0;

    // Show/hide actions based on presence in watchlist
    if (item.id) {
        if (modalAddWatchlist) modalAddWatchlist.style.display = 'none';
        if (modalDelete) {
            modalDelete.style.display = '';
            modalDelete.onclick = async () => {
                await deleteWatchlistItem(item.id);
                closeWatchlistModal();
            };
        }
        const modalStatusContainer = document.getElementById('modal-status-container');
        if (modalStatusContainer) {
            modalStatusContainer.innerHTML = '';
            const statusSelect = buildStatusSelect(item.status || 'watching', item.id);
            modalStatusContainer.appendChild(statusSelect);
            modalStatusContainer.style.display = 'flex';
        }
    } else {
        if (modalDelete) modalDelete.style.display = 'none';
        if (modalAddWatchlist) {
            modalAddWatchlist.style.display = '';
            modalAddWatchlist.onclick = async () => {
                const addObj = {
                    id: item.movie_id,
                    media_type: item.media_type,
                    title: item.title,
                    name: item.title,
                    release_date: item.release_date,
                    first_air_date: item.release_date,
                    poster_path: item.poster_path,
                    overview: item.overview
                };
                await addToWatchlist(addObj);
                closeWatchlistModal();
            };
        }
    }
    if (window.lucide) {
        lucide.createIcons();
    }
}

async function setupEpisodesTracker(item) {
    const container = document.getElementById('modal-episodes-container');
    if (!container) return;
    
    container.style.display = 'block';
    
    const progressLabel = document.getElementById('episodes-progress-label');
    const progressPercent = document.getElementById('episodes-progress-percent');
    const progressBarFg = document.getElementById('episodes-progress-bar-fg');
    const accordionContainer = document.getElementById('seasons-accordion-container');
    
    if (progressLabel) progressLabel.textContent = 'Loading show metadata...';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressBarFg) progressBarFg.style.width = '0%';
    if (accordionContainer) accordionContainer.innerHTML = '';
    
    const showId = item.movie_id;
    const watchlistId = item.id;
    
    try {
        // Fetch show details from TMDB to get the number of seasons and episodes
        const showUrl = `https://api.themoviedb.org/3/tv/${showId}?api_key=${API_KEY}`;
        const showResponse = await fetch(showUrl);
        if (!showResponse.ok) throw new Error('Failed to fetch show metadata');
        const showData = await showResponse.json();
        
        // Fetch watched episodes from Supabase
        const { data: watchedEpisodes, error: watchedError } = await supabaseClient
            .from('user_watched_episodes')
            .select('season_number, episode_number')
            .eq('watchlist_id', watchlistId);
            
        if (watchedError) throw watchedError;
        
        // Track watched set for fast lookup
        const watchedSet = new Set(
            (watchedEpisodes || []).map(ep => `${ep.season_number}_${ep.episode_number}`)
        );
        
        // Calculate total episodes in show
        let totalEpisodes = showData.number_of_episodes || 0;
        let watchedCount = watchedSet.size;
        
        // Render progress bar
        updateProgressUI(watchedCount, totalEpisodes);
        
        // Render seasons list
        const seasons = (showData.seasons || []).filter(s => s.season_number > 0);
        
        if (accordionContainer) {
            accordionContainer.innerHTML = '';
            seasons.forEach(season => {
                const seasonNum = season.season_number;
                const episodeCount = season.episode_count;
                
                // Count watched in this season
                let seasonWatchedCount = 0;
                for (let i = 1; i <= episodeCount; i++) {
                    if (watchedSet.has(`${seasonNum}_${i}`)) {
                        seasonWatchedCount++;
                    }
                }
                
                const accordion = document.createElement('div');
                accordion.className = 'season-accordion';
                accordion.dataset.seasonNumber = seasonNum;
                
                accordion.innerHTML = `
                    <div class="season-header" tabindex="0" role="button" aria-expanded="false">
                        <div class="season-title-info">
                            <span class="season-title">${season.name}</span>
                            <span class="season-stats">${seasonWatchedCount} / ${episodeCount} Watched</span>
                        </div>
                        <svg class="season-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="season-content">
                        <div class="episodes-list">
                            <div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading episodes...</div>
                        </div>
                    </div>
                `;
                
                const header = accordion.querySelector('.season-header');
                const content = accordion.querySelector('.season-content');
                
                header.addEventListener('click', () => {
                    const isExpanded = accordion.classList.contains('expanded');
                    if (isExpanded) {
                        accordion.classList.remove('expanded');
                        header.setAttribute('aria-expanded', 'false');
                    } else {
                        accordion.classList.add('expanded');
                        header.setAttribute('aria-expanded', 'true');
                        lazyLoadSeasonEpisodes(showId, watchlistId, seasonNum, content, watchedSet, totalEpisodes);
                    }
                });
                
                header.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        header.click();
                    }
                });
                
                accordionContainer.appendChild(accordion);
            });
        }
        
    } catch (err) {
        console.error('Error setting up episodes tracker:', err);
        if (progressLabel) progressLabel.textContent = 'Error loading episodes tracking.';
    }
}

function updateProgressUI(watchedCount, totalEpisodes) {
    const progressLabel = document.getElementById('episodes-progress-label');
    const progressPercent = document.getElementById('episodes-progress-percent');
    const progressBarFg = document.getElementById('episodes-progress-bar-fg');
    
    if (totalEpisodes === 0) {
        if (progressLabel) progressLabel.textContent = '0 / 0 Episodes Watched';
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressBarFg) progressBarFg.style.width = '0%';
        return;
    }
    
    const percent = Math.round((watchedCount / totalEpisodes) * 100);
    if (progressLabel) progressLabel.textContent = `${watchedCount} / ${totalEpisodes} Episodes Watched`;
    if (progressPercent) progressPercent.textContent = `${percent}%`;
    if (progressBarFg) progressBarFg.style.width = `${percent}%`;
}

async function lazyLoadSeasonEpisodes(showId, watchlistId, seasonNum, contentDiv, watchedSet, totalEpisodes) {
    const listDiv = contentDiv.querySelector('.episodes-list');
    if (!listDiv) return;
    
    // Check cache
    const cacheKey = `${showId}_s${seasonNum}`;
    let episodes = window._seasonEpisodesCache[cacheKey];
    
    if (!episodes) {
        try {
            const url = `https://api.themoviedb.org/3/tv/${showId}/season/${seasonNum}?api_key=${API_KEY}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch season episodes');
            const data = await response.json();
            episodes = data.episodes || [];
            window._seasonEpisodesCache[cacheKey] = episodes;
        } catch (err) {
            console.error('Error fetching season episodes:', err);
            listDiv.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--danger-color); cursor: pointer;">Error loading episodes. Click to retry.</div>`;
            listDiv.onclick = () => {
                listDiv.onclick = null;
                listDiv.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading episodes...</div>`;
                lazyLoadSeasonEpisodes(showId, watchlistId, seasonNum, contentDiv, watchedSet, totalEpisodes);
            };
            return;
        }
    }
    
    renderEpisodesList(listDiv, episodes, watchlistId, showId, seasonNum, watchedSet, totalEpisodes);
}

function renderEpisodesList(listDiv, episodes, watchlistId, showId, seasonNum, watchedSet, totalEpisodes) {
    listDiv.innerHTML = '';
    
    if (episodes.length === 0) {
        listDiv.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No episodes found.</div>`;
        return;
    }
    
    episodes.forEach(ep => {
        const epNum = ep.episode_number;
        const isWatched = watchedSet.has(`${seasonNum}_${epNum}`);
        
        const epItem = document.createElement('div');
        epItem.className = 'episode-item' + (isWatched ? ' watched' : '');
        
        const dateStr = ep.air_date ? new Date(ep.air_date).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown Air Date';
        const runtimeStr = ep.runtime ? `${ep.runtime}m` : '';
        const metaStr = [dateStr, runtimeStr].filter(Boolean).join(' · ');
        
        epItem.innerHTML = `
            <div class="episode-checkbox-container">
                <input type="checkbox" class="episode-checkbox" data-season="${seasonNum}" data-episode="${epNum}" ${isWatched ? 'checked' : ''} />
            </div>
            <div class="episode-info">
                <div class="episode-title-row">
                    <span class="episode-title">EP ${epNum}. ${ep.name}</span>
                    <span class="episode-meta">${metaStr}</span>
                </div>
                <div class="episode-overview">${ep.overview || 'No description available.'}</div>
            </div>
        `;
        
        const checkbox = epItem.querySelector('.episode-checkbox');
        checkbox.addEventListener('change', async () => {
            const checked = checkbox.checked;
            if (checked) {
                epItem.classList.add('watched');
                watchedSet.add(`${seasonNum}_${epNum}`);
            } else {
                epItem.classList.remove('watched');
                watchedSet.delete(`${seasonNum}_${epNum}`);
            }
            
            const success = await toggleEpisodeWatchedState(watchlistId, showId, seasonNum, epNum, checked);
            if (!success) {
                checkbox.checked = !checked;
                epItem.classList.toggle('watched', !checked);
                if (!checked) watchedSet.add(`${seasonNum}_${epNum}`);
                else watchedSet.delete(`${seasonNum}_${epNum}`);
                return;
            }
            
            // Update local storage cache of watched episodes
            try {
                const { data: sessionData } = await supabaseClient.auth.getSession();
                const user = sessionData?.session?.user;
                if (user) {
                    let cachedEps = loadCachedWatchedEpisodes(user.id) || [];
                    if (checked) {
                        const exists = cachedEps.some(e => e.watchlist_id === watchlistId && e.season_number === seasonNum && e.episode_number === epNum);
                        if (!exists) {
                            cachedEps.push({
                                watchlist_id: watchlistId,
                                season_number: seasonNum,
                                episode_number: epNum
                            });
                        }
                    } else {
                        cachedEps = cachedEps.filter(e => !(e.watchlist_id === watchlistId && e.season_number === seasonNum && e.episode_number === epNum));
                    }
                    saveWatchedEpisodesCache(user.id, cachedEps);
                }
            } catch (e) {
                console.error('Error updating watched episodes cache:', e);
            }
            
            // Update season stats badge in accordion header
            const accordion = listDiv.closest('.season-accordion');
            if (accordion) {
                const statsSpan = accordion.querySelector('.season-stats');
                if (statsSpan) {
                    let seasonWatchedCount = 0;
                    episodes.forEach(item => {
                        if (watchedSet.has(`${seasonNum}_${item.episode_number}`)) {
                            seasonWatchedCount++;
                        }
                    });
                    statsSpan.textContent = `${seasonWatchedCount} / ${episodes.length} Watched`;
                }
            }
            
            // Recalculate and update the show-level progress bar and label in the UI
            updateProgressUI(watchedSet.size, totalEpisodes);
            if (window.loadWatchStatistics) {
                window.loadWatchStatistics();
            }

            // Sync watchlist item progress to the highest watched season and episode
            let maxSeason = 1;
            let maxEpisode = 1;
            if (watchedSet.size > 0) {
                watchedSet.forEach(val => {
                    const [sStr, eStr] = val.split('_');
                    const s = parseInt(sStr, 10);
                    const e = parseInt(eStr, 10);
                    if (s > maxSeason) {
                        maxSeason = s;
                        maxEpisode = e;
                    } else if (s === maxSeason) {
                        if (e > maxEpisode) {
                            maxEpisode = e;
                        }
                    }
                });
            }
            await updateShowProgress(watchlistId, maxSeason, maxEpisode);
            
            // Sync status tracking badge in modal meta
            const trackingBadge = document.getElementById('modal-tracking-badge');
            if (trackingBadge) {
                trackingBadge.innerHTML = `<i data-lucide="hash"></i> S${maxSeason} · E${maxEpisode}`;
                if (window.lucide) {
                    lucide.createIcons();
                }
            }
        });
        
        listDiv.appendChild(epItem);
    });
}

async function toggleEpisodeWatchedState(watchlistId, showId, seasonNum, episodeNum, isWatched) {
    if (!window.supabaseClient) {
        showToast('Supabase is not initialized.', 'error');
        return false;
    }
    
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (!user) {
            showToast('Please sign in to track episodes.', 'warning');
            return false;
        }
        
        if (isWatched) {
            const { error } = await supabaseClient
                .from('user_watched_episodes')
                .insert([
                    {
                        watchlist_id: watchlistId,
                        user_id: user.id,
                        tmdb_show_id: showId,
                        season_number: seasonNum,
                        episode_number: episodeNum
                    }
                ]);
            if (error) throw error;
        } else {
            const { error } = await supabaseClient
                .from('user_watched_episodes')
                .delete()
                .eq('watchlist_id', watchlistId)
                .eq('user_id', user.id)
                .eq('season_number', seasonNum)
                .eq('episode_number', episodeNum);
            if (error) throw error;
        }
        
        return true;
    } catch (err) {
        console.error('Error toggling episode watched status:', err);
        showToast('Failed to update episode watch status.', 'error');
        return false;
    }
}

async function updateShowProgress(id, season, episode) {
    if (!window.supabaseClient) {
        showToast('Unable to update progress right now.', 'error');
        return false;
    }

    let oldCache = null;
    let userId = null;
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (user) {
            userId = user.id;
            const cached = loadCachedWatchlist(user.id);
            if (cached) {
                oldCache = JSON.parse(JSON.stringify(cached));
                const item = cached.find(i => i.id === id);
                if (item) {
                    item.season = season;
                    item.episode = episode;
                    saveWatchlistCache(user.id, cached);
                    
                    const isMoviesPage = window.location.pathname.includes('movies.html');
                    const isShowsPage = window.location.pathname.includes('shows.html');
                    const cachedWatchedEps = loadCachedWatchedEpisodes(user.id) || [];
                    processAndRenderWatchlist(cached, cachedWatchedEps, isMoviesPage, isShowsPage);
                }
            }
        }
    } catch (e) {
        console.error('Optimistic cache progress update failed:', e);
    }

    const { error } = await supabaseClient
        .from('watchlist')
        .update({ season, episode })
        .eq('id', id);

    if (error) {
        console.error('Error updating show progress:', error);
        showToast('Unable to update progress. Please try again.', 'error');
        if (oldCache && userId) {
            saveWatchlistCache(userId, oldCache);
            const isMoviesPage = window.location.pathname.includes('movies.html');
            const isShowsPage = window.location.pathname.includes('shows.html');
            const cachedWatchedEps = loadCachedWatchedEpisodes(userId) || [];
            processAndRenderWatchlist(oldCache, cachedWatchedEps, isMoviesPage, isShowsPage);
        }
        return false;
    }

    return true;
}

function closeWatchlistModal() {
    if (!watchlistModal) return;
    watchlistModal.classList.remove('show');
    watchlistModal.setAttribute('aria-hidden', 'true');
}

if (modalClose) modalClose.addEventListener('click', closeWatchlistModal);
if (watchlistModal) watchlistModal.addEventListener('click', (e) => { if (e.target === watchlistModal) closeWatchlistModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWatchlistModal(); });

// --- Social / Friends / Group Chat helpers ---
async function currentUserId() {
    const { data } = await supabaseClient.auth.getSession();
    return data?.session?.user?.id ?? null;
}

// Search users by username (case-insensitive, partial)
async function searchUsersByUsername(query) {
    if (!query) return [];
    const currentId = await currentUserId();
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .ilike('username', `%${query}%`)
        .neq('id', currentId)
        .limit(20);

    if (error) {
        console.error('Error searching users:', error);
        return [];
    }
    return data;
}

async function loadUserGroups() {
    const userId = await currentUserId();
    const groupsContainer = document.getElementById('user-groups-list');
    if (!groupsContainer) return;
    if (!userId) {
        groupsContainer.innerHTML = '<p class="empty-text">Sign in to see your groups.</p>';
        return;
    }

    const { data, error } = await supabaseClient
        .from('group_members')
        .select('group_id, role, watch_groups(id, name, owner)')
        .eq('member', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading user groups:', error);
        groupsContainer.innerHTML = '<p class="empty-text">Unable to load your groups.</p>';
        return;
    }

    if (!data || data.length === 0) {
        groupsContainer.innerHTML = '<p class="empty-text">No groups yet. Create or join one.</p>';
        return;
    }

    groupsContainer.innerHTML = '';
    data.forEach(item => {
        const group = item.watch_groups;
        if (!group) return;
        
        const isOwner = group.owner === userId;
        
        const card = document.createElement('div');
        card.className = 'group-card';
        if (window.activeGroupId === group.id) {
            card.classList.add('active');
        }

        const cardHeader = document.createElement('div');
        cardHeader.className = 'group-card-header';
        
        const title = document.createElement('h4');
        title.textContent = group.name;
        
        const roleBadge = document.createElement('span');
        roleBadge.className = isOwner ? 'badge owner' : 'badge member';
        roleBadge.textContent = isOwner ? 'Owner' : 'Member';
        
        cardHeader.appendChild(title);
        cardHeader.appendChild(roleBadge);

        const cardMeta = document.createElement('div');
        cardMeta.className = 'group-card-meta';
        
        const idSpan = document.createElement('span');
        idSpan.innerHTML = `<strong>ID:</strong> ${group.id}`;
        cardMeta.appendChild(idSpan);

        const cardActions = document.createElement('div');
        cardActions.className = 'group-card-actions';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'primary btn-sm';
        openBtn.innerHTML = '<i data-lucide="message-square"></i> Chat';
        openBtn.onclick = async () => {
            document.querySelectorAll('.group-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            await window.setGroup(group.id, group.name);
        };

        cardActions.appendChild(openBtn);
        
        card.appendChild(cardHeader);
        card.appendChild(cardMeta);
        card.appendChild(cardActions);
        groupsContainer.appendChild(card);
    });

    if (window.lucide) {
        lucide.createIcons();
    }
}

// Send friend request from current user to targetUserId
async function sendFriendRequest(targetUserId) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Not authenticated');
    if (userId === targetUserId) throw new Error('Cannot send request to yourself');

    const { data: existing } = await supabaseClient
        .from('friends')
        .select('id, status')
        .or(`and(requester.eq.${userId},receiver.eq.${targetUserId}),and(requester.eq.${targetUserId},receiver.eq.${userId})`)
        .limit(1);

    if (existing && existing.length) {
        throw new Error('Friend relationship or request already exists');
    }

    const { error } = await supabaseClient
        .from('friends')
        .insert([{ requester: userId, receiver: targetUserId, status: 'pending' }]);

    if (error) {
        console.error('Error sending friend request:', error);
        throw error;
    }
    return true;
}

// Respond to friend request. accept = true/false
async function respondToFriendRequest(requestId, accept) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Not authenticated');

    const { data, error: fetchErr } = await supabaseClient
        .from('friends')
        .select('id, requester, receiver, status')
        .eq('id', requestId)
        .single();

    if (fetchErr) {
        console.error('Error fetching friend request:', fetchErr);
        throw fetchErr;
    }

    if (data.receiver !== userId) {
        throw new Error('Not authorized to respond to this request');
    }

    if (accept) {
        const { error } = await supabaseClient
            .from('friends')
            .update({ status: 'accepted' })
            .eq('id', requestId);
        if (error) {
            console.error('Error updating friend request status:', error);
            throw error;
        }
    } else {
        const { error } = await supabaseClient
            .from('friends')
            .delete()
            .eq('id', requestId);
        if (error) {
            console.error('Error deleting declined friend request:', error);
            throw error;
        }
    }
    return true;
}

// Load pending requests for current user
async function loadPendingRequests() {
    const userId = await currentUserId();
    const pendingEl = document.getElementById('pending-requests');
    const pendingCountEl = document.getElementById('pending-count');
    if (!pendingEl) return;
    if (!userId) {
        pendingEl.innerHTML = '<p class="empty-text">Sign in to see pending requests.</p>';
        if (pendingCountEl) pendingCountEl.textContent = '0';
        return;
    }

    const { data, error } = await supabaseClient
        .from('friends')
        .select('id, requester, receiver, status, created_at, requester:profiles!friends_requester_fkey(username, full_name)')
        .eq('receiver', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading pending requests:', error);
        return;
    }

    if (pendingCountEl) {
        pendingCountEl.textContent = data.length;
    }

    if (!data || data.length === 0) {
        pendingEl.innerHTML = '<p class="empty-text">No pending requests.</p>';
        return;
    }

    pendingEl.innerHTML = '';
    data.forEach(r => {
        const username = r.requester?.username || 'Unknown';
        const displayName = r.requester?.full_name ? `${r.requester.full_name} (@${username})` : `@${username}`;
        
        const div = document.createElement('div');
        div.className = 'pending-request-item';
        
        const userDiv = document.createElement('div');
        userDiv.className = 'request-user';
        userDiv.textContent = displayName;
        
        const buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'button-wrapper';
        
        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'success';
        acceptBtn.innerHTML = '<i data-lucide="check"></i> Accept';
        acceptBtn.onclick = async () => {
            try {
                await respondToFriendRequest(r.id, true);
                showToast('Friend request accepted!', 'success');
                await loadPendingRequests();
                await loadFriends();
            } catch (err) {
                showToast(err.message || 'Failed to accept', 'error');
            }
        };

        const declineBtn = document.createElement('button');
        declineBtn.className = 'danger';
        declineBtn.innerHTML = '<i data-lucide="x"></i> Decline';
        declineBtn.onclick = async () => {
            try {
                await respondToFriendRequest(r.id, false);
                showToast('Request declined.', 'info');
                await loadPendingRequests();
            } catch (err) {
                showToast(err.message || 'Failed to decline', 'error');
            }
        };

        buttonWrapper.appendChild(acceptBtn);
        buttonWrapper.appendChild(declineBtn);
        div.appendChild(userDiv);
        div.appendChild(buttonWrapper);
        pendingEl.appendChild(div);
    });

    if (window.lucide) {
        lucide.createIcons();
    }
}

// Load accepted friends for current user
async function loadFriends() {
    const userId = await currentUserId();
    const friendsContainer = document.getElementById('friends-list');
    const friendsCountEl = document.getElementById('friends-count');
    if (!friendsContainer) return;
    if (!userId) {
        friendsContainer.innerHTML = '<p class="empty-text">Sign in to see your friends.</p>';
        if (friendsCountEl) friendsCountEl.textContent = '0';
        return;
    }

    const { data, error } = await supabaseClient
        .from('friends')
        .select(`
            id,
            status,
            requester:profiles!friends_requester_fkey(id, username, full_name, avatar_url),
            receiver:profiles!friends_receiver_fkey(id, username, full_name, avatar_url)
        `)
        .eq('status', 'accepted')
        .or(`requester.eq.${userId},receiver.eq.${userId}`);

    if (error) {
        console.error('Error loading friends:', error);
        friendsContainer.innerHTML = '<p class="empty-text">Unable to load friends.</p>';
        return;
    }

    if (friendsCountEl) {
        friendsCountEl.textContent = data.length;
    }

    if (!data || data.length === 0) {
        friendsContainer.innerHTML = '<p class="empty-text">No friends yet. Add some below!</p>';
        return;
    }

    friendsContainer.innerHTML = '';
    data.forEach(item => {
        const isRequester = item.requester.id === userId;
        const friendProfile = isRequester ? item.receiver : item.requester;
        if (!friendProfile) return;

        const friendRow = document.createElement('div');
        friendRow.className = 'friend-item';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'friend-info';

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = (friendProfile.username || 'U').charAt(0).toUpperCase();

        const details = document.createElement('div');
        details.className = 'friend-details';

        const name = document.createElement('span');
        name.className = 'friend-name';
        name.textContent = friendProfile.full_name || friendProfile.username || 'Unknown Friend';

        const username = document.createElement('span');
        username.className = 'friend-username';
        username.textContent = friendProfile.username ? `@${friendProfile.username}` : '';

        details.appendChild(name);
        details.appendChild(username);
        infoDiv.appendChild(avatar);
        infoDiv.appendChild(details);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'friend-actions';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'danger btn-sm icon-btn-sm';
        removeBtn.title = 'Remove Friend';
        removeBtn.innerHTML = '<i data-lucide="user-minus"></i>';
        removeBtn.onclick = async () => {
            if (confirm(`Are you sure you want to remove ${friendProfile.username || 'this friend'}?`)) {
                try {
                    await removeFriend(item.id);
                    showToast('Friend removed.', 'success');
                } catch (err) {
                    showToast(err.message || 'Failed to remove friend.', 'error');
                }
            }
        };

        actionsDiv.appendChild(removeBtn);
        friendRow.appendChild(infoDiv);
        friendRow.appendChild(actionsDiv);
        friendsContainer.appendChild(friendRow);
    });

    if (window.lucide) {
        lucide.createIcons();
    }
}

// Remove friend
async function removeFriend(friendshipId) {
    const { error } = await supabaseClient
        .from('friends')
        .delete()
        .eq('id', friendshipId);

    if (error) {
        console.error('Error removing friend:', error);
        throw error;
    }
    await loadFriends();
    // Refresh search results if search is active
    const searchInputEl = document.getElementById('search-username');
    if (searchInputEl && searchInputEl.value.trim()) {
        document.getElementById('search-username-button')?.click();
    }
}

// Realtime: subscribe to group chat inserts
function subscribeToGroupChat(groupId, onMessageCallback) {
    const channelName = `group_chat:${groupId}`;
    const ch = supabaseClient
        .channel(channelName)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'group_chats', filter: `group_id=eq.${groupId}` },
            (payload) => {
                const message = payload.new;
                onMessageCallback?.(message);
            }
        )
        .subscribe();

    return ch;
}

function attachGroupChatListener(groupId, messagesContainerEl) {
    const onMessage = async (msg) => {
        const userId = await currentUserId();
        const isMe = msg.sender === userId;
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${isMe ? 'me' : 'other'}`;

        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let senderName = isMe ? 'You' : msg.sender;
        if (!isMe) {
            if (window._userProfiles && window._userProfiles[msg.sender]) {
                senderName = window._userProfiles[msg.sender];
            } else {
                try {
                    const { data } = await supabaseClient
                        .from('profiles')
                        .select('username, full_name')
                        .eq('id', msg.sender)
                        .maybeSingle();
                    if (data) {
                        senderName = data.full_name || data.username;
                        window._userProfiles = window._userProfiles || {};
                        window._userProfiles[msg.sender] = senderName;
                    }
                } catch (err) {
                    console.error('Error fetching sender username:', err);
                }
            }
        }

        bubble.innerHTML = `
            <span class="bubble-sender">${senderName}</span>
            <span class="bubble-text">${msg.message}</span>
            <span class="bubble-time">${time}</span>
        `;
        messagesContainerEl.appendChild(bubble);
        messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
    };

    const ch = subscribeToGroupChat(groupId, onMessage);
    return ch;
}

async function sendGroupMessage(groupId, text, metadata = null) {
    if (!text || !text.trim()) return;
    const userId = await currentUserId();
    if (!userId) throw new Error('Not authenticated');

    const { error } = await supabaseClient
        .from('group_chats')
        .insert([{ group_id: groupId, sender: userId, message: text.trim(), metadata: metadata ? metadata : null }]);

    if (error) {
        console.error('Error sending message:', error);
        throw error;
    }
    return true;
}

function isValidUuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function resolveGroupIdentifier(identifier) {
    if (!identifier) return null;

    if (isValidUuid(identifier)) {
        const { data, error } = await supabaseClient
            .from('watch_groups')
            .select('id, name')
            .eq('id', identifier)
            .single();

        if (error) {
            console.error('Error resolving group by id:', error);
            return null;
        }

        return data;
    }

    let result = null;

    // Try exact name match first.
    const { data: exactData, error: exactError } = await supabaseClient
        .from('watch_groups')
        .select('id, name')
        .eq('name', identifier)
        .limit(1);

    if (exactError) {
        console.error('Error resolving group by exact name:', exactError);
    }

    if (exactData && exactData.length > 0) {
        result = exactData[0];
    } else {
        const { data: partialData, error: partialError } = await supabaseClient
            .from('watch_groups')
            .select('id, name')
            .ilike('name', `%${identifier}%`)
            .limit(1);

        if (partialError) {
            console.error('Error resolving group by partial name:', partialError);
        }

        result = partialData?.[0] ?? null;
    }

    return result;
}

async function createGroup(name) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Not authenticated');

    const { data, error } = await supabaseClient
        .from('watch_groups')
        .insert([{ name, owner: userId }])
        .select('id, name')
        .single();

    if (error) {
        console.error('Error creating group:', error);
        throw error;
    }

    await joinGroup(data.id);
    return data;
}

async function joinGroup(groupIdentifier) {
    const userId = await currentUserId();
    if (!userId) throw new Error('Not authenticated');

    const group = await resolveGroupIdentifier(groupIdentifier);
    if (!group) {
        throw new Error('Group not found. Enter a valid group ID or exact name.');
    }

    const { error } = await supabaseClient
        .from('group_members')
        .upsert({ group_id: group.id, member: userId, role: 'member' }, { onConflict: ['group_id', 'member'] });

    if (error) {
        console.error('Error joining group:', error);
        throw error;
    }

    return group;
}

// Leave a group
async function leaveGroup(groupId) {
    const userId = await currentUserId();
    if (!userId) return;

    const { error } = await supabaseClient
        .from('group_members')
        .delete()
        .eq('group_id', groupId)
        .eq('member', userId);

    if (error) {
        console.error('Error leaving group:', error);
        throw error;
    }
}

// Delete a group (owner only)
async function deleteGroup(groupId) {
    const { error } = await supabaseClient
        .from('watch_groups')
        .delete()
        .eq('id', groupId);

    if (error) {
        console.error('Error deleting group:', error);
        throw error;
    }
}

// Load group members list
async function loadGroupMembers(groupId) {
    const membersUl = document.getElementById('group-members-ul');
    const membersText = document.getElementById('members-btn-text');
    if (!membersUl) return;

    const { data, error } = await supabaseClient
        .from('group_members')
        .select('role, profiles(username, full_name)')
        .eq('group_id', groupId);

    if (error) {
        console.error('Error loading group members:', error);
        return;
    }

    if (membersText) {
        membersText.textContent = `Members (${data.length})`;
    }

    membersUl.innerHTML = '';
    data.forEach(item => {
        const profile = item.profiles;
        if (!profile) return;
        
        const li = document.createElement('li');
        li.className = 'member-tag';
        
        const name = profile.full_name || profile.username;
        li.innerHTML = `<i data-lucide="user"></i> ${name}`;
        
        membersUl.appendChild(li);
    });

    if (window.lucide) {
        lucide.createIcons();
    }
}

async function loadGroupMessages(groupId, groupName) {
    const messagesEl = document.getElementById('group-messages');
    if (!groupId || !messagesEl) return;

    const { data, error } = await supabaseClient
        .from('group_chats')
        .select('id, sender, message, created_at, profiles(username, full_name)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error loading group messages:', error);
        return;
    }

    const userId = await currentUserId();
    messagesEl.innerHTML = '';
    
    (data || []).forEach(msg => {
        const isMe = msg.sender === userId;
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${isMe ? 'me' : 'other'}`;

        const senderName = isMe ? 'You' : (msg.profiles?.full_name || msg.profiles?.username || 'Unknown');
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        bubble.innerHTML = `
            <span class="bubble-sender">${senderName}</span>
            <span class="bubble-text">${msg.message}</span>
            <span class="bubble-time">${time}</span>
        `;
        messagesEl.appendChild(bubble);
    });
    
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function setActiveGroup(groupId, groupName) {
    const groupChatEl = document.getElementById('group-chat');
    const groupChatTitle = document.getElementById('group-chat-title');
    const groupChatId = document.getElementById('group-chat-id');
    const leaveGroupBtn = document.getElementById('leave-group-btn');
    const noGroupMessage = document.getElementById('no-group-message');
    const membersDrawer = document.getElementById('group-members-list-drawer');

    if (!groupChatEl) return;
    
    if (membersDrawer) membersDrawer.style.display = 'none';

    if (groupId) {
        groupChatEl.style.display = 'flex';
        if (noGroupMessage) noGroupMessage.style.display = 'none';
        if (groupChatTitle) groupChatTitle.textContent = groupName || 'Group Chat';
        if (groupChatId) groupChatId.textContent = groupId;

        if (leaveGroupBtn) {
            const userId = await currentUserId();
            try {
                const { data } = await supabaseClient
                    .from('watch_groups')
                    .select('owner')
                    .eq('id', groupId)
                    .maybeSingle();

                if (data && data.owner === userId) {
                    leaveGroupBtn.innerHTML = '<i data-lucide="trash-2"></i> Delete';
                    leaveGroupBtn.className = 'danger-btn btn-sm';
                    leaveGroupBtn.title = 'Delete Group';
                    leaveGroupBtn.dataset.action = 'delete';
                } else {
                    leaveGroupBtn.innerHTML = '<i data-lucide="log-out"></i> Leave';
                    leaveGroupBtn.className = 'danger-btn btn-sm';
                    leaveGroupBtn.title = 'Leave Group';
                    leaveGroupBtn.dataset.action = 'leave';
                }
            } catch (err) {
                console.error('Error fetching group owner:', err);
            }
        }
        
        await loadGroupMembers(groupId);
    } else {
        groupChatEl.style.display = 'none';
        if (noGroupMessage) noGroupMessage.style.display = 'flex';
    }
    
    if (window.lucide) {
        lucide.createIcons();
    }
}

// Export functions to window
window.loadFriends = loadFriends;
window.loadPendingRequests = loadPendingRequests;
window.loadUserGroups = loadUserGroups;
window.removeFriend = removeFriend;

// Wire up UI behaviour after DOM ready
window.addEventListener('DOMContentLoaded', () => {
    if (!window.location.pathname.includes('social.html')) {
        return;
    }

    const searchBtn = document.getElementById('search-username-button');
    const searchInputEl = document.getElementById('search-username');
    const resultsEl = document.getElementById('user-search-results');

    if (searchBtn && searchInputEl && resultsEl) {
        searchBtn.addEventListener('click', async () => {
            const q = searchInputEl.value.trim();
            if (!q) return showToast('Please enter a username to search.', 'warning');
            
            const users = await searchUsersByUsername(q);
            if (!users || users.length === 0) {
                resultsEl.innerHTML = '<p class="empty-text">No users found.</p>';
                return;
            }

            resultsEl.innerHTML = '';
            
            let userRelationships = {};
            const userId = await currentUserId();
            if (userId) {
                const { data: friendships } = await supabaseClient
                    .from('friends')
                    .select('id, requester, receiver, status')
                    .or(`requester.eq.${userId},receiver.eq.${userId}`);
                
                (friendships || []).forEach(f => {
                    const friendId = f.requester === userId ? f.receiver : f.requester;
                    userRelationships[friendId] = {
                        id: f.id,
                        status: f.status,
                        isRequester: f.requester === userId
                    };
                });
            }

            users.forEach(u => {
                const node = document.createElement('div');
                node.className = 'user-search-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'username-label';
                nameSpan.textContent = u.full_name ? `${u.full_name} (@${u.username})` : `@${u.username}`;
                
                const btn = document.createElement('button');
                btn.type = 'button';
                
                const rel = userRelationships[u.id];
                if (rel) {
                    if (rel.status === 'accepted') {
                        btn.className = 'secondary';
                        btn.innerHTML = '<i data-lucide="check"></i> Friends';
                        btn.disabled = true;
                    } else if (rel.status === 'pending') {
                        if (rel.isRequester) {
                            btn.className = 'secondary';
                            btn.innerHTML = '<i data-lucide="clock"></i> Sent';
                            btn.disabled = true;
                        } else {
                            btn.className = 'success';
                            btn.innerHTML = '<i data-lucide="user-check"></i> Accept';
                            btn.onclick = async () => {
                                try {
                                    await respondToFriendRequest(rel.id, true);
                                    showToast('Friend request accepted!', 'success');
                                    searchInputEl.value = '';
                                    resultsEl.innerHTML = '';
                                    await loadFriends();
                                    await loadPendingRequests();
                                } catch (err) {
                                    showToast(err.message || 'Failed to accept', 'error');
                                }
                            };
                        }
                    } else {
                        btn.className = 'send-request-btn';
                        btn.innerHTML = '<i data-lucide="user-plus"></i> Request';
                        btn.onclick = async () => {
                            try {
                                await sendFriendRequest(u.id);
                                btn.innerHTML = '<i data-lucide="clock"></i> Sent';
                                btn.className = 'secondary';
                                btn.disabled = true;
                                showToast('Friend request sent!', 'success');
                            } catch (err) {
                                showToast(err.message || 'Request failed', 'error');
                            }
                        };
                    }
                } else {
                    btn.className = 'send-request-btn';
                    btn.innerHTML = '<i data-lucide="user-plus"></i> Request';
                    btn.onclick = async () => {
                        try {
                            await sendFriendRequest(u.id);
                            btn.innerHTML = '<i data-lucide="clock"></i> Sent';
                            btn.className = 'secondary';
                            btn.disabled = true;
                            showToast('Friend request sent!', 'success');
                        } catch (err) {
                            showToast(err.message || 'Request failed', 'error');
                        }
                    };
                }

                node.appendChild(nameSpan);
                node.appendChild(btn);
                resultsEl.appendChild(node);
            });

            if (window.lucide) {
                lucide.createIcons();
            }
        });
        
        searchInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                searchBtn.click();
            }
        });
    }

    const groupNameInput = document.getElementById('group-name-input');
    const createGroupButton = document.getElementById('create-group-button');
    const joinGroupIdInput = document.getElementById('join-group-id-input');
    const joinGroupButton = document.getElementById('join-group-button');
    const groupMessagesEl = document.getElementById('group-messages');
    const groupInput = document.getElementById('group-message-input');
    const groupSendBtn = document.getElementById('group-send-button');
    
    const showCreateJoinBtn = document.getElementById('show-create-join-btn');
    const groupActionsCard = document.getElementById('group-actions-card');
    const closeGroupActionsBtn = document.getElementById('close-group-actions-btn');
    const emptyStateActionBtn = document.getElementById('empty-state-action-btn');

    if (showCreateJoinBtn && groupActionsCard) {
        showCreateJoinBtn.addEventListener('click', () => {
            groupActionsCard.style.display = groupActionsCard.style.display === 'none' ? 'block' : 'none';
        });
    }
    if (closeGroupActionsBtn && groupActionsCard) {
        closeGroupActionsBtn.addEventListener('click', () => {
            groupActionsCard.style.display = 'none';
        });
    }
    if (emptyStateActionBtn && groupActionsCard) {
        emptyStateActionBtn.addEventListener('click', () => {
            groupActionsCard.style.display = 'block';
            groupActionsCard.scrollIntoView({ behavior: 'smooth' });
        });
    }

    const groupMembersBtn = document.getElementById('group-members-btn');
    const groupMembersDrawer = document.getElementById('group-members-list-drawer');
    if (groupMembersBtn && groupMembersDrawer) {
        groupMembersBtn.addEventListener('click', () => {
            groupMembersDrawer.style.display = groupMembersDrawer.style.display === 'none' ? 'block' : 'none';
        });
    }

    const leaveGroupBtn = document.getElementById('leave-group-btn');
    if (leaveGroupBtn) {
        leaveGroupBtn.addEventListener('click', async () => {
            if (!window.activeGroupId) return;
            const action = leaveGroupBtn.dataset.action;
            if (action === 'delete') {
                if (confirm('Are you sure you want to delete this group? This will delete all messages for everyone.')) {
                    try {
                        await deleteGroup(window.activeGroupId);
                        showToast('Group deleted.', 'success');
                        await window.setGroup(null);
                    } catch (err) {
                        showToast(err.message || 'Failed to delete group.', 'error');
                    }
                }
            } else {
                if (confirm('Are you sure you want to leave this group?')) {
                    try {
                        await leaveGroup(window.activeGroupId);
                        showToast('Left the group.', 'info');
                        await window.setGroup(null);
                    } catch (err) {
                        showToast(err.message || 'Failed to leave group.', 'error');
                    }
                }
            }
        });
    }

    const copyGroupIdBtn = document.getElementById('copy-group-id-btn');
    if (copyGroupIdBtn) {
        copyGroupIdBtn.addEventListener('click', () => {
            if (!window.activeGroupId) return;
            navigator.clipboard.writeText(window.activeGroupId).then(() => {
                showToast('Group ID copied to clipboard!', 'success');
                const oldIcon = copyGroupIdBtn.innerHTML;
                copyGroupIdBtn.innerHTML = '<i data-lucide="check" style="color: var(--success-color);"></i>';
                if (window.lucide) lucide.createIcons();
                setTimeout(() => {
                    copyGroupIdBtn.innerHTML = oldIcon;
                    if (window.lucide) lucide.createIcons();
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        });
    }

    window.activeGroupId = null;
    window.activeGroupName = null;
    window.groupSub = null;

    window.setGroup = async (groupId, groupName) => {
        window.activeGroupId = groupId;
        window.activeGroupName = groupName || null;
        await setActiveGroup(groupId, groupName);
        if (groupId) {
            await loadGroupMessages(groupId, groupName);
            if (window.groupSub) {
                supabaseClient.removeChannel(window.groupSub);
                window.groupSub = null;
            }
            if (groupMessagesEl) {
                window.groupSub = attachGroupChatListener(groupId, groupMessagesEl);
            }
        }
        await loadUserGroups();
    };

    createGroupButton?.addEventListener('click', async () => {
        const name = groupNameInput?.value.trim();
        if (!name) return showToast('Enter a group name.', 'warning');
        try {
            const group = await createGroup(name);
            showToast(`Group "${name}" created!`, 'success');
            await window.setGroup(group.id, group.name);
            if (groupNameInput) groupNameInput.value = '';
            if (groupActionsCard) groupActionsCard.style.display = 'none';
        } catch (err) {
            showToast(err.message || 'Unable to create group.', 'error');
        }
    });

    joinGroupButton?.addEventListener('click', async () => {
        const id = joinGroupIdInput?.value.trim();
        if (!id) return showToast('Enter a group ID or name.', 'warning');
        try {
            const group = await joinGroup(id);
            showToast(`Joined group "${group.name}"!`, 'success');
            await window.setGroup(group.id, group.name);
            if (joinGroupIdInput) joinGroupIdInput.value = '';
            if (groupActionsCard) groupActionsCard.style.display = 'none';
        } catch (err) {
            showToast(err.message || 'Unable to join group.', 'error');
        }
    });

    if (groupMessagesEl && groupSendBtn && groupInput) {
        const handleSendMessage = async () => {
            if (!window.activeGroupId) return showToast('Join or create a group first.', 'warning');
            const txt = groupInput.value.trim();
            if (!txt) return;
            try {
                await sendGroupMessage(window.activeGroupId, txt);
                groupInput.value = '';
            } catch (err) {
                showToast(err.message || 'Unable to send message.', 'error');
            }
        };

        groupSendBtn.addEventListener('click', handleSendMessage);
        groupInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        });
    }

    loadPendingRequests();
    loadUserGroups();
    loadFriends();
});

// Global event listener for .movie-card clicks to open the details modal
document.addEventListener('click', async (e) => {
    const card = e.target.closest('.movie-card');
    if (!card) return;

    // Do not trigger modal if clicked on interactive elements
    const interactive = e.target.closest('button, input, select, a, option, .track-btn, .add-to-watchlist-btn, .play-trailer, .view-details, .danger, .dec-season, .inc-season, .dec-episode, .inc-episode');
    if (interactive) return;

    const movieId = parseInt(card.getAttribute('data-movie-id'));
    const mediaType = card.getAttribute('data-media-type') || 'movie';

    if (!movieId) return;

    let watchlistItem = null;
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (user) {
            const cachedList = loadCachedWatchlist(user.id) || [];
            watchlistItem = cachedList.find(item => parseInt(item.movie_id) === movieId && (item.media_type === mediaType || (isTVShow(item.media_type) && isTVShow(mediaType))));
        }
    } catch (err) {
        console.error('Error checking watchlist cache:', err);
    }

    if (watchlistItem) {
        openWatchlistModal(watchlistItem);
    } else {
        try {
            const path = isTVShow(mediaType) ? 'tv' : 'movie';
            const url = `https://api.themoviedb.org/3/${path}/${movieId}?api_key=${API_KEY}`;
            const response = await fetch(url);
            if (response.ok) {
                const details = await response.json();
                const tempItem = {
                    id: null,
                    movie_id: details.id,
                    title: details.title || details.name,
                    release_date: details.release_date || details.first_air_date,
                    poster_path: details.poster_path,
                    overview: details.overview,
                    media_type: mediaType,
                    status: null,
                    season: 1,
                    episode: 1
                };
                openWatchlistModal(tempItem);
            } else {
                showToast('Failed to fetch details.', 'error');
            }
        } catch (err) {
            console.error('Error fetching details for modal:', err);
        }
    }
});

// ==========================================================================
// Monthly Wrapped Feature Logic
// ==========================================================================

// Global state for Monthly Wrapped
window.wrappedState = {
    watchlist: [],
    episodes: [],
    discoveredMonths: [],
    currentSlides: [],
    currentSlideIndex: 0,
    isPlaying: false,
    isPaused: false,
    animationFrameId: null,
    lastFrameTime: 0,
    elapsed: 0,
    duration: 7000, // 7 seconds per slide
    activeMonthStr: '',
    activeData: null
};

// Initialize Monthly Wrapped selection & banner
function initMonthlyWrapped(watchlist, episodes) {
    window.wrappedState.watchlist = watchlist;
    window.wrappedState.episodes = episodes;

    // Scan for active months
    const activeMonths = new Set();

    // 1. Scan completed watchlist items
    watchlist.forEach(item => {
        if (item.status === 'completed') {
            const dateStr = item.completed_at || item.created_at;
            if (dateStr) {
                const date = new Date(dateStr);
                if (!isNaN(date.getTime())) {
                    const yyyy = date.getFullYear();
                    const mm = String(date.getMonth() + 1).padStart(2, '0');
                    activeMonths.add(`${yyyy}-${mm}`);
                }
            }
        }
    });

    // 2. Scan watched episodes
    episodes.forEach(ep => {
        if (ep.watched_at) {
            const date = new Date(ep.watched_at);
            if (!isNaN(date.getTime())) {
                const yyyy = date.getFullYear();
                const mm = String(date.getMonth() + 1).padStart(2, '0');
                activeMonths.add(`${yyyy}-${mm}`);
            }
        }
    });

    // Convert Set to sorted Array (descending)
    const sortedMonths = Array.from(activeMonths).sort().reverse();
    window.wrappedState.discoveredMonths = sortedMonths;

    // Populate Selector Dropdown
    const select = document.getElementById('wrapped-month-select');
    const viewBtn = document.getElementById('view-wrapped-btn');
    if (select) {
        // Clear previous options except placeholder
        select.innerHTML = '<option value="" disabled selected>Select Month</option>';
        
        if (sortedMonths.length === 0) {
            select.disabled = true;
            if (viewBtn) viewBtn.disabled = true;
        } else {
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            sortedMonths.forEach(mStr => {
                const [yyyy, mm] = mStr.split('-');
                const monthName = monthNames[parseInt(mm) - 1];
                const option = document.createElement('option');
                option.value = mStr;
                option.textContent = `${monthName} ${yyyy}`;
                select.appendChild(option);
            });
            select.disabled = false;
            
            // Add change listener to enable View button
            select.addEventListener('change', () => {
                if (viewBtn) viewBtn.disabled = !select.value;
            });
        }
    }

    // Check homepage banner
    checkWrappedBanner(sortedMonths);
}

// Check if we should show the promo banner on the homepage
function checkWrappedBanner(discoveredMonths) {
    const banner = document.getElementById('wrapped-banner');
    if (!banner) return; // Only on homepage

    if (discoveredMonths.length === 0) {
        banner.style.display = 'none';
        return;
    }

    // Determine target month (prefer previous month, fallback to current)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed
    const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    let prevYear = currentYear;
    let prevMonth = currentMonth - 1;
    if (prevMonth < 0) {
        prevMonth = 11;
        prevYear--;
    }
    const prevMonthStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`;

    let targetMonth = null;
    let isCurrent = false;

    if (discoveredMonths.includes(prevMonthStr)) {
        targetMonth = prevMonthStr;
    } else if (discoveredMonths.includes(currentMonthStr)) {
        targetMonth = currentMonthStr;
        isCurrent = true;
    }

    if (!targetMonth) {
        banner.style.display = 'none';
        return;
    }

    // Check if user dismissed this session
    if (sessionStorage.getItem(`dismissed-wrapped-banner-${targetMonth}`)) {
        banner.style.display = 'none';
        return;
    }

    // Render Banner details
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const [yyyy, mm] = targetMonth.split('-');
    const monthName = monthNames[parseInt(mm) - 1];

    const titleEl = document.getElementById('wrapped-banner-title');
    const subtitleEl = document.getElementById('wrapped-banner-subtitle');
    const openBtn = document.getElementById('wrapped-banner-open-btn');
    const closeBtn = document.getElementById('wrapped-banner-close-btn');

    if (titleEl) {
        titleEl.textContent = isCurrent ? `Your ${monthName} Wrapped is in progress! 🌟` : `Your ${monthName} Wrapped is Ready! 🌟`;
    }
    if (subtitleEl) {
        subtitleEl.textContent = isCurrent ? "Relive your screens journey so far this month." : "Take a walk down memory lane and see your month in review.";
    }

    if (openBtn) {
        openBtn.dataset.month = targetMonth;
        // Bind click event once
        openBtn.onclick = () => {
            openWrappedStory(targetMonth);
        };
    }

    if (closeBtn) {
        closeBtn.onclick = () => {
            sessionStorage.setItem(`dismissed-wrapped-banner-${targetMonth}`, 'true');
            banner.style.display = 'none';
        };
    }

    banner.style.display = 'block';
    
    // Create icons inside the banner if lucide exists
    if (window.lucide) {
        lucide.createIcons({
            attrs: {
                class: 'lucide-icon'
            },
            nameAttr: 'data-lucide',
            node: banner
        });
    }
}

// Generate Wrapped stats data for a specific month
async function generateWrappedData(monthStr) {
    const [yyyyStr, mmStr] = monthStr.split('-');
    const targetYear = parseInt(yyyyStr);
    const targetMonthIdx = parseInt(mmStr) - 1;
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthName = monthNames[targetMonthIdx];

    // 1. Filter completed movies
    const completedMovies = window.wrappedState.watchlist.filter(item => {
        if (item.status !== 'completed') return false;
        const isMovie = !item.media_type || item.media_type === 'movie';
        if (!isMovie) return false;

        const compDateStr = item.completed_at || item.created_at;
        if (!compDateStr) return false;

        const date = new Date(compDateStr);
        return date.getFullYear() === targetYear && date.getMonth() === targetMonthIdx;
    });

    // 2. Filter episodes watched this month
    const watchedEpisodes = window.wrappedState.episodes.filter(ep => {
        if (!ep.watched_at) return false;
        const date = new Date(ep.watched_at);
        return date.getFullYear() === targetYear && date.getMonth() === targetMonthIdx;
    });

    // Estimate watch time
    const moviesCount = completedMovies.length;
    const episodesCount = watchedEpisodes.length;
    const totalMinutes = (moviesCount * 120) + (episodesCount * 45);

    // 3. Find Top Show
    const showCounts = {};
    watchedEpisodes.forEach(ep => {
        const watchId = ep.watchlist_id;
        if (!watchId) return;

        if (!showCounts[watchId]) {
            // Find watchlist item for metadata
            const item = window.wrappedState.watchlist.find(i => i.id === watchId);
            showCounts[watchId] = {
                title: item ? item.title : 'Unknown Show',
                poster_path: item ? item.poster_path : null,
                count: 0
            };
        }
        showCounts[watchId].count++;
    });

    let topShow = null;
    Object.values(showCounts).forEach(show => {
        if (!topShow || show.count > topShow.count) {
            topShow = show;
        }
    });

    // 4. Fetch details to resolve genres
    // Collect all unique tmdb show and movie IDs
    const movieIds = completedMovies.map(m => ({ id: m.movie_id, type: 'movie' }));
    const showIds = Object.keys(showCounts).map(watchId => {
        const item = window.wrappedState.watchlist.find(i => i.id === watchId);
        return item ? { id: item.movie_id, type: 'tv' } : null;
    }).filter(Boolean);

    const mediaList = [...movieIds, ...showIds];
    const genreCounts = {};

    // Helper to fetch details with caching
    const fetchPromises = mediaList.map(async (media) => {
        if (window._movieDetailsCache && window._movieDetailsCache[media.id]) {
            return window._movieDetailsCache[media.id];
        }

        try {
            const url = `https://api.themoviedb.org/3/${media.type}/${media.id}?api_key=${API_KEY}`;
            const r = await fetch(url);
            if (r.ok) {
                const details = await r.json();
                window._movieDetailsCache = window._movieDetailsCache || {};
                window._movieDetailsCache[media.id] = details;
                return details;
            }
        } catch (e) {
            console.error(`Error fetching genres in Wrapped details:`, e);
        }
        return null;
    });

    const detailsResults = await Promise.all(fetchPromises);
    detailsResults.forEach(details => {
        if (details && details.genres) {
            details.genres.forEach(g => {
                genreCounts[g.name] = (genreCounts[g.name] || 0) + 1;
            });
        }
    });

    // Sort genres
    const sortedGenres = Object.entries(genreCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

    const topGenre = sortedGenres.length > 0 ? sortedGenres[0].name : 'N/A';
    
    // Calculate percentages for top 4 genres
    const totalGenreTags = sortedGenres.reduce((a, b) => a + b.count, 0);
    const genreBreakdown = sortedGenres.slice(0, 4).map(g => ({
        name: g.name,
        pct: totalGenreTags > 0 ? Math.round((g.count / totalGenreTags) * 100) : 0
    }));

    // 5. Fetch user profile
    let username = 'User';
    let avatarUrl = '';
    try {
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const user = sessionData?.session?.user;
        if (user) {
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('username, avatar_url')
                .eq('id', user.id)
                .maybeSingle();
            
            if (profile) {
                username = profile.username || username;
                avatarUrl = profile.avatar_url || avatarUrl;
            } else {
                username = user.email ? user.email.split('@')[0] : 'User';
            }
        }
    } catch (e) {
        console.error('Error fetching profile for Wrapped:', e);
    }

    return {
        monthName,
        year: targetYear,
        totalMinutes,
        moviesCount,
        episodesCount,
        completedMovies,
        watchedEpisodes,
        topShow,
        topGenre,
        genreBreakdown,
        profile: { username, avatarUrl }
    };
}

// Open Wrapped Stories Modal
async function openWrappedStory(monthStr) {
    const viewBtn = document.getElementById('view-wrapped-btn');
    const bannerBtn = document.getElementById('wrapped-banner-open-btn');
    const select = document.getElementById('wrapped-month-select');

    // Disable triggers during loading
    if (viewBtn) {
        viewBtn.disabled = true;
        viewBtn.innerHTML = '<span class="loading-spinner"></span> Loading...';
    }
    if (bannerBtn) {
        bannerBtn.disabled = true;
        bannerBtn.textContent = 'Loading...';
    }

    try {
        const data = await generateWrappedData(monthStr);
        window.wrappedState.activeMonthStr = monthStr;
        window.wrappedState.activeData = data;

        // Render Slides
        renderWrappedSlides(data);

        // Show Modal
        const modal = document.getElementById('wrapped-modal');
        if (modal) {
            modal.style.display = 'flex';
            // Force reflow
            modal.offsetHeight;
            modal.classList.add('show');
            modal.setAttribute('aria-hidden', 'false');
        }

        // Start Stories Player
        startWrappedPlayer();

    } catch (err) {
        console.error('Failed to launch Monthly Wrapped:', err);
        showToast('Failed to load Wrapped statistics. Please try again.', 'error');
    } finally {
        // Re-enable triggers
        if (viewBtn) {
            viewBtn.disabled = false;
            viewBtn.innerHTML = '<i data-lucide="play" style="width:14px; height:14px;"></i> View';
            if (window.lucide) lucide.createIcons({ node: viewBtn });
        }
        if (bannerBtn) {
            bannerBtn.disabled = false;
            bannerBtn.innerHTML = '<i data-lucide="play"></i> View Now';
            if (window.lucide) lucide.createIcons({ node: bannerBtn });
        }
        if (select) select.value = '';
    }
}

// Render dynamic stories slides HTML
function renderWrappedSlides(data) {
    const container = document.getElementById('wrapped-slides-container');
    const progressContainer = document.getElementById('wrapped-progress-container');
    if (!container || !progressContainer) return;

    container.innerHTML = '';
    progressContainer.innerHTML = '';

    // Create progress bar segments
    const totalSlides = 6;
    for (let i = 0; i < totalSlides; i++) {
        const segment = document.createElement('div');
        segment.className = 'progress-bar-segment';
        segment.innerHTML = `<div class="progress-bar-fill" id="wrapped-pb-fill-${i}"></div>`;
        progressContainer.appendChild(segment);
    }

    // 1. Cover Slide
    const slide1 = document.createElement('div');
    slide1.className = 'wrapped-slide slide-theme-1 active';
    slide1.innerHTML = `
        <div class="slide-content-top">
            <span class="slide-title-label">KeepUp Wrapped</span>
        </div>
        <div class="slide-content-center">
            <i data-lucide="sparkles" style="width:64px; height:64px; color:#a855f7; margin-bottom:1rem;"></i>
            <h2 class="slide-heading">${data.monthName}<br>${data.year}</h2>
            <p class="slide-desc">Let's look back at your screen adventures this past month.</p>
        </div>
        <div class="slide-content-bottom"></div>
    `;

    // 2. Time Spent Slide
    const days = Math.floor(data.totalMinutes / (24 * 60));
    const hours = Math.floor((data.totalMinutes % (24 * 60)) / 60);
    const minutes = data.totalMinutes % 60;
    
    let timeStr = '';
    if (days > 0) timeStr = `${days}d ${hours}h`;
    else if (hours > 0) timeStr = `${hours}h ${minutes}m`;
    else timeStr = `${minutes}m`;

    const slide2 = document.createElement('div');
    slide2.className = 'wrapped-slide slide-theme-2';
    slide2.innerHTML = `
        <div class="slide-content-top">
            <span class="slide-title-label">Watch Time</span>
        </div>
        <div class="slide-content-center">
            <h3 class="slide-heading" style="margin-bottom:1.5rem;">You Spent</h3>
            <p class="wrapped-huge-stat">${timeStr}</p>
            <span class="wrapped-huge-unit">Keeping Up</span>
            <p class="slide-desc">Logging a total of <strong>${data.moviesCount}</strong> completed movies and <strong>${data.episodesCount}</strong> TV episodes.</p>
        </div>
        <div class="slide-content-bottom"></div>
    `;

    // 3. Completed Movies Slide
    let moviesVisualHtml = '';
    if (data.moviesCount > 0) {
        moviesVisualHtml = `<div class="slide-posters-grid">`;
        data.completedMovies.slice(0, 4).forEach((movie, idx) => {
            const pUrl = movie.poster_path ? `https://image.tmdb.org/t/p/w200${movie.poster_path}` : 'https://via.placeholder.com/200x300?text=No+Poster';
            const rotation = idx === 0 ? '-3deg' : idx === 1 ? '3deg' : idx === 2 ? '-2deg' : '2deg';
            moviesVisualHtml += `
                <div class="slide-poster-wrapper" style="--rot: ${rotation}">
                    <img src="${pUrl}" alt="${movie.title}" />
                    <div class="slide-poster-title-tooltip">${movie.title}</div>
                </div>
            `;
        });
        moviesVisualHtml += `</div>`;
    } else {
        moviesVisualHtml = `
            <div style="background: rgba(255,255,255,0.05); border-radius:16px; border:1px dashed rgba(255,255,255,0.15); padding:2rem 1.5rem; text-align:center; max-width:260px;">
                <i data-lucide="clapperboard" style="width:40px; height:40px; color:rgba(255,255,255,0.4); margin-bottom:12px;"></i>
                <p style="margin:0; font-size:0.9rem; color:rgba(255,255,255,0.6); line-height:1.4;">No movies completed this month. Maybe next month calls for a movie night?</p>
            </div>
        `;
    }

    const slide3 = document.createElement('div');
    slide3.className = 'wrapped-slide slide-theme-3';
    slide3.innerHTML = `
        <div class="slide-content-top">
            <span class="slide-title-label">Movie Nights</span>
            <h2 class="slide-heading">The Movie Stars</h2>
        </div>
        <div class="slide-content-center">
            ${moviesVisualHtml}
        </div>
        <div class="slide-content-bottom">
            <p class="slide-desc" style="font-size:0.85rem; text-align:center;">You completed ${data.moviesCount} movie${data.moviesCount === 1 ? '' : 's'} in ${data.monthName}.</p>
        </div>
    `;

    // 4. TV Show Highlight Slide
    let tvVisualHtml = '';
    if (data.topShow) {
        const topShowPoster = data.topShow.poster_path ? `https://image.tmdb.org/t/p/w200${data.topShow.poster_path}` : 'https://via.placeholder.com/200x300?text=No+Poster';
        tvVisualHtml = `
            <div class="slide-show-highlight-card">
                <div class="slide-show-poster-wrap">
                    <img src="${topShowPoster}" alt="${data.topShow.title}" />
                </div>
                <div class="slide-show-meta-wrap">
                    <h4 class="slide-show-name">${data.topShow.title}</h4>
                    <span class="slide-show-stats">${data.topShow.count} Episodes Logged</span>
                </div>
            </div>
        `;
    } else {
        tvVisualHtml = `
            <div style="background: rgba(255,255,255,0.05); border-radius:16px; border:1px dashed rgba(255,255,255,0.15); padding:2rem 1.5rem; text-align:center; max-width:260px;">
                <i data-lucide="tv" style="width:40px; height:40px; color:rgba(255,255,255,0.4); margin-bottom:12px;"></i>
                <p style="margin:0; font-size:0.9rem; color:rgba(255,255,255,0.6); line-height:1.4;">No episodes logged. A month of movie marathons or a break from TV?</p>
            </div>
        `;
    }

    const slide4 = document.createElement('div');
    slide4.className = 'wrapped-slide slide-theme-4';
    slide4.innerHTML = `
        <div class="slide-content-top">
            <span class="slide-title-label">Series Binges</span>
            <h2 class="slide-heading">Top TV Obsession</h2>
        </div>
        <div class="slide-content-center">
            ${tvVisualHtml}
        </div>
        <div class="slide-content-bottom">
            <p class="slide-desc" style="font-size:0.85rem; text-align:center;">You logged ${data.episodesCount} TV episode${data.episodesCount === 1 ? '' : 's'} total.</p>
        </div>
    `;

    // 5. Genre Breakdown Slide
    let genreVisualHtml = '';
    if (data.topGenre !== 'N/A') {
        genreVisualHtml = `<div class="slide-genre-list">`;
        data.genreBreakdown.forEach((genre) => {
            genreVisualHtml += `
                <div class="slide-genre-row">
                    <div class="slide-genre-name">
                        <span class="slide-genre-bullet"></span>
                        <span>${genre.name}</span>
                    </div>
                    <span class="slide-genre-percentage">${genre.pct}%</span>
                </div>
            `;
        });
        genreVisualHtml += `</div>`;
    } else {
        genreVisualHtml = `
            <div style="background: rgba(255,255,255,0.05); border-radius:16px; border:1px dashed rgba(255,255,255,0.15); padding:2rem 1.5rem; text-align:center; max-width:260px;">
                <i data-lucide="compass" style="width:40px; height:40px; color:rgba(255,255,255,0.4); margin-bottom:12px;"></i>
                <p style="margin:0; font-size:0.9rem; color:rgba(255,255,255,0.6); line-height:1.4;">Not enough genre data to map your vibes. Add more details next month!</p>
            </div>
        `;
    }

    const slide5 = document.createElement('div');
    slide5.className = 'wrapped-slide slide-theme-5';
    slide5.innerHTML = `
        <div class="slide-content-top">
            <span class="slide-title-label">Your Vibe</span>
            <h2 class="slide-heading">The Genre Breakdown</h2>
        </div>
        <div class="slide-content-center">
            ${genreVisualHtml}
        </div>
        <div class="slide-content-bottom">
            <p class="slide-desc" style="font-size:0.85rem; text-align:center;">Your favorite flavor of the month was <strong>${data.topGenre}</strong>.</p>
        </div>
    `;

    // 6. Summary Slide
    const avatarImgHtml = data.profile.avatarUrl 
        ? `<img src="${data.profile.avatarUrl}" alt="${data.profile.username}" style="width:32px; height:32px; border-radius:50%; border:1px solid rgba(255,255,255,0.2);" />` 
        : `<div style="width:32px; height:32px; border-radius:50%; background:rgba(255,255,255,0.1); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.8rem; border:1px solid rgba(255,255,255,0.2);">${data.profile.username.slice(0, 2).toUpperCase()}</div>`;

    const slide6 = document.createElement('div');
    slide6.className = 'wrapped-slide slide-theme-6';
    slide6.innerHTML = `
        <div class="slide-content-center" style="margin:0; flex:1; justify-content:center; width:100%;">
            <div class="wrapped-summary-card">
                <div class="wrapped-summary-header">
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${avatarImgHtml}
                        <span style="font-size:0.9rem; font-weight:600; color:#fff; background:none; padding:0; text-transform:none; letter-spacing:normal;">@${data.profile.username}</span>
                    </div>
                    <span>KeepUp</span>
                </div>
                
                <h4 style="margin:4px 0 0 0; text-align:center; font-size:1.4rem; font-weight:800; font-family:'Outfit', sans-serif; letter-spacing:-0.03em; color:#a855f7;">MY MONTHLY WRAPPED</h4>
                <p style="margin: -10px 0 4px 0; text-align:center; font-size:0.8rem; color:var(--text-muted); font-weight:600;">${data.monthName.toUpperCase()} ${data.year}</p>

                <div class="wrapped-summary-grid">
                    <div class="wrapped-summary-item">
                        <span class="wrapped-summary-val">${timeStr}</span>
                        <span class="wrapped-summary-lbl">Watch Time</span>
                    </div>
                    <div class="wrapped-summary-item">
                        <span class="wrapped-summary-val">${data.moviesCount}</span>
                        <span class="wrapped-summary-lbl">Movies Done</span>
                    </div>
                    <div class="wrapped-summary-item">
                        <span class="wrapped-summary-val">${data.episodesCount}</span>
                        <span class="wrapped-summary-lbl">Episodes Logged</span>
                    </div>
                    <div class="wrapped-summary-item">
                        <span class="wrapped-summary-val" style="color:#a855f7;">${data.topGenre}</span>
                        <span class="wrapped-summary-lbl">Top Genre</span>
                    </div>
                    <div class="wrapped-summary-item full-width">
                        <span class="wrapped-summary-val" style="font-size:0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${data.topShow ? data.topShow.title : 'None'}</span>
                        <span class="wrapped-summary-lbl">Top TV Show</span>
                    </div>
                </div>

                <div class="wrapped-summary-actions">
                    <button class="wrapped-replay-btn" id="wrapped-replay-btn"><i data-lucide="rotate-ccw" style="width:14px; height:14px;"></i> Replay</button>
                    <button class="wrapped-share-btn" id="wrapped-share-btn"><i data-lucide="share" style="width:14px; height:14px;"></i> Share</button>
                </div>
            </div>
        </div>
    `;

    // Append all slides
    container.appendChild(slide1);
    container.appendChild(slide2);
    container.appendChild(slide3);
    container.appendChild(slide4);
    container.appendChild(slide5);
    container.appendChild(slide6);

    window.wrappedState.currentSlides = Array.from(container.children);

    // Create lucide icons inside container
    if (window.lucide) {
        lucide.createIcons({
            attrs: {
                class: 'lucide-icon'
            },
            nameAttr: 'data-lucide',
            node: container
        });
    }

    // Bind summary action buttons
    const replayBtn = slide6.querySelector('#wrapped-replay-btn');
    const shareBtn = slide6.querySelector('#wrapped-share-btn');
    
    if (replayBtn) {
        replayBtn.onclick = (e) => {
            e.stopPropagation();
            replayWrapped();
        };
    }
    if (shareBtn) {
        shareBtn.onclick = (e) => {
            e.stopPropagation();
            shareWrapped(data);
        };
    }
}

// Start Wrapped Player Loop
function startWrappedPlayer() {
    window.wrappedState.currentSlideIndex = 0;
    window.wrappedState.isPlaying = true;
    window.wrappedState.isPaused = false;
    window.wrappedState.elapsed = 0;
    window.wrappedState.lastFrameTime = performance.now();

    // Reset progress fills to 0
    for (let i = 0; i < 6; i++) {
        const fill = document.getElementById(`wrapped-pb-fill-${i}`);
        if (fill) fill.style.width = '0%';
    }

    // Toggle pause button icon
    updatePauseButtonUI();

    // Start requestAnimationFrame
    if (window.wrappedState.animationFrameId) {
        cancelAnimationFrame(window.wrappedState.animationFrameId);
    }
    window.wrappedState.animationFrameId = requestAnimationFrame(wrappedPlayerLoop);
}

// Main animation loop for progress bar
function wrappedPlayerLoop(timestamp) {
    if (!window.wrappedState.isPlaying) return;

    const dt = timestamp - window.wrappedState.lastFrameTime;
    window.wrappedState.lastFrameTime = timestamp;

    if (!window.wrappedState.isPaused) {
        window.wrappedState.elapsed += dt;

        const currentIdx = window.wrappedState.currentSlideIndex;
        const percent = Math.min((window.wrappedState.elapsed / window.wrappedState.duration) * 100, 100);

        // Update progress fills
        for (let i = 0; i < 6; i++) {
            const fill = document.getElementById(`wrapped-pb-fill-${i}`);
            if (fill) {
                if (i < currentIdx) {
                    fill.style.width = '100%';
                } else if (i === currentIdx) {
                    fill.style.width = `${percent}%`;
                } else {
                    fill.style.width = '0%';
                }
            }
        }

        // Slide finished, advance to next
        if (window.wrappedState.elapsed >= window.wrappedState.duration) {
            nextWrappedSlide();
        }
    }

    window.wrappedState.animationFrameId = requestAnimationFrame(wrappedPlayerLoop);
}

// Stop player loop
function stopWrappedPlayer() {
    window.wrappedState.isPlaying = false;
    if (window.wrappedState.animationFrameId) {
        cancelAnimationFrame(window.wrappedState.animationFrameId);
        window.wrappedState.animationFrameId = null;
    }
}

// Go to next slide
function nextWrappedSlide() {
    const currentIdx = window.wrappedState.currentSlideIndex;
    const slides = window.wrappedState.currentSlides;

    if (currentIdx < slides.length - 1) {
        // Remove active class from current slide
        slides[currentIdx].classList.remove('active');
        // Advance
        window.wrappedState.currentSlideIndex++;
        const nextIdx = window.wrappedState.currentSlideIndex;
        slides[nextIdx].classList.add('active');

        // Reset timers
        window.wrappedState.elapsed = 0;
        window.wrappedState.lastFrameTime = performance.now();
    } else {
        // Last slide, pause at 100% progress
        window.wrappedState.isPaused = true;
        const lastFill = document.getElementById(`wrapped-pb-fill-${slides.length - 1}`);
        if (lastFill) lastFill.style.width = '100%';
        updatePauseButtonUI();
    }
}

// Go to previous slide
function prevWrappedSlide() {
    const currentIdx = window.wrappedState.currentSlideIndex;
    const slides = window.wrappedState.currentSlides;

    if (currentIdx > 0) {
        // Remove active class from current slide
        slides[currentIdx].classList.remove('active');
        // Go back
        window.wrappedState.currentSlideIndex--;
        const prevIdx = window.wrappedState.currentSlideIndex;
        slides[prevIdx].classList.add('active');

        // Reset timers
        window.wrappedState.elapsed = 0;
        window.wrappedState.lastFrameTime = performance.now();
        
        // Reset current and future progress fills
        const fillCurrent = document.getElementById(`wrapped-pb-fill-${prevIdx}`);
        if (fillCurrent) fillCurrent.style.width = '0%';
        const fillNext = document.getElementById(`wrapped-pb-fill-${currentIdx}`);
        if (fillNext) fillNext.style.width = '0%';
    } else {
        // Already at first slide, restart it
        window.wrappedState.elapsed = 0;
        window.wrappedState.lastFrameTime = performance.now();
        const fill = document.getElementById(`wrapped-pb-fill-0`);
        if (fill) fill.style.width = '0%';
    }
}

// Replay Wrapped Slideshow
function replayWrapped() {
    // Reset active class on slides
    window.wrappedState.currentSlides.forEach((slide, idx) => {
        if (idx === 0) slide.classList.add('active');
        else slide.classList.remove('active');
    });
    // Restart player
    startWrappedPlayer();
}

// Pause/Resume toggle
function toggleWrappedPlayPause() {
    window.wrappedState.isPaused = !window.wrappedState.isPaused;
    window.wrappedState.lastFrameTime = performance.now();
    updatePauseButtonUI();
}

// Update Pause Button Icon
function updatePauseButtonUI() {
    const pauseBtn = document.getElementById('wrapped-pause-btn');
    if (!pauseBtn) return;

    if (window.wrappedState.isPaused) {
        pauseBtn.innerHTML = '<i data-lucide="play"></i>';
        pauseBtn.setAttribute('aria-label', 'Play');
    } else {
        pauseBtn.innerHTML = '<i data-lucide="pause"></i>';
        pauseBtn.setAttribute('aria-label', 'Pause');
    }

    if (window.lucide) {
        lucide.createIcons({ node: pauseBtn });
    }
}

// Close Wrapped Modal
function closeWrappedStory() {
    stopWrappedPlayer();

    const modal = document.getElementById('wrapped-modal');
    if (modal) {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 400); // Wait for transition fade
    }
}

// Share stats summary to clipboard
function shareWrapped(data) {
    const days = Math.floor(data.totalMinutes / (24 * 60));
    const hours = Math.floor((data.totalMinutes % (24 * 60)) / 60);
    const minutes = data.totalMinutes % 60;
    
    let watchTime = '';
    if (days > 0) watchTime = `${days} days and ${hours} hours`;
    else if (hours > 0) watchTime = `${hours} hours and ${minutes} minutes`;
    else watchTime = `${minutes} minutes`;

    const summaryText = `🎬 My KeepUp Monthly Wrapped for ${data.monthName} ${data.year} 🎬

⏱️ Total Watch Time: ${watchTime}
🎥 Movies Completed: ${data.moviesCount}
📺 TV Episodes Logged: ${data.episodesCount}
🎭 Top Genre: ${data.topGenre}
⭐ Top TV Show: ${data.topShow ? data.topShow.title : 'None'}

How did your month look? Track your watchlist with KeepUp! 🍿`;

    navigator.clipboard.writeText(summaryText)
        .then(() => {
            showToast('Wrapped summary copied to clipboard! Share it with your friends.', 'success');
        })
        .catch(err => {
            console.error('Failed to copy Wrapped text:', err);
            showToast('Unable to copy summary to clipboard.', 'error');
        });
}

// Bind event listeners for Wrapped Modal & Story Actions
window.addEventListener('DOMContentLoaded', () => {
    // Selectors
    const modal = document.getElementById('wrapped-modal');
    const pauseBtn = document.getElementById('wrapped-pause-btn');
    const closeBtn = document.getElementById('wrapped-close-btn');
    const prevZone = document.getElementById('wrapped-nav-prev');
    const nextZone = document.getElementById('wrapped-nav-next');
    const viewBtn = document.getElementById('view-wrapped-btn');
    const select = document.getElementById('wrapped-month-select');

    // Stats Section View Button listener
    if (viewBtn) {
        viewBtn.addEventListener('click', () => {
            const mStr = select.value;
            if (mStr) {
                openWrappedStory(mStr);
            }
        });
    }

    // Modal Control buttons
    if (pauseBtn) {
        pauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleWrappedPlayPause();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeWrappedStory();
        });
    }

    // Navigation overlay zones
    if (prevZone) {
        prevZone.addEventListener('click', (e) => {
            e.stopPropagation();
            prevWrappedSlide();
        });
    }

    if (nextZone) {
        nextZone.addEventListener('click', (e) => {
            e.stopPropagation();
            nextWrappedSlide();
        });
    }

    // Touch and mouse hold interactions to pause/resume
    if (modal) {
        const handlePressStart = (e) => {
            // Do not pause if clicking on interactive control buttons
            if (e.target.closest('button') || e.target.closest('.wrapped-summary-actions')) return;
            
            window.wrappedState.isPaused = true;
            updatePauseButtonUI();
        };

        const handlePressEnd = () => {
            if (window.wrappedState.isPlaying && window.wrappedState.currentSlideIndex < 5) {
                window.wrappedState.isPaused = false;
                window.wrappedState.lastFrameTime = performance.now();
                updatePauseButtonUI();
            }
        };

        modal.addEventListener('mousedown', handlePressStart);
        modal.addEventListener('mouseup', handlePressEnd);
        modal.addEventListener('touchstart', handlePressStart, { passive: true });
        modal.addEventListener('touchend', handlePressEnd, { passive: true });
    }
});
