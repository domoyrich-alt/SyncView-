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
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// Хранилище для аватарок
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Только изображения!'));
  }
});

// "База данных" в памяти
const users = new Map();
const rooms = new Map();
const onlineUsers = new Map();
const screenSharers = new Map(); // Текущие демонстраторы экрана

// Функция инициализации данных
function initData() {
  // Создаем тестового пользователя
  const testUserId = uuidv4();
  users.set(testUserId, {
    id: testUserId,
    username: 'Демо Пользователь',
    email: 'demo@watchparty.com',
    password: bcrypt.hashSync('demo123', 10),
    avatar: '/assets/default-avatar.png',
    createdAt: new Date().toISOString(),
    rooms: []
  });

  // Создаем демо комнату
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
    lastUpdate: Date.now(),
    screenSharer: null
  });
}

// Инициализация данных
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
    
    // Валидация
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }
    
    // Проверка существующего пользователя
    const existingUser = Array.from(users.values()).find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ error: 'Email уже зарегистрирован' });
    }
    
    // Создание пользователя
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = {
      id: userId,
      username,
      email,
      password: hashedPassword,
      avatar: '/assets/default-avatar.png',
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
    
    // Поиск пользователя
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    // Проверка пароля
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    
    // Обновление lastSeen
    user.lastSeen = new Date().toISOString();
    users.set(user.id, user);
    
    // Создание сессии
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
    
    // Обновление имени пользователя
    if (req.body.username) {
      user.username = req.body.username;
      req.session.username = req.body.username;
    }
    
    // Обновление аватара
    if (req.file) {
      // Удаляем старый аватар, если это не дефолтный
      if (user.avatar !== '/assets/default-avatar.png' && fs.existsSync(path.join(__dirname, user.avatar))) {
        fs.unlinkSync(path.join(__dirname, user.avatar));
      }
      user.avatar = '/uploads/avatars/' + req.file.filename;
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
      lastUpdate: Date.now(),
      screenSharer: null
    };
    
    rooms.set(roomId, room);
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
    
    // Получаем комнаты пользователя
    const user = users.get(req.session.userId);
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
    
    // Добавляем публичные комнаты
    rooms.forEach(room => {
      if (!room.isPrivate && !userRooms.some(r => r.id === room.id)) {
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
    
    // Проверка пароля для приватных комнат
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
    
    // Проверяем, не присоединен ли уже пользователь
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
    
    // Присоединяем сокет к комнате
    socket.join(roomId);
    
    // Обновляем onlineUsers
    onlineUsers.set(socket.id, { userId, username, roomId });
    
    // Отправляем информацию о присоединении всем, кроме присоединившегося
    socket.to(roomId).emit('user-joined', {
      userId,
      username,
      avatar,
      timestamp: new Date().toISOString()
    });
    
    // Отправляем текущее состояние комнаты новому участнику
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
    
    // Рассылаем обновленный список участников
    io.to(roomId).emit('participants-updated', room.participants);
    
    console.log(`Пользователь ${username} присоединился к комнате ${roomId}`);
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
      message,
      timestamp: new Date().toISOString()
    };
    
    room.messages.push(messageData);
    rooms.set(roomId, room);
    
    // Отправляем сообщение всем в комнате
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
    
    // Отправляем обновление всем, кроме отправителя
    socket.to(roomId).emit('video-update', {
      ...data,
      serverTime: now
    });
  });
  
  socket.on('sound-effect', (data) => {
    const { roomId, sound } = data;
    socket.to(roomId).emit('play-sound', sound);
  });
  
  // Обработчики для синхронизации экрана
  socket.on('screen-share-start', (data) => {
    const { roomId, userId, username, quality, delay } = data;
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    // Устанавливаем текущего демонстратора экрана
    room.screenSharer = {
      userId,
      username,
      quality,
      delay,
      startedAt: new Date().toISOString()
    };
    
    // Обновляем статус участника
    const participant = room.participants.find(p => p.id === userId);
    if (participant) {
      participant.isSharingScreen = true;
    }
    
    rooms.set(roomId, room);
    screenSharers.set(userId, { roomId, socketId: socket.id });
    
    // Рассылаем всем участникам комнаты
    io.to(roomId).emit('screen-share-start', {
      userId,
      username,
      quality,
      delay,
      timestamp: new Date().toISOString()
    });
    
    // Рассылаем обновленный список участников
    io.to(roomId).emit('participants-updated', room.participants);
    
    console.log(`Пользователь ${username} начал показ экрана в комнате ${roomId}`);
  });
  
  socket.on('screen-frame', (data) => {
    const { roomId, userId, frame, timestamp, width, height } = data;
    
    // Пересылаем кадр всем, кроме отправителя
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
    
    // Сбрасываем демонстратора экрана
    if (room.screenSharer && room.screenSharer.userId === userId) {
      room.screenSharer = null;
    }
    
    // Обновляем статус участника
    const participant = room.participants.find(p => p.id === userId);
    if (participant) {
      participant.isSharingScreen = false;
    }
    
    rooms.set(roomId, room);
    screenSharers.delete(userId);
    
    // Рассылаем всем участникам комнаты
    io.to(roomId).emit('screen-share-stop', {
      userId,
      timestamp: new Date().toISOString()
    });
    
    // Рассылаем обновленный список участников
    io.to(roomId).emit('participants-updated', room.participants);
    
    console.log(`Пользователь ${userId} остановил показ экрана в комнате ${roomId}`);
  });
  
  socket.on('leave-room', (data) => {
    const { roomId, userId } = data;
    const room = rooms.get(roomId);
    
    if (room) {
      // Если пользователь демонстрировал экран, останавливаем демонстрацию
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
        // Если пользователь демонстрировал экран, останавливаем демонстрацию
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
    
    console.log('Отключение:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});