# AgroSmart SL Backend

This repository contains the Node.js and Express backend for AgroSmart SL, a weather-aware fertilizer decision support system for Sri Lankan paddy farming. The API manages authentication, farmers, GN-level soil data, fertilizer schedules, weather information, and SMS communication.

## Live Services

- Frontend: https://agrosmart-sl.vercel.app
- Backend API: https://agrosmartbackend-production.up.railway.app
- Health check: https://agrosmartbackend-production.up.railway.app/

## Related Repository

- Frontend: https://github.com/nadeera365/AgroSmart_Frontend

## Key Features

- Administrator authentication using JWT and bcrypt
- Farmer CRUD operations
- DS area, GN division, and soil-data retrieval
- Irrigated and rainfed fertilizer recommendations
- Crop-cycle and fertilizer-stage generation
- Urea, TSP, and MOP quantity calculations
- Fertilizer-stage status updates and deletion
- OpenWeatherMap current weather and forecast integration
- NotifyLK manual messages and scheduled reminders
- SMS delivery logs and duplicate-reminder checks
- MongoDB Atlas cloud storage through Mongoose

## Technology Stack

- Node.js
- Express.js
- MongoDB Atlas
- Mongoose
- JSON Web Token
- bcryptjs
- Axios
- node-cron
- OpenWeatherMap API
- NotifyLK SMS API
- Railway

## System Architecture

```text
React and Vite frontend
          |
          | HTTPS REST requests with JWT
          v
Node.js and Express API
     |          |          |
     v          v          v
MongoDB     Weather API   NotifyLK API
Atlas
```

## Main API Routes

| Route | Purpose |
|---|---|
| `/api/auth` | Administrator registration and login |
| `/api/farmers` | Farmer creation, retrieval, and deletion |
| `/api/gn` | DS areas, GN divisions, and soil data |
| `/api/schedule` | Crop cycles and fertilizer schedules |
| `/api/weather` | Current weather and forecast information |
| `/api/sms` | SMS sending, reminders, and logs |

## Fertilizer Scheduling Algorithm

The algorithm retrieves irrigated or rainfed fertilizer values from the farmer's linked GN record and multiplies the per-acre recommendations by the farmer's acreage.

| Stage | Days after planting | Allocation |
|---|---:|---|
| Basal application | 0 | 100% of recommended TSP |
| Top Dress 1 | 21 | First Urea portion |
| Top Dress 2 | 35 | Urea portion and 50% of MOP |
| Top Dress 3 | 49 | Urea portion and remaining 50% of MOP |
| Top Dress 4 | 56 | Final Urea portion |

Urea is distributed proportionally using one of three stage patterns:

```text
High-Urea recommendation: [0, 20, 30, 26, 14]
TSP at least 14 kg/acre:  [0, 14, 22, 12, 8]
Other recommendations:   [0, 8, 22, 18, 8]
```

The selected pattern is normalized so that all stage allocations add up to the GN recommendation multiplied by acreage. Stages with a total of zero kilograms are not stored. If Urea, TSP, and MOP totals are all zero, the API returns a message explaining that no chemical fertilizer schedule is recommended.

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm
- MongoDB Atlas database
- OpenWeatherMap API key
- NotifyLK account and API credentials for SMS functions

### Installation

```bash
git clone https://github.com/nadeera365/AgroSmart_Backend.git
cd AgroSmart_Backend
npm install
```

Create a `.env` file in the project root. Use the exact variable names expected by your route and service files:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
WEATHER_API_KEY=your_openweather_api_key
NOTIFY_USER_ID=your_notify_user_id
NOTIFY_API_KEY=your_notify_api_key
NOTIFY_SENDER_ID=your_notify_sender_id
```

Never commit the `.env` file.

Start the development server:

```bash
npm run dev
```

Start the production server:

```bash
npm start
```

The local API normally runs at `http://localhost:5000`.

## Deployment

The backend is deployed as a Railway service. Production requirements include:

- All environment variables configured in Railway
- MongoDB Atlas network access configured for the deployed service
- Server listening on `process.env.PORT`
- The production frontend included in the CORS allowlist

```js
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://agrosmart-sl.vercel.app'
];
```

## Testing

The API was tested using Postman and through the React user interface. Main tests included authentication, protected routes, GN data retrieval, farmer creation, schedule generation, zero fertilizer handling, MOP distribution, stage updates, weather retrieval, and SMS logging.

A tested 2.5-acre irrigated field in Amunugoda produced a 140 kg Urea schedule while TSP and MOP correctly remained at zero because the linked recommendation contained zero values for those fertilizers.

## Data Coverage and Limitations

- 320 GN records from 17 DS areas in the Ratnapura District
- GN-level recommendations are not a replacement for field-specific laboratory testing
- Weather information supports decisions but does not automatically reschedule saved stages
- SMS delivery depends on the external gateway, connectivity, and account balance
- No controlled crop-yield field trial was conducted

## Security

- Passwords are hashed before storage.
- Protected endpoints require a valid JWT.
- MongoDB ObjectIds and request inputs are validated.
- API credentials are stored in environment variables.
- `.env` and other secret files must remain excluded from Git.

## Author

H. G. N. S. Kumara  
BSc in Computer Science and Technology  
Sabaragamuwa University of Sri Lanka

## License

This project was developed for academic and demonstration purposes.
