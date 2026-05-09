const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.getAiSuggestions = async (req, res) => {
  try {
    const { watchlist = [] } = req.body;
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `Based on these movies/shows: ${watchlist.join(", ") || "popular sci-fi and drama"}. 
    Suggest 4 similar movies that are highly rated. 
    Return only a valid JSON array of strings containing just the titles. 
    Example: ["Inception", "Interstellar", "The Martian", "Arrival"]`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const titles = JSON.parse(cleanJson);

    const enrichedSuggestions = await Promise.all(
      titles.map(async (title) => {
        try {
          const tmdbRes = await axios.get(`${process.env.TMDB_BASE_URL}/search/movie`, {
            params: {
              api_key: process.env.TMDB_API_KEY,
              query: title,
              page: 1
            }
          });
          return tmdbRes.data.results[0];
        } catch (err) {
          return null;
        }
      })
    );

    res.json({
      suggestions: enrichedSuggestions.filter(item => item !== null) // Filter out any titles not found on TMDB
    });

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ message: "Error generating suggestions", error: error.message });
  }
};