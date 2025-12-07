const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Настройка сессий для Render
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  secret: 'watchparty-secret-key-2023-' + (isProduction ? 'prod' : 'dev'),
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false, // На Render может не работать с true
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true
  }
}));

// Пути для загрузок
const isRender = process.env.RENDER === 'true';
const uploadsDir = isRender ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

app.use('/uploads', express.static(uploadsDir));

// Хранилище для аватарок
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// "База данных" в памяти
const users = new Map();
const rooms = new Map();

// Инициализация данных
function initData() {
  const testUserId = uuidv4();
  users.set(testUserId, {
    id: testUserId,
    username: 'Демо Пользователь',
    email: 'demo@watchparty.com',
    password: bcrypt.hashSync('demo123', 10),
    avatar: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
    createdAt: new Date().toISOString(),
    rooms: []
  });

  const demoRoomId = uuidv4().substring(0, 8);
  rooms.set(demoRoomId, {
    id: demoRoomId,
    name: 'Демо комната',
    host: 'Демо Пользователь',
    hostId: testUserId,
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    isPrivate: false,
    password: null,
    createdAt: new Date().toISOString(),
    participants: [],
    messages: [],
    isPlaying: false,
    currentTime: 0,
    lastUpdate: Date.now()
  });
}

initData();

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  next();
};

// Маршруты
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/profile', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/room/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'room.html'));
});

// API маршруты
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    const existingUser = Array.from(users.values()).find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email уже зарегистрирован' });
    }
    
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = {
      id: userId,
      username,
      email,
      password: hashedPassword,
      avatar: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
      createdAt: new Date().toISOString(),
      rooms: [],
      lastSeen: new Date().toISOString()
    };
    
    users.set(userId, user);
    
    // Сохраняем сессию
    req.session.userId = userId;
    req.session.username = username;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Ошибка сохранения сессии' });
      }
      
      console.log('User registered:', userId);
      res.json({ 
        success: true, 
        user: {
          id: userId,
          username,
          email,
          avatar: user.avatar
        }
      });
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    user.lastSeen = new Date().toISOString();
    users.set(user.id, user);
    
    // Сохраняем сессию
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ error: 'Ошибка сохранения сессии' });
      }
      
      console.log('User logged in:', user.id);
      res.json({ 
        success: true, 
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar
        }
      });
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Ошибка сервера' });
    }
    res.json({ success: true });
  });
});

app.get('/api/user', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  
  const user = users.get(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  const { password, ...userData } = user;
  res.json({ success: true, user: userData });
});

app.post('/api/update-profile', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = users.get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    if (req.body.username) {
      user.username = req.body.username;
      req.session.username = req.body.username;
    }
    
    if (req.file) {
      user.avatar = `/uploads/avatars/${req.file.filename}`;
    }
    
    users.set(userId, user);
    
    const { password, ...userData } = user;
    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Ошибка при обновлении профиля' });
  }
});

app.post('/api/create-room', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId;
    const { roomName, videoUrl, isPrivate, password } = req.body;
    
    const user = users.get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const roomId = uuidv4().substring(0, 8);
    const room = {
      id: roomId,
      name: roomName || 'Новая комната',
      host: user.username,
      hostId: userId,
      videoUrl: videoUrl || '',
      isPrivate: isPrivate || false,
      password: isPrivate ? password : null,
      createdAt: new Date().toISOString(),
      participants: [],
      messages: [],
      isPlaying: false,
      currentTime: 0,
      lastUpdate: Date.now()
    };
    
    rooms.set(roomId, room);
    if (!user.rooms) user.rooms = [];
    user.rooms.push(roomId);
    users.set(userId, user);
    
    res.json({ 
      success: true, 
      room: {
        id: roomId,
        name: room.name,
        host: room.host,
        videoUrl: room.videoUrl,
        isPrivate: room.isPrivate,
        createdAt: room.createdAt,
        participantCount: 0
      }
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Ошибка при создании комнаты' });
  }
});

app.get('/api/rooms', requireAuth, (req, res) => {
  try {
    const userRooms = [];
    const userId = req.session.userId;
    
    const user = users.get(userId);
    if (user && user.rooms) {
      user.rooms.forEach(roomId => {
        const room = rooms.get(roomId);
        if (room) {
          userRooms.push({
            id: room.id,
            name: room.name,
            host: room.host,
            videoUrl: room.videoUrl,
            isPrivate: room.isPrivate,
            createdAt: room.createdAt,
            participantCount: room.participants.length
          });
        }
      });
    }
    
    rooms.forEach(room => {
      if (!room.isPrivate && !userRooms.some(r => r.id === room.id)) {
        userRooms.push({
          id: room.id,
          name: room.name,
          host: room.host,
          videoUrl: room.videoUrl,
          isPrivate: room.isPrivate,
          createdAt: room.createdAt,
          participantCount: room.participants.length
        });
      }
    });
    
    res.json({ success: true, rooms: userRooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Ошибка при получении комнат' });
  }
});

app.get('/api/room/:id', requireAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Комната не найдена' });
    }
    
    if (room.isPrivate && room.hostId !== req.session.userId) {
      const providedPassword = req.query.password;
      if (!providedPassword || providedPassword !== room.password) {
        return res.status(403).json({ error: 'Неверный пароль или доступ запрещен' });
      }
    }
    
    res.json({ success: true, room });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ error: 'Ошибка при получении комнаты' });
  }
});

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);
  
  socket.on('join-room', (data) => {
    const { roomId, userId, username, avatar } = data;
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Комната не найдена' });
      return;
    }
    
    const existingParticipant = room.participants.find(p => p.id === userId);
    if (!existingParticipant) {
      room.participants.push({
        id: userId,
        username,
        avatar,
        socketId: socket.id,
        joinedAt: new Date().toISOString()
      });
      rooms.set(roomId, room);
    }
    
    socket.join(roomId);
    
    socket.emit('room-state', {
      participants: room.participants,
      messages: room.messages.slice(-100),
      videoState: {
        url: room.videoUrl,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        lastUpdate: room.lastUpdate
      }
    });
    
    socket.to(roomId).emit('user-joined', {
      userId,
      username,
      avatar,
      timestamp: new Date().toISOString()
    });
    
    io.to(roomId).emit('participants-updated', room.participants);
  });
  
  socket.on('send-message', (data) => {
    const { roomId, userId, message } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    const user = room.participants.find(p => p.id === userId);
    if (!user) return;
    
    const messageData = {
      id: uuidv4(),
      userId,
      username: user.username,
      avatar: user.avatar,
      message: message.trim(),
      timestamp: new Date().toISOString()
    };
    
    room.messages.push(messageData);
    if (room.messages.length > 1000) {
      room.messages = room.messages.slice(-500);
    }
    rooms.set(roomId, room);
    
    io.to(roomId).emit('new-message', messageData);
  });
  
  socket.on('video-control', (data) => {
    const { roomId, action, time, url } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    const now = Date.now();
    
    switch(action) {
      case 'play':
        room.isPlaying = true;
        room.currentTime = time || 0;
        room.lastUpdate = now;
        break;
      case 'pause':
        room.isPlaying = false;
        room.currentTime = time || 0;
        room.lastUpdate = now;
        break;
      case 'seek':
        room.currentTime = time;
        room.lastUpdate = now;
        break;
      case 'change-video':
        room.videoUrl = url;
        room.isPlaying = false;
        room.currentTime = 0;
        room.lastUpdate = now;
        break;
    }
    
    rooms.set(roomId, room);
    
    socket.to(roomId).emit('video-update', {
      ...data,
      serverTime: now
    });
  });
  
  socket.on('sound-effect', (data) => {
    const { roomId, sound } = data;
    socket.to(roomId).emit('play-sound', sound);
  });
  
  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Сайт: https://syncview-5.onrender.com`);
  console.log(`👤 Демо: demo@watchparty.com / demo123`);
});
