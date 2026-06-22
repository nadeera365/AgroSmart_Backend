const express = require('express')
const router  = express.Router()
const axios   = require('axios')
const db      = require('../db')
const auth    = require('../middleware/auth')

// POST /api/sms/send 
// Send one SMS to a farmer
// Body: { phone, message, farmer_id, stage_id }
router.post('/send', auth, async (req, res) => {
  const { phone, message, farmer_id, stage_id } = req.body

  if (!phone || !message) {
    return res.status(400).json({ message: 'phone and message are required' })
  }

  try {
    // Build the URL query parameters for NotifyLK
    const params = new URLSearchParams({
      user_id:   process.env.NOTIFY_USER_ID,
      api_key:   process.env.NOTIFY_API_KEY,
      sender_id: 'AgroSmart',
      to:        phone,
      message:   message,
    })

    // Call NotifyLK API
    await axios.get(`https://app.notify.lk/api/v1/send?${params}`)

    // Log successful SMS to database
    await db.query(
      `INSERT INTO sms_log (farmer_id, stage_id, phone, message, status)
       VALUES (?, ?, ?, ?, 'sent')`,
      [farmer_id || null, stage_id || null, phone, message]
    )

    res.json({ message: 'SMS sent successfully' })

  } catch (err) {
    console.error('SMS failed:', err.message)

    // Log failed SMS too — so you know what went wrong
    await db.query(
      `INSERT INTO sms_log (farmer_id, stage_id, phone, message, status)
       VALUES (?, ?, ?, ?, 'failed')`,
      [farmer_id || null, stage_id || null, phone, message]
    ).catch(() => {})  // .catch() here so a DB error doesn't cause another error

    res.status(500).json({ message: 'SMS failed: ' + err.message })
  }
})

//  GET /api/sms/log 
// Get all SMS history
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

// GET /api/sms/farmer/:id
// Get SMS history for one specific farmer
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