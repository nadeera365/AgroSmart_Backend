const express = require('express')

const GNDivision = require('../models/GNDivision')
const auth = require('../middleware/auth')

const router = express.Router()

// GET /api/gn/ds-areas
// Return all unique DS area names
router.get('/ds-areas', auth, async (req, res) => {
  try {
    const dsAreas = await GNDivision.distinct(
      'divisional_secretariat'
    )

    dsAreas.sort((a, b) =>
      a.localeCompare(b)
    )

    res.json(dsAreas)
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// GET /api/gn/by-ds/:ds
// Return GN divisions belonging to a DS area
router.get('/by-ds/:ds', auth, async (req, res) => {
  try {
    const rows = await GNDivision.find({
      divisional_secretariat: req.params.ds
    })
      .select('_id gn_division')
      .sort({ gn_division: 1 })
      .lean()

    const divisions = rows.map(row => ({
      id: row._id.toString(),
      gn_division: row.gn_division
    }))

    res.json(divisions)
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// GET /api/gn/data?ds=...&gn=...
// Return soil and fertilizer data
router.get('/data', auth, async (req, res) => {
  const { ds, gn } = req.query

  if (!ds || !gn) {
    return res.status(400).json({
      message:
        'Both ds (divisional secretariat) and gn (GN division) are required'
    })
  }

  try {
    const data = await GNDivision.findOne({
      divisional_secretariat: ds,
      gn_division: gn
    }).lean()

    if (!data) {
      return res.status(404).json({
        message:
          `No data found for GN: ${gn} in DS: ${ds}`
      })
    }

    const noFertilizerNeeded =
      Number(data.irrigated_urea_kg_acre) === 0 &&
      Number(data.irrigated_tsp_kg_acre) === 0 &&
      Number(data.irrigated_mop_kg_acre) === 0

    const {
      _id,
      __v,
      legacyId,
      ...soilData
    } = data

    res.json({
      id: _id.toString(),
      ...soilData,

      no_fertilizer_needed:
        noFertilizerNeeded,

      warning: noFertilizerNeeded
        ? 'Soil nutrients are already high in this area. Minimal chemical fertilizer recommended.'
        : null
    })
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

module.exports = router