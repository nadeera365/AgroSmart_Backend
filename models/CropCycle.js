const mongoose = require('mongoose')

const cropCycleSchema = new mongoose.Schema(
  {
    legacyId: {
      type: Number,
      unique: true,
      sparse: true
    },

    farmer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farmer',
      required: true,
      index: true
    },

    planting_date: {
      type: Date,
      required: true
    },

    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active'
    }
  },
  {
    timestamps: true
  }
)

cropCycleSchema.index({
  farmer_id: 1,
  status: 1
})

module.exports = mongoose.model(
  'CropCycle',
  cropCycleSchema
)