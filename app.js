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
      loginClose: 'Close',
      loginWelcome: 'Welcome to HeartSync',
      loginIntro: 'Choose how you would like to continue.',
      parentLoginTitle: 'Parent Log In',
      parentLoginIntro: "Parents will be able to manage their child's learning records and settings.",
      parentEmailComing: 'Email Sign In - Coming Soon',
      guestPlayTitle: 'Play as Guest',
      guestPlayIntro: 'Explore music and games without creating an account.',
      guestPlayButton: 'Start Playing',

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
      
vmvTitle: 'Our Vision, Mission & Core Values',

visionTitle: 'Vision',
visionMotto: 'Music Lights Brighter Tomorrows.',
visionPlaceholder: `To build an inclusive society where every child (especially SEN students) can independently self-regulate, build focus, and learn through accessible and tech-enabled music sensory kits, enjoying the joy of confident growth.`,

missionTitle: 'Mission',
missionPlaceholder: `To empower children (especially SEN students) with fun and interactive music sensory kit (LED-programmable instruments & online game platform). HeartSync aims to enable SEN students and children to independently train their focus, impulse control, and emotional well-being without constant adult supervision, while easily integrating music and English vocabulary learning.`,

valuesTitle: 'Core Values',

value1Title: 'Affordability & Accessibility',
value1Body: `Lowering economic and usage barriers, making effective interactive music sensory kits easily accessible to every family, school, and community center.`,

value2Title: 'Self-Directed Empowerment',
value2Body: `Creating instruments and games with zero dependency and clear guidance mechanisms, encouraging children to build focus, confidence, and emotional self-control at their own pace.`,

value3Title: 'Playful & Inclusive Learning',
value3Body: `Combining sensory relaxation interventions with interactive games such as English vocabulary and musical rhythms creates a joyful learning experience suitable for all children.`,

value4Title: 'Child-Centric Safety & Ethical Care',
value4Body: `Adhering to safe and non-toxic hardware design, low-irritation lighting protection modes, and strict personal data privacy protection (anonymization & parental autonomy) establishes a trustworthy product experience.`,


// Sensory Settings
connectionTitle: 'Connect Your HeartSync Drum',
connectionIntro: 'Connect your drum or continue without one.',
enterLearningWorld: '⭐ Enter Learning World',
drumStatusTitle: 'Drum Status',
connectionNoDrum: 'You can continue without a drum.',
connectionHelp: 'Turn on your HeartSync drum, then select Connect Drum.',
connectionConnect: 'Connect Drum',
connectionDemo: 'Try Demo Mode',
connectionNotConnected: 'Not Connected',
connectionConnecting: 'Connecting...',
connectionConnected: 'Drum Connected',
connectionDisconnected: 'Drum Disconnected',
connectionFailed: 'Connection unsuccessful',
connectionUnsupported: 'Web Bluetooth is not supported in this browser.',
connectionLastHit: 'Last Drum Hit: —',
connectionConnectedButton: 'Drum Connected ✓',
sensoryTitle: 'Sensory Settings',
sensoryIntro: 'Make HeartSync comfortable for you.',
screenAppearance: 'Screen Appearance',
screenDescription: 'Choose colours that feel comfortable.',
gentle: 'Gentle',
colourful: 'Colourful',
reduceMotion: 'Reduce Motion',
drumLight: 'Drum Light',
drumLightDescription: 'Adjust the drum lighting.',
brightness: 'Brightness',
soundEffects: 'Sound Effects',
back: 'Back',
continue: 'Continue',
chooseAdventure: 'Choose Your Adventure!',
chooseModeIntro: 'Choose a mode to begin your musical journey.',
learningWorldTitle: 'Choose Your Learning World!',
learningWorldIntro1: 'Every child has their own path to shine.',
learningWorldIntro2: 'Where would you like to explore today?',
worldFruits: 'Fruits',
worldAvailable: '✓ Available',
worldTransport: 'Transport',
worldAnimals: 'Animals',
worldColors: 'Colors',
worldNumbers: 'Numbers',
worldFood: 'Food',
worldShapes: 'Shapes',
worldFamily: 'Family',
worldComingSoon: 'Coming Soon'




    },

    zh: {
      navHome: '首頁',
      navAbout: '關於我們',
      navPlay: '開始遊戲',
      navParents: '家長專區',
      login: '登入',
      loginClose: '關閉',
      loginWelcome: '歡迎來到 HeartSync',
      loginIntro: '選擇適合你的使用方式。',
      parentLoginTitle: '家長登入',
      parentLoginIntro: '家長登入後，未來可以管理孩子的學習記錄及設定。',
      parentEmailComing: '電郵登入－即將推出',
      guestPlayTitle: '訪客試玩',
      guestPlayIntro: '無需建立帳戶，即可探索音樂與遊戲。',
      guestPlayButton: '開始遊戲',
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
      vmvTitle: '我們的願景、使命與核心價值',
      visionTitle: '願景',
      visionMotto: '以音樂點亮更好的明天。',
      visionPlaceholder: `打造一個包容共享的社會，讓每一位兒童（特別是SEN孩子）都能透過普及且具啟發性的音樂感官科技，獨立進行情緒調節、提升專注力與自主學習，享受自信成長的快樂。`,
      missionTitle: '使命',
      missionPlaceholder: `我們致力於為兒童（特別是SEN孩子）提供趣味豐富的音樂感官輔助套件（LED 燈光程式化樂器與線上遊戲平台）。HeartSync致力於讓 SEN 學生與兒童在無需成人全程陪同的情況下，能夠自主進行專注力、衝動控制與情緒舒緩訓練，同時輕鬆融入音樂與英語單字的趣味學習。`,
      valuesTitle: '核心價值',
      value1Title: '平等普及',
      value1Body: `降低經濟與使用門檻，讓每一個家庭、學校與社區中心皆能輕鬆獲取有效的互動干預工具。`,
      value2Title: '自主賦能',
      value2Body: `打造零依賴、具明確引導機制的樂器與遊戲，鼓勵孩子依據自己的節奏建立專注力、自信心與情緒自控力。`,
      value3Title: '寓教於樂',
      value3Body: `將感官舒緩干預與英文單字、音樂音律等互動遊戲互相結合，打造適合所有孩子一同參與的快樂學習體驗。`,
      value4Title: '安全信任',
      value4Body: `堅持使用安全無毒的硬體設計、低刺激的燈光防護模式，以及嚴格的個人資料隱私保護（匿名化處理與家長自主權），建立值得信任的產品體驗。`,


// 感官設定
connectionTitle: '連接你的 HeartSync 電子鼓',
connectionIntro: '連接你的電子鼓，或選擇不使用電子鼓繼續。',
enterLearningWorld: '⭐ 進入學習世界',
drumStatusTitle: '電子鼓連接狀態',
connectionNoDrum: '沒有電子鼓也可以繼續學習。',
connectionHelp: '開啟你的 HeartSync 電子鼓，然後按「連接電子鼓」。',
connectionConnect: '連接電子鼓',
connectionDemo: '試玩模式',
connectionNotConnected: '尚未連接',
connectionConnecting: '正在連接...',
connectionConnected: '電子鼓已連接',
connectionDisconnected: '電子鼓已斷線',
connectionFailed: '連接未成功',
connectionUnsupported: '此瀏覽器不支援 Web Bluetooth。',
connectionLastHit: '上次敲鼓：—',
connectionConnectedButton: '電子鼓已連接 ✓',
sensoryTitle: '感官設定',
sensoryIntro: '打造讓你感到舒適的 HeartSync 體驗。',
screenAppearance: '畫面外觀',
screenDescription: '選擇讓你感到舒適的色彩。',
gentle: '柔和模式',
colourful: '繽紛模式',
reduceMotion: '減少動畫',
drumLight: '鼓燈設定',
drumLightDescription: '調整鼓的燈光效果。',
brightness: '亮度',
soundEffects: '遊戲音效',
back: '返回',
continue: '繼續',
chooseAdventure: '選擇你的音樂冒險！',
chooseModeIntro: '選擇一個模式，開始你的音樂旅程。',
learningWorldTitle: '選擇你的學習世界！',
learningWorldIntro1: '每個孩子都有自己的星軌。',
learningWorldIntro2: '今天想去哪裡探索？',
worldFruits: '水果',
worldAvailable: '✓ 可學習',
worldTransport: '交通工具',
worldAnimals: '動物',
worldColors: '顏色',
worldNumbers: '數字',
worldFood: '食物',
worldShapes: '形狀',
worldFamily: '家庭',
worldComingSoon: '即將推出'




    }
  };

  
window.heartSyncTranslate = function (key) {
  const currentLanguage = languageSelect ? languageSelect.value : 'en';
  const words = translations[currentLanguage] || translations.en;
  return words[key] !== undefined ? words[key] : key;
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
    if (typeof window.heartSyncRefreshConnectionLanguage === 'function') {
      window.heartSyncRefreshConnectionLanguage();
}
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

// Translate the selected Play mode
const modeTranslations = {
  'Mode 1 — Free Exploration': '模式一 — 自由探索',
  'Mode 2 — Follow the Light': '模式二 — 燈光引導',
  'Mode 2 — Learning Journey': '模式二 — 學習旅程'
};

function translateModeName(modeName) {
  const languageSelect =
    document.getElementById('language-select');

  const chinese = languageSelect &&
    languageSelect.value === 'zh';

  return chinese
    ? (modeTranslations[modeName] || modeName)
    : modeName;
}

function updateSelectedModeLanguage() {
  if (!selectedMode) return;

  const languageSelect =
    document.getElementById('language-select');

  const chinese = languageSelect &&
    languageSelect.value === 'zh';

  const translatedName = translateModeName(selectedMode);

  const selectedText = chinese
    ? '已選擇：' + translatedName
    : 'Selected: ' + translatedName;

  modeLabel.textContent = selectedText;
  connectionModeLabel.textContent = selectedText;

  const demoModeLabel =
    document.getElementById('demo-mode-label');

  if (demoModeLabel) {
    demoModeLabel.textContent = translatedName;
  }
}

// Update immediately when the visitor changes language
const modeLanguageSelect =
  document.getElementById('language-select');

if (modeLanguageSelect) {
  modeLanguageSelect.addEventListener(
    'change',
    updateSelectedModeLanguage
  );
}

function openSettings(modeName) {

    selectedMode = modeName;
    updateSelectedModeLanguage();

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
    connectionPage.hidden = true;

    const worldPage = document.getElementById(
      'learning-world-selection'
    );

    if (worldPage) {
      worldPage.hidden = true;
    }

    modeSelection.hidden = false;
    modeSelection.scrollIntoView();
  });

  // Continue: Sensory Settings -> Next Page
  continueBtn.addEventListener('click', function () {
    const visualMode = document.querySelector(
      'input[name="visual-mode"]:checked'
    );

    const soundEnabled =
      document.getElementById('sensory-sound').checked;

    const reduceMotion =
      document.getElementById('sensory-reduce-motion').checked;

    // Save Sensory Settings
    window.heartSyncSession = {
      ...(window.heartSyncSession || {}),
      mode: selectedMode,
      visual: visualMode ? visualMode.value : 'gentle',
      sound: soundEnabled,
      reduceMotion: reduceMotion
    };

    updateSelectedModeLanguage();
    sensorySettings.hidden = true;

   
    // Hide Learning World until after drum connection
    const worldPage = document.getElementById(
      'learning-world-selection'
    );

    if (worldPage) {
      worldPage.hidden = true;
    }

    // All modes go to Connect Drum first
    connectionPage.hidden = false;
    connectionPage.scrollIntoView();

  });

  // ===== Learning Journey: Continue to Learning World =====

  const learningWorldBtn = document.getElementById(
    'connection-learning-world-btn'
  );

  if (learningWorldBtn) {

    // Show the correct button for each game mode
    continueBtn.addEventListener('click', function () {
      const isLearningJourney =
        selectedMode.includes('Learning Journey');

      learningWorldBtn.hidden = !isLearningJourney;
      demoBtn.hidden = isLearningJourney;
    });

    // Go to Learning World after the drum connection step
    learningWorldBtn.addEventListener('click', function () {
      if (!selectedMode.includes('Learning Journey')) {
        return;
      }

      const worldPage = document.getElementById(
        'learning-world-selection'
      );

      if (!worldPage) {
        console.warn('Learning World page not found.');
        return;
      }

      connectionPage.hidden = true;
      worldPage.hidden = false;
const visualMode = window.heartSyncSession?.visual || 'gentle';

worldPage.querySelectorAll(
  'img[data-gentle-src][data-colourful-src]'
).forEach(function (img) {
  img.src = visualMode === 'colourful'
    ? img.dataset.colourfulSrc
    : img.dataset.gentleSrc;
});
      worldPage.scrollIntoView();
    });
  }

  // ===== End Learning Journey Continue =====

  // Learning World Back -> Sensory Settings
  const worldBackBtn = document.getElementById(
    'world-back-btn'
  );

  if (worldBackBtn) {
    worldBackBtn.addEventListener('click', function () {
      const worldPage = document.getElementById(
        'learning-world-selection'
      );

      if (worldPage) {
        worldPage.hidden = true;
      }

      sensorySettings.hidden = false;
      sensorySettings.scrollIntoView();
    });
  }



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

demoModeLabel.textContent = translateModeName(
  settings.mode || selectedMode || 'Mode 1 — Free Exploration'
);

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


/* ===== HeartSync Drum Brightness Control ===== */
(function () {
  const brightnessSlider =
    document.getElementById('drum-brightness');

  const brightnessValue =
    document.getElementById('drum-brightness-value');

  if (!brightnessSlider || !brightnessValue) {
    return;
  }

  function updateBrightness() {
    const brightness = Number(brightnessSlider.value);

    // Update percentage immediately
    brightnessValue.textContent = brightness + '%';

    // Save the selected brightness for later use
    window.heartSyncSession = {
      ...(window.heartSyncSession || {}),
      drumBrightness: brightness
    };
  }

  // Update while dragging the slider
  brightnessSlider.addEventListener(
    'input',
    updateBrightness
  );

  // Also update when the value changes
  brightnessSlider.addEventListener(
    'change',
    updateBrightness
  );

  // Show the correct percentage when page loads
  updateBrightness();
})();


/* ===== HeartSync Screen Appearance ===== */
(function () {
  const playPage = document.getElementById('play');
  const visualInputs = document.querySelectorAll(
    '#sensory-settings input[name="visual-mode"]'
  );

  const reduceMotionInput = document.getElementById(
    'sensory-reduce-motion'
  );

  if (!playPage || !visualInputs.length ||
      !reduceMotionInput) {
    return;
  }

  // Add colours for the two screen themes
  const style = document.createElement('style');


  style.textContent = `
    /* ===== Colourful: Main Background ===== */

    #play.hs-colourful #sensory-settings,
    #play.hs-colourful #drum-connection,
    #play.hs-colourful #heartsync-demo {
      background: #FFF1EA !important;
    }

    /* Screen Appearance: Soft Pink */
    #play.hs-colourful
    #sensory-settings > div > div:nth-child(1) {
      background: #FFE9F0 !important;
      border: 2px solid #F5B3C9 !important;
    }

    /* Drum Light: Cream Yellow */
    #play.hs-colourful
    #sensory-settings > div > div:nth-child(2) {
      background: #FFF3CA !important;
      border: 2px solid #F0D16B !important;
    }

    /* Sound Effects: Mint Green */
    #play.hs-colourful
    #sensory-settings > div > div:nth-child(3) {
      background: #DFF8EE !important;
      border: 2px solid #9DDDC6 !important;
    }

    /* Colourful: Radio Buttons and Checkboxes */
    #play.hs-colourful
    #sensory-settings input[type="radio"],
    #play.hs-colourful
    #sensory-settings input[type="checkbox"] {
      accent-color: #DE7797;
    }

    /* Colourful: Brightness Slider */
    #play.hs-colourful #drum-brightness {
      accent-color: #E88A9D !important;
    }

    /* Colourful: Continue Buttons */
    #play.hs-colourful #sensory-start-btn,
    #play.hs-colourful #connection-demo-btn {
      background: #F087A2 !important;
      color: white !important;
    }

    /* Keep animations gentle */
    #play.hs-soft-motion #sensory-settings,
    #play.hs-soft-motion #drum-connection,
    #play.hs-soft-motion #heartsync-demo,
    #play.hs-soft-motion #sensory-settings > div > div {
      transition:
        background-color 0.25s ease,
        border-color 0.25s ease;
    }

    /* Respect reduced motion preferences */
    @media (prefers-reduced-motion: reduce) {
      #play.hs-soft-motion #sensory-settings,
      #play.hs-soft-motion #drum-connection,
      #play.hs-soft-motion #heartsync-demo,
      #play.hs-soft-motion #sensory-settings > div > div {
        transition: none;
      }
    }
  `;


  document.head.appendChild(style);

  function updateScreenAppearance() {
    const selected = document.querySelector(
      '#sensory-settings input[name="visual-mode"]:checked'
    );

    const visual = selected
      ? selected.value
      : 'gentle';

    const reduceMotion = reduceMotionInput.checked;

    // Switch colours immediately
    playPage.classList.toggle(
      'hs-colourful',
      visual === 'colourful'
    );

    // Allow soft transitions only when appropriate
    playPage.classList.toggle(
      'hs-soft-motion',
      !reduceMotion
    );

    // Remember settings without deleting other options
    window.heartSyncSession = {
      ...(window.heartSyncSession || {}),
      visual: visual,
      reduceMotion: reduceMotion
    };
  }

  // Update immediately when the visitor changes settings
  visualInputs.forEach(function (input) {
    input.addEventListener(
      'change',
      updateScreenAppearance
    );
  });

  reduceMotionInput.addEventListener(
    'change',
    updateScreenAppearance
  );

  // Apply the default settings
  updateScreenAppearance();
})();


/* ===== HeartSync Login Dialog ===== */
(function () {
  const openBtn = document.getElementById('open-login-btn');
  const dialog = document.getElementById('heartsync-login');
  const closeBtn = document.getElementById('login-close-btn');
  const guestBtn = document.getElementById('guest-play-btn');

  if (!openBtn || !dialog || !closeBtn || !guestBtn) {
    console.warn('HeartSync: Login elements are missing.');
    return;
  }

  let previousFocus = null;

  function openLogin() {
    previousFocus = document.activeElement;

    dialog.hidden = false;
    closeBtn.focus();
  }

  function closeLogin() {
    dialog.hidden = true;

    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  }

  // Open Login
  openBtn.addEventListener('click', openLogin);

  // Close Login
  closeBtn.addEventListener('click', closeLogin);

  // Close when clicking outside the white dialog
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) {
      closeLogin();
    }
  });

  // Escape key closes the dialog
  document.addEventListener('keydown', function (event) {
    if (!dialog.hidden && event.key === 'Escape') {
      closeLogin();
    }
  });

  // Keep keyboard focus within the dialog
  dialog.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;

    const focusable = Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled])'
      )
    ).filter(function (element) {
      return element.getClientRects().length > 0;
    });

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey &&
               document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Guest Play: go directly to the Play page
  guestBtn.addEventListener('click', function () {
    dialog.hidden = true;

    // Use HeartSync's existing page navigation
    window.location.hash = 'play';

    const playPage = document.getElementById('play');

    if (playPage) {
      playPage.scrollIntoView();
    }
  });

})();


/* ===== HeartSync ESP32 BLE Drum Connection ===== */
(function () {
  const connectButton =
    document.getElementById('connection-connect-btn');

  const statusDisplay =
    document.getElementById('drum-connection-status');

  const hitDisplay =
    document.getElementById('drum-last-hit');

  if (!connectButton || !statusDisplay || !hitDisplay) {
    console.warn('HeartSync: Drum connection elements missing.');
    return;
  }

  const SERVICE_UUID =
    '4fafc201-1fb5-459e-8fcc-c5c9c331914b';

  const HIT_UUID =
    'beb5483e-36e1-4688-b7f5-ea07361b26a8';

  let drumDevice = null;
  let connecting = false;
  const decoder = new TextDecoder();


let currentStatusKey = 'connectionNotConnected';
let lastDrumHit = null;

function setStatus(statusKey) {
  currentStatusKey = statusKey;
  statusDisplay.textContent =
    window.heartSyncTranslate(statusKey);
}

window.heartSyncRefreshConnectionLanguage = function () {
  statusDisplay.textContent =
    window.heartSyncTranslate(currentStatusKey);

  connectButton.textContent = window.heartSyncTranslate(
    currentStatusKey === 'connectionConnected'
      ? 'connectionConnectedButton'
      : 'connectionConnect'
  );
hitDisplay.textContent =
  window.heartSyncTranslate('connectionLastHit').replace('—', lastDrumHit === null ? '—' : lastDrumHit);
};


  function onDrumDisconnected() {
    setStatus('connectionDisconnected');
    connectButton.textContent =
      window.heartSyncTranslate('connectionConnect');
  }

  function onDrumHit(event) {
    const value = event.target.value;

    const bytes = new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength
    );

    const message = decoder.decode(bytes);

    if (!/^HIT:\d+$/.test(message)) {
      console.log('HeartSync BLE data:', message);
      return;
    }

lastDrumHit = message;
hitDisplay.textContent =
  window.heartSyncTranslate('connectionLastHit').replace('—', message);
    console.log('HeartSync received:', message);
  }

  connectButton.addEventListener('click', async function () {
    if (connecting) return;

    if (!navigator.bluetooth) {
      setStatus('connectionUnsupported');
      return;
    }

    connecting = true;
    connectButton.disabled = true;
    setStatus('connectionConnecting');


    try {
      drumDevice = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'HeartSync_Drum' }],
        optionalServices: [SERVICE_UUID]
      });

      drumDevice.addEventListener(
        'gattserverdisconnected',
        onDrumDisconnected
      );

      const server = await drumDevice.gatt.connect();
      const service =
        await server.getPrimaryService(SERVICE_UUID);

      const hitCharacteristic =
        await service.getCharacteristic(HIT_UUID);

      hitCharacteristic.addEventListener(
        'characteristicvaluechanged',
        onDrumHit
      );

      await hitCharacteristic.startNotifications();

      setStatus('connectionConnected');
      connectButton.textContent =
        window.heartSyncTranslate('connectionConnectedButton');


    } catch (error) {
      console.error('HeartSync BLE connection error:', error);

      setStatus('connectionFailed');

      connectButton.textContent =
        window.heartSyncTranslate('connectionConnect');


    } finally {
      connecting = false;
      connectButton.disabled = false;
    }
  });
})();
/* ===== End HeartSync ESP32 BLE Connection ===== */



/* HeartSync Learning World V3 - Visual Mode Images */
(() => {
  function updateLearningWorldImages() {
    const selectedMode =
      document.querySelector('input[name="visual-mode"]:checked')?.value
      || "gentle";

    document.querySelectorAll(
      "#learning-world-selection img[data-gentle-src][data-colourful-src]"
    ).forEach((img) => {
      img.src = selectedMode === "colourful"
        ? img.dataset.colourfulSrc
        : img.dataset.gentleSrc;
    });
  }

  document.querySelectorAll(
    'input[name="visual-mode"]'
  ).forEach((radio) => {
    radio.addEventListener("change", updateLearningWorldImages);
  });

  updateLearningWorldImages();
})();


/* ===== HeartSync Apple Learning Journey ===== */
(function () {
  const applePage = document.getElementById("apple-learning");
  const worldPage = document.getElementById(
    "learning-world-selection"
  );
  const fruitsBtn = document.getElementById("world-fruits-btn");

  if (!applePage || !worldPage || !fruitsBtn) return;

  const drum = document.getElementById("hs-apple-drum");
  const ap = document.getElementById("hs-apple-ap");
  const ple = document.getElementById("hs-apple-ple");
  const progress = document.getElementById("hs-apple-progress");
  const star = document.getElementById("hs-apple-star");
  const english = document.getElementById(
    "hs-apple-english-line"
  );
  const rhythm = document.getElementById(
    "hs-apple-rhythm-line"
  );


let hits = 0;
let lightTimer;
let demoTimers = [];
  
const appleRhythmAudio = new Audio(
  "assets/audio/apple-pronunciation.mp3"
);

appleRhythmAudio.preload = "auto";


let appleAudioContext = null;

// 準備節拍聲音
function prepareAppleAudio() {
  if (window.heartSyncSession?.sound !== true) return;

  const AudioClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioClass) return;

  if (!appleAudioContext) {
    appleAudioContext = new AudioClass();
  }

  if (appleAudioContext.state === "suspended") {
    appleAudioContext.resume().catch(console.warn);
  }
}

// 播放輕柔節拍聲
function playAppleBeat(strong) {
  if (
    window.heartSyncSession?.sound !== true ||
    !appleAudioContext
  ) return;

  const ctx = appleAudioContext;
  const oscillator = ctx.createOscillator();
  const volume = ctx.createGain();
  const now = ctx.currentTime;

  oscillator.type = "sine";

 
oscillator.frequency.setValueAtTime(
  strong ? 260 : 580, now
);

oscillator.frequency.exponentialRampToValueAtTime(
  strong ? 150 : 420, now + 0.15
);


  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(
    strong ? 0.18 : 0.07,
    now + 0.01
  );
  volume.gain.exponentialRampToValueAtTime(
    0.0001,
    now + 0.17
  );

  oscillator.connect(volume);
  volume.connect(ctx.destination);

  oscillator.start(now);
oscillator.stop(now + 0.20);
}

function stopAppleDemo() {
  
// 停止音頻並回到開頭
appleRhythmAudio.pause();
appleRhythmAudio.currentTime = 0;

  demoTimers.forEach(clearTimeout);
  demoTimers = [];

  // 恢復孩子實際完成的拍數
  ap.classList.toggle("is-active", hits >= 1);
  ple.classList.toggle("is-active", hits >= 2);
}

function resetApple() {
  stopAppleDemo();
    hits = 0;
    clearTimeout(lightTimer);
    stopAppleDemo();

    ap.classList.remove("is-active");
    ple.classList.remove("is-active");
    drum.classList.remove("is-hit");

    progress.textContent = "點擊鼓面，開始第一拍";

    english.textContent =
      "我們一起聽聽 Apple 怎麼讀吧！";

    rhythm.textContent =
      "準備好就跟著我敲兩下吧！";

    star.textContent =
      "星星：歡迎來到水果世界！" +
      "我們可以按照自己的速度慢慢學習。";
  }

  function openApple() {
    worldPage.hidden = true;
    applePage.hidden = false;

    
    // 根據 Sensory Settings 切換 Apple 圖片
    const appleImage = document.getElementById("hs-apple-image");

    if (appleImage) {
      const visualMode =
        window.heartSyncSession?.visual || "gentle";

      appleImage.src = visualMode === "colourful"
        ? appleImage.dataset.colourfulSrc
        : appleImage.dataset.gentleSrc;
    }


    applePage.classList.toggle(
      "hs-apple-reduced",
      !!window.heartSyncSession?.reduceMotion
    );

    resetApple();
    applePage.scrollIntoView();
  }


function tapApple() {
  if (applePage.hidden || hits >= 2) return;

  // 孩子開始敲鼓時，停止示範
  stopAppleDemo();


    hits++;

    // 每敲一下，鼓面出現一次柔和紅色光波
    clearTimeout(lightTimer);
    drum.classList.remove("is-hit");
    void drum.offsetWidth;
    drum.classList.add("is-hit");

    lightTimer = setTimeout(function () {
      drum.classList.remove("is-hit");
    }, 400);

    if (hits === 1) {
      ap.classList.add("is-active");

      progress.textContent = "第一拍：AP";

      rhythm.textContent =
        "咚！第一下完成了，接下來是 ple。";

      star.textContent =
        "星星：我們已經開始了！慢慢敲下一下。";
    }

    if (hits === 2) {
      ple.classList.add("is-active");

      progress.textContent = "Apple 練習完成！";

      rhythm.textContent =
        "咚咚！兩下都敲完了！";

      star.textContent =
        "星星：你完成了這次練習！" +
        "想再試一次，還是繼續探索？";
    }
  }

  // Learning World → Apple
  fruitsBtn.addEventListener("click", openApple);

  // Apple → Learning World
  document.getElementById("apple-back")
    .addEventListener("click", function () {
      applePage.hidden = true;
      worldPage.hidden = false;
      worldPage.scrollIntoView();
    });

  // 心心：播放英文
  document.getElementById("hs-apple-listen")
    .addEventListener("click", function () {
      english.textContent =
        "Apple 分成 AP 和 ple，AP 讀得較重。";

      star.textContent =
        "星星：可以多聽幾次，不用著急。";

      if ("speechSynthesis" in window) {
        speechSynthesis.cancel();

        const voice =
          new SpeechSynthesisUtterance("Apple");

        voice.lang = "en-US";
        voice.rate = 0.85;

        speechSynthesis.speak(voice);
      }
    });

  
/* ===== Apple Watch Rhythm Demo ===== */

document.getElementById("hs-apple-watch")
  .addEventListener("click", function () {

    stopAppleDemo();

    // 示範不計入孩子的敲鼓次數
    ap.classList.remove("is-active");
    ple.classList.remove("is-active");

    progress.textContent = "先看看 AP 和 ple 的節奏！";

    // 第一拍：AP
    demoTimers.push(setTimeout(function () {
      if (applePage.hidden) return;

      ap.classList.add("is-active");
      progress.textContent = "① AP：重拍";

    }, 200));

    // 第二拍：ple
    demoTimers.push(setTimeout(function () {
      if (applePage.hidden) return;

      ap.classList.remove("is-active");
      ple.classList.add("is-active");
      progress.textContent = "② ple：輕拍";

    }, 1200));

    // 示範完成
    demoTimers.push(setTimeout(function () {
      if (applePage.hidden) return;

      stopAppleDemo();

      progress.textContent =
        hits === 0
          ? "示範完成！準備好就敲兩下吧！"
          : hits === 1
            ? "第一拍已完成，下一拍是 ple。"
            : "Apple 練習完成！";

    }, 2200));

  });

/* ===== End Watch Rhythm Demo ===== */

  

  // ===== Apple Watch Rhythm =====
  const watchBtn = document.getElementById("hs-apple-watch");

  if (watchBtn) {
    watchBtn.addEventListener("click", function () {

      stopAppleDemo();

      if ("speechSynthesis" in window) {
        speechSynthesis.cancel();
      }

      ap.classList.remove("is-active");
      ple.classList.remove("is-active");

      progress.textContent = "準備播放 Apple 示範...";

      // 關閉音效時，仍可觀看視覺節奏
      if (window.heartSyncSession?.sound === false) {
        ap.classList.add("is-active");

        demoTimers.push(setTimeout(function () {
          ap.classList.remove("is-active");
          ple.classList.add("is-active");
        }, 350));

        demoTimers.push(setTimeout(function () {
          stopAppleDemo();
          progress.textContent = "示範完成！";
        }, 800));

        return;
      }

      // 依照 MP3 實際播放進度控制燈光
      function syncAppleLights() {
        if (appleRhythmAudio.paused || applePage.hidden) {
          return;
        }

        const time = appleRhythmAudio.currentTime;

        // AP：第一個音節
        ap.classList.toggle(
          "is-active",
          time >= 0.10 && time < 0.32
        );

        // ple：第二個音節
        ple.classList.toggle(
          "is-active",
          time >= 0.32 && time < 0.63
        );

        if (time >= 0.32) {
          progress.textContent = "② ple：輕拍";
        } else if (time >= 0.10) {
          progress.textContent = "① AP：重拍";
        }

        requestAnimationFrame(syncAppleLights);
      }

      // 音頻結束才結束示範
      appleRhythmAudio.onended = function () {
        stopAppleDemo();
        progress.textContent =
          "示範完成！現在可以慢慢敲兩下。";
      };

      // 從頭開始播放
      appleRhythmAudio.currentTime = 0;

      appleRhythmAudio.play()
        .then(function () {
          requestAnimationFrame(syncAppleLights);
        })
        .catch(function (error) {
          console.error("Apple 音頻播放失敗:", error);
          progress.textContent = "音頻無法播放，請再試一次。";
        });

    });
  }
  // ===== End Watch Rhythm =====


  // 網頁模擬敲鼓
  drum.addEventListener("click", tapApple);

  // 重新練習
  document.getElementById("hs-apple-reset")
    .addEventListener("click", resetApple);

  // 預留給 ESP32 藍牙敲鼓事件
  window.addEventListener(
    "heartsync:drum-hit",
    tapApple
  );
})();
