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

// Конфигурация для Render
const PORT = process.env.PORT || 3000; // Render автоматически устанавливает PORT
const HOST = '0.0.0.0'; // Важно для Render

// Настройка CORS для Render
const io = socketIo(server, {
  cors: {
    origin: [
      "https://syncview.onrender.com",
      "http://localhost:3000",
      "http://localhost:3001"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Поддержка разных транспортов
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware для отключения кэширования
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Настройка сессий (упрощенная для Render)
app.use(session({
  secret: process.env.SESSION_SECRET || 'watchparty-secret-key-2023',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// Middleware
app.use(cors({
  origin: [
    "https://syncview.onrender.com",
    "http://localhost:3000",
    "http://localhost:3001"
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Статические файлы
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Хранилище для аватарок
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/avatars';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
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
      cb(null, true);
    } else {
      cb(new Error('Только изображения (jpeg, jpg, png, gif, webp)!'));
    }
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
    rooms: [],
    lastSeen: new Date().toISOString()
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

// Middleware для проверки аутентификации
const requireAuth = (req, res, next) => {
  console.log('🔍 Проверка авторизации:', req.session.userId);
  if (!req.session.userId) {
    console.log('❌ Нет авторизации, перенаправление на логин');
    return res.status(401).json({ 
      success: false, 
      error: 'Требуется авторизация',
      redirect: '/login'
    });
  }
  next();
};

// Health check для Render (обязательно!)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Основные маршруты
app.get('/', (req, res) => {
  console.log('📄 Главная страница');
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
  console.log('📄 Страница входа');
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
  console.log('📄 Страница регистрации');
  res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/dashboard', (req, res) => {
  console.log('📄 Дашборд');
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/profile', requireAuth, (req, res) => {
  console.log('📄 Профиль пользователя');
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/room/:id', requireAuth, (req, res) => {
  console.log('📄 Комната:', req.params.id);
  res.sendFile(path.join(__dirname, 'room.html'));
});

// API маршруты
app.post('/api/register', async (req, res) => {
  console.log('📝 Регистрация нового пользователя');
  try {
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
    req.session.userId = userId;
    req.session.username = username;
    
    console.log('✅ Пользователь зарегистрирован:', username);
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
    console.error('❌ Ошибка регистрации:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сервера' 
    });
  }
});

app.post('/api/login', async (req, res) => {
  console.log('🔑 Вход пользователя');
  try {
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
    
    req.session.userId = user.id;
    req.session.username = user.username;
    
    console.log('✅ Пользователь вошел:', user.username);
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
    console.error('❌ Ошибка входа:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка сервера' 
    });
  }
});

app.post('/api/logout', (req, res) => {
  console.log('🚪 Выход пользователя');
  req.session.destroy();
  res.json({ 
    success: true, 
    message: 'Вы успешно вышли' 
  });
});

app.get('/api/user', requireAuth, (req, res) => {
  console.log('👤 Получение данных пользователя');
  const user = users.get(req.session.userId);
  if (!user) {
    return res.status(404).json({ 
      success: false, 
      error: 'Пользователь не найден' 
    });
  }
  
  const { password, ...userData } = user;
  res.json({ 
    success: true, 
    user: userData 
  });
});

// WebSocket соединения (оставьте ваш код без изменений, он хорош)
io.on('connection', (socket) => {
  console.log('✅ Новое подключение:', socket.id);

  // ... весь ваш WebSocket код остается без изменений ...
  // (оставьте все обработчики socket.on как есть)
  
  socket.on('join-room', (data) => {
    // ваш код
  });
  
  socket.on('send-message', (data) => {
    // ваш код
  });
  
  // и т.д.
});

// Запуск сервера
server.listen(PORT, HOST, () => {
  initData(); // Инициализация данных при запуске
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Локальный доступ: http://localhost:${PORT}`);
  console.log(`🌐 Внешний доступ: https://syncview.onrender.com`);
  console.log(`✅ Health check: https://syncview.onrender.com/health`);
});
