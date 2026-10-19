// アプリの状態
let webcamStream = null;
let captureInterval = null;
let timerInterval = null;
let capturedFrames = []; // 静止画コマ（データURL）の配列
let secondsElapsed = 0;
let isPaused = false;
let timerMode = 'stopwatch'; // 'stopwatch' または 'pomodoro'
let currentRating = 5;
let generatedVideoBlob = null;

// DOM要素
const webcamElement = document.getElementById('webcam');
const offscreenCanvas = document.getElementById('offscreen-canvas');
const offCtx = offscreenCanvas.getContext('2d');
const timerDisplay = document.getElementById('timer-display');
const capturedCountDisplay = document.getElementById('captured-count');
const startBtn = document.getElementById('start-btn');
const activeControls = document.getElementById('active-controls');
const pauseBtn = document.getElementById('pause-btn');
const recordingBadge = document.getElementById('recording-badge');
const frameCounter = document.getElementById('frame-counter');
const loaderModal = document.getElementById('loader-modal');
const postModal = document.getElementById('post-modal');
const previewVideo = document.getElementById('preview-video');

// カメラ初期化
async function initCamera() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false
    });
    webcamElement.srcObject = webcamStream;
  } catch (err) {
    alert('カメラへのアクセスを許可してください。');
    console.error(err);
  }
}

// タイマーモードの変更
function setTimerMode(mode) {
  if (captureInterval) return; // 録画中は変更不可
  timerMode = mode;
  document.getElementById('mode-stopwatch').className = mode === 'stopwatch' ? 'text-xs px-3 py-1 rounded-full bg-indigo-600 text-white font-semibold transition' : 'text-xs px-3 py-1 rounded-full bg-gray-700 text-gray-400 font-semibold transition';
  document.getElementById('mode-pomodoro').className = mode === 'pomodoro' ? 'text-xs px-3 py-1 rounded-full bg-indigo-600 text-white font-semibold transition' : 'text-xs px-3 py-1 rounded-full bg-gray-700 text-gray-400 font-semibold transition';
  
  secondsElapsed = mode === 'pomodoro' ? 25 * 60 : 0;
  updateTimerDisplay();
}

// 学習＆タイムラプス撮影開始
function startStudy() {
  const taskName = document.getElementById('task-name').value.trim();
  if (!taskName) {
    alert('具体タスク・目標を入力してください！（例: 単語帳P.10〜20）');
    return;
  }

  const intervalMs = parseInt(document.getElementById('interval-select').value);
  
  capturedFrames = [];
  isPaused = false;
  offscreenCanvas.width = 640;
  offscreenCanvas.height = 360;

  // コマ（画像）の定期キャプチャ
  captureInterval = setInterval(() => {
    if (isPaused) return;
    offCtx.drawImage(webcamElement, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    const dataUrl = offscreenCanvas.toDataURL('image/jpeg', 0.6);
    capturedFrames.push(dataUrl);
    capturedCountDisplay.textContent = capturedFrames.length;
  }, intervalMs);

  // タイマー開始
  if (timerMode === 'stopwatch') secondsElapsed = 0;
  else secondsElapsed = 25 * 60;

  timerInterval = setInterval(() => {
    if (isPaused) return;
    
    if (timerMode === 'stopwatch') {
      secondsElapsed++;
    } else {
      secondsElapsed--;
      if (secondsElapsed <= 0) {
        stopStudy();
        alert('🎉 ポモドーロセッションが完了しました！お疲れ様でした！');
      }
    }
    updateTimerDisplay();
  }, 1000);

  // UI状態切り替え
  startBtn.classList.add('hidden');
  activeControls.classList.remove('hidden');
  recordingBadge.classList.remove('hidden');
  frameCounter.classList.remove('hidden');
}

// 一時停止・再開
function togglePause() {
  isPaused = !isPaused;
  if (isPaused) {
    pauseBtn.innerHTML = `<i class="fa-solid fa-play"></i> 再開`;
    pauseBtn.classList.replace('bg-amber-600', 'bg-emerald-600');
    recordingBadge.classList.add('hidden');
  } else {
    pauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i> 一時停止`;
    pauseBtn.classList.replace('bg-emerald-600', 'bg-amber-600');
    recordingBadge.classList.remove('hidden');
  }
}

// 学習停止 ＆ タイムラプス動画の超高速合成
async function stopStudy() {
  clearInterval(captureInterval);
  clearInterval(timerInterval);
  captureInterval = null;

  if (capturedFrames.length === 0) {
    alert('コマ画像が記録されませんでした。');
    resetUI();
    return;
  }

  // ローダー表示
  loaderModal.classList.remove('hidden');

  // コマ画像を15fps（1秒に15コマ）の速度で連続描画して動画化（=高速タイムラプス化）
  generatedVideoBlob = await createTimelapseVideoBlob(capturedFrames, 15);

  loaderModal.classList.add('hidden');

  // モーダル設定
  previewVideo.src = URL.createObjectURL(generatedVideoBlob);
  document.getElementById('modal-task-title').textContent = document.getElementById('task-name').value;
  
  const minutes = Math.max(1, Math.round(timerMode === 'stopwatch' ? secondsElapsed / 60 : (25 * 60 - secondsElapsed) / 60));
  document.getElementById('modal-subject-time').textContent = `${document.getElementById('subject-select').value} (${minutes}分)`;

  postModal.classList.remove('hidden');
  resetUI();
}

// 画像配列から高速タイムラプスWebM動画を生成する関数
function createTimelapseVideoBlob(frames, fps = 15) {
  return new Promise((resolve) => {
    const stream = offscreenCanvas.captureStream(30);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch(e) {
      recorder = new MediaRecorder(stream);
    }

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };

    recorder.start();

    let frameIdx = 0;
    const intervalTime = 1000 / fps; // 15fpsで連続描画

    const drawNextFrame = () => {
      if (frameIdx >= frames.length) {
        setTimeout(() => recorder.stop(), 200);
        return;
      }

      const img = new Image();
      img.onload = () => {
        offCtx.drawImage(img, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
        frameIdx++;
        setTimeout(drawNextFrame, intervalTime);
      };
      img.src = frames[frameIdx];
    };

    drawNextFrame();
  });
}

function resetUI() {
  startBtn.classList.remove('hidden');
  activeControls.classList.add('hidden');
  recordingBadge.classList.add('hidden');
  frameCounter.classList.add('hidden');
  pauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i> 一時停止`;
  pauseBtn.classList.replace('bg-emerald-600', 'bg-amber-600');
  secondsElapsed = 0;
  updateTimerDisplay();
}

// 時間表示更新
function updateTimerDisplay() {
  const displaySecs = timerMode === 'pomodoro' ? Math.max(0, secondsElapsed) : secondsElapsed;
  const hrs = String(Math.floor(displaySecs / 3600)).padStart(2, '0');
  const mins = String(Math.floor((displaySecs % 3600) / 60)).padStart(2, '0');
  const secs = String(displaySecs % 60).padStart(2, '0');
  timerDisplay.textContent = `${hrs}:${mins}:${secs}`;
}

// 星評価の設定
document.querySelectorAll('#star-rating i').forEach(star => {
  star.addEventListener('click', (e) => {
    currentRating = parseInt(e.target.getAttribute('data-rating'));
    updateStars();
  });
});

function updateStars() {
  document.querySelectorAll('#star-rating i').forEach(star => {
    const r = parseInt(star.getAttribute('data-rating'));
    if (r <= currentRating) star.className = 'fa-solid fa-star text-yellow-400';
    else star.className = 'fa-regular fa-star text-gray-500';
  });
}

// 投稿保存
function submitPost() {
  const taskName = document.getElementById('task-name').value;
  const subject = document.getElementById('subject-select').value;
  const comment = document.getElementById('post-comment').value;
  const minutes = Math.max(1, Math.round(timerMode === 'stopwatch' ? secondsElapsed / 60 : 25));

  const reader = new FileReader();
  reader.readAsDataURL(generatedVideoBlob);
  reader.onloadend = () => {
    const postData = {
      id: Date.now(),
      taskName,
      subject,
      comment,
      duration: minutes,
      rating: currentRating,
      videoUrl: reader.result,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString(),
      likes: 0
    };

    const posts = JSON.parse(localStorage.getItem('study_posts') || '[]');
    posts.unshift(postData);
    localStorage.setItem('study_posts', JSON.stringify(posts));

    closePostModal();
    switchTab('feed');
  };
}

function closePostModal() {
  postModal.classList.add('hidden');
  document.getElementById('post-comment').value = '';
}

// フィード表示
function renderFeed() {
  const posts = JSON.parse(localStorage.getItem('study_posts') || '[]');
  const feedContainer = document.getElementById('feed-container');
  feedContainer.innerHTML = '';

  if (posts.length === 0) {
    feedContainer.innerHTML = `
      <div class="text-center py-16 text-gray-500">
        <i class="fa-solid fa-bolt text-5xl mb-3 text-gray-600"></i>
        <p class="font-bold">まだ学習記録がありません</p>
        <p class="text-xs mt-1">タイムラプスを撮影して最初の学習ログを残そう！</p>
      </div>`;
    return;
  }

  posts.forEach(post => {
    const stars = '★'.repeat(post.rating) + '☆'.repeat(5 - post.rating);
    const card = document.createElement('div');
    card.className = 'bg-gray-800 rounded-2xl overflow-hidden border border-gray-700 shadow-xl';
    card.innerHTML = `
      <div class="p-4 flex justify-between items-center border-b border-gray-700/50">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-black text-sm">
            ME
          </div>
          <div>
            <p class="text-sm font-bold text-white">${post.taskName}</p>
            <p class="text-[11px] text-gray-400">${post.subject} • ${post.date} ${post.timestamp}</p>
          </div>
        </div>
        <span class="bg-indigo-950 text-indigo-300 text-xs px-2.5 py-1 rounded-full border border-indigo-700/50 font-semibold">
          ⏱️ ${post.duration}分
        </span>
      </div>
      <div class="aspect-video bg-black relative">
        <video src="${post.videoUrl}" controls loop muted class="w-full h-full object-cover"></video>
      </div>
      <div class="p-4 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-yellow-400 text-xs tracking-wider">${stars}</span>
          <span class="text-[10px] text-indigo-400 bg-indigo-900/40 px-2 py-0.5 rounded border border-indigo-800">TIMELAPSE</span>
        </div>
        <p class="text-sm text-gray-200">${post.comment || '集中して取り組みました！'}</p>
        <div class="flex items-center justify-between pt-2 text-xs text-gray-400 border-t border-gray-700/50">
          <button onclick="likePost(${post.id})" class="flex items-center gap-1.5 hover:text-red-400 transition">
            <i class="fa-solid fa-heart text-red-500"></i> <span>${post.likes}</span>
          </button>
          <span>#StudyWithMe #StudyLapse</span>
        </div>
      </div>
    `;
    feedContainer.appendChild(card);
  });
}

// 分析＆統計表示
function renderStats() {
  const posts = JSON.parse(localStorage.getItem('study_posts') || '[]');
  let totalMins = 0;
  let totalRating = 0;
  const subjectTotals = {};

  posts.forEach(p => {
    totalMins += p.duration;
    totalRating += p.rating;
    subjectTotals[p.subject] = (subjectTotals[p.subject] || 0) + p.duration;
  });

  document.getElementById('today-total-min').textContent = totalMins;
  document.getElementById('stat-total-time').textContent = `${totalMins}分`;
  document.getElementById('stat-task-count').textContent = `${posts.length}個`;
  document.getElementById('stat-avg-focus').textContent = posts.length > 0 ? `★${(totalRating / posts.length).toFixed(1)}` : '★0.0';

  const statsList = document.getElementById('stats-subject-list');
  statsList.innerHTML = '';

  if (posts.length === 0) {
    statsList.innerHTML = `<p class="text-xs text-gray-500 text-center py-4">データがありません</p>`;
    return;
  }

  for (const [subj, mins] of Object.entries(subjectTotals)) {
    const percent = totalMins > 0 ? Math.round((mins / totalMins) * 100) : 0;
    statsList.innerHTML += `
      <div>
        <div class="flex justify-between text-xs mb-1">
          <span class="font-medium">${subj}</span>
          <span class="text-gray-400">${mins}分 (${percent}%)</span>
        </div>
        <div class="w-full bg-gray-700 rounded-full h-2">
          <div class="bg-indigo-500 h-2 rounded-full" style="width: ${percent}%"></div>
        </div>
      </div>
    `;
  }
}

// いいね機能
window.likePost = function(id) {
  const posts = JSON.parse(localStorage.getItem('study_posts') || '[]');
  const target = posts.find(p => p.id === id);
  if (target) {
    target.likes += 1;
    localStorage.setItem('study_posts', JSON.stringify(posts));
    renderFeed();
  }
};

// タブ切り替え
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');

  if (tabName === 'feed') renderFeed();
  if (tabName === 'stats') renderStats();
};

// 初期化
window.addEventListener('DOMContentLoaded', () => {
  initCamera();
  renderFeed();
  renderStats();
});