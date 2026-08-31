const express = require('express')
const cors = require('cors')
require('dotenv').config()

const connectMongoDB = require('./mongoDb')

const app = express()


app.use(cors({ origin: 'http://localhost:5174' }))


app.use(express.json())


app.use('/api/auth',     require('./routes/auth'))
app.use('/api/farmers',  require('./routes/farmers'))
app.use('/api/schedule', require('./routes/schedule'))
app.use('/api/sms',      require('./routes/sms'))
app.use('/api/weather',  require('./routes/weather'))
app.use('/api/gn',       require('./routes/gn'))


app.get('/', (req, res) => {
  res.json({ message: '🌾 AgroSmart API is running', status: 'ok' })
})


const PORT = process.env.PORT || 5000

async function startServer() {
  await connectMongoDB()

  app.listen(PORT, () => {
    console.log(`🌾 AgroSmart Backend running on port ${PORT}`)
  })
}

startServer()