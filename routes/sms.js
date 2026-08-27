const express = require('express')
const router  = express.Router()
const axios   = require('axios')
const db      = require('../db')
const auth    = require('../middleware/auth')

// ── Helper: clean phone number for Notify.lk ─────────────────
// Notify.lk wants: 94771234567 (no +, no spaces, no dashes)
function cleanPhone(phone) {
  let p = phone.replace(/\D/g, '') // strip everything except digits
  // if starts with 0 (local format 0771234567) → replace with 94
  if (p.startsWith('0')) p = '94' + p.slice(1)
  return p
}

// ── Helper: send via Notify.lk ────────────────────────────────
async function sendNotifyLK(phone, message) {
  const to = cleanPhone(phone)

  if (!process.env.NOTIFY_USER_ID || !process.env.NOTIFY_API_KEY) {
    throw new Error('NOTIFY_USER_ID or NOTIFY_API_KEY missing in .env')
  }

  const params = new URLSearchParams({
    user_id:   process.env.NOTIFY_USER_ID,
    api_key:   process.env.NOTIFY_API_KEY,
    sender_id: 'NotifyDEMO',
    to:        to,
    message:   message,
  })

  const url = `https://app.notify.lk/api/v1/send?${params}`

  console.log('📱 SMS sending to:', to)
  console.log('📝 Message:', message)
  console.log('🔑 user_id:', process.env.NOTIFY_USER_ID)
  console.log('🔑 api_key:', process.env.NOTIFY_API_KEY ? process.env.NOTIFY_API_KEY.slice(0,6) + '...' : 'MISSING')

  const response = await axios.get(url, { timeout: 15000 })

  console.log('📡 Notify.lk response:', JSON.stringify(response.data))

  if (
    response.data?.status === 'error' ||
    response.data?.status === 0 ||
    response.data?.status === false
  ) {
    throw new Error(`Notify.lk error: ${response.data?.message || JSON.stringify(response.data)}`)
  }

  return response.data
}

// ── POST /api/sms/send ────────────────────────────────────────
router.post('/send', auth, async (req, res) => {
  const { phone, message, farmer_id, stage_id } = req.body

  if (!phone || !message) {
    return res.status(400).json({ message: 'phone and message are required' })
  }

  const to = cleanPhone(phone)

  try {
    const result = await sendNotifyLK(phone, message)

    await db.query(
      `INSERT INTO sms_log (farmer_id, stage_id, phone, message, status)
       VALUES (?, ?, ?, ?, 'sent')`,
      [farmer_id || null, stage_id || null, to, message]
    )

    res.json({ message: 'SMS sent successfully', notify_response: result })

  } catch (err) {
    console.error('SMS failed:', err.message)
    if (err.response) {
      console.error('   HTTP status:', err.response.status)
      console.error('   Response body:', JSON.stringify(err.response.data))
    }

    await db.query(
      `INSERT INTO sms_log (farmer_id, stage_id, phone, message, status)
       VALUES (?, ?, ?, ?, 'failed')`,
      [farmer_id || null, stage_id || null, to, message]
    ).catch(() => {})

    res.status(500).json({
      message: 'SMS failed: ' + err.message,
      detail:  err.response?.data || null,
    })
  }
})

// ── POST /api/sms/test ────────────────────────────────────────
router.post('/test', auth, async (req, res) => {
  const { phone } = req.body
  if (!phone) return res.status(400).json({ message: 'phone is required' })

  try {
    const result = await sendNotifyLK(phone, 'AgroSmart SL test message. SMS is working! 🌾')
    res.json({ message: 'Test SMS sent!', notify_response: result })
  } catch (err) {
    console.error('Test SMS failed:', err.message)
    res.status(500).json({ message: err.message, detail: err.response?.data || null })
  }
})

// ── GET /api/sms/check-env ────────────────────────────────────
router.get('/check-env', auth, (req, res) => {
  res.json({
    NOTIFY_USER_ID: process.env.NOTIFY_USER_ID ? `set → ${process.env.NOTIFY_USER_ID}` : 'MISSING',
    NOTIFY_API_KEY: process.env.NOTIFY_API_KEY ? `set → ${process.env.NOTIFY_API_KEY.slice(0,6)}...` : 'MISSING',
  })
})

// ── GET /api/sms/log ──────────────────────────────────────────
router.get('/log', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT sl.*, f.name AS farmer_name
       FROM sms_log sl
       LEFT JOIN farmers f ON sl.farmer_id = f.id
       ORDER BY sl.sent_at DESC
       LIMIT 100`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/sms/farmer/:id ───────────────────────────────────
router.get('/farmer/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM sms_log
       WHERE farmer_id = ?
       ORDER BY sent_at DESC`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router