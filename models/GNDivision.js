const mongoose = require('mongoose')

const gnDivisionSchema = new mongoose.Schema(
  {
    legacyId: {
      type: Number,
      unique: true,
      sparse: true
    },

    district: {
      type: String,
      trim: true
    },

    divisional_secretariat: {
      type: String,
      required: true,
      trim: true
    },

    gn_division: {
      type: String,
      required: true,
      trim: true
    },

    soil_ph: {
      type: Number,
      default: 0
    },

    ph_status: {
      type: String,
      default: null
    },

    ec_ds_m: {
      type: Number,
      default: 0
    },

    salinity_status: {
      type: String,
      default: null
    },

    phosphorus_mg_kg: {
      type: Number,
      default: 0
    },

    phosphorus_status: {
      type: String,
      default: null
    },

    potassium_mg_kg: {
      type: Number,
      default: 0
    },

    potassium_status: {
      type: String,
      default: null
    },

    organic_matter_pct: {
      type: Number,
      default: 0
    },

    organic_matter_status: {
      type: String,
      default: null
    },

    irrigated_urea_kg_acre: {
      type: Number,
      default: 0
    },

    irrigated_tsp_kg_acre: {
      type: Number,
      default: 0
    },

    irrigated_mop_kg_acre: {
      type: Number,
      default: 0
    },

    rainfed_urea_kg_acre: {
      type: Number,
      default: 0
    },

    rainfed_tsp_kg_acre: {
      type: Number,
      default: 0
    },

    rainfed_mop_kg_acre: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
)

gnDivisionSchema.index(
  {
    divisional_secretariat: 1,
    gn_division: 1
  },
  {
    unique: true
  }
)

module.exports = mongoose.model(
  'GNDivision',
  gnDivisionSchema
)