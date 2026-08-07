/* ============================================================
   서가 (Library) — 가져다 쓸 수 있는 글 꾸러미
   ------------------------------------------------------------
   앱과 함께 배포되는 정적 데이터. 빌드 스텝 없이 <script>로 실려서
   window.PILSA_KITS 에 붙는다.

   kind: "reverse"      → 한국어 원문 + 목표 영문 짝. items[] 하나가 문단 하나.
   kind: "transcription"→ 영어 지문. items[] 하나가 문단 하나.

   저작권: 여기 실리는 글은 (a) 작성자가 직접 쓴 것이거나 (b) 퍼블릭 도메인만
   가능하다. 앱이 겨냥하는 현대 작가들(Ocean Vuong, Sontag, Maggie Nelson,
   Cha, Don Mee Choi)의 본문은 저작권 보호 중이라 실을 수 없다.
   ============================================================ */
window.PILSA_KITS = [

  /* ── 박도한, 「수도관 필터 교체 요망」 (본인 소설) ── */
  {
    id: "sudogwan-1",
    kind: "reverse",
    title: "수도관 필터 교체 요망 — 숲",
    blurb: "버려진 초가집과 마당의 작은 언덕. 묘사와 시점이 걸린 대목들입니다. 관사·시제·자동사 선택이 계속 발목을 잡습니다.",
    tag: "소설 · 묘사",
    note: "박도한 본인 소설. 영문은 이 앱에서 만든 번역본입니다.",
    source: { author: "박도한", title: "수도관 필터 교체 요망", page: "숲" },
    items: [
      {
        ko: "이곳에 시체가 있었다.\n이름 모를 풀들은 자라났다. 버려진 초가집을 타고 오르는 이끼들은 비를 맞을 때마다 몸을 퉁퉁하게 불렸고, 벌레들은 나무 기둥의 안쪽을 파먹었고, 새들은 무너져 내리는 천장의 빈틈에 둥지를 틀었다.",
        en: "There had been a body here.\nGrasses no one could name grew up. The mosses climbing the abandoned thatched house swelled thick with every rain, insects ate their way through the inside of the wooden posts, and birds nested in the gaps of the collapsing roof.",
      },
      {
        ko: "초가집 마당에는 작은 언덕이 하나 있었다. 높이 사십 센티미터, 가로 오십 센티미터, 세로 백칠십삼 센티미터쯤 되는 언덕이었다. 오래된 흙무덤처럼 보였지만 그것은 무덤이라고 부르기에는 너무 아무렇게나 놓여 있었고, 그렇다고 흙더미라고 부르기에는 이상하게도 사람 하나가 누울 만한 모양을 하고 있었다.",
        en: "In the yard of the thatched house there was a small mound. Forty centimetres high, fifty across, a hundred and seventy-three long. It looked like an old grave, but it lay too carelessly to be called a grave; and to call it a heap of earth would not do either, because it had, oddly, the shape of a single person lying down.",
      },
      {
        ko: "그러나 숲에서는 그런 것이 문제 되지 않았다. 언덕은 이끼와 작은 풀잎들로 뒤엉켜 있었다. 언덕을 사용하는 이들은 많았다. 잠시 몸을 숨기고 싶은 토끼, 흙 속 벌레를 뒤지는 멧돼지, 썩은 것을 좋아하는 맹조류, 깨진 두개골 안쪽에 고인 맑은 빗물을 마시고 싶은 여러 동물들이 그러했다.",
        en: "In the forest, though, none of this was a problem. The mound was tangled over with moss and small blades of grass. Many made use of it: a rabbit wanting to hide itself a while, a boar rooting for insects in the soil, birds of prey with a taste for rot, and any number of animals that wanted to drink the clear rainwater pooled inside the broken skull.",
      },
      {
        ko: "그들은 그 작은 언덕의 존재에 대해 아무 생각도 하지 않았다. 숲의 정령 같은 것이 있다고 해도, 그것 역시 그 언덕을 크게 신경 쓰지는 않았을 것이다. 모든 것은 태어남과 동시에 죽어간다는 사실을 뇌가 아니라 존재 그 자체로 알고 있었으므로, 그 초가집과 초가집 마당의 작은 언덕은 아무 문제도 없었다.",
        en: "They gave no thought at all to the existence of that small mound. Even if there were such a thing as a spirit of the forest, it too would not have minded the mound much. Because everything there knew — not with a brain but with its whole being — that to be born is to begin dying, the thatched house and the small mound in its yard posed no problem whatever.",
      },
      {
        ko: "그때 시신 안쪽에 갇혀 있던 파리 떼가 일제히 하늘로 솟구쳤다. 나를 먹고 자란 파리는 나의 일부라고 할 수 있을까. 아니면 나의 일부를 먹고 자란 것에 불과한가. 어찌 되었든 결과적으로 사그라든 것은 하나의 몸이었고, 남은 것은 풀과 벌레와 새와 빗물이었다.",
        en: "Then the flies that had been shut inside the body rose all at once into the sky. Can a fly that grew by eating me be called a part of me? Or is it merely something that grew by eating a part of me? Either way, what had gone out was one body, and what remained was grass and insects and birds and rainwater.",
      },
    ],
  },

  {
    id: "sudogwan-2",
    kind: "reverse",
    title: "수도관 필터 교체 요망 — 몸과 박제",
    blurb: "박제사의 아들, 사람 안으로 들어가고 싶다는 충동, 그리고 손톱. 정의문과 반복 구문, 「~이 되고 싶었다」의 리듬을 영어로 어떻게 살릴지가 관건입니다.",
    tag: "소설 · 사유",
    note: "박도한 본인 소설. 영문은 이 앱에서 만든 번역본입니다.",
    source: { author: "박도한", title: "수도관 필터 교체 요망", page: "몸과 박제" },
    items: [
      {
        ko: "나는 사슴의 두개골에서 뇌를 빼는 일을 맡았다. 작은 숟가락으로 안쪽을 긁어내면 회백색의 물컹한 것이 흘러나와 양동이로 들어갔다. 박제된 사슴은 뇌가 없었다. 사슴은 뇌가 있어야 사슴인 것은 아니었다.",
        en: "My job was to take the brain out of the deer's skull. Scraping the inside with a small spoon brought out something grey-white and soft, which went into the bucket. A mounted deer has no brain. A deer is not a deer by virtue of having one.",
      },
      {
        ko: "그는 시다 일을 하면서 한 가지를 배웠다. 박제란 죽은 것을 살아 있는 것처럼 보존하는 일이 아니라, 살아 있을 때 추했던 것을 죽은 후에 보기 좋게 만드는 일이라는 사실.",
        en: "Working as his father's hand, he learned one thing: that taxidermy is not the preserving of the dead as though they were alive, but the making presentable, after death, of what had been ugly while it lived.",
      },
      {
        ko: "그제서야 나는 이해했다. 아버지가 박제하지 않는 것들이 있었다. 쥐, 바퀴벌레, 비둘기, 길고양이. 거실에 둘 수 없는 것들.",
        en: "Only then did I understand. There were things my father would not mount. Rats, cockroaches, pigeons, street cats. Things that cannot be put in a living room.",
      },
      {
        ko: "나는 사람의 말을 믿지 않았고, 사람의 표정도 믿지 않았다. 말과 표정은 너무 쉽게 꾸며진다. 그러나 사람의 몸 안쪽은 다를 것이라고 생각했다. 위장, 폐, 피, 뇌, 장기와 분비물. 그것들은 꾸미지 못할 것이다.",
        en: "I did not trust what people said, and I did not trust their faces either. Words and faces are dressed up too easily. The inside of a body, I thought, would be otherwise. Stomach, lungs, blood, brain, organs and secretions. Those could not be dressed up.",
      },
      {
        ko: "사람이 먹는 물이 되고 싶었다. 사람이 마시는 증기가 되고 싶었다. 화장실 거울에 맺히는 습기가 되고 싶었다. 밤새 꺼진 난방 때문에 방 안에서 하얗게 피어나는 입김이 되고 싶었다. 누군가가 아무것도 모른 채 들이마시는 공기 속 먼지가 되고 싶었다.",
        en: "I wanted to be the water people drink. I wanted to be the vapour they take in. I wanted to be the damp that gathers on a bathroom mirror. I wanted to be the breath that blooms white in a room because the heating has been off all night. I wanted to be the dust in the air that someone breathes in, knowing nothing of it.",
      },
      {
        ko: "손톱 조각이 세면대 위로 떨어진다. 작고 희고 반투명한 조각. 당신은 그것을 한참 들여다본다. 그것이 당신의 일부였다는 사실이 이상하게 낯설다. 사람은 자신을 숨기지 못한다. 아무리 아무것도 모르는 척해도 매일 조금씩 흘러나온다.",
        en: "A nail clipping falls onto the basin. A small white half-transparent flake. You look at it for a long while. That it was a part of you feels strangely unfamiliar. A person cannot keep himself hidden. However much he pretends to know nothing, a little of him leaks out every day.",
      },
    ],
  },
];
