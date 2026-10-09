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

// 【自由回答モード用】初期手札作成ローカル状態
let localCustomCards = [];      // 作成中の7枚の配列
let editingSlotIndex = -1;      // 現在再編集中のスロットインデックス（-1なら新規作成）
let rewritingCardIndex = -1;    // リザルト時に書き換え対象の手札インデックス

// DOM要素参照
const screens = {
    lobby: document.getElementById('lobby-screen'),
    creation: document.getElementById('creation-screen'),
    game: document.getElementById('game-screen'),
    result: document.getElementById('result-screen'),
    gameover: document.getElementById('gameover-screen')
};

// ヘッダー & ロビーUI
const headerModeBadge = document.getElementById('header-mode-badge');
const hostModeControl = document.getElementById('host-mode-control');
const btnModeStandard = document.getElementById('btn-mode-standard');
const btnModeCustom = document.getElementById('btn-mode-custom');
const lobbyEnteredCount = document.getElementById('lobby-entered-count');
const lobbyStatusBadge = document.getElementById('lobby-status-badge');
const btnToggleEntry = document.getElementById('btn-toggle-entry');
const btnStartGame = document.getElementById('btn-start-game');
const lobbyUserList = document.getElementById('lobby-user-list');

// 初期手札作成UI
const creationSlotsContainer = document.getElementById('creation-slots-container');
const inputCustomCard = document.getElementById('input-custom-card');
const btnCustomAction = document.getElementById('btn-custom-action');
const creationCountLabel = document.getElementById('creation-count-label');
const creationSelfDoneLamp = document.getElementById('creation-self-done-lamp');
const creationLampsList = document.getElementById('creation-lamps-list');

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
const resultCustomDock = document.getElementById('result-custom-dock');
const resultHandCards = document.getElementById('result-hand-cards');
const rewriteStatusBadge = document.getElementById('rewrite-status-badge');

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

const modalRewrite = document.getElementById('modal-rewrite');
const modalRewriteOld = document.getElementById('modal-rewrite-old');
const inputRewriteCard = document.getElementById('input-rewrite-card');
const btnConfirmRewrite = document.getElementById('btn-confirm-rewrite');
const btnCloseRewrite = document.getElementById('btn-close-rewrite');

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

// リザルト画面のスクロール位置を最上部へリセットする関数
function resetResultScrollPositions() {
    if (screens.result) {
        screens.result.scrollTop = 0;
    }
    const tableContainer = document.querySelector('.result-table-container');
    if (tableContainer) {
        tableContainer.scrollTop = 0;
    }
    const modalBox = document.querySelector('.result-modal-box');
    if (modalBox) {
        modalBox.scrollTop = 0;
    }
    if (resultHandCards) {
        resultHandCards.scrollLeft = 0;
    }
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

    headerModeBadge.textContent = state.gameMode === 'custom' ? '自由回答' : 'スタンダード';

    if (state.phase === 'answering' && previousPhase !== 'answering') {
        selectedCard = null;
        mySubmittedCard = null;
        isViewingGameOver = false;
        if (submittedCardArea) {
            submittedCardArea.style.display = 'none';
            submittedCardBox.textContent = '';
        }
    }

    // 1. 最終対戦結果画面
    if (state.phase === 'game_over') {
        isViewingGameOver = true;
        switchScreen('gameover');

        if (state.winner) {
            winnerName.textContent = state.winner.name;
        }

        finalRankingsList.innerHTML = '';
        const rankings = state.finalRankings || [];

        let currentRank = 1;
        rankings.forEach((p, idx) => {
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

    if (isViewingGameOver) {
        return;
    }

    // 2. ロビー画面
    if (state.phase === 'lobby') {
        switchScreen('lobby');
        lobbyEnteredCount.textContent = `${state.enteredCount} / 10名`;

        if (isHost) {
            hostModeControl.style.display = 'block';
            if (state.gameMode === 'custom') {
                btnModeCustom.classList.add('active');
                btnModeStandard.classList.remove('active');
            } else {
                btnModeStandard.classList.add('active');
                btnModeCustom.classList.remove('active');
            }
        } else {
            hostModeControl.style.display = 'none';
        }

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

    // 3. 【自由回答モード】初期手札作成画面
    else if (state.phase === 'custom_hand_creation') {
        switchScreen('creation');

        if (previousPhase !== 'custom_hand_creation') {
            localCustomCards = [];
            editingSlotIndex = -1;
            inputCustomCard.disabled = false;
            inputCustomCard.value = '';
            btnCustomAction.disabled = true;
            btnCustomAction.textContent = '作成';
            creationSelfDoneLamp.classList.remove('active');
        }

        creationLampsList.innerHTML = '';
        const enteredPlayers = state.players.filter(p => p.isEntered);
        enteredPlayers.forEach(p => {
            const lampItem = document.createElement('div');
            lampItem.className = 'creation-lamp-item';
            lampItem.innerHTML = `
        <span>${escapeHtml(p.name)}</span>
        <div class="done-lamp ${p.isCustomHandReady ? 'active' : ''}">済</div>
      `;
            creationLampsList.appendChild(lampItem);
        });

        if (me && me.isCustomHandReady) {
            creationSelfDoneLamp.classList.add('active');
            inputCustomCard.disabled = true;
            btnCustomAction.disabled = true;
            btnCustomAction.textContent = '完了済み（待機中）';
        }

        renderCreationSlots();
    }

    // 4. 対戦中（回答フェーズ・審査中）
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

    // 5. ラウンドリザルト画面
    else if (state.phase === 'round_result') {
        const isFirstTimeInResult = previousPhase !== 'round_result';

        // ★改善1: 「前フェーズからリザルト画面へ遷移した瞬間」のみスクロールを最上部へリセット
        // （「次へ」押下時など同一フェーズ中の同期ではリセットしないため、跳ね上がりが発生しない）
        if (isFirstTimeInResult) {
            resetResultScrollPositions();
        }

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

        // ★改善2: モードに応じたレイアウト切り替えクラスの付与
        const hasGameWinner = state.players.some(p => p.isEntered && p.stars >= 3);
        const isCustomActive = state.gameMode === 'custom' && me && !hasGameWinner;

        if (isCustomActive) {
            screens.result.classList.add('is-custom-mode');
            screens.result.classList.remove('is-standard-mode');
            resultCustomDock.style.display = 'block';

            if (me.hasRewrittenThisRound) {
                rewriteStatusBadge.textContent = '変更済み（今ラウンド終了）';
                rewriteStatusBadge.className = 'badge badge-green';
            } else {
                rewriteStatusBadge.textContent = '1枚変更可能';
                rewriteStatusBadge.className = 'badge badge-gray';
            }
            renderResultHandCards(me.hasRewrittenThisRound);
        } else {
            // スタンダードモード（または最終勝者決定時）: 縦方向中央配置＆自動伸長モード
            screens.result.classList.add('is-standard-mode');
            screens.result.classList.remove('is-custom-mode');
            resultCustomDock.style.display = 'none';
        }

        // 初回表示時のみスクロール位置を最上部へ確定
        if (isFirstTimeInResult) {
            resetResultScrollPositions();
        }
    }
});

// ==========================================
// 【自由回答モード】初期手札作成ロジック
// ==========================================
function renderCreationSlots() {
    creationSlotsContainer.innerHTML = '';
    creationCountLabel.textContent = `作成済み: ${localCustomCards.length} / 7枚`;

    for (let i = 0; i < 7; i++) {
        const slot = document.createElement('div');
        slot.className = 'creation-slot';

        const cardText = localCustomCards[i];
        if (cardText) {
            slot.classList.add('filled');
            if (editingSlotIndex === i) {
                slot.classList.add('editing');
            }
            slot.innerHTML = `<span class="slot-number">#${i + 1}</span>${escapeHtml(cardText)}`;

            slot.addEventListener('click', () => {
                if (creationSelfDoneLamp.classList.contains('active')) return;
                editingSlotIndex = i;
                inputCustomCard.value = cardText;
                inputCustomCard.focus();
                updateCreationButtonState();
                renderCreationSlots();
            });
        } else {
            slot.innerHTML = `<span class="slot-number">#${i + 1}</span>（未作成）`;
        }

        creationSlotsContainer.appendChild(slot);
    }

    updateCreationButtonState();
}

function updateCreationButtonState() {
    if (creationSelfDoneLamp.classList.contains('active')) return;

    const text = inputCustomCard.value.trim();

    if (editingSlotIndex !== -1) {
        btnCustomAction.textContent = '修正';
        btnCustomAction.disabled = text.length === 0;
    } else if (localCustomCards.length === 7) {
        btnCustomAction.textContent = '完了';
        btnCustomAction.disabled = false;
    } else {
        btnCustomAction.textContent = '作成';
        btnCustomAction.disabled = text.length === 0;
    }
}

inputCustomCard.addEventListener('input', () => {
    updateCreationButtonState();
});

btnCustomAction.addEventListener('click', () => {
    const text = inputCustomCard.value.trim();

    if (editingSlotIndex !== -1) {
        if (text.length > 0) {
            localCustomCards[editingSlotIndex] = text;
            editingSlotIndex = -1;
            inputCustomCard.value = '';
            renderCreationSlots();
        }
        return;
    }

    if (localCustomCards.length === 7 && btnCustomAction.textContent === '完了') {
        socket.emit('submit_custom_hand', localCustomCards);
        creationSelfDoneLamp.classList.add('active');
        inputCustomCard.disabled = true;
        btnCustomAction.disabled = true;
        btnCustomAction.textContent = '完了済み（待機中）';
        return;
    }

    if (text.length > 0 && localCustomCards.length < 7) {
        localCustomCards.push(text);
        inputCustomCard.value = '';
        renderCreationSlots();
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

function renderResultHandCards(hasRewritten) {
    resultHandCards.innerHTML = '';
    currentHand.forEach((cardText, idx) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'answer-card';
        cardEl.textContent = cardText;
        cardEl.title = hasRewritten ? '今ラウンドは変更済みです' : 'クリックしてこのカードを書き換える';

        if (!hasRewritten) {
            cardEl.addEventListener('click', () => {
                openRewriteModal(idx, cardText);
            });
        } else {
            cardEl.style.cursor = 'default';
            cardEl.style.opacity = '0.7';
        }

        resultHandCards.appendChild(cardEl);
    });
}

function openRewriteModal(index, oldText) {
    rewritingCardIndex = index;
    modalRewriteOld.textContent = oldText;
    inputRewriteCard.value = '';
    modalRewrite.classList.add('active');
    inputRewriteCard.focus();
}

btnConfirmRewrite.addEventListener('click', () => {
    const newText = inputRewriteCard.value.trim();
    if (newText.length > 0 && rewritingCardIndex !== -1) {
        socket.emit('rewrite_custom_card', {
            index: rewritingCardIndex,
            newText: newText
        });

        currentHand[rewritingCardIndex] = newText;
        renderResultHandCards(true);

        rewriteStatusBadge.textContent = '変更済み（今ラウンド終了）';
        rewriteStatusBadge.className = 'badge badge-green';

        modalRewrite.classList.remove('active');
    }
});

btnCloseRewrite.addEventListener('click', () => {
    modalRewrite.classList.remove('active');
});

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
btnModeStandard.addEventListener('click', () => {
    socket.emit('set_game_mode', 'standard');
});

btnModeCustom.addEventListener('click', () => {
    socket.emit('set_game_mode', 'custom');
});

btnToggleEntry.addEventListener('click', () => {
    socket.emit('toggle_entry');
});

btnStartGame.addEventListener('click', () => {
    socket.emit('start_game');
});

btnNextRound.addEventListener('click', () => {
    socket.emit('ready_next_round');
});

btnRematch.addEventListener('click', () => {
    isViewingGameOver = false;
    socket.emit('rematch');
    switchScreen('lobby');
});

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