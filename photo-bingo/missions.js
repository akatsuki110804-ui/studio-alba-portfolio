// ビンゴのマス設定（左上から右へ、5×5＝25マス）。
// 文言やアイコンを変えたいときはここだけ編集してください。
// free: true のマスは最初から達成扱いになります。
window.BINGO_CONFIG = {
  title: "SPECIAL DAY BINGO",
  subtitle: "たくさんの“たのしい”を見つけよう",
  storageKey: "special-day-bingo-v1",
  missions: [
    { icon: "🏰", text: "パークのシンボル（お城など）を写真に撮る", tone: "blue" },
    { icon: "🐭", text: "キャラクターに会う", tone: "pink" },
    { icon: "🍿", text: "ポップコーンを食べる", tone: "cream" },
    { icon: "📷", text: "フォトスポットで写真を撮る", tone: "blue" },
    { icon: "🎢", text: "アトラクションに乗る", tone: "gray" },

    { icon: "🍔", text: "スペシャルフードを食べる", tone: "cream" },
    { icon: "💗", text: "初めて話す人と一緒に行動する", tone: "pink" },
    { icon: "✨", text: "FREE", free: true },
    { icon: "👥", text: "3人以上で写真を撮る", tone: "cream" },
    { icon: "🎁", text: "グッズを買う", tone: "gray" },

    { icon: "⭐", text: "キャストさんに「ありがとう」と伝える", tone: "pink" },
    { icon: "🎈", text: "風船を見つける", tone: "blue" },
    { icon: "🎀", text: "キャラクターのグッズを身につける", tone: "cream" },
    { icon: "🥤", text: "ドリンクを買う", tone: "blue" },
    { icon: "🔍", text: "隠れミッキーを見つける", tone: "pink" },

    { icon: "🤳", text: "委員と一緒に写真を撮る", tone: "gray" },
    { icon: "🍴", text: "委員おすすめのフードを食べる", tone: "pink" },
    { icon: "🪄", text: "好きなキャラクターを見つける", tone: "blue" },
    { icon: "🌅", text: "きれいな景色を写真に撮る", tone: "cream" },
    { icon: "💬", text: "委員におすすめの場所を聞く", tone: "blue" },

    { icon: "👑", text: "カチューシャをつける", tone: "blue" },
    { icon: "🎵", text: "ショーやパレードを見る", tone: "gray" },
    { icon: "🤝", text: "他の参加者と一緒に何かする", tone: "pink" },
    { icon: "🍦", text: "スイーツを食べる", tone: "cream" },
    { icon: "🌟", text: "今日一番楽しかったことを見つける", tone: "cream" },
  ],
};
