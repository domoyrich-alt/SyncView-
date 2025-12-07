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

// Определяем окружение
const isRender = process.env.RENDER === 'true' || __dirname.includes('/opt/render/');
console.log(`🚀 Запуск на Render: ${isRender}`);
console.log(`📁 Текущая директория: ${__dirname}`);

// Отключаем кэширование для всех маршрутов
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Настройка сессий
app.use(session({
  secret: 'watchparty-secret-key-2023',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(__dirname));

// Настройка загрузок на Render (используем /tmp)
const uploadsDir = isRender ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');

// Создаем директории если их нет
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Только изображения (jpeg, jpg, png, gif, webp)!'));
  }
});

// "База данных" в памяти
const users = new Map();
const rooms = new Map();
const onlineUsers = new Map();
const screenSharers = new Map();

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

  const demoRoomId = 'demo123';
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
    lastUpdate: Date.now(),
    screenSharer: null
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

// Функция отправки HTML
const sendHtml = (filename, res) => {
  const filePath = path.join(__dirname, filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    console.log(`Файл не найден: ${filename}`);
    res.status(404).send(`<h1>Файл ${filename} не найден</h1>`);
  }
};

// Маршруты
app.get('/', (req, res) => {
  sendHtml('index.html', res);
});

app.get('/login', (req, res) => {
  sendHtml('login.html', res);
});

app.get('/register', (req, res) => {
  sendHtml('register.html', res);
});

app.get('/dashboard', requireAuth, (req, res) => {
  sendHtml('dashboard.html', res);
});

app.get('/profile', requireAuth, (req, res) => {
  sendHtml('profile.html', res);
});

app.get('/room/:id', requireAuth, (req, res) => {
  sendHtml('room.html', res);
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
    req.session.userId = userId;
    req.session.username = username;
    
    res.json({ 
      success: true, 
      user: {
        id: userId,
        username,
        email,
        avatar: user.avatar
      }
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
    
    req.session.userId = user.id;
    req.session.username = user.username;
    
    res.json({ 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/user', requireAuth, (req, res) => {
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

app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.session.userId;
    const user = users.get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }
    
    user.password = await bcrypt.hash(newPassword, 10);
    users.set(userId, user);
    
    res.json({ success: true, message: 'Пароль изменен' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Ошибка при изменении пароля' });
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
      lastUpdate: Date.now(),
      screenSharer: null
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

app.delete('/api/room/:id', requireAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.session.userId;
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Комната не найдена' });
    }
    
    if (room.hostId !== userId) {
      return res.status(403).json({ error: 'Только создатель может удалить комнату' });
    }
    
    rooms.delete(roomId);
    users.forEach(user => {
      if (user.rooms) {
        user.rooms = user.rooms.filter(id => id !== roomId);
      }
    });
    
    res.json({ success: true, message: 'Комната удалена' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Ошибка при удалении комнаты' });
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
            participantCount: room.participants.length,
            screenSharer: room.screenSharer
          });
        }
      });
    }
    
    rooms.forEach(room => {
      if (!room.isPrivate && room.hostId !== userId) {
        userRooms.push({
          id: room.id,
          name: room.name,
          host: room.host,
          videoUrl: room.videoUrl,
          isPrivate: room.isPrivate,
          createdAt: room.createdAt,
          participantCount: room.participants.length,
          screenSharer: room.screenSharer
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

app.get('/api/room/:id/messages', requireAuth, (req, res) => {
  try {
    const roomId = req.params.id;
    const room = rooms.get(roomId);
    
    if (!room) {
      return res.status(404).json({ error: 'Комната не найдена' });
    }
    
    const limit = parseInt(req.query.limit) || 100;
    const messages = room.messages.slice(-limit);
    
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Ошибка при получении сообщений' });
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
        joinedAt: new Date().toISOString(),
        isSharingScreen: false
      });
      rooms.set(roomId, room);
    }
    
    socket.join(roomId);
    onlineUsers.set(socket.id, { userId, username, roomId });
    
    socket.to(roomId).emit('user-joined', {
      userId,
      username,
      avatar,
      timestamp: new Date().toISOString()
    });
    
    socket.emit('room-state', {
      participants: room.participants,
      messages: room.messages.slice(-100),
      videoState: {
        url: room.videoUrl,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        lastUpdate: room.lastUpdate
      },
      screenSharer: room.screenSharer
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
  
  socket.on('screen-share-start', (data) => {
    const { roomId, userId, username, quality, delay } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    room.screenSharer = {
      userId,
      username,
      quality,
      delay,
      startedAt: new Date().toISOString()
    };
    
    const participant = room.participants.find(p => p.id === userId);
    if (participant) {
      participant.isSharingScreen = true;
    }
    
    rooms.set(roomId, room);
    screenSharers.set(userId, { roomId, socketId: socket.id });
    
    io.to(roomId).emit('screen-share-start', {
      userId,
      username,
      quality,
      delay,
      timestamp: new Date().toISOString()
    });
    
    io.to(roomId).emit('participants-updated', room.participants);
  });
  
  socket.on('screen-frame', (data) => {
    const { roomId, userId, frame, timestamp, width, height } = data;
    socket.to(roomId).emit('screen-frame', {
      userId,
      frame,
      timestamp,
      width,
      height
    });
  });
  
  socket.on('screen-share-stop', (data) => {
    const { roomId, userId } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    if (room.screenSharer && room.screenSharer.userId === userId) {
      room.screenSharer = null;
    }
    
    const participant = room.participants.find(p => p.id === userId);
    if (participant) {
      participant.isSharingScreen = false;
    }
    
    rooms.set(roomId, room);
    screenSharers.delete(userId);
    
    io.to(roomId).emit('screen-share-stop', {
      userId,
      timestamp: new Date().toISOString()
    });
    
    io.to(roomId).emit('participants-updated', room.participants);
  });
  
  socket.on('leave-room', (data) => {
    const { roomId, userId } = data;
    const room = rooms.get(roomId);
    
    if (room) {
      if (room.screenSharer && room.screenSharer.userId === userId) {
        room.screenSharer = null;
        io.to(roomId).emit('screen-share-stop', {
          userId,
          timestamp: new Date().toISOString()
        });
      }
      
      room.participants = room.participants.filter(p => p.id !== userId);
      rooms.set(roomId, room);
      
      socket.to(roomId).emit('user-left', {
        userId,
        timestamp: new Date().toISOString()
      });
      
      io.to(roomId).emit('participants-updated', room.participants);
    }
    
    screenSharers.delete(userId);
    onlineUsers.delete(socket.id);
    socket.leave(roomId);
  });
  
  socket.on('disconnect', () => {
    const userData = onlineUsers.get(socket.id);
    if (userData) {
      const { userId, roomId } = userData;
      const room = rooms.get(roomId);
      
      if (room) {
        if (room.screenSharer && room.screenSharer.userId === userId) {
          room.screenSharer = null;
          io.to(roomId).emit('screen-share-stop', {
            userId,
            timestamp: new Date().toISOString()
          });
        }
        
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        rooms.set(roomId, room);
        
        io.to(roomId).emit('participants-updated', room.participants);
        io.to(roomId).emit('user-left', {
          userId,
          timestamp: new Date().toISOString()
        });
      }
      
      screenSharers.delete(userId);
      onlineUsers.delete(socket.id);
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    users: users.size,
    rooms: rooms.size,
    online: onlineUsers.size
  });
});

// Статистика
app.get('/api/stats', requireAuth, (req, res) => {
  const user = users.get(req.session.userId);
  const isAdmin = user.email === 'admin@watchparty.com';
  
  if (!isAdmin) {
    return res.status(403).json({ error: 'Доступ запрещен' });
  }
  
  res.json({
    success: true,
    stats: {
      totalUsers: users.size,
      totalRooms: rooms.size,
      onlineUsers: onlineUsers.size,
      screenSharers: screenSharers.size,
      uptime: process.uptime()
    }
  });
});

// 404 обработчики
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API маршрут не найден' });
});

app.use('*', (req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Страница не найдена</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        h1 { color: #333; }
        a { color: #007bff; text-decoration: none; }
      </style>
    </head>
    <body>
      <h1>404 - Страница не найдена</h1>
      <p><a href="/">На главную</a></p>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Сайт: https://syncview-5.onrender.com`);
  console.log(`📁 Директория: ${__dirname}`);
  console.log(`👤 Демо: demo@watchparty.com / demo123`);
});
