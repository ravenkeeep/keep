const axios = require('axios');

const tmdbClient = axios.create({
  baseURL: process.env.TMDB_BASE_URL,
  params: {
    api_key: process.env.TMDB_API_KEY,
  },
});

exports.getTrending = async (req, res) => {
  try {
    const { type = 'movie', time_window = 'day' } = req.query;
    const response = await tmdbClient.get(`/trending/${type}/${time_window}`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ message: "Error fetching trending data", error: error.message });
  }
};

exports.getMovieDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const response = await tmdbClient.get(`/movie/${id}`, {
      params: { append_to_response: 'videos,credits' }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: "Error fetching movie details", error: error.message });
  }
};

exports.searchMovies = async (req, res) => {
  try {
    const { query, page = 1 } = req.query;
    if (!query) return res.status(400).json({ message: "Query is required" });
    
    const response = await tmdbClient.get('/search/movie', {
      params: { query, page }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ message: "Error searching movies", error: error.message });
  }
};
