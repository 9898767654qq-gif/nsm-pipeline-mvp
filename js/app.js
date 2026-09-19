(function () {
  const $ = (id) => document.getElementById(id);
  const state = {
    object: "Объект пилота",
    customer: "Заказчик",
    contractor: "Подрядчик",
    transcript: "",
    recording: false,
    media: null,
    chunks: []
  };

  function setStep(n) {
    document.querySelectorAll(".step").forEach((el, i) => {
      el.classList.toggle("on", i < n);
      el.classList.toggle("ok", i + 1 < n);
    });
  }

  function loadDemo(id) {
    const d = window.NSM_DEMOS[id];
    state.object = d.object;
    state.customer = d.customer;
    state.contractor = d.contractor;
    state.transcript = d.transcript;
    $("object").value = d.object;
    $("customer").value = d.customer;
    $("contractor").value = d.contractor;
    $("transcript").value = d.transcript;
    $("status").textContent = "Загружен демо-кейс: " + d.title;
  }

  async function toggleRec() {
    if (state.recording) {
      state.media.stop();
      state.recording = false;
      $("recBtn").innerHTML = "Начать запись";
      $("status").textContent = "Запись остановлена. Распознавание речи ещё не подключено — вставьте текст или возьмите демо.";
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      state.chunks = [];
      state.media = new MediaRecorder(stream);
      state.media.ondataavailable = (e) => state.chunks.push(e.data);
      state.media.onstop = () => {
        const blob = new Blob(state.chunks, { type: "audio/webm" });
        $("audio").src = URL.createObjectURL(blob);
        $("audio").style.display = "block";
      };
      state.media.start();
      state.recording = true;
      $("recBtn").innerHTML = '<span class="recdot"></span>Стоп';
      $("status").textContent = "Идёт запись. После остановки вставьте расшифровку.";
    } catch (err) {
      $("status").textContent = "Микрофон недоступен. Используйте демо или вставьте текст.";
    }
  }

  function run() {
    state.object = $("object").value.trim() || "Объект";
    state.customer = $("customer").value.trim() || "Заказчик";
    state.contractor = $("contractor").value.trim() || "Подрядчик";
    state.transcript = $("transcript").value.trim();
    if (!state.transcript) {
      $("status").textContent = "Нужен текст разговора.";
      return;
    }
    setStep(4);
    const result = window.NSM_PIPELINE.run(state);
    renderResult(result);
    $("status").textContent = "Готово. Проверьте ядро и статусы до подписи.";
  }

  function renderResult(result) {
    const flags = $("flags");
    flags.innerHTML = "";
    result.flags.forEach((f) => {
      const d = document.createElement("div");
      d.className = "flag " + (f.kind === "bad" ? "bad" : f.kind === "ok" ? "ok" : "");
      d.textContent = f.text;
      flags.appendChild(d);
    });
    $("counts").textContent =
      "В работе: " + result.counts.included +
      "  ·  отказов: " + result.counts.refused +
      "  ·  неясно: " + result.counts.unclear +
      "  ·  ориентир " + result.docs.min.toLocaleString("ru-RU") +
      " – " + result.docs.max.toLocaleString("ru-RU") + " ₽";

    const groups = {
      included: $("list-included"),
      refused: $("list-refused"),
      tech: $("list-tech"),
      unclear: $("list-unclear")
    };
    Object.values(groups).forEach((el) => { el.innerHTML = ""; });

    result.entities.forEach((e) => {
      const card = document.createElement("div");
      card.className = "item";
      const title = e.professional_term || e.goal || e.type;
      const tags = [
        '<span class="tag">' + e.classification + "</span>",
        e.added_by === "contractor_technology" ? '<span class="tag tech">технология подрядчика</span>' : ""
      ].join("");
      const props = (e.property_bundle || []).map((p) => "<li>" + p + "</li>").join("");
      card.innerHTML =
        tags +
        "<h3>" + title + "</h3>" +
        (e.professional_term ? '<div class="term">ярлык после ядра</div>' : "") +
        (props ? "<ul class='props'>" + props + "</ul>" : "") +
        '<div class="quote">«' + e.source_evidence + "»</div>" +
        "<div class='hint'>" + e.reason + "</div>" +
        (e.estimate_min ? "<div class='price'>" + e.estimate_min.toLocaleString("ru-RU") + " – " + e.estimate_max.toLocaleString("ru-RU") + " ₽</div>" : "");

      if (e.classification === "refused") groups.refused.appendChild(card);
      else if (e.classification === "unclear") groups.unclear.appendChild(card);
      else if (e.added_by === "contractor_technology") groups.tech.appendChild(card);
      else groups.included.appendChild(card);
    });

    $("doc-protocol").textContent = result.docs.protocol;
    $("doc-tz").textContent = result.docs.tz;
    $("doc-spec").textContent = result.docs.spec;
    window._lastResult = { session: { ...state }, result };
  }

  function download(kind) {
    const pack = window._lastResult;
    if (!pack) return;
    let name = "protocol.txt";
    let body = pack.result.docs.protocol;
    if (kind === "tz") { name = "tz.txt"; body = pack.result.docs.tz; }
    if (kind === "spec") { name = "spec.txt"; body = pack.result.docs.spec; }
    if (kind === "json") { name = "session.json"; body = JSON.stringify(pack, null, 2); }
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }

  function printDoc() {
    const text = $("doc-protocol").textContent;
    const w = window.open("", "_blank");
    w.document.write("<pre style='font: 14px/1.45 Georgia, serif; padding:24px; white-space:pre-wrap'>" + text.replace(/</g, "<") + "</pre>");
    w.document.close();
    w.print();
  }

  $("demoClimate").onclick = () => loadDemo("climate");
  $("demoGarage").onclick = () => loadDemo("garage");
  $("recBtn").onclick = toggleRec;
  $("runBtn").onclick = run;
  $("dlProtocol").onclick = () => download("protocol");
  $("dlTz").onclick = () => download("tz");
  $("dlSpec").onclick = () => download("spec");
  $("dlJson").onclick = () => download("json");
  $("printBtn").onclick = printDoc;
  loadDemo("climate");
})();
