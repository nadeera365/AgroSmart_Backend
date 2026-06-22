const jwt = require('jsonwebtoken')

function authMiddleware(req,res,next){

    const authHeader = req.headers['authorization']

    if(!authHeader){
        return res.status(401).json({message: 'Access denied. No token provided.'})
    }

    const token = authHeader.split(' ')[1]

    if(!token){
        return res.status(401).json({ message: 'Access denied. Token malformed.' })
    }

    try{
        const decoded = jwt.verify(token,process.env.JWT_SECRET)

        req.user = decoded
        next()
    } catch(err){
        res.status(401).json({ message: 'Invalid or expired token. Please login again.' })
    }

}

module.exports = authMiddleware