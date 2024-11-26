const express = require('express');
const bodyParser = require('body-parser');
const app = express();

// Middleware to handle JSON data
app.use(bodyParser.json());

// In-memory storage for scores (replace this with a database later)
let scores = [];

// Endpoint to handle score submissions
app.post('/submit-score', (req, res) => {
    const { judge, category, performance, score } = req.body;

    if (!judge || !category || !performance || !score) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    // Store the submitted score (in a real app, save this to a database)
    const scoreEntry = { judge, category, performance, score: Number(score) };
    scores.push(scoreEntry);

    console.log('Score submitted:', scoreEntry);
    res.status(201).json({ message: 'Score submitted successfully', scoreEntry });
});

// Endpoint to retrieve scores (for example, to display them later)
app.get('/scores', (req, res) => {
    res.status(200).json(scores);
});

// Serve static files (like your HTML, JS, and CSS files)
app.use(express.static('public'));

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});