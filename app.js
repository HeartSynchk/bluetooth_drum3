// --- 藍牙 GATT UUID 設定 (必須與玩具端硬體晶片設定完全一致) ---
const SERVICE_UUID        = '19b10000-e8f2-537e-4f6c-d104768a1214';
const NOTIFY_CHAR_UUID    = '19b10001-e8f2-537e-4f6c-d104768a1214'; // 玩具 -> 網頁
const WRITE_CHAR_UUID     = '19b10002-e8f2-537e-4f6c-d104768a1214'; // 網頁 -> 玩具

let bluetoothDevice = null;
let notifyCharacteristic = null;
let writeCharacteristic = null;

// UI 元件參照
const connectBtn = document.getElementById('connect-btn');
const statusText = document.getElementById('status');
const btnVibrate = document.getElementById('btn-vibrate');
const btnLedRed = document.getElementById('btn-led-red');
const btnLedGreen = document.getElementById('btn-led-green');
const toyButtonDisplay = document.getElementById('toy-button');
const toyTiltDisplay = document.getElementById('toy-tilt');

// --- 步驟 1：Web Bluetooth 雙向連接邏輯 ---
connectBtn.addEventListener('click', async () => {
  try {
    statusText.innerText = '掃描中...';
    
    // 請求藍牙裝置
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'SmartToy' }], // 依玩具藍牙廣播名稱前綴過濾
      optionalServices: [SERVICE_UUID]
    });

    bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);

    // 取得 Notify 特徵值 (接收數據)
    notifyCharacteristic = await service.getCharacteristic(NOTIFY_CHAR_UUID);
    await notifyCharacteristic.startNotifications();
    notifyCharacteristic.addEventListener('characteristicvaluechanged', handleToyData);

    // 取得 Write 特徵值 (傳送數據)
    writeCharacteristic = await service.getCharacteristic(WRITE_CHAR_UUID);

    // 更新 UI 狀態
    statusText.innerText = '狀態：已連線';
    statusText.className = 'status-connected';
    toggleButtons(true);
    console.log('藍牙雙向連線成功');
  } catch (error) {
    console.error('藍牙連線失敗：', error);
    statusText.innerText = '狀態：連線失敗';
    statusText.className = 'status-disconnected';
  }
});

// 斷線處理
function onDisconnected() {
  statusText.innerText = '狀態：已斷線';
  statusText.className = 'status-disconnected';
  toggleButtons(false);
}

function toggleButtons(enable) {
  btnVibrate.disabled = !enable;
  btnLedRed.disabled = !enable;
  btnLedGreen.disabled = !enable;
}

// --- 步驟 2：接收玩具數據並控制遊戲 (Notify) ---
function handleToyData(event) {
  const dataView = event.target.value;
  const dataType = dataView.getUint8(0); // 第 1 個 Byte 為數據類型

  if (dataType === 0x01) { 
    // 按鈕按下事件
    const btnId = dataView.getUint8(1);
    toyButtonDisplay.innerText = `按鈕 ${btnId} 被按下`;
    playerShoot(); // 觸發遊戲發射射擊
  } else if (dataType === 0x02) { 
    // 傾斜角數據 (Int8: -90 到 +90 度)
    const rollAngle = dataView.getInt8(1);
    toyTiltDisplay.innerText = rollAngle;
    playerX += rollAngle * 0.2; // 依玩具傾斜度移動角色
  }
}

// --- 步驟 3：網頁發送指令給玩具 (Write) ---
async function sendCommand(commandType, param1 = 0, param2 = 0) {
  if (!writeCharacteristic) return;
  try {
    const payload = new Uint8Array([commandType, param1, param2]);
    await writeCharacteristic.writeValue(payload);
  } catch (err) {
    console.error('指令發送失敗：', err);
  }
}

// 綁定 UI 按鈕對玩具的寫入指令
btnVibrate.addEventListener('click', () => sendCommand(0x10, 5)); // 0x10: 震動, 500ms
btnLedRed.addEventListener('click', () => sendCommand(0x20, 255, 0)); // 0x20: LED (R:255, G:0)
btnLedGreen.addEventListener('click', () => sendCommand(0x20, 0, 255)); // 0x20: LED (R:0, G:255)


// --- 步驟 4：HTML5 Canvas 遊戲邏輯 ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let playerX = canvas.width / 2;
let bullets = [];
let hazards = [];

// 點擊 Canvas 備用發射
canvas.addEventListener('click', playerShoot);

function playerShoot() {
  bullets.push({ x: playerX, y: canvas.height - 30 });
}

function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 限制玩家邊界
  if (playerX < 15) playerX = 15;
  if (playerX > canvas.width - 15) playerX = canvas.width - 15;

  // 繪製玩家飛船
  ctx.fillStyle = '#00ffcc';
  ctx.beginPath();
  ctx.arc(playerX, canvas.height - 20, 15, 0, Math.PI * 2);
  ctx.fill();

  // 更新與繪製子彈
  ctx.fillStyle = '#ffff00';
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= 5;
    ctx.fillRect(bullets[i].x - 2, bullets[i].y, 4, 10);
    if (bullets[i].y < 0) bullets.splice(i, 1);
  }

  // 隨機產生障礙物
  if (Math.random() < 0.02) {
    hazards.push({ x: Math.random() * (canvas.width - 20) + 10, y: 0 });
  }

  // 更新與繪製障礙物
  ctx.fillStyle = '#ff4444';
  for (let i = hazards.length - 1; i >= 0; i--) {
    hazards[i].y += 2;
    ctx.beginPath();
    ctx.arc(hazards[i].x, hazards[i].y, 10, 0, Math.PI * 2);
    ctx.fill();

    // 碰撞檢測：飛船撞到障礙物 -> 反饋玩具震動與紅燈
    const dist = Math.hypot(hazards[i].x - playerX, hazards[i].y - (canvas.height - 20));
    if (dist < 25) {
      hazards.splice(i, 1);
      sendCommand(0x10, 3); // 指令：玩具震動 300ms
      sendCommand(0x20, 255, 0); // 指令：玩具閃紅燈
    }
  }

  requestAnimationFrame(gameLoop);
}

gameLoop();


 
// ===== HeartSync 中英文切換功能 =====
(function () {
  const languageSelect = document.getElementById('language-select');

  // 英文和中文對照表
  const translations = {
    en: {
      navHome: 'Home',
      navAbout: 'About Us',
      navPlay: 'Play',
      navParents: 'Parents',
      login: 'Log in',
      welcome: 'WELCOME TO HEARTSYNC',
      slogan: 'Music Lights Brighter Tomorrows',    
      description: 'Learning English through rhythm, light and play.',
      aboutTitle: 'About HeartSync',
      aboutIntro: 'Discover how music, light and play come together in HeartSync.',
      parentsTitle: 'Parents Area',
      parentsIntro: "Your child's learning journey, all in one place.",
      parentsComing: 'Coming Soon',
      parentsMessage: 'Learning progress and activity records will be available in the future.',
      contactTitle: 'Contact Us',
      contactIntro: "Have a question about HeartSync? We'd love to hear from you!",
      storyTitle: 'Our Story',
      storyPlaceholder: 'Coming Soon',
      vmvTitle: 'Our VMV',
      visionTitle: 'Vision',
      visionPlaceholder: 'Coming Soon',
      missionTitle: 'Mission',
      missionPlaceholder: 'Coming Soon',
      valuesTitle: 'Values',
      valuesPlaceholder: 'Coming Soon'
    },

    zh: {
      navHome: '首頁',
      navAbout: '關於我們',
      navPlay: '開始遊戲',
      navParents: '家長專區',
      login: '登入',
      welcome: '歡迎來到 HeartSync',
      slogan: '以音樂點亮更好的明天',
      description: '透過節奏、燈光與遊戲，讓英語學習充滿樂趣。',
      aboutTitle: '關於 HeartSync',
      aboutIntro: '探索 HeartSync 如何將音樂、燈光與遊戲結合，讓學習充滿樂趣。',
      parentsTitle: '家長專區',
      parentsIntro: '在這裡陪伴孩子的每一步學習旅程。',
      parentsComing: '即將推出',
      parentsMessage: '未來將提供學習進度與活動紀錄，方便家長了解孩子的成長。',
      contactTitle: '聯絡我們',
      contactIntro: '對 HeartSync 有任何疑問嗎？歡迎透過以下方式聯絡我們！',
      storyTitle: '我們的故事',
      storyPlaceholder: '即將推出',
      vmvTitle: '我們的願景、使命與價值觀',
      visionTitle: '願景',
      visionPlaceholder: '即將推出',
      missionTitle: '使命',
      missionPlaceholder: '即將推出',
      valuesTitle: '價值觀',
      valuesPlaceholder: '即將推出'
    }
  };

  function changeLanguage(language) {
    const words = translations[language] || translations.en;

    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      const key = element.getAttribute('data-i18n');

      if (words[key] !== undefined) {
        element.textContent = words[key];
      }
    });

    document.documentElement.lang = language === 'zh' ? 'zh-Hant' : 'en';
  }

  if (languageSelect) {
    languageSelect.addEventListener('change', function () {
      changeLanguage(languageSelect.value);
    });

    changeLanguage(languageSelect.value);
  }
})();

/* ===== HeartSync 页面切换功能 ===== */
(function () {
  const pageIds = ['home', 'about', 'play', 'parents'];

  function showPage(pageId) {
    if (!pageIds.includes(pageId)) {
      pageId = 'home';
    }

    pageIds.forEach(function (id) {
      const page = document.getElementById(id);

      if (page) {
        page.hidden = (id !== pageId);
      }
    });

    window.scrollTo(0, 0);
  }

  document.querySelectorAll('nav a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      const pageId = link.getAttribute('href').substring(1);

      if (pageIds.includes(pageId)) {
        event.preventDefault();
        window.location.hash = pageId;
        showPage(pageId);
      }
    });
  });

  window.addEventListener('hashchange', function () {
    showPage(window.location.hash.substring(1));
  });

  showPage(window.location.hash.substring(1) || 'home');
})();



/* ===== HeartSync Sensory Settings Flow ===== */
(function () {
  const modeSelection = document.getElementById('play-mode-selection');
  const sensorySettings = document.getElementById('sensory-settings');
  const modeLabel = document.getElementById('selected-mode-label');

  const backBtn = document.getElementById('sensory-back-btn');
  const continueBtn = document.getElementById('sensory-start-btn');

  const connectionPage = document.getElementById('drum-connection');
  const connectionModeLabel = document.getElementById('connection-selected-mode');
  const connectionBackBtn = document.getElementById('connection-back-btn');
  const demoBtn = document.getElementById('connection-demo-btn');

  if (!modeSelection || !sensorySettings || !modeLabel ||
      !backBtn || !continueBtn || !connectionPage ||
      !connectionModeLabel || !connectionBackBtn || !demoBtn) {
    console.warn('HeartSync: A page element is missing.');
    return;
  }

  const modes = [
    ['mode1-card', 'Mode 1 — Free Exploration'],
    ['mode2-card', 'Mode 2 — Follow the Light'],
    ['learning-journey-card', 'Mode 2 — Learning Journey']
  ];

  let selectedMode = '';

  function openSettings(modeName) {
    selectedMode = modeName;
    modeLabel.textContent = 'Selected: ' + selectedMode;

    modeSelection.hidden = true;
    connectionPage.hidden = true;
    sensorySettings.hidden = false;

    sensorySettings.scrollIntoView();
  }

  // Select a game mode
  modes.forEach(function (mode) {
    const card = document.getElementById(mode[0]);
    if (!card) return;

    card.style.cursor = 'pointer';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', 'Choose ' + mode[1]);

    function chooseMode() {
      openSettings(mode[1]);
    }

    card.addEventListener('click', chooseMode);

    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        chooseMode();
      }
    });
  });

  // Back: Sensory Settings -> Mode Selection
  backBtn.addEventListener('click', function () {
    sensorySettings.hidden = true;
    modeSelection.hidden = false;
    modeSelection.scrollIntoView();
  });

  // Continue: Sensory Settings -> Connect Drum
  continueBtn.addEventListener('click', function () {
    const visualMode = document.querySelector(
      'input[name="visual-mode"]:checked'
    );

    const soundEnabled =
      document.getElementById('sensory-sound').checked;

    const reduceMotion =
      document.getElementById('sensory-reduce-motion').checked;

    // Keep selections available for the future demo game
    window.heartSyncSession = {
      mode: selectedMode,
      visual: visualMode ? visualMode.value : 'gentle',
      sound: soundEnabled,
      reduceMotion: reduceMotion
    };

    connectionModeLabel.textContent =
      'Selected: ' + selectedMode;

    sensorySettings.hidden = true;
    connectionPage.hidden = false;

    connectionPage.scrollIntoView();
  });

  // Back: Connect Drum -> Sensory Settings
  connectionBackBtn.addEventListener('click', function () {
    connectionPage.hidden = true;
    sensorySettings.hidden = false;
    sensorySettings.scrollIntoView();
  });


  // ===== HeartSync Virtual Drum Demo =====

  const demoPage = document.getElementById('heartsync-demo');
  const drumPad = document.getElementById('demo-drum-pad');
  const demoModeLabel = document.getElementById('demo-mode-label');
  const demoFeedback = document.getElementById('demo-feedback');
  const tapCount = document.getElementById('demo-tap-count');
  const resetBtn = document.getElementById('demo-reset-btn');
  const demoBackBtn = document.getElementById('demo-back-btn');

  if (!demoPage || !drumPad || !demoModeLabel ||
      !demoFeedback || !tapCount || !resetBtn || !demoBackBtn) {
    console.warn('HeartSync: Demo elements are missing.');
    return;
  }

  let hits = 0;
  let colorIndex = 0;

  const gentleColors = [
    '#D8F4EE',
    '#FFE2DB',
    '#FFF1DD'
  ];

  const colourfulColors = [
    '#FFB5A7',
    '#FFE082',
    '#A7E8D5',
    '#B8C8FF',
    '#E5BEFA'
  ];

  function updateDrumColor() {
    const settings = window.heartSyncSession || {};
    const colourful = settings.visual === 'colourful';

    const colors = colourful
      ? colourfulColors
      : gentleColors;

    drumPad.style.background =
      colors[colorIndex % colors.length];

    drumPad.style.borderColor =
      colourful ? '#E8898A' : '#63C7BE';

    drumPad.style.transition = settings.reduceMotion
      ? 'none'
      : 'background-color 0.2s ease, border-color 0.2s ease';
  }

  function tapDrum() {
    hits += 1;
    colorIndex += 1;

    tapCount.textContent = hits;
    demoFeedback.textContent = 'Great job! ♪';

    updateDrumColor();
  }

  function resetDemo() {
    hits = 0;
    colorIndex = 0;

    tapCount.textContent = '0';
    demoFeedback.textContent = 'Ready to play!';

    updateDrumColor();
  }

  // Connect Drum -> Demo Mode
  demoBtn.addEventListener('click', function () {
    const settings = window.heartSyncSession || {};

    demoModeLabel.textContent =
      settings.mode || 'Free Exploration';

    connectionPage.hidden = true;
    demoPage.hidden = false;

    resetDemo();
    demoPage.scrollIntoView();
  });

  // Tap on the drum
  drumPad.addEventListener('click', tapDrum);

  // Keyboard: Space to tap
  document.addEventListener('keydown', function (event) {
    if (demoPage.hidden || event.key !== ' ') {
      return;
    }

    const active = document.activeElement;
    const tag = active ? active.tagName : '';

    // Do not interfere with buttons or form fields
    if (tag === 'BUTTON' || tag === 'INPUT' ||
        tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }

    event.preventDefault();

    if (!event.repeat) {
      tapDrum();
    }
  });

  // Reset hit counter
  resetBtn.addEventListener('click', resetDemo);

  // Demo Mode -> Connect Drum
  demoBackBtn.addEventListener('click', function () {
    demoPage.hidden = true;
    connectionPage.hidden = false;

    connectionPage.scrollIntoView();
  });

  // ===== End Virtual Drum Demo =====
})();
