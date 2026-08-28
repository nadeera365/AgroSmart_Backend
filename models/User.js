const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true
    },

    phone: {
      type: String,
      required: [true, 'Phone is required'],
      unique: true,
      trim: true
    },

    password: {
      type: String,
      required: [true, 'Password is required']
    }
  },
  {
    timestamps: true
  }
)

module.exports = mongoose.model('User', userSchema)