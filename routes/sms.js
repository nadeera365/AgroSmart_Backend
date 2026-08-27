const express = require('express')
const router = express.Router()
const axios = require('axios')
const cron = require('node-cron')
const db = require('../db')
const auth = require('../middleware/auth')

// Clean phone number for Notify.lk
function cleanPhone(phone) {
  let p = String(phone).replace(/\D/g, '')

  if (p.startsWith('0')) {
    p = '94' + p.slice(1)
  }

  return p
}

// Send SMS through Notify.lk
async function sendNotifyLK(phone, message) {
  const to = cleanPhone(phone)

  if (
    !process.env.NOTIFY_USER_ID ||
    !process.env.NOTIFY_API_KEY
  ) {
    throw new Error(
      'NOTIFY_USER_ID or NOTIFY_API_KEY missing in .env'
    )
  }

  const params = new URLSearchParams({
    user_id: process.env.NOTIFY_USER_ID,
    api_key: process.env.NOTIFY_API_KEY,
    sender_id: 'NotifyDEMO',
    to,
    message,
  })

  const url = `https://app.notify.lk/api/v1/send?${params}`

  console.log('SMS sending to:', to)
  console.log('Message:', message)

  const response = await axios.get(url, {
    timeout: 15000,
  })

  console.log(
    'Notify.lk response:',
    JSON.stringify(response.data)
  )

  if (
    response.data?.status === 'error' ||
    response.data?.status === 0 ||
    response.data?.status === false
  ) {
    throw new Error(
      `Notify.lk error: ${
        response.data?.message ||
        JSON.stringify(response.data)
      }`
    )
  }

  return response.data
}

// Check rain risk for the scheduled date
async function checkRainRisk(lat, lon, date) {
  if (!process.env.WEATHER_API_KEY) {
    console.warn(
      'WEATHER_API_KEY missing. Rain risk check skipped.'
    )

    return {
      risk: false,
      reason: null,
    }
  }

  try {
    const response = await axios.get(
      'https://api.openweathermap.org/data/2.5/forecast',
      {
        params: {
          lat,
          lon,
          appid: process.env.WEATHER_API_KEY,
          units: 'metric',
        },
        timeout: 15000,
      }
    )

    const forecasts = response.data?.list || []

    const dayForecasts = forecasts.filter(item => {
      const forecastDate = new Date(item.dt * 1000)
        .toLocaleDateString('en-CA', {
          timeZone: 'Asia/Colombo',
        })

      return forecastDate === date
    })

    if (dayForecasts.length === 0) {
      return {
        risk: false,
        reason: null,
      }
    }

    let rainRisk = false
    let maxRainProbability = 0
    let maxRainAmount = 0

    for (const forecast of dayForecasts) {
      const probability = (forecast.pop || 0) * 100
      const rainAmount = forecast.rain?.['3h'] || 0

      if (probability >= 50) {
        rainRisk = true
      }

      if (rainAmount >= 2) {
        rainRisk = true
      }

      maxRainProbability = Math.max(
        maxRainProbability,
        probability
      )

      maxRainAmount = Math.max(
        maxRainAmount,
        rainAmount
      )
    }

    if (!rainRisk) {
      return {
        risk: false,
        reason: null,
      }
    }

    return {
      risk: true,
      reason: `Rain probability around ${Math.round(
        maxRainProbability
      )}%`,
    }
  } catch (err) {
    console.error(
      'Rain risk check failed:',
      err.message
    )

    return {
      risk: false,
      reason: null,
    }
  }
}

// Format date for SMS
function formatDate(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Colombo',
  })
}

// Get tomorrow date in Sri Lanka
function getTomorrowDate() {
  const now = new Date()

  const sriLankaDate = new Date(
    now.toLocaleString('en-US', {
      timeZone: 'Asia/Colombo',
    })
  )

  sriLankaDate.setDate(
    sriLankaDate.getDate() + 1
  )

  const year = sriLankaDate.getFullYear()

  const month = String(
    sriLankaDate.getMonth() + 1
  ).padStart(2, '0')

  const day = String(
    sriLankaDate.getDate()
  ).padStart(2, '0')

  return `${year}-${month}-${day}`
}

// Send fertilizer reminders for tomorrow
async function sendTomorrowReminders() {
  console.log('Checking fertilizer reminders...')

  const tomorrow = getTomorrowDate()

  console.log(
    'Checking scheduled date:',
    tomorrow
  )

  try {
    const [stages] = await db.query(
      `SELECT
         fs.*,
         f.name AS farmer_name,
         f.phone AS farmer_phone,
         f.gn_division,
         f.ds_area
       FROM fertilizer_stages fs
       JOIN farmers f
         ON fs.farmer_id = f.id
       WHERE DATE(fs.scheduled_date) = ?
       AND fs.status = 'pending'`,
      [tomorrow]
    )

    if (stages.length === 0) {
      console.log(
        'No fertilizer applications scheduled for tomorrow.'
      )

      return
    }

    console.log(
      `Found ${stages.length} stage(s) for tomorrow.`
    )

    for (const stage of stages) {
      try {
        // Prevent duplicate reminder SMS
        const [existing] = await db.query(
          `SELECT id
           FROM sms_log
           WHERE stage_id = ?
           AND status = 'reminder_sent'
           LIMIT 1`,
          [stage.id]
        )

        if (existing.length > 0) {
          console.log(
            `Reminder already sent for stage ${stage.id}`
          )

          continue
        }

        // Ratnapura District centre coordinates
        const LAT = 6.7
        const LON = 80.4

        const rain = await checkRainRisk(
          LAT,
          LON,
          tomorrow
        )

        const fertilizerParts = []

        if (parseFloat(stage.urea_kg) > 0) {
          fertilizerParts.push(
            `Urea ${stage.urea_kg}kg`
          )
        }

        if (parseFloat(stage.tsp_kg) > 0) {
          fertilizerParts.push(
            `TSP ${stage.tsp_kg}kg`
          )
        }

        if (parseFloat(stage.mop_kg) > 0) {
          fertilizerParts.push(
            `MOP ${stage.mop_kg}kg`
          )
        }

        const fertilizerText =
          fertilizerParts.join(', ')

        let message =
          `AgroSmart: Reminder. ` +
          `${stage.stage_name} is scheduled for ` +
          `${formatDate(stage.scheduled_date)}. `

        if (fertilizerText) {
          message +=
            `Apply: ${fertilizerText}. `
        }

        if (rain.risk) {
          message +=
            `Rain risk is expected tomorrow. ` +
            `${rain.reason || ''}. ` +
            `Avoid applying fertilizer immediately ` +
            `before heavy rain.`
        } else {
          message +=
            `Weather check: No significant rain risk detected.`
        }

        console.log(
          `Sending reminder to ${stage.farmer_name}`
        )

        await sendNotifyLK(
          stage.farmer_phone,
          message
        )

        await db.query(
          `INSERT INTO sms_log
           (
             farmer_id,
             stage_id,
             phone,
             message,
             status
           )
           VALUES (?, ?, ?, ?, 'reminder_sent')`,
          [
            stage.farmer_id,
            stage.id,
            cleanPhone(stage.farmer_phone),
            message,
          ]
        )

        console.log(
          `Reminder sent to ${stage.farmer_name}`
        )
      } catch (err) {
        console.error(
          `Reminder failed for stage ${stage.id}:`,
          err.message
        )

        await db.query(
          `INSERT INTO sms_log
           (
             farmer_id,
             stage_id,
             phone,
             message,
             status
           )
           VALUES (?, ?, ?, ?, 'failed')`,
          [
            stage.farmer_id,
            stage.id,
            cleanPhone(stage.farmer_phone),
            `Reminder failed: ${err.message}`,
          ]
        ).catch(() => {})
      }
    }
  } catch (err) {
    console.error(
      'Reminder scheduler error:',
      err.message
    )
  }
}

// Run automatic reminders every day at 7 AM
cron.schedule(
  '0 7 * * *',
  () => {
    sendTomorrowReminders()
  },
  {
    timezone: 'Asia/Colombo',
  }
)

console.log(
  'Fertilizer SMS reminder scheduler started.'
)

// Manual SMS endpoint
router.post(
  '/send',
  auth,
  async (req, res) => {
    const {
      phone,
      message,
      farmer_id,
      stage_id,
    } = req.body

    if (!phone || !message) {
      return res.status(400).json({
        message:
          'phone and message are required',
      })
    }

    const to = cleanPhone(phone)

    try {
      const result = await sendNotifyLK(
        phone,
        message
      )

      await db.query(
        `INSERT INTO sms_log
         (
           farmer_id,
           stage_id,
           phone,
           message,
           status
         )
         VALUES (?, ?, ?, ?, 'sent')`,
        [
          farmer_id || null,
          stage_id || null,
          to,
          message,
        ]
      )

      res.json({
        message:
          'SMS sent successfully',
        notify_response: result,
      })
    } catch (err) {
      console.error(
        'SMS failed:',
        err.message
      )

      if (err.response) {
        console.error(
          'HTTP status:',
          err.response.status
        )

        console.error(
          'Response body:',
          JSON.stringify(
            err.response.data
          )
        )
      }

      await db.query(
        `INSERT INTO sms_log
         (
           farmer_id,
           stage_id,
           phone,
           message,
           status
         )
         VALUES (?, ?, ?, ?, 'failed')`,
        [
          farmer_id || null,
          stage_id || null,
          to,
          message,
        ]
      ).catch(() => {})

      res.status(500).json({
        message:
          'SMS failed: ' +
          err.message,
        detail:
          err.response?.data || null,
      })
    }
  }
)

// Test SMS endpoint
router.post(
  '/test',
  auth,
  async (req, res) => {
    const { phone } = req.body

    if (!phone) {
      return res.status(400).json({
        message:
          'phone is required',
      })
    }

    try {
      const result = await sendNotifyLK(
        phone,
        'AgroSmart SL test message. SMS is working!'
      )

      res.json({
        message:
          'Test SMS sent!',
        notify_response: result,
      })
    } catch (err) {
      console.error(
        'Test SMS failed:',
        err.message
      )

      res.status(500).json({
        message:
          err.message,
        detail:
          err.response?.data || null,
      })
    }
  }
)

// Check environment variables
router.get(
  '/check-env',
  auth,
  (req, res) => {
    res.json({
      NOTIFY_USER_ID:
        process.env.NOTIFY_USER_ID
          ? `set -> ${process.env.NOTIFY_USER_ID}`
          : 'MISSING',

      NOTIFY_API_KEY:
        process.env.NOTIFY_API_KEY
          ? `set -> ${process.env.NOTIFY_API_KEY.slice(0, 6)}...`
          : 'MISSING',

      WEATHER_API_KEY:
        process.env.WEATHER_API_KEY
          ? 'set'
          : 'MISSING',
    })
  }
)

// Get SMS logs
router.get(
  '/log',
  auth,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT
           sl.*,
           f.name AS farmer_name
         FROM sms_log sl
         LEFT JOIN farmers f
           ON sl.farmer_id = f.id
         ORDER BY sl.sent_at DESC
         LIMIT 100`
      )

      res.json(rows)
    } catch (err) {
      res.status(500).json({
        message:
          err.message,
      })
    }
  }
)

// Get SMS logs for a farmer
router.get(
  '/farmer/:id',
  auth,
  async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT *
         FROM sms_log
         WHERE farmer_id = ?
         ORDER BY sent_at DESC`,
        [req.params.id]
      )

      res.json(rows)
    } catch (err) {
      res.status(500).json({
        message:
          err.message,
      })
    }
  }
)

// Manually run tomorrow reminders for testing
router.post(
  '/run-reminders',
  auth,
  async (req, res) => {
    try {
      await sendTomorrowReminders()

      res.json({
        message:
          'Tomorrow reminders checked successfully',
      })
    } catch (err) {
      res.status(500).json({
        message:
          err.message,
      })
    }
  }
)

module.exports = router