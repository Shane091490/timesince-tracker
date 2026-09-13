const express = require('express');
const cookieParser = require('cookie-parser');
const { waitForDb } = require('./src/db');

const authRoutes = require('./src/routes/auth');
const habitRoutes = require('./src/routes/habits');
const dataRoutes = require('./src/routes/data');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.get('/healthz', (req, res) => res.status(200).json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/habits', habitRoutes);
app.use('/api', dataRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

waitForDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Time Since Tracker API listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Could not connect to database, exiting', err);
    process.exit(1);
  });
