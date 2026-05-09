const express = require('express');
const router = express.Router();
const { getTrending, searchMovies, getMovieDetails } = require('./tmdbController');

router.get('/trending', getTrending);
router.get('/search', searchMovies);
router.get('/movie/:id', getMovieDetails);

module.exports = router;