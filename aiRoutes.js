const express = require('express');
const router = express.Router();
const { getAiSuggestions } = require('./aiController');

router.post('/suggestions', getAiSuggestions);

module.exports = router;