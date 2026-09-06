// ==========================================
// 初期化 & Socket接続
// ==========================================
const socket = io();

let currentSocketId = null;
let currentHand = [];
let lastState = null;
let selectedCard = null;        // 手札でタップ選択中のカード
let mySubmittedCard = null;     // 確定・提出したカード
let isViewingGameOver = false;  // 最終結果画面を表示中かどうかのフラグ

// DOM要素参照
const screens = {
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen'),
    gameover: document.getElementById('gameover-screen')
};

// ロビーUI
const lobbyEnteredCount = document.getElementById('lobby-entered-count');
const lobbyStatusBadge = document.getElementById('lobby-status-badge');
const btnToggleEntry = document.getElementById('btn-toggle-entry');
const btnStartGame = document.getElementById('btn-start-game');
const lobbyUserList = document.getElementById('lobby-user-list');

// 盤面UI
const opponentsContainer = document.getElementById('opponents-container');
const currentTopicText = document.getElementById('current-topic-text');
const scoringIndicator = document.getElementById('scoring-indicator');
const handCardsContainer = document.getElementById('hand-cards-container');
const selfName = document.getElementById('self-name');
const selfStars = document.getElementById('self-stars');
const selfDoneLamp = document.getElementById('self-done-lamp');
const btnSubmitAnswer = document.getElementById('btn-submit-answer');

// 中央提出カード表示エリア
const submittedCardArea = document.getElementById('submitted-card-area');
const submittedCardBox = document.getElementById('submitted-card-box');

// リザルトUI
const resultTopicSummary = document.getElementById('result-topic-summary');
const resultLampsList = document.getElementById('result-lamps-list');
const resultGridBody = document.getElementById('result-grid-body');
const btnNextRound = document.getElementById('btn-next-round');

// 最終結果UI
const winnerName = document.getElementById('winner-name');
const finalRankingsList = document.getElementById('final-rankings-list');
const btnRematch = document.getElementById('btn-rematch');
const btnLeave = document.getElementById('btn-leave');

// モーダル関連
const modalSettings = document.getElementById('modal-settings');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveName = document.getElementById('btn-save-name');
const inputPlayerName = document.getElementById('input-player-name');

const modalExplanation = document.getElementById('modal-explanation');
const modalCardTitle = document.getElementById('modal-card-title');
const modalCardQuote = document.getElementById('modal-card-quote');
const modalCardComment = document.getElementById('modal-card-comment');
const btnCloseExplanation = document.getElementById('btn-close-explanation');

// ==========================================
// ユーティリティ関数
// ==========================================
function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[screenName]) {
        screens[screenName].classList.add('active');
    }
}

function renderStars(count) {
    const filled = '★'.repeat(Math.min(count, 3));
    const empty = '☆'.repeat(Math.max(0, 3 - count));
    return filled + empty;
}

// ==========================================
// 状態更新イベントの受信
// ==========================================
socket.on('connect', () => {
    currentSocketId = socket.id;
});

socket.on('sync_hand', (data) => {
    currentHand = data.hand || [];
    renderHandCards();
});

socket.on('state_update', (state) => {
    const previousPhase = lastState ? lastState.phase : null;
    lastState = state;
    const me = state.players.find(p => p.id === currentSocketId);
    const isHost = me ? me.isHost : false;
    const isEntered = me ? me.isEntered : false;

    // 新ラウンド開始時に選択中・提出中カードをリセット
    if (state.phase === 'answering' && previousPhase !== 'answering') {
        selectedCard = null;
        mySubmittedCard = null;
        isViewingGameOver = false;
        if (submittedCardArea) {
            submittedCardArea.style.display = 'none';
            submittedCardBox.textContent = '';
        }
    }

    // 1. 最終対戦結果画面（確定星数・同順位の描画）
    if (state.phase === 'game_over') {
        isViewingGameOver = true;
        switchScreen('gameover');

        if (state.winner) {
            winnerName.textContent = state.winner.name;
        }

        finalRankingsList.innerHTML = '';
        // サーバー側で確定保存された finalRankings を使用
        const rankings = state.finalRankings || [];

        let currentRank = 1;
        rankings.forEach((p, idx) => {
            // 直前のプレイヤーより星数が少なければ順位を繰り下げ（同星数は同順位）
            if (idx > 0 && p.stars < rankings[idx - 1].stars) {
                currentRank = idx + 1;
            }
            const li = document.createElement('li');
            li.innerHTML = `
        <span>第${currentRank}位: ${escapeHtml(p.name)} ${p.id === currentSocketId ? '(あなた)' : ''}</span>
        <span class="stars">${renderStars(p.stars)} (${p.stars}本)</span>
      `;
            finalRankingsList.appendChild(li);
        });
        return;
    }

    // 自分がまだ最終結果画面を見ている間は、他人の操作によるロビー遷移をブロック
    if (isViewingGameOver) {
        return;
    }

    // 2. ロビー画面の更新
    if (state.phase === 'lobby') {
        switchScreen('lobby');
        lobbyEnteredCount.textContent = `${state.enteredCount} / 10名`;

        if (isEntered) {
            lobbyStatusBadge.textContent = '参加中... 他のプレイヤーを待っています';
            lobbyStatusBadge.className = 'badge badge-green';
            btnToggleEntry.textContent = '参加キャンセル';
            btnToggleEntry.className = 'btn-secondary';
        } else {
            lobbyStatusBadge.textContent = '未エントリー';
            lobbyStatusBadge.className = 'badge badge-gray';
            btnToggleEntry.textContent = '参加する';
            btnToggleEntry.className = 'btn-primary';
        }

        if (isHost && state.enteredCount >= 2) {
            btnStartGame.style.display = 'block';
        } else {
            btnStartGame.style.display = 'none';
        }

        lobbyUserList.innerHTML = '';
        state.players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `
        <span>${escapeHtml(p.name)} ${p.isHost ? '👑(ホスト)' : ''} ${p.id === currentSocketId ? '（あなた）' : ''}</span>
        <span style="color: ${p.isEntered ? '#00e676' : '#8c93a4'}">${p.isEntered ? '参加中' : '待機中'}</span>
      `;
            lobbyUserList.appendChild(li);
        });
    }

    // 3. 対戦中（回答選択中・AI審査中）
    else if (state.phase === 'answering' || state.phase === 'scoring') {
        switchScreen('game');
        currentTopicText.textContent = state.currentTopic || 'お題準備中';
        scoringIndicator.style.display = (state.phase === 'scoring') ? 'flex' : 'none';

        if (me) {
            selfName.textContent = me.name;
            selfStars.textContent = renderStars(me.stars);

            if (me.hasAnswered) {
                selfDoneLamp.classList.add('active');
                btnSubmitAnswer.disabled = true;
                btnSubmitAnswer.textContent = '回答済み';

                if (mySubmittedCard) {
                    submittedCardArea.style.display = 'flex';
                    submittedCardBox.textContent = mySubmittedCard;
                }
            } else {
                selfDoneLamp.classList.remove('active');
                btnSubmitAnswer.textContent = '回答する';
                submittedCardArea.style.display = 'none';

                if (selectedCard && state.phase === 'answering') {
                    btnSubmitAnswer.disabled = false;
                } else {
                    btnSubmitAnswer.disabled = true;
                }
            }
        }

        // 対戦相手の描画
        opponentsContainer.innerHTML = '';
        const opponents = state.players.filter(p => p.isEntered && p.id !== currentSocketId);

        opponents.forEach(opp => {
            const card = document.createElement('div');
            card.className = 'opponent-card';
            card.innerHTML = `
        <div class="opponent-info">
          <span class="name">${escapeHtml(opp.name)}</span>
          <span class="stars">${renderStars(opp.stars)}</span>
        </div>
        <div class="done-lamp ${opp.hasAnswered ? 'active' : ''}">済</div>
      `;
            opponentsContainer.appendChild(card);
        });

        renderHandCards();
    }

    // 4. ラウンドリザルト画面
    else if (state.phase === 'round_result') {
        switchScreen('result');

        mySubmittedCard = null;
        if (submittedCardArea) {
            submittedCardArea.style.display = 'none';
            submittedCardBox.textContent = '';
        }

        resultTopicSummary.textContent = `お題:「${state.currentTopic}」`;

        resultLampsList.innerHTML = '';
        const enteredPlayers = state.players.filter(p => p.isEntered);
        enteredPlayers.forEach(p => {
            const lampItem = document.createElement('div');
            lampItem.className = 'result-lamp-item';
            lampItem.innerHTML = `
        <span>${escapeHtml(p.name)}</span>
        <div class="done-lamp ${p.isReadyForNext ? 'active' : ''}">済</div>
      `;
            resultLampsList.appendChild(lampItem);
        });

        if (me && me.isReadyForNext) {
            btnNextRound.disabled = true;
            btnNextRound.textContent = '他のプレイヤーを待っています...';
            btnNextRound.className = 'btn-secondary';
        } else {
            btnNextRound.disabled = false;
            btnNextRound.textContent = '次へ（準備完了）';
            btnNextRound.className = 'btn-primary';
        }

        renderRoundResults(state.roundResults);
    }
});

// ==========================================
// 手札レンダリング & 選択ロジック
// ==========================================
function renderHandCards() {
    handCardsContainer.innerHTML = '';
    const me = lastState ? lastState.players.find(p => p.id === currentSocketId) : null;
    const hasAnswered = me ? me.hasAnswered : false;
    const isScoring = lastState && lastState.phase === 'scoring';

    currentHand.forEach((cardText) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'answer-card';
        cardEl.textContent = cardText;

        if (selectedCard === cardText) {
            cardEl.classList.add('selected');
        }

        if (!hasAnswered && !isScoring) {
            cardEl.addEventListener('click', () => {
                selectedCard = cardText;
                btnSubmitAnswer.disabled = false;
                renderHandCards();
            });
        } else {
            cardEl.classList.add('disabled');
            cardEl.style.opacity = '0.5';
            cardEl.style.cursor = 'default';
        }

        handCardsContainer.appendChild(cardEl);
    });
}

// 回答するボタン押下
btnSubmitAnswer.addEventListener('click', () => {
    if (!selectedCard) return;

    const me = lastState ? lastState.players.find(p => p.id === currentSocketId) : null;
    if (!me || me.hasAnswered || lastState.phase !== 'answering') return;

    mySubmittedCard = selectedCard;
    submittedCardArea.style.display = 'flex';
    submittedCardBox.textContent = mySubmittedCard;

    socket.emit('submit_answer', selectedCard);

    selectedCard = null;
    btnSubmitAnswer.disabled = true;
    btnSubmitAnswer.textContent = '回答済み';
    selfDoneLamp.classList.add('active');
    renderHandCards();
});

// 3カラムGridリザルト描画
function renderRoundResults(results) {
    resultGridBody.innerHTML = '';
    if (!results) return;

    results.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'result-row';

        const colPlayer = document.createElement('div');
        colPlayer.className = 'col-player';
        const starClass = item.isWinnerOfRound ? 'star-pop' : '';
        colPlayer.innerHTML = `
      <span class="rank-badge ${item.rank === 1 ? 'rank-1' : ''}">#${item.rank}</span>
      <span class="stars ${starClass}">${renderStars(item.stars)}</span>
      <strong>${escapeHtml(item.name)}</strong>
    `;

        const colScore = document.createElement('div');
        colScore.className = 'col-score';
        colScore.textContent = `${item.score}点`;

        const colCard = document.createElement('div');
        colCard.className = 'col-card-btn';
        colCard.textContent = item.answer;
        colCard.title = 'クリックしてAI審査講評を見る';
        colCard.addEventListener('click', () => {
            openExplanationModal(item.name, item.answer, item.comment);
        });

        row.appendChild(colPlayer);
        row.appendChild(colScore);
        row.appendChild(colCard);
        resultGridBody.appendChild(row);

        if (item.isWinnerOfRound) {
            const topComment = document.createElement('div');
            topComment.className = 'top-comment-banner';
            topComment.innerHTML = `<strong>🏆 1位の講評:</strong> ${escapeHtml(item.comment)}`;
            resultGridBody.appendChild(topComment);
        }
    });
}

function openExplanationModal(name, answer, comment) {
    modalCardTitle.textContent = `${name} さんの回答`;
    modalCardQuote.textContent = answer;
    modalCardComment.textContent = comment;
    modalExplanation.classList.add('active');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

// ==========================================
// イベントリスナー設定
// ==========================================
btnToggleEntry.addEventListener('click', () => {
    socket.emit('toggle_entry');
});

btnStartGame.addEventListener('click', () => {
    socket.emit('start_game');
});

btnNextRound.addEventListener('click', () => {
    socket.emit('ready_next_round');
});

// 再戦ボタン：押した本人のみ再戦を決定してロビーへ遷移
btnRematch.addEventListener('click', () => {
    isViewingGameOver = false;
    socket.emit('rematch');
    switchScreen('lobby');
});

// 退出するボタン：押した本人のみ退出を決定してロビーへ遷移
btnLeave.addEventListener('click', () => {
    isViewingGameOver = false;
    socket.emit('leave_game');
    switchScreen('lobby');
});

btnOpenSettings.addEventListener('click', () => {
    modalSettings.classList.add('active');
});

btnCloseSettings.addEventListener('click', () => {
    modalSettings.classList.remove('active');
});

btnSaveName.addEventListener('click', () => {
    const name = inputPlayerName.value.trim();
    if (name.length > 0) {
        socket.emit('update_name', name);
        modalSettings.classList.remove('active');
    }
});

btnCloseExplanation.addEventListener('click', () => {
    modalExplanation.classList.remove('active');
});