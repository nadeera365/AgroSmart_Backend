const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectMongoDB = require('./mongoDb');

const app = express();

// Allowed frontend origins
const allowedOrigins = [
  'https://agrosmart-sl.vercel.app'
];

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow Postman, server-to-server requests and allowed frontends
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS blocked origin: ${origin}`);
      callback(new Error(`CORS blocked origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Parse JSON request bodies
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
  res.status(200).json({
    message: 'AgroSmart API is running',
    status: 'ok'
  });
});

const PORT = process.env.PORT || 5000;

// Connect to MongoDB and start the server
async function startServer() {
  try {
    await connectMongoDB();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`AgroSmart Backend running on port ${PORT}`);
      console.log('Allowed origins:', allowedOrigins);
    });
  } catch (error) {
    console.error(
      'Failed to start AgroSmart backend:',
      error.message
    );

    process.exit(1);
  }
}

startServer();