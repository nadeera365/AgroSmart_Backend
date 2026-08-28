const express = require('express')
const mongoose = require('mongoose')

const Farmer = require('../models/Farmer')
const CropCycle = require('../models/CropCycle')
const FertilizerStage =
  require('../models/FertilizerStage')

const auth = require('../middleware/auth')

const router = express.Router()

// Convert YYYY-MM-DD into a valid UTC Date
function parseDateOnly(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return null
  }

  const date = new Date(
    `${dateString}T00:00:00.000Z`
  )

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== dateString
  ) {
    return null
  }

  return date
}

// Add days without timezone changes
function addDays(dateString, days) {
  const date = parseDateOnly(dateString)

  date.setUTCDate(
    date.getUTCDate() + days
  )

  return date.toISOString().slice(0, 10)
}

function fmtDate(date) {
  return new Date(date).toLocaleDateString(
    'en-GB',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }
  )
}

// Select the correct Urea distribution pattern
function getUreaSplitRatios(
  totalUreaPerAcre,
  tspPerAcre
) {
  // Ibulpe pattern
  if (totalUreaPerAcre >= 80) {
    return [0, 20, 30, 26, 14]
  }

  // High TSP areas
  if (tspPerAcre >= 14) {
    return [0, 14, 22, 12, 8]
  }

  // Standard GN divisions
  return [0, 8, 22, 18, 8]
}

// Calculate fertilizer schedule
function calculateStages(
  gnData,
  acres,
  plantingDate,
  cultivationType
) {
  const isIrrigated =
    cultivationType === 'irrigated'

  const totalUrea =
    Number(
      isIrrigated
        ? gnData.irrigated_urea_kg_acre
        : gnData.rainfed_urea_kg_acre
    ) || 0

  const totalTSP =
    Number(
      isIrrigated
        ? gnData.irrigated_tsp_kg_acre
        : gnData.rainfed_tsp_kg_acre
    ) || 0

  const totalMOP =
    Number(
      isIrrigated
        ? gnData.irrigated_mop_kg_acre
        : gnData.rainfed_mop_kg_acre
    ) || 0

  console.log(
    `\n📊 Fertilizer calculation for GN: ` +
    `${gnData.gn_division}`
  )

  console.log(
    `   Type: ${cultivationType} | ` +
    `Acres: ${acres}`
  )

  console.log(
    `   Per-acre totals → ` +
    `Urea: ${totalUrea}kg | ` +
    `TSP: ${totalTSP}kg | ` +
    `MOP: ${totalMOP}kg`
  )

  if (
    totalUrea === 0 &&
    totalTSP === 0 &&
    totalMOP === 0
  ) {
    return []
  }

  const ureaRatios = getUreaSplitRatios(
    totalUrea,
    totalTSP
  )

  const ratioTotal = ureaRatios.reduce(
    (sum, value) => sum + value,
    0
  )

  const ureaByStage = ureaRatios.map(
    ratio =>
      ratioTotal > 0
        ? (ratio / ratioTotal) * totalUrea
        : 0
  )

  // TSP: 100% at Basal
  const tspByStage = [
    totalTSP,
    0,
    0,
    0,
    0
  ]

  // MOP: 50% Week 5 and 50% Week 7
  const mopFirstHalf = Number(
    (totalMOP / 2).toFixed(2)
  )

  const mopSecondHalf = Number(
    (totalMOP - mopFirstHalf).toFixed(2)
  )

  const mopByStage = [
    0,
    0,
    mopFirstHalf,
    mopSecondHalf,
    0
  ]

  const stageDefinitions = [
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

  const stages = stageDefinitions.map(
    (stage, index) => {
      const urea = Number(
        (
          ureaByStage[index] * acres
        ).toFixed(2)
      )

      const tsp = Number(
        (
          tspByStage[index] * acres
        ).toFixed(2)
      )

      const mop = Number(
        (
          mopByStage[index] * acres
        ).toFixed(2)
      )

      const total = Number(
        (urea + tsp + mop).toFixed(2)
      )

      const scheduledDate = addDays(
        plantingDate,
        stage.dap
      )

      console.log(
        `   Stage ${stage.index} ` +
        `(DAP ${stage.dap}) ` +
        `${fmtDate(scheduledDate)}: ` +
        `Urea ${urea}kg + ` +
        `TSP ${tsp}kg + ` +
        `MOP ${mop}kg = ${total}kg`
      )

      return {
        stage_index: stage.index,
        stage_name: stage.name,
        stage_icon: stage.icon,
        scheduled_date: scheduledDate,
        days_after: stage.dap,
        urea_kg: urea,
        tsp_kg: tsp,
        mop_kg: mop,
        total_kg: total
      }
    }
  )

  // Do not save empty stages
  return stages.filter(
    stage => stage.total_kg > 0
  )
}

// Keep API response compatible with frontend
function formatStage(stage) {
  const populatedFarmer =
    stage.farmer_id &&
    stage.farmer_id._id

  const farmer = populatedFarmer
    ? stage.farmer_id
    : null

  const farmerId = populatedFarmer
    ? farmer._id
    : stage.farmer_id

  const cycleId =
    stage.cycle_id &&
    stage.cycle_id._id
      ? stage.cycle_id._id
      : stage.cycle_id

  return {
    id: stage._id.toString(),

    cycle_id: cycleId
      ? cycleId.toString()
      : null,

    farmer_id: farmerId
      ? farmerId.toString()
      : null,

    stage_index: stage.stage_index,
    stage_name: stage.stage_name,
    stage_icon: stage.stage_icon,

    scheduled_date: stage.scheduled_date,
    days_after: stage.days_after,

    urea_kg: stage.urea_kg,
    tsp_kg: stage.tsp_kg,
    mop_kg: stage.mop_kg,
    total_kg: stage.total_kg,

    status: stage.status,
    rescheduled: stage.rescheduled,
    original_date: stage.original_date,

    farmer_name:
      farmer?.name,

    farmer_phone:
      farmer?.phone,

    gn_division:
      farmer?.gn_division,

    ds_area:
      farmer?.ds_area,

    created_at:
      stage.createdAt
  }
}

// POST /api/schedule
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

  if (!mongoose.isValidObjectId(farmer_id)) {
    return res.status(400).json({
      message: 'Invalid farmer_id'
    })
  }

  const parsedPlantingDate =
    parseDateOnly(planting_date)

  if (!parsedPlantingDate) {
    return res.status(400).json({
      message:
        'planting_date must be a valid YYYY-MM-DD date'
    })
  }

  try {
    const farmer = await Farmer.findById(
      farmer_id
    ).populate('gn_id')

    if (!farmer) {
      return res.status(404).json({
        message: 'Farmer not found'
      })
    }

    if (!farmer.gn_id) {
      return res.status(400).json({
        message:
          `Farmer "${farmer.name}" has no GN division linked. ` +
          `Please re-register the farmer.`
      })
    }

    const gnData = farmer.gn_id

    const stages = calculateStages(
      gnData,
      Number(farmer.acres),
      planting_date,
      farmer.cultivation_type
    )

    if (stages.length === 0) {
      return res.status(400).json({
        message:
          `No fertilizer recommended for ` +
          `${gnData.gn_division} ` +
          `(${farmer.ds_area}). ` +
          `Soil nutrients are already sufficient in this area.`,

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

    let newCycle
    let savedStages

    // Save cycle and stages atomically
    await mongoose.connection.transaction(
      async session => {
        // Complete previous active cycles
        await CropCycle.updateMany(
          {
            farmer_id: farmer._id,
            status: 'active'
          },
          {
            $set: {
              status: 'completed'
            }
          },
          {
            session
          }
        )

        const createdCycles =
          await CropCycle.create(
            [
              {
                farmer_id: farmer._id,
                planting_date:
                  parsedPlantingDate,
                status: 'active'
              }
            ],
            {
              session
            }
          )

        newCycle = createdCycles[0]

        const stageDocuments = stages.map(
          stage => ({
            cycle_id: newCycle._id,
            farmer_id: farmer._id,

            stage_index:
              stage.stage_index,

            stage_name:
              stage.stage_name,

            stage_icon:
              stage.stage_icon,

            scheduled_date:
              parseDateOnly(
                stage.scheduled_date
              ),

            days_after:
              stage.days_after,

            urea_kg:
              stage.urea_kg,

            tsp_kg:
              stage.tsp_kg,

            mop_kg:
              stage.mop_kg,

            total_kg:
              stage.total_kg,

            status: 'pending',
            rescheduled: false,
            original_date: null
          })
        )

        savedStages =
          await FertilizerStage.insertMany(
            stageDocuments,
            {
              session
            }
          )

        await Farmer.updateOne(
          {
            _id: farmer._id
          },
          {
            $set: {
              active_cycle: true
            }
          },
          {
            session
          }
        )
      }
    )

    const totalUrea = Number(
      stages
        .reduce(
          (sum, stage) =>
            sum + stage.urea_kg,
          0
        )
        .toFixed(2)
    )

    const totalTSP = Number(
      stages
        .reduce(
          (sum, stage) =>
            sum + stage.tsp_kg,
          0
        )
        .toFixed(2)
    )

    const totalMOP = Number(
      stages
        .reduce(
          (sum, stage) =>
            sum + stage.mop_kg,
          0
        )
        .toFixed(2)
    )

    console.log(
      `\n✅ Schedule created: ` +
      `cycle_id=${newCycle._id}, ` +
      `${savedStages.length} stages`
    )

    res.status(201).json({
      message:
        'Schedule created successfully',

      cycle_id:
        newCycle._id.toString(),

      farmer_name:
        farmer.name,

      planting_date,

      cultivation_type:
        farmer.cultivation_type,

      gn_division:
        gnData.gn_division,

      stages_count:
        savedStages.length,

      season_totals: {
        urea_kg: totalUrea,
        tsp_kg: totalTSP,
        mop_kg: totalMOP
      },

      stages: savedStages.map(
        formatStage
      ),

      soil_warning:
        gnData.phosphorus_status === 'High' ||
        gnData.potassium_status === 'High'
          ? `High nutrient levels detected in ` +
            `${gnData.gn_division}. ` +
            `Monitor crop response.`
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

// GET /api/schedule/farmer/:id
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
      const stages =
        await FertilizerStage.find({
          farmer_id: req.params.id
        })
          .sort({ scheduled_date: 1 })
          .lean()

      res.json(
        stages.map(formatStage)
      )
    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

// GET /api/schedule/debug/:farmer_id
router.get(
  '/debug/:farmer_id',
  auth,
  async (req, res) => {
    const { farmer_id } = req.params

    if (!mongoose.isValidObjectId(farmer_id)) {
      return res.status(400).json({
        message: 'Invalid farmer ID'
      })
    }

    try {
      const farmer = await Farmer.findById(
        farmer_id
      ).populate('gn_id')

      if (!farmer) {
        return res.status(404).json({
          message: 'Farmer not found'
        })
      }

      const gn = farmer.gn_id || null

      const stages =
        await FertilizerStage.find({
          farmer_id: farmer._id
        })
          .sort({ scheduled_date: 1 })
          .lean()

      const isIrrigated =
        farmer.cultivation_type ===
        'irrigated'

      const ureaPerAcre = gn
        ? Number(
            isIrrigated
              ? gn.irrigated_urea_kg_acre
              : gn.rainfed_urea_kg_acre
          ) || 0
        : 0

      const tspPerAcre = gn
        ? Number(
            isIrrigated
              ? gn.irrigated_tsp_kg_acre
              : gn.rainfed_tsp_kg_acre
          ) || 0
        : 0

      const mopPerAcre = gn
        ? Number(
            isIrrigated
              ? gn.irrigated_mop_kg_acre
              : gn.rainfed_mop_kg_acre
          ) || 0
        : 0

      res.json({
        farmer: {
          id: farmer._id.toString(),
          name: farmer.name,
          acres: farmer.acres,

          cultivation_type:
            farmer.cultivation_type,

          gn_id: gn
            ? gn._id.toString()
            : null,

          gn_division:
            farmer.gn_division,

          ds_area:
            farmer.ds_area,

          gn_id_status: gn
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
          : 'NO SOIL DATA',

        what_will_be_used: gn
          ? {
              type:
                farmer.cultivation_type,

              urea_per_acre:
                ureaPerAcre,

              tsp_per_acre:
                tspPerAcre,

              mop_per_acre:
                mopPerAcre,

              for_acres:
                farmer.acres,

              total_urea:
                (
                  ureaPerAcre *
                  farmer.acres
                ).toFixed(2) + ' kg',

              total_tsp:
                (
                  tspPerAcre *
                  farmer.acres
                ).toFixed(2) + ' kg',

              total_mop:
                (
                  mopPerAcre *
                  farmer.acres
                ).toFixed(2) + ' kg'
            }
          : null,

        stages_in_db:
          stages.map(formatStage)
      })
    } catch (err) {
      res.status(500).json({
        message: err.message
      })
    }
  }
)

// GET /api/schedule
router.get('/', auth, async (req, res) => {
  try {
    const stages =
      await FertilizerStage.find()
        .populate(
          'farmer_id',
          'name phone gn_division ds_area'
        )
        .sort({
          farmer_id: 1,
          scheduled_date: 1
        })
        .limit(500)
        .lean()

    res.json(
      stages.map(formatStage)
    )
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// PATCH /api/schedule/:id
router.patch('/:id', auth, async (req, res) => {
  const { status } = req.body

  const allowed = [
    'pending',
    'applied',
    'rescheduled'
  ]

  if (!allowed.includes(status)) {
    return res.status(400).json({
      message:
        `status must be one of: ` +
        `${allowed.join(', ')}`
    })
  }

  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      message: 'Invalid stage ID'
    })
  }

  try {
    const stage =
      await FertilizerStage.findByIdAndUpdate(
        req.params.id,
        {
          $set: {
            status,

            rescheduled:
              status === 'rescheduled'
          }
        },
        {
          new: true,
          runValidators: true
        }
      )

    if (!stage) {
      return res.status(404).json({
        message: 'Stage not found'
      })
    }

    res.json({
      message: 'Stage status updated',
      status: stage.status
    })
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

// DELETE /api/schedule/:id
router.delete('/:id', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      message: 'Invalid stage ID'
    })
  }

  try {
    const stage =
      await FertilizerStage.findByIdAndDelete(
        req.params.id
      )

    if (!stage) {
      return res.status(404).json({
        message: 'Stage not found'
      })
    }

    res.json({
      message: 'Stage deleted successfully'
    })
  } catch (err) {
    res.status(500).json({
      message: err.message
    })
  }
})

module.exports = router