const express = require('express')
const router  = express.Router()
const axios   = require('axios')
const auth    = require('../middleware/auth')

// GET /api/weather?lat=6.7&lon=80.4
router.get('/', auth, async (req, res) => {
  const { lat = 6.7, lon = 80.4 } = req.query

  try {
    const { data } = await axios.get(
      'https://api.openweathermap.org/data/2.5/forecast',
      { timeout: 8000, params: { lat, lon, appid: process.env.WEATHER_API_KEY, units: 'metric' } }
    )

    const current = data.list[0]

    // Build 5-day forecast (one slot per day)
    const days = ['Today','Tomorrow','Day 3','Day 4','Day 5']
    const forecast = data.list
      .filter((_, i) => i % 8 === 0)  // every 8th slot = 24hrs apart
      .slice(0, 5)
      .map((slot, i) => ({
        day:  days[i],
        icon: slot.weather[0].main === 'Rain'   ? '🌧️'
            : slot.weather[0].main === 'Clouds' ? '⛅' : '☀️',
        temp: Math.round(slot.main.temp),
        rain: Math.round((slot.pop || 0) * 100),  // probability %
        warn: (slot.pop || 0) > 0.6,              // high risk flag
      }))

    res.json({
      current: {
        temp:      Math.round(current.main.temp),
        condition: current.weather[0].description,
        humidity:  current.main.humidity,
        wind:      Math.round(current.wind.speed * 3.6),
      },
      forecast,
      rainRisk: forecast.slice(0, 3).some(f => f.warn),
    })

  } catch (err) {
    res.status(500).json({ message: 'Weather API error: ' + err.message })
  }
})

module.exports = router