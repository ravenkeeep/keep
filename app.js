const SUPABASE_URL = 'https://syjvismfzxokzvexhius.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_WnY7m_CdMnqxAEfz6fgBfQ_GtFkLT36';

var supabaseClient = null;
if (typeof supabase !== 'undefined') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.error('Supabase SDK failed to load. Please check your internet connection or ad-blocker settings.');
}
window.supabaseClient = supabaseClient;

function showAuthMessage(message) {
  const messageContainer = document.getElementById('auth-message');
  if (messageContainer) {
    messageContainer.textContent = message;
  }
}

function updateUIForAuth(isLoggedIn) {
  const signedOutActions = document.getElementById('signed-out-actions');
  const signedInActions = document.getElementById('signed-in-actions');
  const searchControls = document.getElementById('search-controls');
  const watchlistSection = document.getElementById('watchlist-section');
  const watchlistLink = document.getElementById('watchlist-link');
  const socialLink = document.getElementById('social-link');
  const navSearchToggle = document.getElementById('nav-search-toggle');

  if (signedOutActions) {
    signedOutActions.style.display = isLoggedIn ? 'none' : 'block';
  }
  if (signedInActions) {
    signedInActions.style.display = isLoggedIn ? 'block' : 'none';
  }
  if (navSearchToggle) {
    navSearchToggle.style.display = isLoggedIn ? 'inline-flex' : 'none';
  }
  if (searchControls) {
    searchControls.style.display = 'none';
  }
  if (watchlistSection) {
    watchlistSection.style.display = isLoggedIn ? 'block' : 'none';
  }
  if (watchlistLink) {
    watchlistLink.style.display = isLoggedIn ? 'inline-block' : 'none';
  }
  if (socialLink) {
    socialLink.style.display = isLoggedIn ? 'inline-block' : 'none';
  }
  const releaseRadarSection = document.getElementById('release-radar-section');
  if (releaseRadarSection && !isLoggedIn) {
    releaseRadarSection.style.display = 'none';
  }
}

async function ensureUserProfile(user) {
  if (!user?.id) return;

  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, username')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Error checking profile:', error);
    return;
  }

  if (!data) {
    const defaultUsername = user.email
      ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || `user_${user.id.slice(0, 8)}`
      : `user_${user.id.slice(0, 8)}`;

    const { error: insertError } = await supabaseClient.from('profiles').insert([
      { id: user.id, username: defaultUsername, full_name: '', avatar_url: '' },
    ]);
    if (insertError) {
      console.error('Error creating profile:', insertError);
    }
  }
}

async function setAuthUI(user) {
  const welcomeMessage = document.getElementById('welcome-banner');

  updateUIForAuth(!!user);

  if (user) {
    await ensureUserProfile(user);
  }

  let username = 'User';
  if (user) {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .maybeSingle();
    if (profile && profile.username) {
      username = profile.username;
    } else {
      username = user.email ? user.email.split('@')[0] : 'User';
    }
  showAuthMessage('');
  if (window.loadWatchlist) {
    window.loadWatchlist();
  }
  if (window.loadWatchStatistics) {
    window.loadWatchStatistics();
  }
  if (window.loadUpcomingReleases) {
    window.loadUpcomingReleases();
  }
  if (window.loadNextEpisodesCountdown) {
    window.loadNextEpisodesCountdown();
  }
  if (window.loadUpcomingMoviesCountdown) {
    window.loadUpcomingMoviesCountdown();
  }
  }

  // Initialize social page if on social.html
  if (window.location.pathname.includes('social.html')) {
    const socialDashboard = document.getElementById('social-dashboard');
    if (socialDashboard) socialDashboard.style.display = user ? 'grid' : 'none';
    if (window.loadPendingRequests) window.loadPendingRequests();
    if (window.loadUserGroups) window.loadUserGroups();
    if (window.loadFriends) window.loadFriends();
  }
}

async function signIn() {
  const email = document.getElementById('email-input')?.value.trim();
  const password = document.getElementById('password-input')?.value.trim();

  if (!email || !password) {
    showAuthMessage('Please enter email and password.');
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showAuthMessage(error.message);
    return;
  }

  showAuthMessage('Signed in successfully.');
}

async function signUp() {
  const email = document.getElementById('email-input')?.value.trim();
  const password = document.getElementById('password-input')?.value.trim();

  if (!email || !password) {
    showAuthMessage('Please enter email and password.');
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    showAuthMessage(error.message);
    return;
  }

  if (data?.user) {
    await ensureUserProfile(data.user);
  }

  showAuthMessage('Sign-up complete. Check your email for confirmation if required.');
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    showAuthMessage(error.message);
    return;
  }

  showAuthMessage('Signed out successfully.');
}

async function clearSession() {
  const { error } = await supabaseClient.auth.signOut();

  // Remove any stored Supabase auth session data from local storage.
  Object.keys(localStorage).forEach(key => {
    if (key.includes('supabase') || key.startsWith('sb-')) {
      localStorage.removeItem(key);
    }
  });

  await setAuthUI(null);
  if (window.loadWatchlist) {
    window.loadWatchlist();
  }

  if (error) {
    showAuthMessage(`Session cleared, but sign-out returned an error: ${error.message}`);
    console.error('Supabase sign-out error when clearing session:', error);
  } else {
    showAuthMessage('Session cleared. You can now sign in as a different user.');
  }
}

async function initializeAuth() {
  const { data } = await supabaseClient.auth.getSession();
  await setAuthUI(data?.session?.user ?? null);

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    setAuthUI(session?.user ?? null);
  });
}

function highlightActivePage() {
  const pageLinks = document.querySelectorAll('nav.page-nav a');
  const currentPage = window.location.pathname.split('/').pop();

  pageLinks.forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const signInButton = document.getElementById('sign-in-button');
  const signUpButton = document.getElementById('sign-up-button');
  const signOutButton = document.getElementById('sign-out-button');

  signInButton?.addEventListener('click', signIn);
  signUpButton?.addEventListener('click', signUp);
  signOutButton?.addEventListener('click', signOut);

  // Toggle account dropdown
  document.addEventListener('click', (e) => {
    const dropdownButton = document.getElementById('account-dropdown-button');
    const dropdownMenu = document.getElementById('account-dropdown-menu');
    if (dropdownButton && dropdownMenu) {
      if (dropdownButton.contains(e.target)) {
        dropdownMenu.classList.toggle('show');
        dropdownButton.classList.toggle('active');
      } else if (!dropdownMenu.contains(e.target)) {
        dropdownMenu.classList.remove('show');
        dropdownButton.classList.remove('active');
      }
    }
  });

  initializeAuth();
  highlightActivePage();
  if (window.lucide) {
    lucide.createIcons();
  }
});
