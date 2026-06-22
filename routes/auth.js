const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const db = require('../db')

router.post('/register', async(req,res)=>{

    const{ name,phone,passowrd} = req.body
    if(!name|| !phone || !password){
        return res.status(400).json({message:'Name, phone and password are required'})
    }

    try{
        const hashedPassword = await bcrypt.hash(password,10)
        const[result]= await db.query(
            'INSERT INTO users(name,phone,password)VALUES(?,?,?)',
            [name,phone,password]
        )

        res.status(201).json({
            message: 'Admin user created successfully',
            id: result.insertId
        })
    } catch(err){
        if(err.code ==='ER_DUP_ENTRY'){
            return res.status(400).json({message:'Phone number already registered'})
        }
        res.status(500).json({message:'Server error:' + err.message})
    }
})

router.post('/login', async(req,res)=>{

    const {phone,password} = req.body

    if(!phone || !password){
        return res.status(400).json({message:'Phone and password are required'})
    }

    try{
        const [rows] = await db.query(
            'SELECT * FROM users WHERE phone = ?',[phone]
        )
        if(rows.length ===0){
            return res.status(401).json({message: 'Invalid phone or password'})
        }

        const user = rows[0]

        const passwordMatch = await bcrypt.compare(password,user.password)

        if(!passwordMatch){
            return res.status(401).json({message:'Invalid phone or password'})

        }

        //create jwt token

        const token = jwt.sign(
            {id:user.id, name:user.name},
            process.env.JWT_SECRET,
            {expiresIn: '7d'}
        )

        res.json({
            token,
            user:{
                id: user.id,
                name: user.name,
                phone: user.phone
            }
        })
    }catch(err){
        res.status(500).json({message:'Server error: '+ err.message})
    }
})

module.exports = router