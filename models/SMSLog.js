const mongoose = require('mongoose')

const smsLogSchema = new mongoose.Schema(
  {
    legacyId: {
      type: Number,
      unique: true,
      sparse: true
    },

    farmer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farmer',
      default: null,
      index: true
    },

    stage_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FertilizerStage',
      default: null,
      index: true
    },

    phone: {
      type: String,
      required: true,
      trim: true
    },

    message: {
      type: String,
      required: true,
      trim: true
    },

    status: {
      type: String,
      enum: [
        'sent',
        'reminder_sent',
        'failed'
      ],
      required: true
    },

    sms_type: {
      type: String,
      enum: [
        'manual',
        'reminder'
      ],
      default: 'manual'
    },

    sent_at: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
)

smsLogSchema.index({
  farmer_id: 1,
  sent_at: -1
})

smsLogSchema.index({
  stage_id: 1,
  status: 1
})

module.exports = mongoose.model(
  'SMSLog',
  smsLogSchema
)