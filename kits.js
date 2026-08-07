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

  /* ── 박도한, 「상호작용 서사에서의 감정 궤적 이탈 측정」 (본인 논문 Track A v0.4) ── */
  {
    id: "tem-framing",
    kind: "reverse",
    title: "감정 궤적 이탈 측정 — 틀 잡기",
    blurb: "공백 진술, 연구 질문, 기여 선언. 논문이 자기 자리를 만드는 문장들입니다. 「~해 왔다」의 현재완료, 「~지 않았다」의 부정 완료, 무관사 추상명사가 반복해서 걸립니다.",
    tag: "논문 · 서론",
    note: "박도한 본인 논문 (Working Draft v0.4). 영문은 이 앱에서 만든 번역본입니다.",
    source: { author: "박도한", title: "감정 궤적 이탈 측정", page: "§1 서론" },
    items: [
      {
        ko: "상호작용 서사에서 서로 다른 체험자는 서로 다른 경험을 하지만, 그 “다름”은 대부분 플롯 분기의 차이로만 기술되어 왔다.",
        en: "In interactive narrative, different participants have different experiences, but that “difference” has largely been described only as a difference of plot branching.",
      },
      {
        ko: "상호작용 서사의 핵심 약속은 체험자마다 다른 경험을 제공한다는 것이다. 그러나 대부분의 도구는 플롯 분기를 통한 경로의 다양성에 집중해 왔으며, 체험자가 서사를 관통하며 겪는 감정의 궤적은 명시적으로 추적되지 않았다.",
        en: "The central promise of interactive narrative is that it offers each participant a different experience. Most tools, however, have concentrated on the variety of paths afforded by a branching plot, and the trajectory of emotion a participant undergoes in passing through the narrative has not been tracked explicitly.",
      },
      {
        ko: "이 공백은 정서 컴퓨팅 쪽에서도 정확히 메워지지 않는다. 이들은 기본적으로 관찰된 감정 데이터를 사후에 분석하는 도구이며, 상호작용 서사 내부의 실시간 궤적 비교에는 적용되지 않는다.",
        en: "Nor is the gap filled precisely from the side of affective computing. These are, fundamentally, tools for analysing observed emotion data after the fact, and they do not extend to real-time trajectory comparison inside an interactive narrative.",
      },
      {
        ko: "첫째, 시스템적 기여. 감정 벡터를 씬의 일차 속성으로 두고, 매 턴 체험자 감정 상태에 따라 접근 가능 씬 집합을 계산하는 인터랙티브 서사 시스템. 기존 저작 도구가 명시적 플롯 분기 조건식으로 경로를 가르는 데 반해, TEM은 분기 조건식 없이 체험자 감정 상태와 씬 원본 감정 사이의 거리만으로 다음 경로를 결정한다.",
        en: "First, a systems contribution. An interactive narrative system that treats the emotion vector as a first-class property of the scene and computes, at every turn, the accessible pin set from the participant's emotional state. Where existing authoring tools divide paths by explicit plot-branching conditionals, TEM determines the next path with no branching conditional at all, using only the distance between the participant's emotional state and the scene's original emotion.",
      },
      {
        ko: "본 논문은 이들을 하나로 묶는 통합 이론을 제안하지 않는다. 본 논문이 다루는 것은 이 변형들 중 감정 궤적의 이탈이라는 한 단면을, 인터랙티브 서사 안에서 실시간으로 측정 가능한 양으로 만드는 장치이다.",
        en: "This paper proposes no unified theory binding them together. What it addresses is a single facet of these transformations — divergence in emotional trajectory — and the apparatus that renders that facet a quantity measurable in real time inside an interactive narrative.",
      },
      {
        ko: "첫째, 목적 함수의 방향이 반대다. 드라마 매니저는 목표 궤적을 향해 최적화하며 체험자의 이탈을 되돌려야 할 오차로 취급한다. TEM은 어떤 목표 궤적으로도 조향하지 않는다. 작가의 감정 궤적은 최적화 대상이 아니라 측정 기준선이며, 거기서의 발산 그 자체가 렌더링되는 내용물이다.",
        en: "First, the objective function points the other way. A drama manager optimises toward a target trajectory and treats the participant's departure from it as error to be corrected. TEM steers toward no target trajectory whatever. The author's emotional trajectory is not an object of optimisation but a measurement baseline, and the divergence from it is itself the content that gets rendered.",
      },
    ],
  },

  {
    id: "tem-argument",
    kind: "reverse",
    title: "감정 궤적 이탈 측정 — 논증과 한계",
    blurb: "설계를 왜 그렇게 했는지 변호하는 문장, 그리고 스스로 한계를 긋는 문장. 「~이 아니라 ~이다」 구문과 조건절, 그리고 한계 선언 특유의 명사구 문장이 관건입니다.",
    tag: "논문 · 논증",
    note: "박도한 본인 논문 (Working Draft v0.4). 영문은 이 앱에서 만든 번역본입니다.",
    source: { author: "박도한", title: "감정 궤적 이탈 측정", page: "§3–8" },
    items: [
      {
        ko: "가장 검증 가능한 차이는 데이터 구조 수준의 분기 소멸이다. beat 기반 드라마 매니저조차 beat에 선·후행 조건을 부여하므로 내부에는 부분적 플롯 그래프가 남는다. TEM의 choice에는 next_scene_id 열이 존재하지 않으며, 가지치기할 플롯 그래프 자체가 없다. 분기를 숨긴 것이 아니라 스키마 차원에서 아예 없앤 것이다.",
        en: "The most verifiable difference is the disappearance of branching at the level of the data structure. Even a beat-based drama manager assigns pre- and postconditions to its beats, so a partial plot graph remains inside it. TEM's choice table has no next_scene_id column, and there is no plot graph to prune in the first place. The branching has not been hidden; it has been removed at the level of the schema.",
      },
      {
        ko: "이 설계에서 중요한 것은 전이 패턴이 접근 공간의 반경이 아니라 중심을 옮긴다는 점이다. 패턴이 반경만 조절한다면 엔진은 단순 룩업 테이블로 격하되고 만다. 그래서 패턴마다 중심 자체가 이동해야 한다.",
        en: "What matters in this design is that the transition pattern moves the centre of the accessible space rather than its radius. Were a pattern only to adjust the radius, the engine would be reduced to a simple lookup table. The centre itself must therefore shift with each pattern.",
      },
      {
        ko: "세 인자를 더하지 않고 곱한 것이 이 설계의 요점이다. 선형 결합에서는 한 축이 낮아도 다른 축이 보상할 수 있지만, 곱셈은 그 보상을 구조적으로 막는다.",
        en: "The point of this design is that the three factors are multiplied rather than summed. Under a linear combination one axis can compensate for another that is low; multiplication blocks that compensation structurally.",
      },
      {
        ko: "동일 총 이탈량이라도, drift-dominant한 체험과 fixation-dominant한 체험은 체험적으로 구분된다. 전자는 “다른 길로 빠지는” 느낌이고 후자는 “한 지점에 꽂혀 되풀이되는” 느낌이다. 두 축을 분리하지 않으면 동일 총량 값으로 뭉뚱그려진다.",
        en: "Even at the same total divergence, a drift-dominant experience and a fixation-dominant one are distinguishable as experiences. The former feels like straying onto another path; the latter, like being caught on a single point and repeating it. Without separating the two axes, both collapse into the same aggregate figure.",
      },
      {
        ko: "Ground truth 부재. 어떤 궤적이 “올바른” 궤적인지에 대한 기준이 없다. 이는 본 메트릭이 부합이나 정확성이 아니라 유사도와 이탈 양식을 측정하도록 설계된 결과이다.",
        en: "Absence of ground truth. There is no criterion for which trajectory is the “correct” one. This follows from the metric having been designed to measure similarity and modes of divergence rather than conformity or accuracy.",
      },
      {
        ko: "15개 페르소나 전원이 평균 0.64 이상으로 떠 있고, 인간 독자에게 기대되는 낮은 꼬리가 없었다. 따라서 이 계측기는 상대 비교에서는 유효하지만 절대 분포에서는 천장 편향을 보인다. 우리는 이것을 도구의 실패로 보지 않고 측정된 경계로 읽는다.",
        en: "All fifteen personas sat above a mean of 0.64, and the low tail one would expect of human readers was absent. The instrument is therefore valid for relative comparison but exhibits a ceiling bias in absolute distribution. We read this not as a failure of the tool but as a measured boundary.",
      },
      {
        ko: "본 논문이 남기는 것은 거대 이론의 증명이 아니라, 손에 잡히는 측정 장치와 체험 시스템이다. 기억이 변형되며 전파된다는 관찰은 Bartlett 이래 두껍게 쌓여 왔다. 본 논문은 그 변형의 양상을 측정 가능한 양으로 분해하고, 그 양이 흐르는 체험 환경을 실제로 구축했다. 작더라도 하나의 새로운 좌표를 보탠다.",
        en: "What this paper leaves behind is not the proof of a grand theory but a measuring instrument and an experiential system one can put a hand on. The observation that memory is transformed as it propagates has accumulated thickly since Bartlett. This paper decomposes the modes of that transformation into measurable quantities and actually builds the environment through which those quantities flow. Small as it is, it adds one new coordinate.",
      },
    ],
  },
];
