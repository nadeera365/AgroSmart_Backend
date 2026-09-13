const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectMongoDB = require('./mongoDb');

const app = express();

// CORS configuration
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://agrosmart-sl.vercel.app'
    ],
    credentials: true
  })
);

// Middleware
app.use(express.json());

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/farmers', require('./routes/farmers'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/gn', require('./routes/gn'));

// API health-check route
app.get('/', (req, res) => {
  res.json({
    message: 'AgroSmart API is running',
    status: 'ok'
  });
});

const PORT = process.env.PORT || 5000;

// Connect to MongoDB and start the server
async function startServer() {
  try {
    await connectMongoDB();

    app.listen(PORT, () => {
      console.log(`AgroSmart Backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start AgroSmart backend:', error.message);
    process.exit(1);
  }
}

startServer();