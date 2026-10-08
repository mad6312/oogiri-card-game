// ==========================================
// 環境変数（.env）の自動読み込み
// ==========================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

// カードマスターデータの外部モジュール読み込み
const { MASTER_TOPICS, MASTER_ANSWERS } = require('./data/cards');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// 最優先モデル: gemini-3.5-flash-lite
const PREFERRED_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ゲーム状態の管理
// ==========================================
const gameState = {
    phase: 'lobby',
    hostId: null,
    players: {},
    currentTopic: null,
    topicDeck: [],
    answerDeck: [],
    roundResults: [],
    winner: null,
    finalRankings: []
};

// 配列シャッフル関数
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function resetTopicDeck() {
    gameState.topicDeck = shuffle(MASTER_TOPICS);
}

function resetAnswerDeck() {
    const heldCards = new Set();
    Object.values(gameState.players).forEach(p => {
        p.hand.forEach(c => heldCards.add(c));
    });

    const available = MASTER_ANSWERS.filter(card => !heldCards.has(card));
    gameState.answerDeck = shuffle(available);

    if (gameState.answerDeck.length === 0) {
        gameState.answerDeck = shuffle(MASTER_ANSWERS);
    }
}

function drawAnswerCard() {
    if (gameState.answerDeck.length === 0) {
        resetAnswerDeck();
    }
    return gameState.answerDeck.pop();
}

function drawTopic() {
    if (gameState.topicDeck.length === 0) {
        resetTopicDeck();
    }
    return gameState.topicDeck.pop();
}

function broadcastState() {
    const playerList = Object.values(gameState.players).map(p => ({
        id: p.id,
        name: p.name,
        isEntered: p.isEntered,
        stars: p.stars,
        handCount: p.hand.length,
        hasAnswered: p.currentAnswer !== null,
        isReadyForNext: p.isReadyForNext,
        isHost: p.id === gameState.hostId
    }));

    const enteredPlayers = playerList.filter(p => p.isEntered);

    io.emit('state_update', {
        phase: gameState.phase,
        hostId: gameState.hostId,
        currentTopic: gameState.currentTopic,
        players: playerList,
        enteredCount: enteredPlayers.length,
        roundResults: gameState.roundResults,
        winner: gameState.winner,
        finalRankings: gameState.finalRankings
    });

    Object.values(gameState.players).forEach(p => {
        io.to(p.id).emit('sync_hand', { hand: p.hand });
    });
}

// ==========================================
// Gemini APIによる完全ブラインド・公平採点ロジック
// ==========================================
async function evaluateAnswersWithGemini(topic, submissions) {
    if (!GEMINI_API_KEY) {
        return fallbackEvaluation(submissions);
    }

    // 順序バイアス排除のためのランダムシャッフル
    const shuffledSubmissions = shuffle(submissions.map((s, originalIdx) => ({
        ...s,
        originalIdx
    })));

    // プレイヤー名を伏せたブラインド審査用リスト
    const labelChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const blindList = shuffledSubmissions.map((item, idx) => ({
        label: labelChars[idx] || `${idx + 1}`,
        answer: item.answer,
        playerId: item.playerId,
        name: item.name
    }));

    const candidateModels = [
        PREFERRED_GEMINI_MODEL,
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
        "gemini-3-flash-preview"
    ];

    const uniqueModels = [...new Set(candidateModels)];
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    const prompt = `
あなたは毒舌とユーモアを兼ね備えたプロの大喜利大会のメイン審査員です。
プレイヤーの先入観を完全に排除した「ブラインド審査」を行います。
以下のお題に対する各回答（候補A〜）を純粋な言葉の切れ味・面白さだけで比較審査し、100点満点で厳格に採点してください。

【厳格な採点・出力ルール】
1. 得点は必ず1〜100点の整数とし、**「絶対に同点を出さないこと」**（各回答の得点は全て異なるユニークな値にしてください）。
2. お題に対する意外性、ワードセンス、シュールさ、ギャップの切れ味を客観的・公正に評価してください。提示された順番に惑わされず、最も面白い回答に最高得点を与えてください。
3. 全員の回答に対して、なぜウケたのか（または滑ったのか）の具体的な採点理由と、愛のあるツッコミや称賛を交えた講評（comment）を記述してください。
4. **【講評の文字数】必ず日本語で「2〜3文、100〜130文字程度」**にまとめてください。
5. 返却は必ず有効なJSONフォーマットのみを出力し、各要素に「candidate」（例: "A", "B"...）を正確に含めてください。

お題:「${topic}」

匿名回答一覧:
${blindList.map(b => `[候補 ${b.label}] 回答:「${b.answer}」`).join('\n')}

期待するJSONフォーマット:
{
  "evaluations": [
    {
      "candidate": "A",
      "score": 95,
      "comment": "講評コメント（100〜130文字程度）"
    }
  ]
}
`;

    for (const modelName of uniqueModels) {
        try {
            console.log(`Gemini API呼び出し中: モデル [${modelName}] でブラインド審査中...`);
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.75
                }
            });

            const result = await model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (!jsonMatch) throw new Error("JSONパースエラー");

            const parsed = JSON.parse(jsonMatch[0]);

            let rawList = [];
            if (Array.isArray(parsed)) {
                rawList = parsed;
            } else if (parsed && typeof parsed === 'object') {
                rawList = parsed.evaluations || parsed.results || parsed.scores || parsed.data || Object.values(parsed).find(v => Array.isArray(v)) || [];
            }

            if (!Array.isArray(rawList) || rawList.length === 0) {
                throw new Error("評価リストが抽出できませんでした");
            }

            let evaluations = rawList.map((item, idx) => {
                const candidateLabel = String(item.candidate || item.label || item.id || labelChars[idx] || "").trim().toUpperCase();
                const scoreVal = Math.max(1, Math.min(100, Math.round(Number(item.score || item.point || item.点数) || 50)));
                const commentVal = (item.comment || item.feedback || item.review || item.講評 || item.reason || item.commentary || "").trim();

                return {
                    candidate: candidateLabel,
                    score: scoreVal,
                    comment: commentVal
                };
            });

            // 同点時のランダム分散処理
            evaluations = shuffle(evaluations);
            let usedScores = new Set();
            evaluations.forEach(item => {
                while (usedScores.has(item.score)) {
                    item.score = Math.max(1, item.score - 1);
                }
                usedScores.add(item.score);
            });

            console.log(`モデル [${modelName}] でのブラインド採点が正常に完了しました！`);

            return blindList.map(blind => {
                let evalItem = evaluations.find(e => e.candidate === blind.label);
                if (!evalItem) {
                    evalItem = evaluations[labelChars.indexOf(blind.label)] || evaluations[0];
                }

                const score = evalItem ? evalItem.score : (60 + Math.floor(Math.random() * 35));
                const comment = (evalItem && evalItem.comment) ? evalItem.comment : "お題に対する独特のアプローチが光るセンスある回答でした！";

                return {
                    playerId: blind.playerId,
                    name: blind.name,
                    answer: blind.answer,
                    score: score,
                    comment: comment
                };
            }).sort((a, b) => b.score - a.score);

        } catch (err) {
            const errMsg = err.message || '';
            if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('Too Many Requests')) {
                console.warn(`[無料枠上限] モデル [${modelName}] の利用枠上限に達しました。次のモデルを試行します。`);
                continue;
            }
            console.warn(`モデル [${modelName}] 呼び出し失敗: ${errMsg}`);
        }
    }

    console.log("【自動切り替え】高品質スマートフォールバック（公平ランダム採点）を実行します。");
    return fallbackEvaluation(submissions);
}

// 高品質スマートフォールバック採点
function fallbackEvaluation(submissions) {
    const count = submissions.length;
    const scores = [];
    while (scores.length < count) {
        const s = Math.floor(Math.random() * 41) + 60;
        if (!scores.includes(s)) scores.push(s);
    }
    const randomizedScores = shuffle(scores);

    const commentBank = [
        "お題の真面目なトーンに対して、あまりにも日常的で情けないシチュエーションをぶつける落差が見事でした！誰もが一度は経験したことのある絶妙な共感ポイントを突いており、会場の爆笑をかっさらった文句なしの一本です。",
        "お題から想像もつかない斜め上のワードを繰り出す独創性に脱帽です！一瞬のシュールな静寂のあと、じわじわと込み上げてくる中毒性がありました。大喜利らしい切れ味と冒険心を高く評価したい好回答です。",
        "シンプルながらも言葉のチョイスに一切の無駄がなく、脳内に情景が鮮明に浮かび上がりました！直球ストレートで笑いを取りにいく潔いスタイルが審査員の心に深く刺さる、非常にレベルの高い回答です。",
        "常識の枠組みを鮮やかに飛び越えたクレイジーな世界観が最高です！理屈ではなく本能で笑わせに来る圧倒的なパワーを感じました。このカオスな発想力は他の追随を許さない大きな武器になるはずです。",
        "哀愁とユーモアのブレンドが完璧で、思わずクスッと笑ってしまう絶妙な味付けでした！派手さこそ控えめですが、噛めば噛むほど深みが増していくスルメのような魅力を持った素晴らしいセンスの一撃です。",
        "ワード自体のインパクトが強烈で、提示された瞬間に空気を掌握していました！お題との接続部分にも違和感がなく、力技に見えて実は緻密に計算されたスマートさを感じさせます。お見事でした！",
        "誰もが言いたくても言えなかったタブーに切り込むような切れ味が痛快でした！ブラックユーモアを絶妙なラインで成立させており、審査員席でも思わず唸り声が上がったハイセンスな回答です。",
        "情景を想像した瞬間にじわじわと笑いがこみ上げてくる破壊力があります！言葉のチョイスが非常にリアルで、まるですぐそこにその光景が見えるかのようでした。センスの塊のような回答です。"
    ];

    const shuffledComments = shuffle(commentBank);

    return submissions.map((sub, index) => ({
        playerId: sub.playerId,
        name: sub.name,
        answer: sub.answer,
        score: randomizedScores[index],
        comment: shuffledComments[index % shuffledComments.length]
    })).sort((a, b) => b.score - a.score);
}

// ==========================================
// ラウンド進行関数（手札全体回収・シャッフル再配布実装）
// ==========================================
function startNewRound() {
    const entered = Object.values(gameState.players).filter(p => p.isEntered);
    if (entered.length < 2) {
        gameState.phase = 'lobby';
        broadcastState();
        return;
    }

    gameState.phase = 'answering';
    gameState.currentTopic = drawTopic();

    // ★仕様変更: 毎ラウンド開始時、全プレイヤーの手札を回収・集約してランダム再配布
    let pooledCards = [];
    entered.forEach(p => {
        pooledCards.push(...p.hand);
        p.hand = []; // 一旦回収
    });

    // カードプールをランダムシャッフル
    pooledCards = shuffle(pooledCards);

    // 全員に均等に1枚ずつ再配布
    while (pooledCards.length >= entered.length) {
        entered.forEach(p => {
            if (pooledCards.length > 0) {
                p.hand.push(pooledCards.pop());
            }
        });
    }

    // 手札が7枚に満たない分を山札から補充（全重複なしルール維持・7枚維持）
    entered.forEach(p => {
        while (p.hand.length < 7) {
            p.hand.push(drawAnswerCard());
        }
        p.currentAnswer = null;
        p.isReadyForNext = false;
    });

    gameState.roundResults = [];
    broadcastState();
}

async function processScoring() {
    gameState.phase = 'scoring';
    broadcastState();

    const entered = Object.values(gameState.players).filter(p => p.isEntered);
    const submissions = entered.map(p => ({
        playerId: p.id,
        name: p.name,
        answer: p.currentAnswer || "（未選択）"
    }));

    const results = await evaluateAnswersWithGemini(gameState.currentTopic, submissions);

    if (results.length > 0) {
        const topPlayerId = results[0].playerId;
        if (gameState.players[topPlayerId]) {
            gameState.players[topPlayerId].stars += 1;
        }
    }

    gameState.roundResults = results.map((r, index) => ({
        rank: index + 1,
        playerId: r.playerId,
        name: r.name,
        score: r.score,
        answer: r.answer,
        comment: r.comment,
        stars: gameState.players[r.playerId] ? gameState.players[r.playerId].stars : 0,
        isWinnerOfRound: index === 0
    }));

    entered.forEach(p => {
        p.isReadyForNext = false;
    });

    gameState.phase = 'round_result';
    broadcastState();
}

// ==========================================
// Socket.io 通信イベント
// ==========================================
io.on('connection', (socket) => {
    gameState.players[socket.id] = {
        id: socket.id,
        name: `プレイヤー${Object.keys(gameState.players).length + 1}`,
        isEntered: false,
        hand: [],
        stars: 0,
        currentAnswer: null,
        isReadyForNext: false
    };

    if (!gameState.hostId) {
        gameState.hostId = socket.id;
    }

    if (gameState.answerDeck.length === 0) resetAnswerDeck();
    if (gameState.topicDeck.length === 0) resetTopicDeck();

    broadcastState();

    socket.on('update_name', (newName) => {
        if (gameState.players[socket.id] && typeof newName === 'string') {
            const trimmed = newName.trim();
            if (trimmed.length > 0 && trimmed.length <= 12) {
                gameState.players[socket.id].name = trimmed;
                broadcastState();
            }
        }
    });

    socket.on('toggle_entry', () => {
        const player = gameState.players[socket.id];
        if (!player || gameState.phase !== 'lobby') return;

        player.isEntered = !player.isEntered;
        broadcastState();
    });

    socket.on('start_game', () => {
        if (socket.id !== gameState.hostId) return;
        const entered = Object.values(gameState.players).filter(p => p.isEntered);
        if (entered.length < 2 || entered.length > 10) return;

        resetAnswerDeck();
        resetTopicDeck();
        gameState.winner = null;
        gameState.finalRankings = [];

        // 初期手札7枚の生成
        entered.forEach(p => {
            p.stars = 0;
            p.hand = [];
            for (let i = 0; i < 7; i++) {
                p.hand.push(drawAnswerCard());
            }
        });

        startNewRound();
    });

    socket.on('submit_answer', (answerText) => {
        const player = gameState.players[socket.id];
        if (!player || gameState.phase !== 'answering' || !player.isEntered) return;

        const cardIndex = player.hand.indexOf(answerText);
        if (cardIndex !== -1) {
            player.currentAnswer = answerText;
            player.hand.splice(cardIndex, 1);
            broadcastState();

            const entered = Object.values(gameState.players).filter(p => p.isEntered);
            const allAnswered = entered.every(p => p.currentAnswer !== null);

            if (allAnswered) {
                processScoring();
            }
        }
    });

    socket.on('ready_next_round', () => {
        const player = gameState.players[socket.id];
        if (!player || gameState.phase !== 'round_result' || !player.isEntered) return;

        player.isReadyForNext = true;
        broadcastState();

        const entered = Object.values(gameState.players).filter(p => p.isEntered);
        const allReady = entered.every(p => p.isReadyForNext);

        if (allReady) {
            const victor = entered.find(p => p.stars >= 3);
            if (victor) {
                gameState.phase = 'game_over';
                gameState.winner = victor;

                // 全参加者の最終獲得星数を確定保存
                gameState.finalRankings = entered.map(p => ({
                    id: p.id,
                    name: p.name,
                    stars: p.stars
                })).sort((a, b) => b.stars - a.stars);

                Object.values(gameState.players).forEach(p => {
                    p.isEntered = false;
                    p.hand = [];
                    p.currentAnswer = null;
                    p.isReadyForNext = false;
                });

                broadcastState();
            } else {
                startNewRound();
            }
        }
    });

    socket.on('rematch', () => {
        const player = gameState.players[socket.id];
        if (!player) return;

        player.stars = 0;
        player.hand = [];
        player.currentAnswer = null;
        player.isReadyForNext = false;
        player.isEntered = true;

        gameState.phase = 'lobby';
        gameState.winner = null;
        broadcastState();
    });

    socket.on('leave_game', () => {
        const player = gameState.players[socket.id];
        if (!player) return;

        player.stars = 0;
        player.hand = [];
        player.currentAnswer = null;
        player.isReadyForNext = false;
        player.isEntered = false;

        gameState.phase = 'lobby';
        gameState.winner = null;
        broadcastState();
    });

    socket.on('disconnect', () => {
        const wasHost = socket.id === gameState.hostId;
        delete gameState.players[socket.id];

        if (wasHost) {
            const remainingIds = Object.keys(gameState.players);
            gameState.hostId = remainingIds.length > 0 ? remainingIds[0] : null;
        }

        if (gameState.phase !== 'lobby') {
            const entered = Object.values(gameState.players).filter(p => p.isEntered);
            if (entered.length < 2) {
                gameState.phase = 'lobby';
            }
        }

        broadcastState();
    });
});

server.listen(PORT, () => {
    console.log(`大喜利サーバーが起動しました: http://localhost:${PORT}`);
    console.log(`最優先モデル: ${PREFERRED_GEMINI_MODEL}`);
});