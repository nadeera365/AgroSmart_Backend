const express = require('express')
const db = require('../db')
const auth = require('../middleware/auth')

const router = express.Router()

function addDays(dateStr, days) {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

// Format a date nicely for logging
function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function getUreaSplitRatios(totalUreaPerAcre, tspPerAcre) {
  // Ibulpe DS pattern — total urea is 90 kg/acre
  if (totalUreaPerAcre >= 80) {
    return [0, 20, 30, 26, 14] // sums to 90
  }

  // High TSP areas (TSP >= 14 kg/acre) → use ratio B
  if (tspPerAcre >= 14) {
    return [0, 14, 22, 12, 8] // sums to 56
  }

  // Standard (most GN divisions) → ratio A
  return [0, 8, 22, 18, 8] // sums to 56
}

function calculateStages(
  gnData,
  acres,
  plantingDate,
  cultivationType
) {
  const isIrrigated =
    cultivationType === 'irrigated'

  // ── Read totals from DB (per acre) ──
  const totalUrea = parseFloat(
    isIrrigated
      ? gnData.irrigated_urea_kg_acre
      : gnData.rainfed_urea_kg_acre
  ) || 0

  const totalTSP = parseFloat(
    isIrrigated
      ? gnData.irrigated_tsp_kg_acre
      : gnData.rainfed_tsp_kg_acre
  ) || 0

  const totalMOP = parseFloat(
    isIrrigated
      ? gnData.irrigated_mop_kg_acre
      : gnData.rainfed_mop_kg_acre
  ) || 0

  console.log(
    `\n📊 Fertilizer calculation for GN: ${gnData.gn_division}`
  )

  console.log(
    `   Type: ${cultivationType} | Acres: ${acres}`
  )

  console.log(
    `   Per-acre totals → Urea: ${totalUrea}kg | ` +
    `TSP: ${totalTSP}kg | MOP: ${totalMOP}kg`
  )

  // ── If this GN has 0 fertilizer recommended ──
  if (
    totalUrea === 0 &&
    totalTSP === 0 &&
    totalMOP === 0
  ) {
    console.log(
      '   ⚠️ No fertilizer recommended for this GN division'
    )

    return []
  }

  // ── Urea split ratios ──
  const ureaRatios = getUreaSplitRatios(
    totalUrea,
    totalTSP
  )

  const ureaRatioSum =
    ureaRatios.reduce(
      (a, b) => a + b,
      0
    )

  // ── Distribute Urea proportionally across stages ──
  const ureaPerAcreByStage =
    ureaRatios.map(r =>
      ureaRatioSum > 0
        ? (r / ureaRatioSum) * totalUrea
        : 0
    )

  // ── TSP: 100% at Basal ──
  const tspPerAcreByStage = [
    totalTSP,
    0,
    0,
    0,
    0
  ]

  // ── MOP: split 50/50 between stage 2 and stage 3 ──
  const mopHalfA = parseFloat(
    (totalMOP / 2).toFixed(2)
  )

  const mopHalfB = parseFloat(
    (totalMOP - mopHalfA).toFixed(2)
  )

  const mopPerAcreByStage = [
    0,
    0,
    mopHalfA,
    mopHalfB,
    0
  ]

  // ── Stage definitions ──
  // icon values are mapped to react-icons in frontend
  const STAGES = [
    {
      index: 0,
      name: 'Basal Application',
      icon: 'seedling',
      dap: 0
    },
    {
      index: 1,
      name: 'Top Dress 1 — Week 3',
      icon: 'water',
      dap: 21
    },
    {
      index: 2,
      name: 'Top Dress 2 — Week 5',
      icon: 'wheat',
      dap: 35
    },
    {
      index: 3,
      name: 'Top Dress 3 — Week 7',
      icon: 'bolt',
      dap: 49
    },
    {
      index: 4,
      name: 'Top Dress 4 — Week 8',
      icon: 'leaf',
      dap: 56
    }
  ]

  const stages = STAGES.map((s, i) => {

    // Multiply per-acre values by actual acres
    const urea = parseFloat(
      (
        ureaPerAcreByStage[i] *
        acres
      ).toFixed(2)
    )

    const tsp = parseFloat(
      (
        tspPerAcreByStage[i] *
        acres
      ).toFixed(2)
    )

    const mop = parseFloat(
      (
        mopPerAcreByStage[i] *
        acres
      ).toFixed(2)
    )

    const total = parseFloat(
      (
        urea +
        tsp +
        mop
      ).toFixed(2)
    )

    // Original DAP date — no rain checking
    const scheduledDate = addDays(
      plantingDate,
      s.dap
    )

    console.log(
      `   Stage ${s.index} ` +
      `(DAP ${s.dap}) ` +
      `${fmtDate(scheduledDate)}: ` +
      `Urea ${urea}kg + ` +
      `TSP ${tsp}kg + ` +
      `MOP ${mop}kg = ` +
      `${total}kg`
    )

    return {
      stage_index: s.index,
      stage_name: s.name,
      stage_icon: s.icon,
      date: scheduledDate,
      days_after: s.dap,
      urea_kg: urea,
      tsp_kg: tsp,
      mop_kg: mop,
      total_kg: total
    }
  })

  // Remove stages with nothing to apply
  return stages.filter(
    s => s.total_kg > 0
  )
}


// ══════════════════════════════════════════════════════════════
// POST /api/schedule
// Create a new crop cycle + stages
// ══════════════════════════════════════════════════════════════

router.post('/', auth, async (req, res) => {

  const {
    farmer_id,
    planting_date
  } = req.body

  if (!farmer_id || !planting_date) {
    return res.status(400).json({
      message:
        'farmer_id and planting_date are required'
    })
  }

  // Validate date format
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      planting_date
    )
  ) {
    return res.status(400).json({
      message:
        'planting_date must be YYYY-MM-DD format'
    })
  }

  try {

    // ── 1. Get farmer ──
    const [farmers] =
      await db.query(
        'SELECT * FROM farmers WHERE id = ?',
        [farmer_id]
      )

    if (farmers.length === 0) {
      return res.status(404).json({
        message: 'Farmer not found'
      })
    }

    const farmer = farmers[0]


    // ── 2. Check farmer has GN division ──
    if (!farmer.gn_id) {
      return res.status(400).json({
        message:
          `Farmer "${farmer.name}" has no GN division linked. ` +
          `The GN division "${farmer.gn_division}" in ${farmer.ds_area} ` +
          `may not match the database. Please re-register the farmer.`
      })
    }


    // ── 3. Get soil/fertilizer data ──
    const [gnRows] =
      await db.query(
        'SELECT * FROM gn_divisions WHERE id = ?',
        [farmer.gn_id]
      )

    if (gnRows.length === 0) {
      return res.status(404).json({
        message:
          `Soil data not found for GN ID ${farmer.gn_id}. ` +
          `Check your database import.`
      })
    }

    const gnData = gnRows[0]


    // ── 4. Calculate fertilizer stages ──
    const stages = calculateStages(
      gnData,
      parseFloat(farmer.acres),
      planting_date,
      farmer.cultivation_type
    )

    if (stages.length === 0) {
      return res.status(400).json({

        message:
          `No fertilizer recommended for ${gnData.gn_division} ` +
          `(${farmer.ds_area}). Soil nutrients are already sufficient in this area.`,

        soil_data: {
          gn_division:
            gnData.gn_division,

          soil_ph:
            gnData.soil_ph,

          ph_status:
            gnData.ph_status
        }
      })
    }


    // ── 5. Check existing active cycle ──
    const [existingCycles] =
      await db.query(
        `SELECT id
         FROM crop_cycles
         WHERE farmer_id = ?
         AND status = 'active'`,
        [farmer_id]
      )

    if (existingCycles.length > 0) {

      // Mark old cycle as completed
      await db.query(
        `UPDATE crop_cycles
         SET status = 'completed'
         WHERE farmer_id = ?
         AND status = 'active'`,
        [farmer_id]
      )

      console.log(
        `ℹ️ Previous active cycle for farmer ${farmer_id} marked as completed`
      )
    }


    // ── 6. Save crop cycle ──
    const [cycleResult] =
      await db.query(
        `INSERT INTO crop_cycles
         (farmer_id, planting_date)
         VALUES (?, ?)`,
        [
          farmer_id,
          planting_date
        ]
      )

    const cycle_id =
      cycleResult.insertId


    // ── 7. Save fertilizer stages ──
    for (const stage of stages) {

      await db.query(
        `INSERT INTO fertilizer_stages
         (
           cycle_id,
           farmer_id,
           stage_index,
           stage_name,
           stage_icon,
           scheduled_date,
           days_after,
           urea_kg,
           tsp_kg,
           mop_kg,
           total_kg
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          stage.total_kg
        ]
      )
    }


    // ── 8. Mark farmer as active ──
    await db.query(
      `UPDATE farmers
       SET active_cycle = TRUE
       WHERE id = ?`,
      [farmer_id]
    )


    // ── 9. Build summary totals ──
    const totalUrea =
      stages
        .reduce(
          (s, x) =>
            s + x.urea_kg,
          0
        )
        .toFixed(2)

    const totalTSP =
      stages
        .reduce(
          (s, x) =>
            s + x.tsp_kg,
          0
        )
        .toFixed(2)

    const totalMOP =
      stages
        .reduce(
          (s, x) =>
            s + x.mop_kg,
          0
        )
        .toFixed(2)


    console.log(
      `\n✅ Schedule created: ` +
      `cycle_id=${cycle_id}, ` +
      `${stages.length} stages`
    )

    console.log(
      `   Season totals → ` +
      `Urea: ${totalUrea}kg | ` +
      `TSP: ${totalTSP}kg | ` +
      `MOP: ${totalMOP}kg`
    )


    // ── 10. Response ──
    res.status(201).json({

      message:
        'Schedule created successfully',

      cycle_id,

      farmer_name:
        farmer.name,

      planting_date,

      cultivation_type:
        farmer.cultivation_type,

      gn_division:
        gnData.gn_division,

      stages_count:
        stages.length,

      season_totals: {
        urea_kg:
          parseFloat(totalUrea),

        tsp_kg:
          parseFloat(totalTSP),

        mop_kg:
          parseFloat(totalMOP)
      },

      stages:
        stages.map(s => ({
          ...s,
          scheduled_date: s.date
        })),

      soil_warning:
        (
          gnData.phosphorus_status === 'High' ||
          gnData.potassium_status === 'High'
        )
          ? `High nutrient levels detected in ${gnData.gn_division}. Monitor crop response.`
          : null
    })

  } catch (err) {

    console.error(
      '❌ Schedule creation error:',
      err
    )

    res.status(500).json({
      message: err.message
    })
  }
})


// ══════════════════════════════════════════════════════════════
// GET /api/schedule/farmer/:id
// All stages for one farmer
// ══════════════════════════════════════════════════════════════

router.get(
  '/farmer/:id',
  auth,
  async (req, res) => {

    try {

      const [rows] =
        await db.query(
          `SELECT *
           FROM fertilizer_stages
           WHERE farmer_id = ?
           ORDER BY scheduled_date ASC`,
          [req.params.id]
        )

      res.json(rows)

    } catch (err) {

      res.status(500).json({
        message: err.message
      })
    }
  }
)


// ══════════════════════════════════════════════════════════════
// GET /api/schedule
// All stages
// ══════════════════════════════════════════════════════════════

router.get(
  '/',
  auth,
  async (req, res) => {

    try {

      const [rows] =
        await db.query(
          `SELECT
             fs.*,
             f.name AS farmer_name,
             f.phone AS farmer_phone,
             f.gn_division,
             f.ds_area
           FROM fertilizer_stages fs
           JOIN farmers f
             ON fs.farmer_id = f.id
           ORDER BY
             fs.farmer_id ASC,
             fs.scheduled_date ASC
           LIMIT 500`
        )

      res.json(rows)

    } catch (err) {

      res.status(500).json({
        message: err.message
      })
    }
  }
)


// ══════════════════════════════════════════════════════════════
// PATCH /api/schedule/:id
// Update stage status
// ══════════════════════════════════════════════════════════════

router.patch(
  '/:id',
  auth,
  async (req, res) => {

    const { status } = req.body

    const allowed = [
      'pending',
      'applied',
      'rescheduled'
    ]

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message:
          `status must be one of: ${allowed.join(', ')}`
      })
    }

    try {

      await db.query(
        `UPDATE fertilizer_stages
         SET status = ?
         WHERE id = ?`,
        [
          status,
          req.params.id
        ]
      )

      res.json({
        message:
          'Stage status updated',

        status
      })

    } catch (err) {

      res.status(500).json({
        message: err.message
      })
    }
  }
)


// ══════════════════════════════════════════════════════════════
// DELETE /api/schedule/:id
// Delete one stage
// ══════════════════════════════════════════════════════════════

router.delete(
  '/:id',
  auth,
  async (req, res) => {

    try {

      const [result] =
        await db.query(
          `DELETE FROM fertilizer_stages
           WHERE id = ?`,
          [req.params.id]
        )

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message:
            'Stage not found'
        })
      }

      res.json({
        message:
          'Stage deleted successfully'
      })

    } catch (err) {

      res.status(500).json({
        message: err.message
      })
    }
  }
)


// ══════════════════════════════════════════════════════════════
// GET /api/schedule/debug/:farmer_id
// Verify calculations
// ══════════════════════════════════════════════════════════════

router.get(
  '/debug/:farmer_id',
  auth,
  async (req, res) => {

    try {

      const [farmers] =
        await db.query(
          'SELECT * FROM farmers WHERE id = ?',
          [req.params.farmer_id]
        )

      if (farmers.length === 0) {
        return res.status(404).json({
          message:
            'Farmer not found'
        })
      }

      const farmer =
        farmers[0]


      const [gnRows] =
        farmer.gn_id
          ? await db.query(
              `SELECT *
               FROM gn_divisions
               WHERE id = ?`,
              [farmer.gn_id]
            )
          : [[]]

      const gn =
        gnRows?.[0] || null


      const [stages] =
        await db.query(
          `SELECT *
           FROM fertilizer_stages
           WHERE farmer_id = ?
           ORDER BY scheduled_date ASC`,
          [req.params.farmer_id]
        )


      const isIrrigated =
        farmer.cultivation_type ===
        'irrigated'


      res.json({

        farmer: {

          id:
            farmer.id,

          name:
            farmer.name,

          acres:
            farmer.acres,

          cultivation_type:
            farmer.cultivation_type,

          gn_id:
            farmer.gn_id,

          gn_division:
            farmer.gn_division,

          ds_area:
            farmer.ds_area,

          gn_id_status:
            farmer.gn_id
              ? 'linked'
              : 'NULL — schedule will fail'
        },


        soil_data: gn
          ? {

              gn_division:
                gn.gn_division,

              divisional_secretariat:
                gn.divisional_secretariat,

              soil_ph:
                gn.soil_ph,

              ph_status:
                gn.ph_status,

              phosphorus_status:
                gn.phosphorus_status,

              potassium_status:
                gn.potassium_status,

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
          : 'NO SOIL DATA — gn_id is null or not in gn_divisions table',


        what_will_be_used: gn
          ? {

              type:
                farmer.cultivation_type,

              urea_per_acre:
                isIrrigated
                  ? gn.irrigated_urea_kg_acre
                  : gn.rainfed_urea_kg_acre,

              tsp_per_acre:
                isIrrigated
                  ? gn.irrigated_tsp_kg_acre
                  : gn.rainfed_tsp_kg_acre,

              mop_per_acre:
                isIrrigated
                  ? gn.irrigated_mop_kg_acre
                  : gn.rainfed_mop_kg_acre,

              for_acres:
                farmer.acres,

              total_urea:
                (
                  (
                    isIrrigated
                      ? gn.irrigated_urea_kg_acre
                      : gn.rainfed_urea_kg_acre
                  ) *
                  farmer.acres
                ).toFixed(2) + ' kg',

              total_tsp:
                (
                  (
                    isIrrigated
                      ? gn.irrigated_tsp_kg_acre
                      : gn.rainfed_tsp_kg_acre
                  ) *
                  farmer.acres
                ).toFixed(2) + ' kg',

              total_mop:
                (
                  (
                    isIrrigated
                      ? gn.irrigated_mop_kg_acre
                      : gn.rainfed_mop_kg_acre
                  ) *
                  farmer.acres
                ).toFixed(2) + ' kg'

            }
          : null,


        stages_in_db:
          stages
      })

    } catch (err) {

      res.status(500).json({
        message: err.message
      })
    }
  }
)


module.exports = router