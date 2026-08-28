const express = require('express')
const mongoose = require('mongoose')

const Farmer = require('../models/Farmer')
const GNDivision = require('../models/GNDivision')
const auth = require('../middleware/auth')

const router = express.Router()

function formatFarmer(farmer) {
  const gn = farmer.gn_id || {}

  return {
    id: farmer._id.toString(),
    name: farmer.name,
    phone: farmer.phone,
    nic: farmer.nic,
    ds_area: farmer.ds_area,
    gn_division: farmer.gn_division,

    gn_id: gn._id
      ? gn._id.toString()
      : null,

    acres: farmer.acres,
    cultivation_type: farmer.cultivation_type,
    active_cycle: farmer.active_cycle,

    created_at: farmer.createdAt,

    soil_ph: gn.soil_ph,
    ph_status: gn.ph_status,

    ec_ds_m: gn.ec_ds_m,
    salinity_status: gn.salinity_status,

    phosphorus_mg_kg:
      gn.phosphorus_mg_kg,

    phosphorus_status:
      gn.phosphorus_status,

    potassium_mg_kg:
      gn.potassium_mg_kg,

    potassium_status:
      gn.potassium_status,

    organic_matter_pct:
      gn.organic_matter_pct,

    organic_matter_status:
      gn.organic_matter_status,

    irrigated_urea_kg_acre:
      gn.irrigated_urea_kg_acre,

    irrigated_tsp_kg_acre:
      gn.irrigated_tsp_kg_acre,

    irrigated_mop_kg_acre:
      gn.irrigated_mop_kg_acre,

    rainfed_urea_kg_acre:
      gn.rainfed_urea_kg_acre,

    rainfed_tsp_kg_acre:
      gn.rainfed_tsp_kg_acre,

    rainfed_mop_kg_acre:
      gn.rainfed_mop_kg_acre
  }
}

// GET /api/farmers
router.get('/', auth, async (req, res) => {
  try {
    const farmers = await Farmer.find()
      .populate('gn_id')
      .sort({ createdAt: -1 })

    res.json(
      farmers.map(formatFarmer)
    )
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// GET /api/farmers/:id
router.get('/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      message: 'Invalid farmer ID'
    })
  }

  try {
    const farmer = await Farmer.findById(
      req.params.id
    ).populate('gn_id')

    if (!farmer) {
      return res.status(404).json({
        message: 'Farmer not found'
      })
    }

    res.json(formatFarmer(farmer))
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// POST /api/farmers
router.post('/', auth, async (req, res) => {
  const {
    name,
    phone,
    nic,
    ds_area,
    gn_division,
    acres,
    cultivation_type
  } = req.body

  if (
    !name ||
    !phone ||
    !ds_area ||
    !gn_division ||
    acres === undefined ||
    acres === null
  ) {
    return res.status(400).json({
      message:
        'Name, phone, DS area, GN division and acres are required'
    })
  }

  const numericAcres = Number(acres)

  if (
    !Number.isFinite(numericAcres) ||
    numericAcres <= 0
  ) {
    return res.status(400).json({
      message:
        'Acres must be a number greater than 0'
    })
  }

  try {
    const gnData = await GNDivision.findOne({
      divisional_secretariat: ds_area,
      gn_division
    })

    if (!gnData) {
      return res.status(400).json({
        message:
          `No GN data found for ${gn_division} in ${ds_area}`
      })
    }

    const farmer = await Farmer.create({
      name: name.trim(),
      phone: phone.trim(),
      nic: nic?.trim() || null,
      ds_area,
      gn_division,
      gn_id: gnData._id,
      acres: numericAcres,
      cultivation_type:
        cultivation_type || 'irrigated'
    })

    res.status(201).json({
      message:
        `Farmer ${farmer.name} registered successfully`,

      id: farmer._id.toString(),
      gn_id: gnData._id.toString()
    })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message:
          'This phone number is already registered'
      })
    }

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: err.message
      })
    }

    res.status(500).json({
      message: err.message
    })
  }
})

// DELETE /api/farmers/:id
router.delete('/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      message: 'Invalid farmer ID'
    })
  }

  try {
    const farmer =
      await Farmer.findByIdAndDelete(req.params.id)

    if (!farmer) {
      return res.status(404).json({
        message: 'Farmer not found'
      })
    }

    res.json({
      message: 'Farmer deleted successfully'
    })
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

module.exports = router