// ==========================================
// 環境変数（.env）の自動読み込み
// ==========================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const PREFERRED_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// カードマスターデータ
// ==========================================
const MASTER_TOPICS = [
    "こんな学校の先生は嫌だ。どんな先生？",
    "100階建てのビル。屋上にある意外すぎる施設とは？",
    "AIが反乱を起こした理由ランキング第1位は？",
    "絶対に流行らないコンビニの新しいサービスとは？",
    "誰も見たことがない新しいヒーローの必殺技は？",
    "無人島に1つだけ持っていくとしたら絶対に選ばないものは？",
    "宇宙人が地球に来て最初に発した衝撃の一言とは？",
    "絶対に売れない新車につけられたキャッチコピーとは？",
    "ことわざ『犬も歩けば棒に当たる』の現代版を教えてください。",
    "面接で『特技は？』と聞かれて落された衝撃の回答とは？",
    "世界一くだらないギネス記録とは？",
    "タイムマシンを作った博士が最初に行ったくだらない過去とは？"
];

const MASTER_ANSWERS = [
    "毎朝の全校朝礼で自分のポエムを朗読する",
    "消しゴムのカスを練り固めた巨大な球体",
    "WiFiのパスワードが全角カタカナで40文字",
    "ボタンを押すと3秒間だけ猫の鳴き声がする",
    "店員の笑顔が有料オプション（1回50円）",
    "賞味期限が切れたマヨネーズの怨念",
    "全自動で肩をトントン叩いてくるが強さが異常",
    "絶対に誰も乗らないジェットコースター",
    "初対面の相手にいきなりタメ口で説教を始める",
    "『それってあなたの感想ですよね？』と囁く",
    "深夜2時に突然鳴り響くリコーダーの演奏",
    "宇宙船の燃料がまさかの麦茶",
    "テストの裏面にだけびっしり書かれた自分史",
    "全員が一度は踏んだことがある生暖かいレゴブロック",
    "パスモの残高が常に3円足りない呪い",
    "授業参観にだけ本気を出してくる担任",
    "校内放送でこっそり愚痴をこぼす校長",
    "満員電車でいきなり始まるイントロクイズ",
    "なぜか靴下だけを盗んでいく謎の怪盗",
    "語尾に必ず『〜とでも言うと思ったか』がつく",
    "3日煮込んだ結果ただの炭になったカレー",
    "どんな質問にも『要検討ですね』と返すロボット",
    "全自動肩たたき機（ただし全力パンチ）",
    "絶対に曲がらないスプーンを曲げようとして自爆",
    "100円ショップで一番いらないと噂の便利グッズ",
    "世界で一番どうでもいい豆知識を披露する",
    "雨の日だけ異常に張り切るてるてる坊主",
    "授業中に突然始まるサイレントダンス",
    "自動ドアが自分を認識してくれず激突する",
    "大事なところで必ず噛むアナウンサー",
    "靴を脱ぐと必ず靴下に親指の穴が空いている",
    "『全米が泣いた』の全米が実は1人の名前だった",
    "絶対に起きられない目覚まし時計（添い寝機能付き）",
    "テスト前日に部屋の大掃除を始めてしまう衝動",
    "コンビニのおにぎりが綺麗に開けられない呪縛",
    "体育座りで世界新記録を狙う男",
    "親戚のおじさんが酔っ払って語る若かりし武勇伝",
    "誰も頼んでいないのに流れるヒーリング音楽",
    "100円玉を入れないと動かないブランコ",
    "宿題を忘れた理由が『宇宙人の侵略』",
    "シャンプーとリンスを同時に間違える絶望感",
    "エレベーターでボタンを押し間違えて気まずい空気",
    "急に静かになった教室で鳴り響く腹の虫",
    "『明日から本気出す』と言い続けて10年経過",
    "絶対に勝てないジャンケンマシーン",
    "唐揚げに勝手にレモンを絞る謎の勢力",
    "お母さんが買ってきた微妙にダサい英字Tシャツ",
    "お化け屋敷の幽霊がマスクをして除菌している",
    "全自動で言い訳を生成してくれるAIアシスタント",
    "月曜日の朝にだけ押し寄せる強烈な虚無感"
];

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
    finalRankings: [] // 最終対戦結果の確定ランキング
};

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
        finalRankings: gameState.finalRankings // 確定した最終順位一覧を同期
    });

    Object.values(gameState.players).forEach(p => {
        io.to(p.id).emit('sync_hand', { hand: p.hand });
    });
}

// ==========================================
// Gemini APIによる採点ロジック
// ==========================================
async function evaluateAnswersWithGemini(topic, submissions) {
    if (!GEMINI_API_KEY) {
        return fallbackEvaluation(submissions);
    }

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
以下のお題とプレイヤーたちの回答を審査し、100点満点で厳格に採点してください。

【厳格な採点・出力ルール】
1. 得点は必ず1〜100点の整数とし、**「絶対に同点を出さないこと」**（各プレイヤーの得点は全て異なるユニークな値にしてください）。
2. お題に対する意外性、ワードセンス、シュールさ、ギャップの切れ味を高く評価してください。
3. 全員の回答に対して、なぜウケたのか（または滑ったのか）の具体的な採点理由と、愛のあるツッコミや称賛を交えた講評（comment）を記述してください。
4. **【講評の文字数】必ず日本語で「2〜3文、100〜130文字程度」**にまとめてください。
5. 返却は必ず有効なJSONフォーマットのみを出力してください。

お題:「${topic}」

回答一覧:
${submissions.map(s => `ID:${s.playerId} | 回答者:${s.name} | 回答:「${s.answer}」`).join('\n')}

期待するJSONフォーマット:
{
  "evaluations": [
    {
      "playerId": "ID",
      "score": 95,
      "comment": "講評コメント（100〜130文字程度）"
    }
  ]
}
`;

    for (const modelName of uniqueModels) {
        try {
            console.log(`Gemini API呼び出し中: モデル [${modelName}] で審査中...`);
            const model = genAI.getGenerativeModel({ model: modelName });

            const result = await model.generateContent(prompt);
            const text = result.response.text();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("JSONパースエラー");

            const data = JSON.parse(jsonMatch[0]);
            let evaluations = data.evaluations || [];
            let usedScores = new Set();

            evaluations.forEach(item => {
                let score = Math.max(1, Math.min(100, Math.round(item.score)));
                while (usedScores.has(score)) {
                    score = Math.max(1, score - 1);
                }
                usedScores.add(score);
                item.score = score;
            });

            console.log(`モデル [${modelName}] での採点が正常に完了しました！`);

            return submissions.map(s => {
                const evalItem = evaluations.find(e => e.playerId === s.playerId);
                return {
                    playerId: s.playerId,
                    name: s.name,
                    answer: s.answer,
                    score: evalItem ? evalItem.score : 50,
                    comment: evalItem ? evalItem.comment : "お題の核心を突く鋭いワードチョイスが光っていました！会場全体の空気を一瞬で自分の色に染め上げた素晴らしい回答で、文句なしの高評価です。"
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

    console.log("【自動切り替え】高品質スマートフォールバック（100〜130文字講評）で採点します。");
    return fallbackEvaluation(submissions);
}

function fallbackEvaluation(submissions) {
    const count = submissions.length;
    const scores = [];
    while (scores.length < count) {
        const s = Math.floor(Math.random() * 41) + 60;
        if (!scores.includes(s)) scores.push(s);
    }
    scores.sort((a, b) => b - a);

    const commentBank = [
        "お題の真面目なトーンに対して、あまりにも日常的で情けないシチュエーションをぶつける落差が見事でした！誰もが一度は経験したことのある絶妙な共感ポイントを突いており、会場の爆笑をかっさらった文句なしの一本です。",
        "お題から想像もつかない斜め上のワードを繰り出す独創性に脱帽です！一瞬のシュールな静寂のあと、じわじわと込み上げてくる中毒性がありました。大喜利らしい切れ味と冒険心を高く評価したい好回答です。",
        "シンプルながらも言葉のチョイスに一切の無駄がなく、脳内に情景が鮮明に浮かび上がりました！直球ストレートで笑いを取りにいく潔いスタイルが審査員の心に深く刺さる、非常にレベルの高い回答です。",
        "常識の枠組みを鮮やかに飛び越えたクレイジーな世界観が最高です！理屈ではなく本能で笑わせに来る圧倒的なパワーを感じました。このカオスな発想力は他の追随を許さない大きな武器になるはずです。",
        "哀愁とユーモアのブレンドが完璧で、思わずクスッと笑ってしまう絶妙な味付けでした！派手さこそ控えめですが、噛めば噛むほど深みが増していくスルメのような魅力を持った素晴らしいセンスの一撃です。"
    ];

    const shuffledComments = shuffle(commentBank);

    return submissions.map((sub, index) => ({
        playerId: sub.playerId,
        name: sub.name,
        answer: sub.answer,
        score: scores[index],
        comment: shuffledComments[index % shuffledComments.length]
    }));
}

// ==========================================
// ラウンド進行関数
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

                // ★修正: 星をリセットする前に、全参加者の最終獲得星数を確定保存！
                gameState.finalRankings = entered.map(p => ({
                    id: p.id,
                    name: p.name,
                    stars: p.stars
                })).sort((a, b) => b.stars - a.stars);

                // 次期ゲームへの準備としてエントリー状態と手札のみ初期化（星情報は finalRankings に保持）
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
});