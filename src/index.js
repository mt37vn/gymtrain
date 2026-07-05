const path = require('path');
const express = require('express');
const db = require('./database');
const { parseCSV } = require('./csv-parser');
const { runAnalysis } = require('./engine/analyzer');
const apiRoutes = require('./routes/api');

const CSV_PATH = process.env.CSV_PATH || 'C:\\Users\\pc\\Downloads\\618-11f1-8c41-57a0acc381c9.csv';
const PORT = parseInt(process.env.PORT, 10) || 3000;

console.log('Initializing database...');
db.initDatabase();

console.log(`Parsing CSV: ${CSV_PATH}`);
const { sets, skipped } = parseCSV(CSV_PATH);
console.log(`Parsed ${sets.length} valid sets. Skipped: ${JSON.stringify(skipped)}`);

console.log('Importing sets into database...');
db.insertSets(sets);
console.log('Import complete.');

console.log('Running analysis...');
runAnalysis();

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', apiRoutes);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
