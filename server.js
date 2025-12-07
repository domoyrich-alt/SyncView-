// server.js - помести в папку src!
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Простое логирование
console.log('🚀 Запуск сервера...');
console.log('📁 Директория:', __dirname);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Сессии
app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// Простые маршруты
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'room.html'));
});

// Простой API
const users = {};

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    const userId = uuidv4();
    users[userId] = {
      id: userId,
      username,
      email,
      avatar: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    };
    
    req.session.userId = userId;
    
    res.json({ success: true, user: users[userId] });
  } catch (error) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/login', (req, res) => {
  // Демо логин
  const demoUser = {
    id: 'demo123',
    username: 'Демо',
    email: 'demo@watchparty.com',
    avatar: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
  };
  
  req.session.userId = demoUser.id;
  res.json({ success: true, user: demoUser });
});

// WebSocket для чата
io.on('connection', (socket) => {
  console.log('Подключение:', socket.id);
  
  socket.on('join-room', (data) => {
    socket.join(data.roomId);
    console.log(`Пользователь в комнате ${data.roomId}`);
  });
  
  socket.on('send-message', (data) => {
    io.to(data.roomId).emit('new-message', {
      username: data.username,
      message: data.message,
      timestamp: new Date().toISOString()
    });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Сервер работает на порту ${PORT}`);
});