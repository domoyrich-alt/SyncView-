// Глобальные утилитные функции для WatchParty

/**
 * Форматирует время в формат MM:SS
 * @param {number} seconds - Секунды
 * @returns {string} Отформатированное время
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Экранирует HTML символы для безопасного отображения
 * @param {string} text - Текст для экранирования
 * @returns {string} Экранированный текст
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Показывает уведомление
 * @param {string} message - Текст сообщения
 * @param {string} type - Тип уведомления (success, error, info)
 * @param {number} duration - Длительность показа (мс)
 */
function showNotification(message, type = 'info', duration = 3000) {
    // Создаем элемент уведомления, если его нет
    let notification = document.getElementById('global-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'global-notification';
        notification.className = 'notification';
        document.body.appendChild(notification);
    }
    
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.style.display = 'block';
    
    // Автоматическое скрытие
    setTimeout(() => {
        notification.style.display = 'none';
    }, duration);
}

/**
 * Проверяет, является ли строка валидным URL
 * @param {string} string - Строка для проверки
 * @returns {boolean} true если валидный URL
 */
function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Определяет тип видео по URL
 * @param {string} url - URL видео
 * @returns {string} Тип видео (youtube, vimeo, hls, direct)
 */
function getVideoType(url) {
    if (!url) return 'unknown';
    
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return 'youtube';
    } else if (url.includes('vimeo.com')) {
        return 'vimeo';
    } else if (url.includes('.m3u8')) {
        return 'hls';
    } else if (url.match(/\.(mp4|webm|ogg|avi|mkv|mov)$/i)) {
        return 'direct';
    } else {
        return 'unknown';
    }
}

/**
 * Извлекает ID видео из YouTube URL
 * @param {string} url - YouTube URL
 * @returns {string|null} ID видео или null
 */
function getYouTubeId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length == 11) ? match[7] : null;
}

/**
 * Копирует текст в буфер обмена
 * @param {string} text - Текст для копирования
 * @returns {Promise<void>}
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('Скопировано в буфер обмена!', 'success');
        return true;
    } catch (err) {
        console.error('Ошибка копирования:', err);
        showNotification('Не удалось скопировать', 'error');
        return false;
    }
}

/**
 * Форматирует дату в читаемый вид
 * @param {string|Date} date - Дата
 * @returns {string} Отформатированная дата
 */
function formatDate(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    const day = 24 * 60 * 60 * 1000;
    
    if (diff < day) {
        return 'Сегодня';
    } else if (diff < 2 * day) {
        return 'Вчера';
    } else if (diff < 7 * day) {
        const days = Math.floor(diff / day);
        return `${days} дней назад`;
    } else {
        return d.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }
}

/**
 * Создает debounce функцию
 * @param {Function} func - Функция для debounce
 * @param {number} wait - Время ожидания (мс)
 * @returns {Function} Debounced функция
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Создает throttle функцию
 * @param {Function} func - Функция для throttle
 * @param {number} limit - Лимит времени (мс)
 * @returns {Function} Throttled функция
 */
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Генерирует случайный цвет для аватара
 * @returns {string} HEX цвет
 */
function getRandomColor() {
    const colors = [
        '#FF6600', '#3366FF', '#00CC66', '#FF3366', 
        '#9933FF', '#FFCC00', '#33CCCC', '#FF6666'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Создает инициалы из имени
 * @param {string} name - Полное имя
 * @returns {string} Инициалы
 */
function getInitials(name) {
    return name
        .split(' ')
        .map(part => part.charAt(0))
        .join('')
        .toUpperCase()
        .substring(0, 2);
}

/**
 * Проверяет поддержку WebRTC
 * @returns {boolean} true если поддерживается
 */
function isWebRTCSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Проверяет поддержку Fullscreen API
 * @returns {boolean} true если поддерживается
 */
function isFullscreenSupported() {
    return !!(document.fullscreenEnabled || 
              document.webkitFullscreenEnabled || 
              document.mozFullScreenEnabled || 
              document.msFullscreenEnabled);
}

/**
 * Переключает полноэкранный режим для элемента
 * @param {HTMLElement} element - Элемент для полноэкранного режима
 */
function toggleFullscreen(element) {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
        } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

/**
 * Форматирует размер файла в читаемый вид
 * @param {number} bytes - Размер в байтах
 * @returns {string} Отформатированный размер
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Валидирует email
 * @param {string} email - Email для валидации
 * @returns {boolean} true если email валиден
 */
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Валидирует пароль
 * @param {string} password - Пароль для валидации
 * @returns {Object} Результат валидации
 */
function validatePassword(password) {
    const errors = [];
    
    if (password.length < 6) {
        errors.push('Пароль должен быть не менее 6 символов');
    }
    
    if (!/[A-Z]/.test(password)) {
        errors.push('Пароль должен содержать хотя бы одну заглавную букву');
    }
    
    if (!/[0-9]/.test(password)) {
        errors.push('Пароль должен содержать хотя бы одну цифру');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Создает уникальный ID
 * @param {number} length - Длина ID
 * @returns {string} Уникальный ID
 */
function generateId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Экспорт функций для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        formatTime,
        escapeHtml,
        showNotification,
        isValidUrl,
        getVideoType,
        getYouTubeId,
        copyToClipboard,
        formatDate,
        debounce,
        throttle,
        getRandomColor,
        getInitials,
        isWebRTCSupported,
        isFullscreenSupported,
        toggleFullscreen,
        formatFileSize,
        validateEmail,
        validatePassword,
        generateId
    };
}