// 首次體驗用的內建範例 sprint：一份通勤 podcast 構想的逐字稿 + 對應回填 JSON。
// source_quote 皆為逐字稿子字串，載入後「出處對得上」會全綠，示範完整流程。

export const SAMPLE_TRANSCRIPT =
  "我最近通勤都在聽 podcast，可是常常找不到適合那段車程長度的單集。有時候只有十五分鐘，可是點開的節目都四十分鐘起跳，聽到一半就要下車很煩。我在想能不能有個 app，你輸入你大概有多少時間，它就幫你排剛好聽得完的內容。其實重點不是節目本身，是時間剛好。也許可以讓使用者自己標每集多長值得聽。或者乾脆跟行事曆連動，知道你下一個會議還有多久。我自己是不想要再多一個社群功能啦，已經夠累了。";

const SAMPLE_SPRINT = {
  core_concepts: [
    { id: "c1", label: "依時間配內容" },
    { id: "c2", label: "單集資料來源" },
    { id: "c3", label: "通勤情境連動" },
  ],
  nodes: [
    {
      id: "n1",
      idea: "輸入可用時間，自動排剛好聽得完的單集",
      source_quote: "你輸入你大概有多少時間，它就幫你排剛好聽得完的內容",
      core_concept_ids: ["c1"],
    },
    {
      id: "n2",
      idea: "痛點：車程長度和單集長度對不上",
      source_quote: "常常找不到適合那段車程長度的單集",
      core_concept_ids: ["c1", "c2"],
    },
    {
      id: "n3",
      idea: "核心價值是時間剛好，不是節目本身",
      source_quote: "重點不是節目本身，是時間剛好",
      core_concept_ids: ["c1"],
    },
    {
      id: "n4",
      idea: "讓使用者標註每集值得聽的長度",
      source_quote: "讓使用者自己標每集多長值得聽",
      core_concept_ids: ["c2"],
    },
    {
      id: "n5",
      idea: "與行事曆連動，推估下一段空檔",
      source_quote: "跟行事曆連動，知道你下一個會議還有多久",
      core_concept_ids: ["c3"],
    },
    {
      id: "n6",
      idea: "刻意不做社群功能，守住單純",
      source_quote: "不想要再多一個社群功能",
      core_concept_ids: ["c3"],
    },
  ],
  lenses: {
    fastest: [
      { id: "l1", direction: "先做純網頁：輸入分鐘數→回一則符合長度的單集，清單先手動維護" },
    ],
    reverse: [
      { id: "l2", direction: "不幫你找剛好的，而是把長單集切成可中斷段落，隨時下車隨時續" },
    ],
    crossdomain: [
      { id: "l3", direction: "學 Spotify 每日混音：每天自動產一份剛好通勤長度的單集合輯" },
      { id: "l4", direction: "學餐廳套餐：把零散單集組成「15 分／30 分套餐」直接選" },
    ],
    upstream: [
      { id: "l5", direction: "也許問題不是找內容，是通勤太無聊；先解決願意規劃通勤時間這件事" },
    ],
  },
};

export const SAMPLE_JSON = JSON.stringify(SAMPLE_SPRINT, null, 2);
