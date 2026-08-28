const mongoose = require('mongoose')

const farmerSchema = new mongoose.Schema(
  {
    legacyId: {
      type: Number,
      unique: true,
      sparse: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    nic: {
      type: String,
      default: null,
      trim: true
    },

    ds_area: {
      type: String,
      required: true,
      trim: true
    },

    gn_division: {
      type: String,
      required: true,
      trim: true
    },

    gn_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GNDivision',
      required: true
    },

    acres: {
      type: Number,
      required: true,
      min: 0.01
    },

    cultivation_type: {
      type: String,
      enum: ['irrigated', 'rainfed'],
      default: 'irrigated'
    },

    active_cycle: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
)

module.exports = mongoose.model(
  'Farmer',
  farmerSchema
)