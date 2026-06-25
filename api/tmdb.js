export default async function handler(req, res) {
  // Extract the target path (e.g., 'movie/popular') and other query parameters
  const { path, ...rest } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TMDB_API_KEY environment variable is not configured on Vercel' });
  }

  // Construct the secure URL to call TMDB from the server
  const queryParams = new URLSearchParams({
    api_key: apiKey,
    ...rest
  });

  const tmdbUrl = `https://api.themoviedb.org/3/${path}?${queryParams.toString()}`;

  try {
    const response = await fetch(tmdbUrl);
    const data = await response.json();
    
    // Set headers to allow JSON response and forward TMDB data
    res.setHeader('Content-Type', 'application/json');
    
    // Set cache headers only for successful TMDB API calls
    if (response.status === 200) {
      let cacheControl = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=600';
      if (path.includes('search')) {
        cacheControl = 'public, max-age=300, s-maxage=1800, stale-while-revalidate=300';
      }
      res.setHeader('Cache-Control', cacheControl);
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    }
    
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data from TMDB', details: error.message });
  }
}
