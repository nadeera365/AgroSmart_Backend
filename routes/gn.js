const express = require('express')
const router = express.Router()
const db = require('../db')
const auth = require ('../middleware/auth')

//returns list of all 17 DS area names
router.get('/ds-areas',auth,async(req,res)=>{
    try{
        const [rows] = await db.query(
            `SELECT DISTINCT divisional_secretariat
            FROM gn_divisions
            ORDER BY divisional_secretariat`
        )
        res.json(rows.map(r=> r.divisional_secretariat))
    } catch(err){
        res.status(500).json({message: err.message})
    }
})

router.get('/by-ds/:ds',auth,async (req,res)=>{
    try{
        const [rows] = await db.query(
           `SELECT id, gn_division
            FROM gn_divisions
            WHERE divisional_secretariat = ?
            ORDER BY gn_division`,
            [req.params.ds] 
        )
        res.json(rows)
    }catch(err){
        res.status(500).json({message: err.message})
    }
})

router.get('/data', auth, async (req, res) => {
  const { ds, gn } = req.query
  

  if (!ds || !gn) {
    return res.status(400).json({
      message: 'Both ds (divisional secretariat) and gn (GN division) are required'
    })
  }

  try {
    const [rows] = await db.query(
      `SELECT * FROM gn_divisions
       WHERE divisional_secretariat = ?
       AND gn_division = ?
       LIMIT 1`,
      [ds, gn]
    )

    if (rows.length === 0) {
      return res.status(404).json({
        message: `No data found for GN: ${gn} in DS: ${ds}`
      })
    }

    const data = rows[0]

   
    const noFertilizerNeeded =
      parseFloat(data.irrigated_urea_kg_acre) === 0 &&
      parseFloat(data.irrigated_tsp_kg_acre)  === 0 &&
      parseFloat(data.irrigated_mop_kg_acre)  === 0

    res.json({
      ...data,  
      no_fertilizer_needed: noFertilizerNeeded,
      warning: noFertilizerNeeded
        ? 'Soil nutrients are already high in this area. Minimal chemical fertilizer recommended.'
        : null
    })

  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

module.exports = router