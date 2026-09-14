import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import apiRouter from './routes/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uiPath = path.resolve(__dirname, '../../ui')
const dataDir = path.resolve(__dirname, '../../data')

const app = express()
const PORT = process.env.PORT || 3737

app.use(cors())
app.use(express.json({ limit: '5mb' }))

// health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '0.1.0', ts: new Date().toISOString() })
})

// API root
app.get('/api', (req, res) => {
  res.json({
    message: 'Finans API',
    endpoints: [
      'GET    /api/health',
      'GET    /api/summary/net-worth',
      'GET    /api/summary/today',
      'CRUD   /api/accounts',
      'CRUD   /api/transactions',
      'CRUD   /api/categories',
      'CRUD   /api/deposits',
      'CRUD   /api/holdings',
      'CRUD   /api/loans',
      'CRUD   /api/subscriptions',
      'CRUD   /api/obligations',
      'POST   /api/holdings/import/tinvest',
      'POST   /api/holdings/import/bcs',
      'CRUD   /api/broker-credentials'
    ]
  })
})

// API routes
app.use('/api', apiRouter)

// static UI
if (fs.existsSync(uiPath)) {
  app.use(express.static(uiPath))
  // SPA fallback
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    const indexPath = path.join(uiPath, 'index.html')
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath)
    }
    next()
  })
} else {
  console.warn(`UI directory not found at ${uiPath}`)
}

const server = app.listen(PORT, () => {
  console.log(`Finans backend listening on http://localhost:${PORT}`)
  console.log(`Data dir: ${dataDir}`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✗ Port ${PORT} is already in use. Set another: PORT=3738 npm start`)
    process.exit(1)
  }
  throw err
})
