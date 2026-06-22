const express = require('express')
const axios   = require('axios')
const db      = require('../db')
const auth    = require('../middleware/auth')

const router  = express.Router()

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]  // 'YYYY-MM-DD'
}

async function checkRainRisk(lat, lon, targetDate) {
  try {
    const response = await axios.get(
      'https://api.openweathermap.org/data/2.5/forecast',
      {
        params: {
          lat,
          lon,
          appid: process.env.WEATHER_API_KEY,
          units: 'metric',
        }
      }
    )

    const target   = new Date(targetDate)
    const dayAfter = new Date(targetDate)
    dayAfter.setDate(dayAfter.getDate() + 1)

    // Find forecast slots that fall on our target date
    const relevant = response.data.list.filter(slot => {
      const slotDate = new Date(slot.dt * 1000)
      return slotDate >= target && slotDate <= dayAfter
    })

    // Rain risk = any slot has > 5mm of rain per 3 hours
    return relevant.some(slot => (slot.rain?.['3h'] || 0) > 5)

  } catch (err) {
    // If weather API fails → assume no rain (don't block the schedule)
    console.log('Weather check failed, assuming clear:', err.message)
    return false
  }
}

function calculateStages(gnData, acres, plantingDate, cultivationType) {
  const isIrrigated = cultivationType === 'irrigated'

  // Get total fertilizer per acre from your CSV row
  const totalUrea = isIrrigated
    ? parseFloat(gnData.irrigated_urea_kg_acre)
    : parseFloat(gnData.rainfed_urea_kg_acre)

  const totalTSP = isIrrigated
    ? parseFloat(gnData.irrigated_tsp_kg_acre)
    : parseFloat(gnData.rainfed_tsp_kg_acre)

  const totalMOP = isIrrigated
    ? parseFloat(gnData.irrigated_mop_kg_acre)
    : parseFloat(gnData.rainfed_mop_kg_acre)

  // Split Urea into 5 stages using DOA ratios
  // Pattern A (most areas): total = 56kg → split 0+8+22+18+8
  // Pattern B (Ibulpe DS):  total = 90kg → split 0+20+30+26+14
  const isPatternB = totalUrea >= 70
  const ureaByStage = isPatternB
    ? [0, 20, 30, 26, 14]   // Ibulpe DS pattern
    : [0,  8, 22, 18,  8]   // Standard pattern (most DS areas)

  // TSP: all applied at Basal stage (day 0)
  const tspByStage = [totalTSP, 0, 0, 0, 0]

  // MOP: split between stage 2 (day 35) and stage 3 (day 49)
  const mopHalf = Math.round(totalMOP / 2)
  const mopByStage = [0, 0, mopHalf, totalMOP - mopHalf, 0]

  // Stage definitions: DOA guidelines
  const stageDefs = [
    { index: 0, name: 'Basal Application',    icon: '🌱', daysAfter: 0  },
    { index: 1, name: 'Top Dress 1 — Week 3', icon: '💧', daysAfter: 21 },
    { index: 2, name: 'Top Dress 2 — Week 5', icon: '🌾', daysAfter: 35 },
    { index: 3, name: 'Top Dress 3 — Week 7', icon: '⚡', daysAfter: 49 },
    { index: 4, name: 'Top Dress 4 — Week 8', icon: '🌿', daysAfter: 56 },
  ]

  // Build stage objects and multiply per-acre rates by actual acres
  const stages = stageDefs.map((s, i) => {
    const urea  = parseFloat((ureaByStage[i]  * acres).toFixed(2))
    const tsp   = parseFloat((tspByStage[i]   * acres).toFixed(2))
    const mop   = parseFloat((mopByStage[i]   * acres).toFixed(2))
    const total = parseFloat((urea + tsp + mop).toFixed(2))

    return {
      stage_index:   s.index,
      stage_name:    s.name,
      stage_icon:    s.icon,
      date:          addDays(plantingDate, s.daysAfter),
      days_after:    s.daysAfter,
      urea_kg:       urea,
      tsp_kg:        tsp,
      mop_kg:        mop,
      total_kg:      total,
      rescheduled:   false,
      original_date: null,
    }
  })

  // Remove stages where nothing is applied (total = 0)
  return stages.filter(s => s.total_kg > 0)
}

router.post('/', auth, async (req, res) => {
  const { farmer_id, planting_date } = req.body

  if (!farmer_id || !planting_date) {
    return res.status(400).json({ message: 'farmer_id and planting_date are required' })
  }

  try {
    
    const [farmers] = await db.query(
      'SELECT * FROM farmers WHERE id = ?',
      [farmer_id]
    )
    if (farmers.length === 0) {
      return res.status(404).json({ message: 'Farmer not found' })
    }
    const farmer = farmers[0]

    
    const [gnRows] = await db.query(
      'SELECT * FROM gn_divisions WHERE id = ?',
      [farmer.gn_id]
    )
    if (gnRows.length === 0) {
      return res.status(404).json({
        message: 'Soil data not found for this GN division. Check CSV import.'
      })
    }
    const gnData = gnRows[0]

    
    const stages = calculateStages(
      gnData,
      parseFloat(farmer.acres),
      planting_date,
      farmer.cultivation_type
    )

    
    const lat = 6.7, lon = 80.4

    for (const stage of stages) {
      
      const hasRain = await checkRainRisk(lat, lon, stage.date)

      if (hasRain) {
        stage.original_date = stage.date          
        stage.date          = addDays(stage.date, 3)  
        stage.rescheduled   = true
        console.log(`⚠️  Stage "${stage.stage_name}" rescheduled due to rain`)
      }
    }

    
    const [cycleResult] = await db.query(
      'INSERT INTO crop_cycles (farmer_id, planting_date) VALUES (?, ?)',
      [farmer_id, planting_date]
    )
    const cycle_id = cycleResult.insertId

    
    for (const stage of stages) {
      await db.query(
        `INSERT INTO fertilizer_stages
           (cycle_id, farmer_id, stage_index, stage_name, stage_icon,
            scheduled_date, days_after, urea_kg, tsp_kg, mop_kg, total_kg,
            rescheduled, original_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cycle_id,
          farmer_id,
          stage.stage_index,
          stage.stage_name,
          stage.stage_icon,
          stage.date,
          stage.days_after,
          stage.urea_kg,
          stage.tsp_kg,
          stage.mop_kg,
          stage.total_kg,
          stage.rescheduled,
          stage.original_date || null,
        ]
      )
    }

    
    await db.query(
      'UPDATE farmers SET active_cycle = TRUE WHERE id = ?',
      [farmer_id]
    )

    
    res.status(201).json({
      message: 'Schedule created successfully',
      cycle_id,
      farmer_name: farmer.name,
      planting_date,
      stages,
      soil_warning: (gnData.irrigated_urea_kg_acre === 0)
        ? 'Soil nutrients are high in this area. Minimal fertilizer needed.'
        : null
    })

  } catch (err) {
    console.error('Schedule creation error:', err)
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/schedule/farmer/:id ────────────────────

router.get('/farmer/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM fertilizer_stages
       WHERE farmer_id = ?
       ORDER BY scheduled_date ASC`,
      [req.params.id]
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── GET /api/schedule ───────────────────────────────

router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         fs.*,
         f.name  AS farmer_name,
         f.phone AS farmer_phone,
         f.gn_division,
         f.ds_area
       FROM fertilizer_stages fs
       JOIN farmers f ON fs.farmer_id = f.id
       WHERE fs.status != 'applied'
       ORDER BY fs.scheduled_date ASC
       LIMIT 100`
    )
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ── PATCH /api/schedule/:id ──────────────────────────

router.patch('/:id', auth, async (req, res) => {
  const { status } = req.body
  try {
    await db.query(
      'UPDATE fertilizer_stages SET status = ? WHERE id = ?',
      [status, req.params.id]
    )
    res.json({ message: 'Stage status updated' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router