require('dotenv').config();
const express = require('express');
const cors = require('cors');
const tmdbRoutes = require('./tmdbRoutes');
const aiRoutes = require('./aiRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/tmdb', tmdbRoutes);
app.use('/api/ai', aiRoutes);

app.get('/', (req, res) => {
  res.send('KEEP UP API is running...');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});