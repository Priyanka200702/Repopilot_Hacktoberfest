const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
require('dotenv').config({ override: true });

const analyzeRoutes = require('./routes/analyze');
const chatRoutes = require('./routes/chat');
const webhookRoutes = require('./routes/webhook');
const readmeRoutes = require('./routes/readme');
const explorerRoutes = require('./routes/explorer');
const aiRoutes = require('./routes/ai');
const timeMachineRoutes = require('./routes/timeMachine');
const voiceRoutes = require('./routes/voice');

const app = express();

// Middleware
app.use(helmet());
app.use(compression());
app.use(morgan('dev'));
const allowedOrigins = ['http://localhost:5173'];
if (process.env.CORS_ORIGIN) {
  allowedOrigins.push(...process.env.CORS_ORIGIN.split(',').map(o => o.trim()));
}

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-AI-Key', 'X-AI-Provider', 'Accept']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Routes
app.use('/api/analyze', analyzeRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/readme', readmeRoutes);
app.use('/api/explorer', explorerRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/time-machine', timeMachineRoutes);
app.use('/api/voice', voiceRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  const server = app.listen(PORT, (err) => {
    if (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
