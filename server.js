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

// Настройка CORS для Render
const allowedOrigins = [
  'https://syncview.onrender.com',
  'http://syncview.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'https://localhost:3000'
];

const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// ВАЖНО: Render автоматически устанавливает PORT
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Важно для Render

// Настройка CORS middleware
app.use(cors({
  origin: function(origin, callback) {
    // Разрешаем запросы без origin (например, из мобильных приложений или Postman)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Разрешаем предварительные запросы OPTIONS
app.options('*', cors());

// Отключаем кэширование для всех маршрутов
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Настройка сессий с правильными куками для Render
app.use(session({
  secret: process.env.SESSION_SECRET || 'watchparty-secret-key-2023-sync-view-strong-secret',
  resave: false,
  saveUninitialized: false, // Не сохранять пустые сессии
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.NODE_ENV === 'production' ? '.onrender.com' : undefined
  },
  name: 'watchparty.sid'
}));

// Middleware для отладки сессий
app.use((req, res, next) => {
  console.log('=== Сессия ===');
  console.log('Session ID:', req.sessionID);
  console.log('User ID в сессии:', req.session.userId);
  console.log('URL:', req.url);
  console.log('Method:', req.method);
  console.log('=== Конец сессии ===');
  next();
});

// Middleware для парсинга JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

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
  limits: { fileSize: 5 * 1024 * 1024 },
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
const screenSharers = new Map();

// Функция инициализации данных
function initData() {
  console.log('🔧 Инициализация данных...');
  
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
    name: '🎬 Демо комната для всех',
    host: 'Демо Пользователь',
    hostId: testUserId,
    videoUrl: '',
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
  
  console.log('✅ Данные инициализированы');
}

// Инициализация данных
initData();

// Health check для Render (обязательно!)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sessionId: req.sessionID
  });
});

// ГЛАВНАЯ СТРАНИЦА - логика перенаправления
app.get('/', (req, res) => {
  console.log('📄 Главная страница - запрос');
  console.log('Сессия пользователя:', req.session.userId);
  
  // Если пользователь авторизован, перенаправляем в дашборд
  if (req.session.userId) {
    console.log('👤 Пользователь авторизован, перенаправляем в дашборд');
    return res.redirect('/dashboard');
  }
  
  // Иначе показываем главную
  res.sendFile(path.join(__dirname, 'index.html'));
});

// СТРАНИЦА ВХОДА
app.get('/login', (req, res) => {
  console.log('📄 Страница входа - запрос');
  
  // Если уже авторизован, перенаправляем в дашборд
  if (req.session.userId) {
    console.log('👤 Пользователь уже авторизован, перенаправляем в дашборд');
    return res.redirect('/dashboard');
  }
  
  res.sendFile(path.join(__dirname, 'login.html'));
});

// СТРАНИЦА РЕГИСТРАЦИИ
app.get('/register', (req, res) => {
  console.log('📄 Страница регистрации - запрос');
  
  // Если уже авторизован, перенаправляем в дашборд
  if (req.session.userId) {
    console.log('👤 Пользователь уже авторизован, перенаправляем в дашборд');
    return res.redirect('/dashboard');
  }
  
  res.sendFile(path.join(__dirname, 'register.html'));
});

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
  console.log('🔍 Проверка авторизации для пути:', req.path);
  console.log('Сессия ID:', req.sessionID);
  console.log('User ID в сессии:', req.session.userId);
  
  // Публичные пути
  const publicPaths = ['/', '/login', '/register', '/health', '/api/login', '/api/register'];
  
  if (publicPaths.includes(req.path)) {
    console.log('✅ Публичный путь, пропускаем проверку');
    return next();
  }
  
  if (!req.session.userId) {
    console.log('❌ Нет авторизации для защищенного пути:', req.path);
    
    // Для API возвращаем JSON
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Требуется авторизация',
        redirect: '/login'
      });
    }
    
    // Для HTML перенаправляем на логин
    return res.redirect('/login');
  }
  
  next();
};

// ЗАЩИЩЕННЫЕ МАРШРУТЫ
app.get('/dashboard', requireAuth, (req, res) => {
  console.log('📄 Дашборд для пользователя:', req.session.username);
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/profile', requireAuth, (req, res) => {
  console.log('📄 Профиль пользователя:', req.session.username);
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/room/:id', requireAuth, (req, res) => {
  console.log('📄 Комната:', req.params.id, 'для пользователя:', req.session.username);
  res.sendFile(path.join(__dirname, 'room.html'));
});

// ==================== API МАРШРУТЫ ====================

// API регистрации
app.post('/api/register', async (req, res) => {
  try {
    console.log('📝 Регистрация нового пользователя');
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Все поля обязательны' 
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Пароль должен быть не менее 6 символов' 
      });
    }
    
    const existingUser = Array.from(users.values()).find(u => u.email === email);
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email уже зарегистрирован' 
      });
    }
    
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
    
    // Сохраняем сессию
    req.session.userId = userId;
    req.session.username = username;
    req.session.email = email;
    
    // Сохраняем сессию вручную чтобы убедиться
    req.session.save((err) => {
      if (err) {
        console.error('Ошибка сохранения сессии:', err);
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка сервера при создании сессии' 
        });
      }
      
      console.log('✅ Пользователь зарегистрирован:', username);
      console.log('✅ Сессия установлена, ID:', req.sessionID);
      
      // Устанавливаем куки вручную для надежности
      res.cookie('watchparty.sid', req.sessionID, {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
      });
      
      res.json({ 
        success: true, 
        user: { 
          id: userId, 
          username, 
          email, 
          avatar: user.avatar 
        },
        sessionId: req.sessionID,
        message: 'Регистрация успешна'
      });
    });
    
  } catch (error) {
    console.error('❌ Ошибка регистрации:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сервера' 
    });
  }
});

// API входа
app.post('/api/login', async (req, res) => {
  try {
    console.log('🔑 Вход пользователя');
    const { email, password } = req.body;
    
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      console.log('❌ Пользователь не найден:', email);
      return res.status(401).json({ 
        success: false, 
        error: 'Неверный email или пароль' 
      });
    }
    
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('❌ Неверный пароль для:', email);
      return res.status(401).json({ 
        success: false, 
        error: 'Неверный email или пароль' 
      });
    }
    
    user.lastSeen = new Date().toISOString();
    users.set(user.id, user);
    
    // Сохраняем сессию
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.email = user.email;
    
    req.session.save((err) => {
      if (err) {
        console.error('Ошибка сохранения сессии:', err);
        return res.status(500).json({ 
          success: false, 
          error: 'Ошибка сервера при входе' 
        });
      }
      
      console.log('✅ Пользователь вошел:', user.username);
      console.log('✅ Сессия установлена, ID:', req.sessionID);
      
      // Устанавливаем куки вручную для надежности
      res.cookie('watchparty.sid', req.sessionID, {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
      });
      
      res.json({ 
        success: true, 
        user: { 
          id: user.id, 
          username: user.username, 
          email: user.email, 
          avatar: user.avatar 
        },
        sessionId: req.sessionID,
        message: 'Вход успешен'
      });
    });
    
  } catch (error) {
    console.error('❌ Ошибка входа:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сервера' 
    });
  }
});

// API выхода
app.post('/api/logout', (req, res) => {
  console.log('🚪 Выход пользователя:', req.session.username);
  
  // Удаляем куки
  res.clearCookie('watchparty.sid');
  
  // Уничтожаем сессию
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Ошибка при выходе' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Вы успешно вышли' 
    });
  });
});

// API получения данных пользователя
app.get('/api/user', (req, res) => {
  console.log('👤 Получение данных пользователя');
  console.log('Session ID:', req.sessionID);
  console.log('User ID в сессии:', req.session.userId);
  
  if (!req.session.userId) {
    console.log('❌ Нет авторизации');
    return res.status(401).json({ 
      success: false, 
      error: 'Требуется авторизация',
      redirect: '/login'
    });
  }
  
  const user = users.get(req.session.userId);
  if (!user) {
    console.log('❌ Пользователь не найден в базе');
    // Если пользователь не найден в базе, сбрасываем сессию
    req.session.destroy();
    return res.status(404).json({ 
      success: false, 
      error: 'Пользователь не найден',
      redirect: '/login'
    });
  }
  
  const { password, ...userData } = user;
  console.log('✅ Данные пользователя отправлены:', userData.username);
  res.json({ 
    success: true, 
    user: userData,
    sessionId: req.sessionID
  });
});

// Остальные API маршруты остаются как были
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
    res.json({ success: true, room: { id: roomId, name: room.name, host: room.host, videoUrl: room.videoUrl, isPrivate: room.isPrivate, createdAt: room.createdAt, participantCount: 0 } });
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
  console.log('✅ Новое подключение:', socket.id);

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
    socket.to(roomId).emit('user-joined', { userId, username, avatar, timestamp: new Date().toISOString() });
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
    io.to(roomId).emit('new-message', messageData);
  });

  socket.on('video-control', (data) => {
    const { roomId, action, time, url } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    const now = Date.now();
    switch (action) {
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
    socket.to(roomId).emit('video-update', { ...data, serverTime: now });
  });

  socket.on('sound-effect', (data) => {
    const { roomId, sound } = data;
    socket.to(roomId).emit('play-sound', sound);
  });

  socket.on('screen-share-start', (data) => {
    const { roomId, userId, username, quality, delay } = data;
    const room = rooms.get(roomId);
    if (!room) return;
    room.screenSharer = { userId, username, quality, delay, startedAt: new Date().toISOString() };
    const participant = room.participants.find(p => p.id === userId);
    if (participant) {
      participant.isSharingScreen = true;
    }
    rooms.set(roomId, room);
    screenSharers.set(userId, { roomId, socketId: socket.id });
    io.to(roomId).emit('screen-share-start', { userId, username, quality, delay, timestamp: new Date().toISOString() });
    io.to(roomId).emit('participants-updated', room.participants);
    console.log(`Пользователь ${username} начал показ экрана в комнате ${roomId}`);
  });

  socket.on('screen-frame', (data) => {
    const { roomId, userId, frame, timestamp, width, height } = data;
    socket.to(roomId).emit('screen-frame', { userId, frame, timestamp, width, height });
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
    io.to(roomId).emit('screen-share-stop', { userId, timestamp: new Date().toISOString() });
    io.to(roomId).emit('participants-updated', room.participants);
    console.log(`Пользователь ${userId} остановил показ экрана в комнате ${roomId}`);
  });

  socket.on('leave-room', (data) => {
    const { roomId, userId } = data;
    const room = rooms.get(roomId);
    if (room) {
      if (room.screenSharer && room.screenSharer.userId === userId) {
        room.screenSharer = null;
        io.to(roomId).emit('screen-share-stop', { userId, timestamp: new Date().toISOString() });
      }
      room.participants = room.participants.filter(p => p.id !== userId);
      rooms.set(roomId, room);
      socket.to(roomId).emit('user-left', { userId, timestamp: new Date().toISOString() });
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
          io.to(roomId).emit('screen-share-stop', { userId, timestamp: new Date().toISOString() });
        }
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        rooms.set(roomId, room);
        io.to(roomId).emit('participants-updated', room.participants);
        io.to(roomId).emit('user-left', { userId, timestamp: new Date().toISOString() });
      }
      screenSharers.delete(userId);
      onlineUsers.delete(socket.id);
    }
    console.log('Отключение:', socket.id);
  });
});

// Запуск сервера
server.listen(PORT, HOST, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Хост: ${HOST}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
