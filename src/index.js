const path = require('path');
const express = require('express');
const db = require('./database');
const { parseCSV } = require('./csv-parser');
const { runAnalysis } = require('./engine/analyzer');
const apiRoutes = require('./routes/api');

const CSV_PATH = process.env.CSV_PATH || 'C:\\Users\\pc\\Downloads\\618-11f1-8c41-57a0acc381c9.csv';
const PORT = parseInt(process.env.PORT, 10) || 3001;

console.log('Initializing database...');
db.initDatabase();

const existingCount = db.getDb().prepare('SELECT COUNT(*) as c FROM workout_sets').get().c;
if (existingCount === 0) {
  console.log('Database empty, importing CSV...');
  console.log(`Parsing CSV: ${CSV_PATH}`);
  const { sets, skipped } = parseCSV(CSV_PATH);
  console.log(`Parsed ${sets.length} valid sets. Skipped: ${JSON.stringify(skipped)}`);
  console.log('Importing sets into database...');
  db.insertSets(sets);
  console.log('Import complete.');
} else {
  console.log(`Database has ${existingCount} existing sets, skipping CSV import.`);
}

console.log('Running analysis...');
runAnalysis();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err.stack || err.message || err);
  res.status(500).send('Internal Server Error');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
