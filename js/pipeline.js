(function () {
  const TERMS = window.NSM_TERMS;
  const MOLECULES = window.NSM_MOLECULES;

  function moleculeById(id) {
    return MOLECULES.find((m) => m.id === id);
  }
  function splitLines(text) {
    return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  }
  function parseSpeaker(line) {
    const m = line.match(/^(заказчик|подрядчик|customer|contractor)\s*[:\u2014-]\s*(.+)$/i);
    if (!m) return { speaker: "unknown", text: line };
    const role = /заказчик|customer/i.test(m[1]) ? "customer" : "contractor";
    return { speaker: role, text: m[2].trim() };
  }
  function hasAny(text, words) {
    return words.some((w) => text.toLowerCase().includes(w));
  }

  function extract(transcript) {
    const lines = splitLines(transcript).map(parseSpeaker);
    const entities = [];
    let i = 0;
    const push = (partial) => {
      entities.push({
        id: "e" + (++i),
        raw_text: partial.raw_text,
        speaker: partial.speaker,
        type: partial.type,
        professional_term: partial.professional_term || "",
        goal: partial.goal || "",
        hints: partial.hints || []
      });
    };
    lines.forEach((line) => {
      const t = line.text.toLowerCase();
      if (hasAny(t, ["не хочу", "не надо", "можно без", "пока не надо", "отказ"])) {
        push({ raw_text: line.text, speaker: line.speaker, type: "refusal" });
      }
      Object.keys(TERMS).forEach((term) => {
        if (t.includes(term) && term !== "климат") {
          push({
            raw_text: line.text,
            speaker: line.speaker,
            type: "work",
            professional_term: term,
            hints: [TERMS[term]]
          });
        }
      });
      if (hasAny(t, ["климат", "душно", "отделка", "плитка"]) && line.speaker === "customer") {
        push({ raw_text: line.text, speaker: line.speaker, type: "work", goal: line.text });
      }
    });
    const seen = new Set();
    return entities.filter((e) => {
      const key = e.type + "|" + e.professional_term + "|" + e.raw_text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function explicate(entities) {
    return entities.map((e) => {
      const mol = e.hints && e.hints[0] ? moleculeById(e.hints[0]) : null;
      const properties = [];
      if (mol) properties.push(mol.core);
      if (e.professional_term === "рекуператор") {
        properties.splice(0, properties.length,
          "Меняет воздух в доме",
          "Бережёт тепло уходящего воздуха",
          "Ставится в стену",
          "Нужны отверстие в стене и электричество",
          "Может быть слышен звук у стены"
        );
      }
      if (e.professional_term === "праймер" || e.professional_term === "грунтовка") {
        properties.push("Нужен до следующего слоя, иначе покрытие плохо держится");
      }
      if (e.professional_term === "гидроизоляция") properties.push("Чтобы вода не ушла в плиту или стену");
      if (e.professional_term === "вентиляция") properties.push("Чтобы не было сырости и плесени");
      return {
        ...e,
        property_bundle: [...new Set(properties)],
        nsm_explication: properties.map((p) => "это делают, потому что " + p.toLowerCase()),
        molecules_used: e.hints || [],
        legality_score: properties.length ? 8 : 3
      };
    });
  }

  function classify(items, transcript) {
    const low = transcript.toLowerCase();
    const agreed = hasAny(low, ["хорошо", "давайте", "ок", "делайте как надо", "давайте так", "давайте, если надо"]);
    const bedroomNo = /шум в спальне не хочу|в спальне не ставить/.test(low);
    return items.map((e) => {
      let classification = "unclear";
      let reason = "Нет ядра или нет согласия.";
      let added_by = e.speaker === "contractor" ? "contractor_technology" : "customer";
      if (e.type === "refusal") {
        classification = "refused";
        reason = "Прямой отказ в разговоре.";
      } else if (e.professional_term === "рекуператор" && bedroomNo) {
        classification = "conditional";
        reason = "Согласие есть, но не в спальне.";
        e.property_bundle = (e.property_bundle || []).concat(["Не ставить со стороны спальни"]);
      } else if (e.property_bundle && e.property_bundle.length && agreed && e.type !== "unclear") {
        classification = "included";
        reason = "Есть свойства и фраза согласия.";
      } else if (e.professional_term && (!e.property_bundle || !e.property_bundle.length)) {
        classification = "unclear";
        reason = "Ярлык без ядра. В договор нельзя.";
      }
      if (["праймер", "грунтовка", "гидроизоляция", "стяжка", "вентиляция"].includes(e.professional_term)) {
        added_by = "contractor_technology";
      }
      if (classification === "included" && (!e.property_bundle || !e.property_bundle.length || !e.raw_text)) {
        classification = "unclear";
        reason = "Правило: included без ядра или цитаты запрещён.";
      }
      const est = estimate(e.professional_term);
      return { ...e, classification, reason, added_by, source_evidence: e.raw_text, estimate_min: est.min, estimate_max: est.max };
    });
  }

  function estimate(term) {
    const map = {
      "рекуператор": { min: 35000, max: 90000 },
      "вентиляция": { min: 15000, max: 45000 },
      "праймер": { min: 4000, max: 12000 },
      "грунтовка": { min: 3000, max: 9000 },
      "гидроизоляция": { min: 18000, max: 40000 },
      "стяжка": { min: 25000, max: 60000 },
      "штукатурка": { min: 40000, max: 90000 },
      "плитка": { min: 50000, max: 120000 }
    };
    return map[term] || { min: 0, max: 0 };
  }

  function flags(items) {
    const out = [];
    if (items.some((i) => i.classification === "unclear")) out.push({ kind: "bad", text: "Есть неясности. Подпись по ним закрывать нельзя." });
    if (items.some((i) => i.added_by === "contractor_technology" && (i.classification === "included" || i.classification === "conditional"))) {
      out.push({ kind: "warn", text: "Часть работ добавил подрядчик как технологию." });
    }
    if (items.some((i) => i.classification === "refused")) out.push({ kind: "ok", text: "Отказы зафиксированы отдельным блоком." });
    if (items.some((i) => (i.classification === "included" || i.classification === "conditional") && i.property_bundle.length)) {
      out.push({ kind: "ok", text: "У включённых позиций есть простое ядро." });
    }
    return out;
  }

  function money(n) { return n ? n.toLocaleString("ru-RU") + " ₽" : "\u2014"; }

  function renderDocs(session, items) {
    const inc = items.filter((i) => i.classification === "included" || i.classification === "conditional");
    const ref = items.filter((i) => i.classification === "refused");
    const unc = items.filter((i) => i.classification === "unclear");
    const tech = inc.filter((i) => i.added_by === "contractor_technology");
    const min = inc.reduce((s, i) => s + (i.estimate_min || 0), 0);
    const max = inc.reduce((s, i) => s + (i.estimate_max || 0), 0);
    const protocol = ["ПРОТОКОЛ СОГЛАСОВАНИЯ ОБЪЁМА РАБОТ", "Объект: " + session.object, "Заказчик: " + session.customer, "Подрядчик: " + session.contractor, "", "A. Включённые и условные работы"];
    inc.forEach((i, n) => {
      protocol.push((n + 1) + ". " + (i.professional_term || i.goal || "работа"));
      (i.property_bundle || []).forEach((p) => protocol.push("   \u2014 " + p));
      protocol.push("   цитата: \u00ab" + i.source_evidence + "\u00bb");
      protocol.push("   статус: " + i.classification + "; ориентир " + money(i.estimate_min) + " \u2013 " + money(i.estimate_max));
    });
    protocol.push("", "B. Отказы");
    if (!ref.length) protocol.push("нет");
    ref.forEach((i) => protocol.push("\u2014 \u00ab" + i.raw_text + "\u00bb"));
    protocol.push("", "C. Технология подрядчика");
    if (!tech.length) protocol.push("нет");
    tech.forEach((i) => protocol.push("\u2014 " + (i.professional_term || i.raw_text)));
    protocol.push("", "D. Неясности");
    if (!unc.length) protocol.push("нет");
    unc.forEach((i) => protocol.push("\u2014 " + i.reason + " / \u00ab" + i.raw_text + "\u00bb"));
    protocol.push("", "Ориентир: " + money(min) + " \u2013 " + money(max));
    protocol.push("Это не нормативная смета. Подпись ставится под свойствами работ.");
    const tz = ["ТЕХНИЧЕСКОЕ ЗАДАНИЕ", ""];
    inc.forEach((i, n) => {
      tz.push((n + 1) + ". Сделать: " + (i.professional_term || "работу") + ".");
      (i.property_bundle || []).forEach((p) => tz.push("   Результат/ограничение: " + p));
    });
    ref.forEach((i) => tz.push("Не делать: " + i.raw_text));
    const spec = ["СПЕЦИФИКАЦИЯ К ДОГОВОРУ", ""];
    inc.forEach((i, n) => {
      spec.push((n + 1) + ". " + (i.professional_term || "позиция") + " \u2014 свойства согласованы, ориентир " + money(i.estimate_min) + "\u2013" + money(i.estimate_max));
    });
    spec.push("", "Исключения из объёма:");
    ref.forEach((i) => spec.push("\u2014 " + i.raw_text));
    return { protocol: protocol.join("\n"), tz: tz.join("\n"), spec: spec.join("\n"), min, max };
  }

  window.NSM_PIPELINE = {
    run(session) {
      const extracted = extract(session.transcript);
      const explicated = explicate(extracted);
      const classified = classify(explicated, session.transcript);
      const docs = renderDocs(session, classified);
      return {
        entities: classified,
        flags: flags(classified),
        docs,
        counts: {
          included: classified.filter((i) => i.classification === "included" || i.classification === "conditional").length,
          refused: classified.filter((i) => i.classification === "refused").length,
          unclear: classified.filter((i) => i.classification === "unclear").length
        }
      };
    }
  };
})();
