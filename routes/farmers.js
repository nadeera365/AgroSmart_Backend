const express = require('express')
const router  = express.Router()
const db      = require('../db')
const auth    = require('../middleware/auth')

router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        f.id,
        f.name,
        f.phone,
        f.nic,
        f.ds_area,
        f.gn_division,
        f.acres,
        f.cultivation_type,
        f.active_cycle,
        f.created_at,
        g.soil_ph,
        g.ph_status,
        g.ec_ds_m,
        g.salinity_status,
        g.phosphorus_mg_kg,
        g.phosphorus_status,
        g.potassium_mg_kg,
        g.potassium_status,
        g.organic_matter_pct,
        g.organic_matter_status,
        g.irrigated_urea_kg_acre,
        g.irrigated_tsp_kg_acre,
        g.irrigated_mop_kg_acre,
        g.rainfed_urea_kg_acre,
        g.rainfed_tsp_kg_acre,
        g.rainfed_mop_kg_acre
      FROM farmers f
      LEFT JOIN gn_divisions g ON f.gn_id = g.id
      ORDER BY f.created_at DESC
    `)
   
    res.json(rows)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        f.*,
        g.soil_ph, g.ph_status,
        g.ec_ds_m, g.salinity_status,
        g.phosphorus_mg_kg, g.phosphorus_status,
        g.potassium_mg_kg, g.potassium_status,
        g.organic_matter_pct, g.organic_matter_status,
        g.irrigated_urea_kg_acre, g.irrigated_tsp_kg_acre, g.irrigated_mop_kg_acre,
        g.rainfed_urea_kg_acre, g.rainfed_tsp_kg_acre, g.rainfed_mop_kg_acre
      FROM farmers f
      LEFT JOIN gn_divisions g ON f.gn_id = g.id
      WHERE f.id = ?
    `, [req.params.id])

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Farmer not found' })
    }

    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.post('/', auth, async (req, res) => {
  const { name, phone, nic, ds_area, gn_division, acres, cultivation_type } = req.body

  // Validate required fields
  if (!name || !phone || !ds_area || !gn_division || !acres) {
    return res.status(400).json({
      message: 'Name, phone, DS area, GN division and acres are required'
    })
  }

  try {
    // Find the gn_id by matching ds_area + gn_division
    // This links the farmer to your CSV data row
    const [gnRows] = await db.query(
      `SELECT id FROM gn_divisions
       WHERE divisional_secretariat = ?
       AND gn_division = ?
       LIMIT 1`,
      [ds_area, gn_division]
    )

    // gn_id links farmer to your CSV soil data
    const gn_id = gnRows.length > 0 ? gnRows[0].id : null

    // Insert farmer into database
    const [result] = await db.query(
      `INSERT INTO farmers
         (name, phone, nic, ds_area, gn_division, gn_id, acres, cultivation_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone, nic || null, ds_area, gn_division, gn_id, acres, cultivation_type || 'irrigated']
    )

    res.status(201).json({
      message: `Farmer ${name} registered successfully`,
      id: result.insertId,
      gn_id
    })

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'This phone number is already registered' })
    }
    res.status(500).json({ message: err.message })
  }
})

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM farmers WHERE id = ?', [req.params.id])
    res.json({ message: 'Farmer deleted successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router