const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');  // Import cors

const app = express();  // Initialize the Express app

app.use(cors());  // Enable CORS for all routes

// Middleware to parse incoming JSON requests
app.use(express.json());

// MySQL connection setup
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',           // MySQL username
    password: 'Jade112739%',  // Replace 'your_password' with your actual MySQL root password
    database: 'dance_competition'  // The database you created
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error('Failed to connect to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database.');
});

app.get('/api/judges', (req, res) => {
    const query = 'SELECT id, name, pin FROM judges';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(results); // Return list of judges including name and PIN
    });
});

app.post('/api/authenticate', (req, res) => {
    const { name, pin } = req.body;

    // Query the database to find the judge with the given name and PIN
    const query = 'SELECT * FROM judges WHERE name = ? AND pin = ?';
    db.query(query, [name, pin], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Database error' });
        }

        // If a matching judge is found
        if (results.length > 0) {
            res.json({ success: true, judge: results[0] });
        } else {
            // If no matching judge is found, return an authentication error
            res.status(401).json({ success: false, message: 'Invalid name or PIN' });
        }
    });
});

app.get('/api/categories', (req, res) => {
    const query = 'SELECT id, name, judge_count FROM categories';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json(results); // Return all categories along with judge_count
    });
});

app.get('/api/competitors/:category_id', (req, res) => {
    const category_id = req.params.category_id;
    const query = `
        SELECT c.lot_number, c.name 
        FROM competitors c
        JOIN competitor_category cc ON c.id = cc.competitor_id
        WHERE cc.category_id = ?`;

    db.query(query, [category_id], (err, results) => {
        if (err) {
            return res.status(500).json({ message: 'Database error' });
        }

        res.json(results);
    });
});

app.post('/api/submit-scores', (req, res) => {
    const { judge, category_id, results } = req.body;

    console.log('Received data:', req.body);  // Log incoming data for debugging

    // Ensure results exist and iterate through them
    if (results && results.length > 0) {
        results.forEach(result => {
            const query = `
                INSERT INTO heat_results (judge_name, category_id, lot_number, advance)
                VALUES (?, ?, ?, ?)
            `;
            // Log each result for debugging
            console.log(`Storing result for Lot Number ${result.lot_number}: Advance - ${result.advance ? 'Yes' : 'No'}`);
            
            // Insert each result into the database
            db.query(query, [judge, category_id, result.lot_number, result.advance ? 1 : 0], (err) => {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ message: 'Database error' });
                }
            });
        });

        // Send success response after processing
        res.json({ message: 'Scores submitted successfully' });
    } else {
        console.error('No results provided');
        res.status(400).json({ message: 'No results to store' });
    }
});

app.post('/api/advance-to-semi-finals', (req, res) => {
    const categoryId = req.body.category_id;  // Get the category ID from the request

    // Query to count Yes votes (advance = 1) for each competitor in the heat
    const query = `
        SELECT lot_number, COUNT(*) AS yes_votes
        FROM heat_results
        WHERE category_id = ? AND advance = 1
        GROUP BY lot_number
        HAVING yes_votes >= 5
    `;

    db.query(query, [categoryId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
        }

        // Insert semi-finalists into the semi_finalists table
        results.forEach(result => {
            const insertQuery = `
                INSERT INTO semi_finalists (category_id, lot_number, yes_votes)
                VALUES (?, ?, ?)
            `;
            db.query(insertQuery, [categoryId, result.lot_number, result.yes_votes], (insertErr) => {
                if (insertErr) {
                    console.error('Error inserting semi-finalist:', insertErr);
                }
            });
        });

        res.json({ message: 'Semi-finalists have been populated' });
    });
});

app.get('/api/semi-finalists/:category_id', (req, res) => {
    const categoryId = req.params.category_id;

    const query = `
        SELECT lot_number, yes_votes
        FROM semi_finalists
        WHERE category_id = ?
    `;

    db.query(query, [categoryId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
        }

        res.json(results);
    });
});

app.get('/api/competitors', (req, res) => {
    const name = req.query.name;

    if (!name) {
        return res.status(400).json({ error: 'Competitor name is required' });
    }

    // Search for the competitor by name and get their lot number as well
    const query = `
        SELECT c.id, c.name, c.lot_number, GROUP_CONCAT(cat.name) AS categories
        FROM competitors c
        LEFT JOIN competitor_category cc ON c.id = cc.competitor_id
        LEFT JOIN categories cat ON cc.category_id = cat.id
        WHERE c.name LIKE ?
        GROUP BY c.id
    `;

    db.query(query, [`%${name}%`], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'Competitor not found' });
        }

        // Return competitor details with their categories and lot number
        const competitor = results[0];
        const categories = competitor.categories ? competitor.categories.split(',') : [];

        res.json({
            id: competitor.id,
            name: competitor.name,
            lot_number: competitor.lot_number,  // Lot number is now included
            categories: categories,
        });
    });
});

app.post('/api/competitors/update-category', (req, res) => {
    const { competitorId, category, addToCategory } = req.body;

    if (!competitorId || !category) {
        return res.status(400).json({ error: 'Competitor ID and category are required' });
    }

    // Fetch the category ID based on the category name
    const categoryQuery = 'SELECT id FROM categories WHERE name = ?';
    db.query(categoryQuery, [category], (categoryErr, categoryResults) => {
        if (categoryErr || categoryResults.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }

        const categoryId = categoryResults[0].id;

        if (addToCategory) {
            // Add competitor to category
            const insertQuery = `
                INSERT INTO competitor_category (competitor_id, category_id)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE competitor_id = competitor_id
            `;
            db.query(insertQuery, [competitorId, categoryId], (insertErr) => {
                if (insertErr) {
                    console.error('Error adding competitor to category:', insertErr);
                    return res.status(500).json({ error: 'Database error' });
                }

                res.json({ message: 'Competitor added to category' });
            });
        } else {
            // Remove competitor from category
            const deleteQuery = 'DELETE FROM competitor_category WHERE competitor_id = ? AND category_id = ?';
            db.query(deleteQuery, [competitorId, categoryId], (deleteErr) => {
                if (deleteErr) {
                    console.error('Error removing competitor from category:', deleteErr);
                    return res.status(500).json({ error: 'Database error' });
                }

                res.json({ message: 'Competitor removed from category' });
            });
        }
    });
});

app.post('/api/competitors/update-category-batch', (req, res) => {
    const { updates } = req.body;
    if (!updates || updates.length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
    }

    // Process each update (add or remove competitors from categories)
    updates.forEach(update => {
        const { competitorId, category, addToCategory } = update;

        const categoryQuery = 'SELECT id FROM categories WHERE name = ?';
        db.query(categoryQuery, [category], (categoryErr, categoryResults) => {
            if (categoryErr || categoryResults.length === 0) return;

            const categoryId = categoryResults[0].id;

            if (addToCategory) {
                // Add competitor to category
                const insertQuery = 'INSERT INTO competitor_category (competitor_id, category_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE competitor_id = competitor_id';
                db.query(insertQuery, [competitorId, categoryId], (err) => {
                    if (err) console.error('Error adding competitor to category:', err);
                });
            } else {
                // Remove competitor from category
                const deleteQuery = 'DELETE FROM competitor_category WHERE competitor_id = ? AND category_id = ?';
                db.query(deleteQuery, [competitorId, categoryId], (err) => {
                    if (err) console.error('Error removing competitor from category:', err);
                });
            }
        });
    });

    res.json({ message: 'Categories updated' });
});

app.get('/api/competitors/suggestions', (req, res) => {
    const searchTerm = req.query.name;

    if (!searchTerm) {
        return res.status(400).json({ error: 'Search term is required' });
    }

    // Query to get competitor names matching the search term
    const query = `
        SELECT name FROM competitors WHERE name LIKE ? LIMIT 10
    `;

    db.query(query, [`%${searchTerm}%`], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        const names = results.map(result => result.name);
        res.json(names);
    });
});

app.get('/api/competitors/all', (req, res) => {
    const query = 'SELECT id, name, lot_number FROM competitors ORDER BY name';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);  // Log detailed error
            return res.status(500).json({ error: 'Database error' });
        }

        console.log('Fetched competitors from database:', results);
        res.json(results); // Return all competitors
    });
});

app.post('/api/judges', (req, res) => {
    const { name, pin } = req.body;

    if (!name || !pin) {
        return res.status(400).json({ error: 'Name and PIN are required' });
    }

    if (pin.length !== 4 || isNaN(pin)) {
        return res.status(400).json({ error: 'PIN must be a 4-digit number' });
    }

    const query = 'INSERT INTO judges (name, pin) VALUES (?, ?)';

    db.query(query, [name, pin], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        res.json({ success: true });
    });
});

app.delete('/api/judges/:id', (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM judges WHERE id = ?';

    db.query(query, [id], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Judge not found' });
        }

        res.json({ success: true });
    });
});

app.put('/api/judges/:id', (req, res) => {
    const { id } = req.params;
    const { name, pin } = req.body;

    if (!name || !pin) {
        return res.status(400).json({ error: 'Name and PIN are required' });
    }

    if (pin.length !== 4 || isNaN(pin)) {
        return res.status(400).json({ error: 'PIN must be a 4-digit number' });
    }

    const query = 'UPDATE judges SET name = ?, pin = ? WHERE id = ?';

    db.query(query, [name, pin, id], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Judge not found' });
        }

        res.json({ success: true });
    });
});

app.post('/api/update-category-judges', (req, res) => {
    const { category_id, judge_count } = req.body;

    if (!category_id || !judge_count) {
        return res.status(400).json({ success: false, message: 'Invalid data submitted' });
    }

    // Calculate votes_needed as half of judge_count, rounded up
    const votes_needed = Math.ceil(judge_count / 2);

    // Update the judge_count and votes_needed in the categories table
    const query = `
        UPDATE categories
        SET judge_count = ?, votes_needed = ?
        WHERE id = ?
    `;

    db.query(query, [judge_count, votes_needed, category_id], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        res.json({ success: true, message: 'Judge count and votes needed updated successfully' });
    });
});

app.get('/api/rounds', (req, res) => {
    const query = `
        SELECT r.id, r.category_id, c.name AS category_name, 
               r.selection, r.semi_final, r.final
        FROM rounds r
        JOIN categories c ON r.category_id = c.id;
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        // Send the results (rounds data) to the frontend
        res.json(results);
    });
});

app.post('/api/update-category-rounds', (req, res) => {
    const categoryRounds = req.body;

    const query = 'UPDATE rounds SET selection = ?, semi_final = ?, final = ? WHERE id = ?';

    categoryRounds.forEach(categoryRound => {
        db.query(query, [categoryRound.selection, categoryRound.semi_final, categoryRound.final, categoryRound.id], (err, result) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
        });
    });

    res.json({ success: true });
});

app.get('/api/get-round-status/:categoryId', (req, res) => {
    const categoryId = req.params.categoryId;

    const query = `
        SELECT selection, quarter_final, semi_final, final 
        FROM rounds 
        WHERE category_id = ?
    `;

    db.query(query, [categoryId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (results.length > 0) {
            res.json(results[0]);  // Send back the round status
        } else {
            res.status(404).json({ error: 'Category not found' });
        }
    });
});

app.post('/api/submit-selection-votes', (req, res) => {
    const { category_id, judge_name, votes } = req.body;

    if (!category_id || !judge_name || !votes) {
        return res.status(400).json({ success: false, message: 'Invalid data submitted' });
    }

    // Loop through the votes and insert them into the database
    const insertVotes = Object.keys(votes).map(lot_number => {
        const vote = votes[lot_number] === 'yes' ? 1 : 0;  // Convert 'yes' to 1, 'no' to 0

        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO selection_scores (category_id, lot_number, judge_name, vote)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE vote = VALUES(vote)
            `;
            db.query(query, [category_id, lot_number, judge_name, vote], (err, result) => {
                if (err) {
                    return reject(err);
                }
                resolve(result);
            });
        });
    });

    // Execute all insert operations
    Promise.all(insertVotes)
        .then(() => {
            res.json({ success: true, message: 'Votes submitted successfully' });
        })
        .catch(err => {
            console.error('Error submitting votes:', err);
            res.status(500).json({ success: false, message: 'Database error' });
        });
});

app.get('/api/category-rounds/:categoryId', (req, res) => {
    const categoryId = req.params.categoryId;

    const query = `
        SELECT selection, semi_final, final
        FROM rounds
        WHERE category_id = ?
    `;

    db.query(query, [categoryId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json(results[0]);
    });
});

app.get('/api/semi-finalists/:categoryId', (req, res) => {
    const categoryId = req.params.categoryId;

    const query = `
        SELECT sf.lot_number, c.name 
        FROM semi_finalists sf
        INNER JOIN competitors c ON sf.lot_number = c.lot_number
        WHERE sf.category_id = ?
    `;

    db.query(query, [categoryId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

app.post('/api/submit-semi-final-votes', async (req, res) => {
    const { category_id, judge_name, votes } = req.body;

    if (!category_id || !judge_name || !votes) {
        return res.status(400).json({ success: false, message: 'Invalid data submitted' });
    }

    try {
        // Retrieve judge_id based on judge_name
        const judgeResult = await new Promise((resolve, reject) => {
            db.query('SELECT id FROM judges WHERE name = ?', [judge_name], (err, results) => {
                if (err) {
                    console.error('Error fetching judge_id:', err);
                    return reject(err);
                }
                if (results.length === 0) {
                    console.error('Judge not found:', judge_name);
                    return reject(new Error('Judge not found'));
                }
                resolve(results[0].id);
            });
        });
        const judge_id = judgeResult;

        // Prepare entries for insertion using lot_number directly
        const insertVotes = Object.keys(votes).map(lot_number => {
            const yes_vote = votes[lot_number] === 'yes' ? 1 : 0;

            return new Promise((resolve, reject) => {
                const query = `
                    INSERT INTO semi_final_scores (category_id, lot_number, judge_id, yes_vote, created_at)
                    VALUES (?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE yes_vote = VALUES(yes_vote)
                `;
                db.query(query, [category_id, lot_number, judge_id, yes_vote], (err, result) => {
                    if (err) {
                        console.error('Error inserting vote:', err);
                        return reject(err);
                    }
                    resolve(result);
                });
            });
        });

        // Execute all insert operations
        Promise.all(insertVotes)
            .then(() => {
                res.json({ success: true, message: 'Votes submitted successfully' });
            })
            .catch(err => {
                console.error('Error submitting votes:', err);
                res.status(500).json({ success: false, message: 'Database error' });
            });
    } catch (error) {
        console.error('Error processing votes:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/advance-to-semi-final', (req, res) => {
    const { category_id } = req.body;

    if (!category_id) {
        return res.status(400).json({ success: false, message: 'Category ID is required' });
    }

    // Step 1: Get the number of "Yes" votes for each competitor in the Selection Round
    const getCompetitorVotesQuery = `
        SELECT ss.lot_number, COUNT(*) AS yes_votes
        FROM selection_scores ss
        WHERE ss.category_id = ? AND ss.vote = 1
        GROUP BY ss.lot_number
    `;

    db.query(getCompetitorVotesQuery, [category_id], (err, competitors) => {
        if (err) {
            console.error('Error fetching competitor votes:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (competitors.length === 0) {
            return res.status(200).json({ success: false, message: 'No competitors to advance.' });
        }

        // Step 2: Order competitors by yes_votes in descending order
        competitors.sort((a, b) => b.yes_votes - a.yes_votes);

        // Step 3: Select top competitors to advance, ensuring at least 12 competitors including ties
        let advancingCompetitors = [];
        let cutoffVotes = 0;

        for (let i = 0; i < competitors.length; i++) {
            const competitor = competitors[i];
            if (i < 12) {
                advancingCompetitors.push(competitor);
                cutoffVotes = competitor.yes_votes;
            } else if (competitor.yes_votes === cutoffVotes) {
                advancingCompetitors.push(competitor);
            } else {
                break;
            }
        }

        // Step 4: Insert the advancing competitors into the semi_finalists table
        const insertSemiFinalistsQuery = `
            INSERT IGNORE INTO semi_finalists (category_id, lot_number)
            VALUES ?
        `;

        const values = advancingCompetitors.map(competitor => [category_id, competitor.lot_number]);

        db.query(insertSemiFinalistsQuery, [values], (err, result) => {
            if (err) {
                console.error('Error advancing competitors:', err);
                return res.status(500).json({ success: false, message: 'Error advancing competitors' });
            }

            res.json({ success: true, message: 'Competitors advanced to the semi-final round', advancedCompetitors: advancingCompetitors });
        });
    });
});

app.post('/api/advance-to-final', (req, res) => {
    const { category_id } = req.body;

    if (!category_id) {
        return res.status(400).json({ success: false, message: 'Category ID is required' });
    }

    // Step 1: Get the total score for each competitor in the Semi-Final Round
    const getCompetitorScoresQuery = `
        SELECT semi_final_scores.lot_number, COUNT(*) AS yes_votes
        FROM semi_final_scores
        WHERE semi_final_scores.category_id = ? AND semi_final_scores.yes_vote = 1
        GROUP BY semi_final_scores.lot_number
    `;

    db.query(getCompetitorScoresQuery, [category_id], (err, competitors) => {
        if (err) {
            console.error('Error fetching competitor scores:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        if (competitors.length === 0) {
            return res.status(200).json({ success: false, message: 'No competitors to advance.' });
        }

        // Step 2: Order competitors by yes_votes in descending order
        competitors.sort((a, b) => b.yes_votes- a.yes_votes);

        // Step 3: Select top competitors to advance, ensuring at least 6 competitors including ties
        let advancingCompetitors = [];
        let cutoffScore = 0;

        for (let i = 0; i < competitors.length; i++) {
            const competitor = competitors[i];
            if (i < 6) {
                advancingCompetitors.push(competitor);
                cutoffScore = competitor.yes_votes;
            } else if (competitor.yes_votes === cutoffScore) {
                advancingCompetitors.push(competitor);
            } else {
                break;
            }
        }

        // Step 4: Insert the advancing competitors into the finalists table
        const insertFinalistsQuery = `
            INSERT IGNORE INTO finalists (category_id, lot_number)
            VALUES ?
        `;

        const values = advancingCompetitors.map(competitor => [category_id, competitor.lot_number]);

        db.query(insertFinalistsQuery, [values], (err, result) => {
            if (err) {
                console.error('Error advancing competitors:', err);
                return res.status(500).json({ success: false, message: 'Error advancing competitors' });
            }

            res.json({ success: true, message: 'Competitors advanced to the final round', advancedCompetitors: advancingCompetitors });
        });
    });
});

app.get('/api/finalists/:categoryId', (req, res) => {
    const categoryId = req.params.categoryId;

    const query = `
        SELECT f.lot_number, c.name 
        FROM finalists f
        INNER JOIN competitors c ON f.lot_number = c.lot_number
        WHERE f.category_id = ?
    `;

    db.query(query, [categoryId], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(results);
    });
});

app.post('/api/submit-final-scores', async (req, res) => {
    const { category_id, judge_name, scores } = req.body;

    if (!category_id || !judge_name || !scores) {
        return res.status(400).json({ success: false, message: 'Invalid data submitted' });
    }

    try {
        // Get judge_id based on judge_name
        const judgeResult = await new Promise((resolve, reject) => {
            db.query('SELECT id FROM judges WHERE name = ?', [judge_name], (err, results) => {
                if (err) {
                    console.error('Error fetching judge_id:', err);
                    return reject(err);
                }
                if (results.length === 0) {
                    console.error('Judge not found:', judge_name);
                    return reject(new Error('Judge not found'));
                }
                resolve(results[0].id);
            });
        });
        const judge_id = judgeResult;

        // Prepare entries for insertion
        const insertScores = Object.entries(scores).map(([lot_number, scoreData]) => {
            const { T, C, I } = scoreData;
            const total_score = parseInt(T, 10) + parseInt(C, 10) + parseInt(I, 10);

            return new Promise((resolve, reject) => {
                const query = `
                    INSERT INTO final_scores (category_id, lot_number, judge_id, t_score, c_score, i_score, total_score, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                    ON DUPLICATE KEY UPDATE
                        t_score = VALUES(t_score),
                        c_score = VALUES(c_score),
                        i_score = VALUES(i_score),
                        total_score = VALUES(total_score)
                `;
                db.query(query, [category_id, lot_number, judge_id, T, C, I, total_score], (err, result) => {
                    if (err) {
                        console.error('Error inserting score:', err);
                        return reject(err);
                    }
                    resolve(result);
                });
            });
        });

        // Execute all insert operations
        Promise.all(insertScores)
            .then(() => {
                res.json({ success: true, message: 'Scores submitted successfully' });
            })
            .catch(err => {
                console.error('Error submitting scores:', err);
                res.status(500).json({ success: false, message: 'Database error' });
            });
    } catch (error) {
        console.error('Error processing scores:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/final-results', (req, res) => {
    const query = `
        SELECT fs.category_id, c.name AS category_name, fs.lot_number, comp.name AS competitor_name, fs.total_score
        FROM final_scores fs
        INNER JOIN categories c ON fs.category_id = c.id
        INNER JOIN competitors comp ON fs.lot_number = comp.lot_number
        ORDER BY fs.category_id, fs.total_score DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        const categories = {};

        results.forEach(row => {
            const { category_id, category_name, lot_number, competitor_name, total_score } = row;
            if (!categories[category_id]) {
                categories[category_id] = { name: category_name, topCompetitors: [] };
            }
            if (categories[category_id].topCompetitors.length < 3) {
                categories[category_id].topCompetitors.push({
                    lot_number,
                    name: competitor_name,
                    total_score
                });
            }
        });

        res.json(Object.values(categories));
    });
});

app.post('/api/calculate-final-ranks', async (req, res) => {
    const { category_id } = req.body;

    if (!category_id) {
        return res.status(400).json({ success: false, message: 'Category ID is required' });
    }

    try {
        // Step 1: Retrieve final scores for the specified category
        const scoresQuery = `
            SELECT fs.lot_number, fs.judge_id, fs.total_score
            FROM final_scores fs
            WHERE fs.category_id = ?
            ORDER BY fs.judge_id, fs.total_score DESC
        `;

        const scores = await new Promise((resolve, reject) => {
            db.query(scoresQuery, [category_id], (err, results) => {
                if (err) {
                    console.error('Error fetching scores:', err);
                    return reject(err);
                }
                resolve(results);
            });
        });

        if (scores.length === 0) {
            return res.status(404).json({ success: false, message: 'No scores found for the specified category' });
        }

        // Step 2: Group scores by judge and calculate rankings
        const ranks = [];
        const judgeGroups = scores.reduce((groups, score) => {
            if (!groups[score.judge_id]) groups[score.judge_id] = [];
            groups[score.judge_id].push(score);
            return groups;
        }, {});

        for (const judgeId in judgeGroups) {
            const judgeScores = judgeGroups[judgeId];

            // Assign rankings (1 for highest score, 2 for second highest, etc.)
            judgeScores.forEach((score, index) => {
                ranks.push({
                    category_id,
                    lot_number: score.lot_number,
                    judge_id: score.judge_id,
                    ranking: index + 1,
                });
            });
        }

        // Step 3: Insert rankings into the final_ranks table
        const insertRanksQuery = `
            INSERT INTO final_ranks (category_id, lot_number, judge_id, ranking)
            VALUES ?
            ON DUPLICATE KEY UPDATE ranking = VALUES(ranking)
        `;
        const values = ranks.map(rank => [
            rank.category_id,
            rank.lot_number,
            rank.judge_id,
            rank.ranking,
        ]);

        await new Promise((resolve, reject) => {
            db.query(insertRanksQuery, [values], (err, result) => {
                if (err) {
                    console.error('Error inserting ranks:', err);
                    return reject(err);
                }
                resolve(result);
            });
        });

        res.json({ success: true, message: 'Final rankings calculated and saved successfully' });
    } catch (error) {
        console.error('Error calculating final ranks:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.get('/api/final-rankings', (req, res) => {
    const query = `
        SELECT DISTINCT 
            fr.ranking, 
            fr.lot_number, 
            c.name AS competitor_name, 
            fr.category_id, 
            cat.name AS category_name
        FROM final_ranks fr
        INNER JOIN competitors c ON fr.lot_number = c.lot_number
        INNER JOIN categories cat ON fr.category_id = cat.id
        ORDER BY fr.category_id, fr.ranking
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching final rankings:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        const categories = {};
        results.forEach(result => {
            if (!categories[result.category_id]) {
                categories[result.category_id] = {
                    category_name: result.category_name,
                    rankings: []
                };
            }

            categories[result.category_id].rankings.push({
                ranking: result.ranking,
                lot_number: result.lot_number,
                name: result.competitor_name
            });
        });

        res.json(Object.values(categories));
    });
});

app.get('/api/category-progress', (req, res) => {
    const progressQuery = `
        SELECT
            c.id AS category_id,
            c.name AS category_name,
            c.judge_count,
            r.selection,
            r.semi_final,
            r.final,
            COALESCE(ss.judge_count, 0) AS selection_judges,
            COALESCE(sfs.judge_count, 0) AS semi_final_judges,
            COALESCE(fs.judge_count, 0) AS final_judges
        FROM categories c
        INNER JOIN rounds r ON c.id = r.category_id
        LEFT JOIN (
            SELECT category_id, COUNT(DISTINCT judge_name) AS judge_count
            FROM selection_scores
            GROUP BY category_id
        ) ss ON c.id = ss.category_id
        LEFT JOIN (
            SELECT category_id, COUNT(DISTINCT judge_id) AS judge_count
            FROM semi_final_scores
            GROUP BY category_id
        ) sfs ON c.id = sfs.category_id
        LEFT JOIN (
            SELECT category_id, COUNT(DISTINCT judge_id) AS judge_count
            FROM final_scores
            GROUP BY category_id
        ) fs ON c.id = fs.category_id
    `;

    db.query(progressQuery, (err, results) => {
        if (err) {
            console.error('Error fetching progress data:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }

        // Transform the results to include round progress status
        const progressData = results.map(row => {
            let currentRound = null;
            if (row.selection === 1) {
                currentRound = 'selection';
            } else if (row.semi_final === 1) {
                currentRound = 'semi_final';
            } else if (row.final === 1) {
                currentRound = 'final';
            }

            return {
                category_id: row.category_id,
                category_name: row.category_name,
                judge_count: row.judge_count,
                selection: {
                    status: row.selection === 0 ? 'completed' : currentRound === 'selection' ? 'current' : 'future',
                    judges: row.selection_judges,
                },
                semi_final: {
                    status: row.semi_final === 0 ? 'completed' : currentRound === 'semi_final' ? 'current' : 'future',
                    judges: row.semi_final_judges,
                },
                final: {
                    status: row.final === 0 ? 'completed' : currentRound === 'final' ? 'current' : 'future',
                    judges: row.final_judges,
                },
            };
        });

        res.json({ success: true, data: progressData });
    });
});

app.get('/api/judge-votes-log', async (req, res) => {
    const query = `
        SELECT 
            'Selection' AS round_type,
            ss.judge_name,
            ss.category_id,
            c.name AS category_name,
            ss.lot_number,
            ss.vote AS score,
            ss.created_at
        FROM selection_scores ss
        JOIN categories c ON ss.category_id = c.id
        UNION ALL
        SELECT 
            'Semi-Final' AS round_type,
            j.name AS judge_name,
            sf.category_id,
            c.name AS category_name,
            sf.lot_number,
            sf.yes_vote AS score,
            sf.created_at
        FROM semi_final_scores sf
        JOIN judges j ON sf.judge_id = j.id
        JOIN categories c ON sf.category_id = c.id
        UNION ALL
        SELECT 
            'Final' AS round_type,
            j.name AS judge_name,
            fs.category_id,
            c.name AS category_name,
            fs.lot_number,
            (fs.t_score + fs.c_score + fs.i_score) AS score,
            fs.created_at
        FROM final_scores fs
        JOIN judges j ON fs.judge_id = j.id
        JOIN categories c ON fs.category_id = c.id
        ORDER BY created_at DESC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        res.json({ success: true, data: results });
    });
});


// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
