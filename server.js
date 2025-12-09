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
const io = socketIo(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

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

// Middleware для отладки сессий (упрощенный)
app.use((req, res, next) => {
  // console.log('Сессия:', req.sessionID, 'UserID:', req.session.userId, 'Path:', req.path);
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// Хранилище для аватарок (оставляем как есть)
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

// "База данных" в памяти (оставляем как есть)
const users = new Map();
const rooms = new Map();
const onlineUsers = new Map();
const screenSharers = new Map();

// Функция инициализации данных (оставляем как есть)
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
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
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
  console.log('🔍 Проверка авторизации для пути:', req.path);
  
  // Пути, доступные без авторизации
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
        error: 'Требуется авторизация',
        redirect: '/login'
      });
    }
    
    // Для HTML страниц перенаправляем
    return res.redirect('/login');
  }
  
  next();
};

// Health check для Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==================== ОСНОВНЫЕ МАРШРУТЫ ====================

// ГЛАВНАЯ СТРАНИЦА - доступна всем
app.get('/', (req, res) => {
  console.log('📄 Главная страница - показываем лендинг');
  
  // Если пользователь уже авторизован, перенаправляем в дашборд
  if (req.session.userId) {
    console.log('👤 Пользователь авторизован, перенаправляем в дашборд');
    return res.redirect('/dashboard');
  }
  
  // Показываем главную страницу для неавторизованных
  res.sendFile(path.join(__dirname, 'index.html'));
});

// СТРАНИЦА ВХОДА - доступна всем
app.get('/login', (req, res) => {
  console.log('📄 Страница входа');
  
  // Если пользователь уже авторизован, перенаправляем в дашборд
  if (req.session.userId) {
    console.log('👤 Пользователь уже авторизован, перенаправляем в дашборд');
    return res.redirect('/dashboard');
  }
  
  res.sendFile(path.join(__dirname, 'login.html'));
});

// СТРАНИЦА РЕГИСТРАЦИИ - доступна всем
app.get('/register', (req, res) => {
  console.log('📄 Страница регистрации');
  
  // Если пользователь уже авторизован, перенаправляем в дашборд
  if (req.session.userId) {
    console.log('👤 Пользователь уже авторизован, перенаправляем в дашборд');
    return res.redirect('/dashboard');
  }
  
  res.sendFile(path.join(__dirname, 'register.html'));
});

// ДАШБОРД - требует авторизации
app.get('/dashboard', requireAuth, (req, res) => {
  console.log('📄 Дашборд для пользователя:', req.session.username);
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ПРОФИЛЬ - требует авторизации
app.get('/profile', requireAuth, (req, res) => {
  console.log('📄 Профиль пользователя:', req.session.username);
  res.sendFile(path.join(__dirname, 'profile.html'));
});

// КОМНАТА - требует авторизации
app.get('/room/:id', requireAuth, (req, res) => {
  console.log('📄 Комната:', req.params.id, 'для пользователя:', req.session.username);
  res.sendFile(path.join(__dirname, 'room.html'));
});

// ==================== API МАРШРУТЫ ====================

// API регистрации (без requireAuth)
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

// API входа (без requireAuth)
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

// API выхода
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// API получения данных пользователя (требует авторизации)
app.get('/api/user', requireAuth, (req, res) => {
  const user = users.get(req.session.userId);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  const { password, ...userData } = user;
  res.json({ success: true, user: userData });
});

// Остальные API маршруты оставляем как есть (они у вас уже есть в коде)
app.post('/api/update-profile', requireAuth, upload.single('avatar'), async (req, res) => {
  // ... ваш существующий код ...
});

app.post('/api/create-room', requireAuth, (req, res) => {
  // ... ваш существующий код ...
});

app.get('/api/rooms', requireAuth, (req, res) => {
  // ... ваш существующий код ...
});

app.get('/api/room/:id', requireAuth, (req, res) => {
  // ... ваш существующий код ...
});

// ==================== WebSocket СОЕДИНЕНИЯ ====================

// Ваш существующий WebSocket код (оставляем без изменений)
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);

  socket.on('join-room', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('send-message', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('video-control', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('sound-effect', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('screen-share-start', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('screen-frame', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('screen-share-stop', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('leave-room', (data) => {
    // ... ваш существующий код ...
  });

  socket.on('disconnect', () => {
    // ... ваш существующий код ...
  });
});

// ==================== ЗАПУСК СЕРВЕРА ====================

const PORT = process.env.PORT || 3000; // Для Render используем 3000
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});
