const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const User = require('../models/User')

const router = express.Router()

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, phone, password } = req.body

  if (!name || !phone || !password) {
    return res.status(400).json({
      message: 'Name, phone and password are required'
    })
  }

  try {
    const existingUser = await User.findOne({
      phone: phone.trim()
    })

    if (existingUser) {
      return res.status(400).json({
        message: 'Phone number already registered'
      })
    }

    const hashedPassword = await bcrypt.hash(
      password,
      10
    )

    const user = await User.create({
      name: name.trim(),
      phone: phone.trim(),
      password: hashedPassword
    })

    res.status(201).json({
      message: 'Admin user created successfully',
      id: user._id.toString()
    })
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({
        message: 'Phone number already registered'
      })
    }

    res.status(500).json({
      message: 'Server error: ' + err.message
    })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { phone, password } = req.body

  if (!phone || !password) {
    return res.status(400).json({
      message: 'Phone and password are required'
    })
  }

  try {
    const user = await User.findOne({
      phone: phone.trim()
    })

    if (!user) {
      return res.status(401).json({
        message: 'Invalid phone or password'
      })
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    )

    if (!passwordMatch) {
      return res.status(401).json({
        message: 'Invalid phone or password'
      })
    }

    const token = jwt.sign(
      {
        id: user._id.toString(),
        name: user.name
      },
      process.env.JWT_SECRET,
      {
        expiresIn: '7d'
      }
    )

    res.json({
      token,

      user: {
        id: user._id.toString(),
        name: user.name,
        phone: user.phone
      }
    })
  } catch (err) {
    res.status(500).json({
      message: 'Server error: ' + err.message
    })
  }
})

module.exports = router