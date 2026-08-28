const express = require('express')
const mongoose = require('mongoose')
const axios = require('axios')
const cron = require('node-cron')

const Farmer = require('../models/Farmer')
const FertilizerStage =
  require('../models/FertilizerStage')
const SMSLog = require('../models/SMSLog')

const auth = require('../middleware/auth')

const router = express.Router()

function cleanPhone(phone) {
  let value = String(phone).replace(/\D/g, '')

  if (value.startsWith('0')) {
    value = '94' + value.slice(1)
  }

  return value
}

function isValidSriLankanPhone(phone) {
  return /^94\d{9}$/.test(cleanPhone(phone))
}

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

  if (!isValidSriLankanPhone(phone)) {
    throw new Error(
      'Invalid Sri Lankan phone number'
    )
  }

  const response = await axios.get(
    'https://app.notify.lk/api/v1/send',
    {
      params: {
        user_id:
          process.env.NOTIFY_USER_ID,

        api_key:
          process.env.NOTIFY_API_KEY,

        sender_id:
          process.env.NOTIFY_SENDER_ID ||
          'NotifyDEMO',

        to,
        message
      },

      timeout: 15000
    }
  )

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

async function checkRainRisk(
  lat,
  lon,
  targetDate
) {
  if (!process.env.WEATHER_API_KEY) {
    return {
      risk: false,
      reason: null
    }
  }

  try {
    const response = await axios.get(
      'https://api.openweathermap.org/data/2.5/forecast',
      {
        params: {
          lat,
          lon,
          appid:
            process.env.WEATHER_API_KEY,
          units: 'metric'
        },

        timeout: 15000
      }
    )

    const forecasts =
      response.data?.list || []

    const dayForecasts =
      forecasts.filter(item => {
        const date = new Date(
          item.dt * 1000
        ).toLocaleDateString(
          'en-CA',
          {
            timeZone: 'Asia/Colombo'
          }
        )

        return date === targetDate
      })

    let maxProbability = 0
    let maxRainAmount = 0

    for (const forecast of dayForecasts) {
      maxProbability = Math.max(
        maxProbability,
        (forecast.pop || 0) * 100
      )

      maxRainAmount = Math.max(
        maxRainAmount,
        forecast.rain?.['3h'] || 0
      )
    }

    const risk =
      maxProbability >= 50 ||
      maxRainAmount >= 2

    return {
      risk,

      reason: risk
        ? `Rain probability around ` +
          `${Math.round(maxProbability)}%`
        : null
    }
  } catch (err) {
    console.error(
      'Rain risk check failed:',
      err.message
    )

    return {
      risk: false,
      reason: null
    }
  }
}

function formatDate(date) {
  return new Date(date).toLocaleDateString(
    'en-GB',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Colombo'
    }
  )
}

function getTomorrowDate() {
  const formatter = new Intl.DateTimeFormat(
    'en-CA',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Colombo'
    }
  )

  const sriLankaToday =
    formatter.format(new Date())

  const date = new Date(
    `${sriLankaToday}T00:00:00.000Z`
  )

  date.setUTCDate(
    date.getUTCDate() + 1
  )

  return date.toISOString().slice(0, 10)
}

function buildFertilizerText(stage) {
  const parts = []

  if (Number(stage.urea_kg) > 0) {
    parts.push(
      `Urea ${stage.urea_kg}kg`
    )
  }

  if (Number(stage.tsp_kg) > 0) {
    parts.push(
      `TSP ${stage.tsp_kg}kg`
    )
  }

  if (Number(stage.mop_kg) > 0) {
    parts.push(
      `MOP ${stage.mop_kg}kg`
    )
  }

  return parts.join(', ')
}

function formatSMSLog(log) {
  const farmer =
    log.farmer_id &&
    log.farmer_id._id
      ? log.farmer_id
      : null

  const farmerId = farmer
    ? farmer._id
    : log.farmer_id

  const stageId =
    log.stage_id &&
    log.stage_id._id
      ? log.stage_id._id
      : log.stage_id

  return {
    id: log._id.toString(),

    farmer_id: farmerId
      ? farmerId.toString()
      : null,

    stage_id: stageId
      ? stageId.toString()
      : null,

    phone: log.phone,
    message: log.message,
    status: log.status,
    sms_type: log.sms_type,
    sent_at: log.sent_at,

    farmer_name:
      farmer?.name || null
  }
}

async function sendTomorrowReminders() {
  console.log(
    'Checking fertilizer reminders...'
  )

  const tomorrow = getTomorrowDate()

  const startDate = new Date(
    `${tomorrow}T00:00:00.000Z`
  )

  const endDate = new Date(startDate)

  endDate.setUTCDate(
    endDate.getUTCDate() + 1
  )

  console.log(
    'Checking scheduled date:',
    tomorrow
  )

  try {
    const stages =
      await FertilizerStage.find({
        scheduled_date: {
          $gte: startDate,
          $lt: endDate
        },

        status: 'pending'
      }).populate(
        'farmer_id',
        'name phone gn_division ds_area'
      )

    if (stages.length === 0) {
      console.log(
        'No fertilizer applications scheduled for tomorrow.'
      )

      return {
        date: tomorrow,
        found: 0,
        sent: 0,
        failed: 0,
        skipped: 0
      }
    }

    let sent = 0
    let failed = 0
    let skipped = 0

    for (const stage of stages) {
      const farmer = stage.farmer_id

      if (!farmer) {
        console.warn(
          `Farmer missing for stage ${stage._id}`
        )

        skipped++
        continue
      }

      const existingReminder =
        await SMSLog.exists({
          stage_id: stage._id,
          status: 'reminder_sent'
        })

      if (existingReminder) {
        console.log(
          `Reminder already sent for stage ${stage._id}`
        )

        skipped++
        continue
      }

      let message = ''

      try {
        const rain = await checkRainRisk(
          6.7,
          80.4,
          tomorrow
        )

        const fertilizerText =
          buildFertilizerText(stage)

        message =
          `AgroSmart: Reminder. ` +
          `${stage.stage_name} is scheduled ` +
          `for ${formatDate(
            stage.scheduled_date
          )}. `

        if (fertilizerText) {
          message +=
            `Apply: ${fertilizerText}. `
        }

        if (rain.risk) {
          message +=
            `Rain risk is expected tomorrow. ` +
            `${rain.reason || ''}. ` +
            `Avoid applying fertilizer ` +
            `immediately before heavy rain.`
        } else {
          message +=
            `Weather check: No significant ` +
            `rain risk detected.`
        }

        await sendNotifyLK(
          farmer.phone,
          message
        )

        await SMSLog.create({
          farmer_id: farmer._id,
          stage_id: stage._id,

          phone:
            cleanPhone(farmer.phone),

          message,
          status: 'reminder_sent',
          sms_type: 'reminder',
          sent_at: new Date()
        })

        console.log(
          `Reminder sent to ${farmer.name}`
        )

        sent++
      } catch (err) {
        console.error(
          `Reminder failed for stage ` +
          `${stage._id}:`,
          err.message
        )

        await SMSLog.create({
          farmer_id: farmer._id,
          stage_id: stage._id,

          phone:
            cleanPhone(farmer.phone),

          message:
            message ||
            `Reminder failed: ${err.message}`,

          status: 'failed',
          sms_type: 'reminder',
          sent_at: new Date()
        }).catch(() => {})

        failed++
      }
    }

    return {
      date: tomorrow,
      found: stages.length,
      sent,
      failed,
      skipped
    }
  } catch (err) {
    console.error(
      'Reminder scheduler error:',
      err.message
    )

    throw err
  }
}

// Automatic reminders every day at 7 AM
cron.schedule(
  '0 7 * * *',
  async () => {
    try {
      await sendTomorrowReminders()
    } catch (err) {
      console.error(
        'Automatic reminder job failed:',
        err.message
      )
    }
  },
  {
    timezone: 'Asia/Colombo'
  }
)

console.log(
  'Fertilizer SMS reminder scheduler started.'
)

// POST /api/sms/send
router.post('/send', auth, async (req, res) => {
  const {
    phone,
    message,
    farmer_id,
    stage_id
  } = req.body

  if (!phone || !message) {
    return res.status(400).json({
      message:
        'phone and message are required'
    })
  }

  if (!isValidSriLankanPhone(phone)) {
    return res.status(400).json({
      message:
        'Invalid Sri Lankan phone number'
    })
  }

  if (
    farmer_id &&
    !mongoose.isValidObjectId(farmer_id)
  ) {
    return res.status(400).json({
      message: 'Invalid farmer_id'
    })
  }

  if (
    stage_id &&
    !mongoose.isValidObjectId(stage_id)
  ) {
    return res.status(400).json({
      message: 'Invalid stage_id'
    })
  }

  const to = cleanPhone(phone)

  try {
    if (farmer_id) {
      const farmerExists =
        await Farmer.exists({
          _id: farmer_id
        })

      if (!farmerExists) {
        return res.status(404).json({
          message: 'Farmer not found'
        })
      }
    }

    if (stage_id) {
      const stageExists =
        await FertilizerStage.exists({
          _id: stage_id
        })

      if (!stageExists) {
        return res.status(404).json({
          message: 'Stage not found'
        })
      }
    }

    const result = await sendNotifyLK(
      phone,
      message
    )

    const log = await SMSLog.create({
      farmer_id: farmer_id || null,
      stage_id: stage_id || null,
      phone: to,
      message,
      status: 'sent',
      sms_type: 'manual',
      sent_at: new Date()
    })

    res.json({
      message: 'SMS sent successfully',
      log_id: log._id.toString(),
      notify_response: result
    })
  } catch (err) {
    console.error(
      'SMS failed:',
      err.message
    )

    await SMSLog.create({
      farmer_id: farmer_id || null,
      stage_id: stage_id || null,
      phone: to,
      message,
      status: 'failed',
      sms_type: 'manual',
      sent_at: new Date()
    }).catch(() => {})

    res.status(500).json({
      message:
        'SMS failed: ' + err.message,

      detail:
        err.response?.data || null
    })
  }
})

// POST /api/sms/test
router.post('/test', auth, async (req, res) => {
  const { phone } = req.body

  if (!phone) {
    return res.status(400).json({
      message: 'phone is required'
    })
  }

  if (!isValidSriLankanPhone(phone)) {
    return res.status(400).json({
      message:
        'Invalid Sri Lankan phone number'
    })
  }

  try {
    const result = await sendNotifyLK(
      phone,
      'AgroSmart SL test message. SMS is working!'
    )

    res.json({
      message: 'Test SMS sent!',
      notify_response: result
    })
  } catch (err) {
    res.status(500).json({
      message: err.message,
      detail:
        err.response?.data || null
    })
  }
})

// GET /api/sms/check-env
router.get('/check-env', auth, (req, res) => {
  res.json({
    NOTIFY_USER_ID:
      process.env.NOTIFY_USER_ID
        ? 'set'
        : 'MISSING',

    NOTIFY_API_KEY:
      process.env.NOTIFY_API_KEY
        ? 'set'
        : 'MISSING',

    NOTIFY_SENDER_ID:
      process.env.NOTIFY_SENDER_ID
        ? 'set'
        : 'using NotifyDEMO',

    WEATHER_API_KEY:
      process.env.WEATHER_API_KEY
        ? 'set'
        : 'MISSING'
  })
})

// GET /api/sms/log
router.get('/log', auth, async (req, res) => {
  try {
    const logs = await SMSLog.find()
      .populate('farmer_id', 'name')
      .sort({ sent_at: -1 })
      .limit(100)
      .lean()

    res.json(
      logs.map(formatSMSLog)
    )
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// GET /api/sms/farmer/:id
router.get(
  '/farmer/:id',
  auth,
  async (req, res) => {
    if (
      !mongoose.isValidObjectId(req.params.id)
    ) {
      return res.status(400).json({
        message: 'Invalid farmer ID'
      })
    }

    try {
      const logs = await SMSLog.find({
        farmer_id: req.params.id
      })
        .sort({ sent_at: -1 })
        .lean()

      res.json(
        logs.map(formatSMSLog)
      )
    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

// POST /api/sms/run-reminders
router.post(
  '/run-reminders',
  auth,
  async (req, res) => {
    try {
      const result =
        await sendTomorrowReminders()

      res.json({
        message:
          'Tomorrow reminders checked successfully',

        result
      })
    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

module.exports = router