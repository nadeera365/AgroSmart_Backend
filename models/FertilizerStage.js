const mongoose = require('mongoose')

const fertilizerStageSchema =
  new mongoose.Schema(
    {
      legacyId: {
        type: Number,
        unique: true,
        sparse: true
      },

      cycle_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CropCycle',
        required: true,
        index: true
      },

      farmer_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Farmer',
        required: true,
        index: true
      },

      stage_index: {
        type: Number,
        required: true,
        min: 0
      },

      stage_name: {
        type: String,
        required: true,
        trim: true
      },

      stage_icon: {
        type: String,
        default: null
      },

      scheduled_date: {
        type: Date,
        required: true,
        index: true
      },

      days_after: {
        type: Number,
        required: true,
        min: 0
      },

      urea_kg: {
        type: Number,
        default: 0,
        min: 0
      },

      tsp_kg: {
        type: Number,
        default: 0,
        min: 0
      },

      mop_kg: {
        type: Number,
        default: 0,
        min: 0
      },

      total_kg: {
        type: Number,
        default: 0,
        min: 0
      },

      status: {
        type: String,
        enum: [
          'pending',
          'applied',
          'rescheduled'
        ],
        default: 'pending'
      },

      rescheduled: {
        type: Boolean,
        default: false
      },

      original_date: {
        type: Date,
        default: null
      }
    },
    {
      timestamps: true
    }
  )

fertilizerStageSchema.index({
  farmer_id: 1,
  scheduled_date: 1
})

fertilizerStageSchema.index({
  cycle_id: 1,
  stage_index: 1
})

module.exports = mongoose.model(
  'FertilizerStage',
  fertilizerStageSchema
)