// widget/widget.js
(() => {
  const cfg = window.CRASH_CONCIERGE_CONFIG || {};
  const shopName = cfg.shopName || "Auto Body Shop";
  const phoneNumber = cfg.phoneNumber || "";
  const apiUrl = cfg.apiUrl || "/.netlify/functions/new-lead";
  const accent = cfg.brandAccent || "#d40000";

  // Identify which demo flow to run
  const demoId = cfg.demoId || "";
  const demoKind = cfg.demoKind || "autobody"; // "autobody" | "automotive"
  const isWesbecker = demoId === "wesbecker-automotive" || demoKind === "automotive";

  const state = {
    step: "WELCOME",
    lead: {
      source: "website-chat",
      intent: null,

      // autobody fields
      drivable: null,
      insurance: null,
      claim_number: "",

      // shared vehicle fields (we’ll reuse for Subaru)
      vehicle_year: "",
      vehicle_make: "",
      vehicle_model: "",
      vin: "",

      // autobody fields
      damage_areas: [],
      incident_description: "",
      zip: "",

      // automotive demo fields
      service_type: "",       // e.g., oil_change, brakes, diag, etc.
      quote_estimate: "",     // e.g., "$120–$180"
      symptoms: "",           // short description

      // contact
      contact_preference: "text",
      name: "",
      phone: "",
      email: "",
      text_consent: true,

      photo_urls: [],
      preferred_next_step: null,
      preferred_time_window: null,
      notes: "",

      meta: {
        demo: true,
        demoId: cfg.demoId || null,
        demoKind: cfg.demoKind || null,
        shopName: cfg.shopName || null,
        shopAddress: cfg.shopAddress || null,
        user_agent: navigator.userAgent,
      },
    },
  };

  // ---------- UI ----------
  const launcher = document.createElement("button");
  launcher.id = "cc-launcher";
  launcher.textContent = "💬";
  launcher.style.background = accent;

  const panel = document.createElement("div");
  panel.id = "cc-panel";

  panel.innerHTML = `
    <div id="cc-header">
      <div>
        <div id="cc-title">${shopName} · Chat</div>
        <div id="cc-subtitle">${isWesbecker ? "Subaru service & rough quotes" : "Estimates + inspections in minutes"}</div>
      </div>
      <button id="cc-close" aria-label="Close">✕</button>
    </div>
    <div id="cc-messages"></div>
    <div id="cc-controls">
      <div id="cc-quick"></div>
      <div id="cc-inputrow">
        <input id="cc-input" placeholder="Type here…" />
        <button id="cc-send">Send</button>
      </div>
      <div id="cc-hint"></div>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(panel);

  const $messages = panel.querySelector("#cc-messages");
  const $quick = panel.querySelector("#cc-quick");
  const $input = panel.querySelector("#cc-input");
  const $send = panel.querySelector("#cc-send");
  const $hint = panel.querySelector("#cc-hint");
  const $close = panel.querySelector("#cc-close");

  $send.style.background = accent;

  function scrollToBottom() {
    $messages.scrollTop = $messages.scrollHeight;
  }

  function addBubble(text, who = "bot") {
    const div = document.createElement("div");
    div.className = `cc-bubble ${who === "user" ? "cc-user" : "cc-bot"}`;
    div.textContent = text;
    $messages.appendChild(div);
    scrollToBottom();
  }

  // iPhone-safe quick buttons: inner row
  function setQuickButtons(buttons) {
    $quick.innerHTML = "";
    const row = document.createElement("div");
    row.className = "cc-quick-row";

    (buttons || []).forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "cc-btn";
      btn.textContent = b.label;

      if (b.value === "DMG_DONE") btn.classList.add("cc-sticky-done");
      if (b.value === "DMG_CLEAR") btn.classList.add("cc-sticky-clear");

      btn.onclick = () => handleUser(b.value, true);
      row.appendChild(btn);
    });

    $quick.appendChild(row);

    const hasSticky = (buttons || []).some((b) => b.value === "DMG_DONE" || b.value === "DMG_CLEAR");
    if (hasSticky) {
      requestAnimationFrame(() => {
        $quick.scrollLeft = $quick.scrollWidth;
      });
    }
  }

  function setHint(text) {
    $hint.textContent = text || "";
  }

  function openPanel() {
    panel.style.display = "flex";
    launcher.style.display = "none";
    if ($messages.childElementCount === 0) start();
  }

  function closePanel() {
    panel.style.display = "none";
    launcher.style.display = "grid";
  }

  launcher.onclick = openPanel;
  $close.onclick = closePanel;

  // ---------- Helpers ----------
  function isZip(s) {
    return /^[0-9]{5}$/.test((s || "").trim());
  }

  function normalizePhone(s) {
    const digits = (s || "").replace(/\D/g, "");
    if (digits.length === 10) return digits;
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return "";
  }

  function prettyKey(k) {
    return (k || "").replace(/_/g, " ");
  }

  function resetLead() {
    state.lead = {
      source: "website-chat",
      intent: null,

      drivable: null,
      insurance: null,
      claim_number: "",

      vehicle_year: "",
      vehicle_make: "",
      vehicle_model: "",
      vin: "",

      damage_areas: [],
      incident_description: "",
      zip: "",

      service_type: "",
      quote_estimate: "",
      symptoms: "",

      contact_preference: "text",
      name: "",
      phone: "",
      email: "",
      text_consent: true,

      photo_urls: [],

      preferred_next_step: null,
      preferred_time_window: null,
      notes: "",

      meta: {
        demo: true,
        demoId: cfg.demoId || null,
        demoKind: cfg.demoKind || null,
        shopName: cfg.shopName || null,
        shopAddress: cfg.shopAddress || null,
        user_agent: navigator.userAgent,
      },
    };
  }

  function summaryText() {
    const L = state.lead;
    const lines = [];
    lines.push(`Shop: ${L.meta?.shopName || shopName}`);
    if (L.meta?.shopAddress) lines.push(`Address: ${L.meta.shopAddress}`);
    lines.push(`Intent: ${L.intent || "-"}`);

    if (L.intent === "estimate") {
      lines.push(`Drivable: ${L.drivable || "-"}`);
      lines.push(`Insurance: ${L.insurance || "-"}`);
      if (L.claim_number) lines.push(`Claim #: ${L.claim_number}`);
      lines.push(`Vehicle: ${[L.vehicle_year, L.vehicle_make, L.vehicle_model].filter(Boolean).join(" ") || "-"}`);
      lines.push(`Damage: ${(L.damage_areas || []).map(prettyKey).join(", ") || "-"}`);
      lines.push(`What happened: ${L.incident_description || "-"}`);
      lines.push(`ZIP: ${L.zip || "-"}`);
    }

    if (L.intent === "automotive_quote") {
      lines.push(`Subaru: ${[L.vehicle_year, L.vehicle_model].filter(Boolean).join(" ") || "-"}`);
      lines.push(`Service: ${L.service_type ? prettyKey(L.service_type) : "-"}`);
      if (L.symptoms) lines.push(`Symptoms: ${L.symptoms}`);
      if (L.quote_estimate) lines.push(`Rough quote: ${L.quote_estimate}`);
      lines.push(`ZIP: ${L.zip || "-"}`);
    }

    lines.push(`Contact: ${L.contact_preference || "-"}`);
    lines.push(`Name: ${L.name || "-"}`);
    lines.push(`Phone: ${L.phone || "-"}`);
    if (L.email) lines.push(`Email: ${L.email}`);
    lines.push(`Text consent: ${L.text_consent ? "yes" : "no"}`);
    return lines.join("\n");
  }

  function renderDamageButtons() {
    setQuickButtons([
      { label: "Front", value: "DMG_front" },
      { label: "Rear", value: "DMG_rear" },
      { label: "Driver side", value: "DMG_driver_side" },
      { label: "Passenger side", value: "DMG_passenger_side" },
      { label: "Glass", value: "DMG_glass" },
      { label: "Wheels/Suspension", value: "DMG_wheels_suspension" },
      { label: "Clear", value: "DMG_CLEAR" },
      { label: "Done", value: "DMG_DONE" },
    ]);
  }

  // Generic quote table (demo values)
  const QUOTES = {
    diag: { label: "Check engine / Diagnostic", range: "$120–$180", note: "Depends on what we find." },
    oil_change: { label: "Oil change", range: "$90–$140", note: "Price varies by oil type & model." },
    brakes: { label: "Brakes (pads/rotors)", range: "$350–$900", note: "Axle + parts choice drives range." },
    battery: { label: "Battery / charging", range: "$180–$420", note: "Includes test + replacement if needed." },
    suspension: { label: "Suspension noise / clunk", range: "$200–$1,200", note: "Depends on what’s worn." },
    ac: { label: "A/C not cold", range: "$180–$1,000+", note: "Could be recharge or component repair." },
  };

  function renderQuoteButtons() {
    setQuickButtons([
      { label: QUOTES.diag.label, value: "Q_diag" },
      { label: QUOTES.oil_change.label, value: "Q_oil_change" },
      { label: QUOTES.brakes.label, value: "Q_brakes" },
      { label: QUOTES.battery.label, value: "Q_battery" },
      { label: QUOTES.suspension.label, value: "Q_suspension" },
      { label: QUOTES.ac.label, value: "Q_ac" },
      { label: "Something else", value: "Q_other" },
    ]);
  }

  async function submitLead() {
    const payload = {
      source: state.lead.source,
      intent: state.lead.intent,

      drivable: state.lead.drivable,
      insurance: state.lead.insurance,
      claim_number: state.lead.claim_number,

      vehicle_year: state.lead.vehicle_year,
      vehicle_make: state.lead.vehicle_make,
      vehicle_model: state.lead.vehicle_model,
      vin: state.lead.vin,

      damage_areas: state.lead.damage_areas,
      incident_description: state.lead.incident_description,
      zip: state.lead.zip,

      // automotive
      service_type: state.lead.service_type,
      quote_estimate: state.lead.quote_estimate,
      symptoms: state.lead.symptoms,

      contact_preference: state.lead.contact_preference,
      name: state.lead.name,
      phone: state.lead.phone,
      email: state.lead.email,
      text_consent: state.lead.text_consent,

      photo_urls: state.lead.photo_urls,

      preferred_next_step: state.lead.preferred_next_step,
      preferred_time_window: state.lead.preferred_time_window,
      notes: state.lead.notes,

      meta: state.lead.meta,
    };

    setQuickButtons([]);
    setHint("Submitting…");

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submit failed");

      addBubble("✅ You’re in. We’ll follow up ASAP.\n\nWant a copy of your summary here?", "bot");
      setQuickButtons([
        { label: "Show summary", value: "SHOW_SUMMARY" },
        { label: "Start over", value: "RESTART" },
      ]);
      setHint("Demo tip: this is where you’d send SMS/email to the shop.");
      state.step = "POST_SUBMIT";
    } catch (e) {
      addBubble("⚠️ Something went wrong submitting that. You can try again or just call us.", "bot");
      const btns = [{ label: "Try again", value: "TRY_SUBMIT" }];
      if (phoneNumber) btns.push({ label: "Call shop now", value: "CALL_SHOP" });
      setQuickButtons(btns);
      setHint("");
      state.step = "SUBMIT_ERROR";
    }
  }

  // ---------- Start ----------
  function start() {
    if (isWesbecker) {
      // Wesbecker demo: Subaru first
      state.lead.intent = "automotive_quote";
      state.lead.vehicle_make = "Subaru";
      addBubble("Hi! Quick Subaru quote demo 👇\n\nWhat’s the year and model of your Subaru?", "bot");
      setQuickButtons([]);
      setHint("Example: 2015 Outback");
      state.step = "WES_SUBARU";
      return;
    }

    // Default: autobody welcome
    addBubble(
      "Hi! I can help you start an estimate, book an inspection, or help if the car isn’t drivable.\n\nWhat do you need?",
      "bot"
    );
    setQuickButtons([
      { label: "Start Estimate", value: "START_ESTIMATE" },
      { label: "Book Inspection", value: "BOOK_INSPECTION" },
      { label: "Car Not Drivable", value: "NOT_DRIVABLE" },
    ]);
    setHint("");
    state.step = "WELCOME";
  }

  // ---------- Handler ----------
  function handleUser(text, fromButton = false) {
    const raw = (text || "").trim();
    if (!raw) return;
    if (!fromButton) addBubble(raw, "user");

    // Global commands
    if (raw === "RESTART") {
      $messages.innerHTML = "";
      resetLead();
      start();
      return;
    }
    if (raw === "CALL_SHOP") {
      if (phoneNumber) window.location.href = `tel:${phoneNumber}`;
      return;
    }
    if (raw === "SHOW_SUMMARY") {
      addBubble(summaryText(), "bot");
      return;
    }
    if (raw === "TRY_SUBMIT") {
      addBubble("Okay, trying again…", "bot");
      submitLead();
      return;
    }

    // -------------------------
    // Wesbecker Automotive Flow
    // -------------------------
    if (isWesbecker) {
      switch (state.step) {
        case "WES_SUBARU": {
          // Accept: "2015 Outback" or "2015 Subaru Outback"
          const parts = raw.split(/\s+/);
          const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
          if (!year || parts.length < 2) {
            addBubble("Please reply like: 2015 Outback (year + model).", "bot");
            setHint("Example: 2018 Forester");
            return;
          }

          state.lead.vehicle_year = year;

          // If they included Subaru, drop it
          let rest = parts.slice(1).join(" ");
          rest = rest.replace(/^subaru\s+/i, "");
          state.lead.vehicle_model = rest;

          addBubble("Got it. What do you want a rough quote for?", "bot");
          renderQuoteButtons();
          setHint("Tap a service type.");
          state.step = "WES_SERVICE";
          return;
        }

        case "WES_SERVICE": {
          if (raw.startsWith("Q_")) {
            const key = raw.replace("Q_", "");

            if (key === "other") {
              state.lead.service_type = "other";
              addBubble("Tell me a sentence about the issue (symptoms or what you want done).", "bot");
              setQuickButtons([]);
              setHint("Example: squealing when braking, or needs 60k service.");
              state.step = "WES_SYMPTOMS";
              return;
            }

            const q = QUOTES[key];
            if (!q) {
              addBubble("Pick one of the buttons so I can estimate a range.", "bot");
              renderQuoteButtons();
              return;
            }

            state.lead.service_type = key;
            state.lead.quote_estimate = q.range;

            addBubble(
              `Rough range for ${q.label} on a ${state.lead.vehicle_year} ${state.lead.vehicle_model}:\n${q.range}\n\n${q.note}\n\nWant to add symptoms/details?`,
              "bot"
            );
            setQuickButtons([
              { label: "Add symptoms", value: "WES_ADD_SYM" },
              { label: "Skip", value: "WES_SKIP_SYM" },
            ]);
            setHint("");
            state.step = "WES_SYMPTOMS_PROMPT";
            return;
          }

          addBubble("Use the buttons to pick a service type.", "bot");
          renderQuoteButtons();
          return;
        }

        case "WES_SYMPTOMS_PROMPT": {
          if (raw === "WES_ADD_SYM") {
            addBubble("What symptoms are you noticing? (one sentence)", "bot");
            setQuickButtons([]);
            setHint("Example: grinding noise front right, only when turning.");
            state.step = "WES_SYMPTOMS";
            return;
          }
          if (raw === "WES_SKIP_SYM") {
            state.lead.symptoms = "";
            addBubble("What’s your ZIP code?", "bot");
            setQuickButtons([]);
            setHint("5 digits.");
            state.step = "WES_ZIP";
            return;
          }
          addBubble("Tap Add symptoms or Skip.", "bot");
          return;
        }

        case "WES_SYMPTOMS": {
          state.lead.symptoms = raw;
          addBubble("What’s your ZIP code?", "bot");
          setQuickButtons([]);
          setHint("5 digits.");
          state.step = "WES_ZIP";
          return;
        }

        case "WES_ZIP": {
          if (!isZip(raw)) {
            addBubble("That ZIP doesn’t look right. Please enter 5 digits.", "bot");
            return;
          }
          state.lead.zip = raw;

          addBubble("Best way to reach you?", "bot");
          setQuickButtons([
            { label: "Text", value: "CP_text" },
            { label: "Call", value: "CP_call" },
            { label: "Email", value: "CP_email" },
          ]);
          setHint("");
          state.step = "CONTACT_PREF";
          return;
        }

        // Falls through to the shared CONTACT_PREF / PHONE / EMAIL / NAME flow below
      }
    }

    // -------------------------
    // Shared Contact Flow + Auto Body Flow
    // -------------------------
    switch (state.step) {
      // Contact preference works for both flows
      case "CONTACT_PREF": {
        if (!raw.startsWith("CP_")) {
          addBubble("Tap a button: text, call, or email.", "bot");
          return;
        }
        state.lead.contact_preference = raw.replace("CP_", "");

        if (state.lead.contact_preference === "email") {
          addBubble("What’s your email?", "bot");
          setQuickButtons([]);
          setHint("We’ll reply with next steps.");
          state.step = "EMAIL";
        } else {
          addBubble("What’s your phone number?", "bot");
          setQuickButtons([]);
          setHint("We’ll use this for updates.");
          state.step = "PHONE";
        }
        return;
      }

      case "PHONE": {
        const p = normalizePhone(raw);
        if (!p) {
          addBubble("Please enter a 10-digit phone number.", "bot");
          return;
        }
        state.lead.phone = p;

        addBubble("OK to text you updates about this request?", "bot");
        setQuickButtons([
          { label: "Yes", value: "CONSENT_Y" },
          { label: "No", value: "CONSENT_N" },
        ]);
        setHint("");
        state.step = "CONSENT";
        return;
      }

      case "CONSENT": {
        if (raw === "CONSENT_Y") state.lead.text_consent = true;
        else if (raw === "CONSENT_N") state.lead.text_consent = false;
        else {
          addBubble("Tap Yes or No please.", "bot");
          setQuickButtons([
            { label: "Yes", value: "CONSENT_Y" },
            { label: "No", value: "CONSENT_N" },
          ]);
          return;
        }

        addBubble("What’s your name?", "bot");
        setQuickButtons([]);
        setHint("");
        state.step = "NAME";
        return;
      }

      case "EMAIL": {
        const email = raw.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          addBubble("That email doesn’t look right. Try again.", "bot");
          return;
        }
        state.lead.email = email;

        addBubble("What’s your name?", "bot");
        setQuickButtons([]);
        setHint("");
        state.step = "NAME";
        return;
      }

      case "NAME": {
        state.lead.name = raw;

        addBubble("Here’s what I’ve got. Looks good?", "bot");
        addBubble(summaryText(), "bot");
        setQuickButtons([
          { label: "Submit", value: "SUBMIT" },
          { label: "Start over", value: "RESTART" },
        ]);
        setHint("");
        state.step = "CONFIRM";
        return;
      }

      case "CONFIRM": {
        if (raw === "SUBMIT") {
          submitLead();
          return;
        }
        addBubble("Tap Submit or Start over.", "bot");
        return;
      }

      // -------------------------
      // Auto body flow (unchanged-ish)
      // -------------------------
      case "WELCOME": {
        if (raw === "START_ESTIMATE") {
          state.lead.intent = "estimate";
          addBubble("No worries. We’ll get you taken care of.\n\nIs the vehicle drivable?", "bot");
          setQuickButtons([
            { label: "Yes", value: "DRIVABLE_YES" },
            { label: "No", value: "DRIVABLE_NO" },
            { label: "Not sure", value: "DRIVABLE_NS" },
          ]);
          setHint("");
          state.step = "DRIVABLE";
          return;
        }
        if (raw === "BOOK_INSPECTION") {
          state.lead.intent = "book_inspection";
          addBubble("Great. What’s the vehicle? (Year Make Model)", "bot");
          setQuickButtons([]);
          setHint("Example: 2018 Toyota Camry");
          state.step = "BOOK_VEHICLE";
          return;
        }
        if (raw === "NOT_DRIVABLE") {
          state.lead.intent = "tow_help";
          addBubble(
            "Got it. If it’s unsafe to drive, call us and we’ll help with towing options.\n\nWant to also start an estimate with details?",
            "bot"
          );
          const btns = [];
          if (phoneNumber) btns.push({ label: "Call Shop Now", value: "CALL_SHOP" });
          btns.push({ label: "Yes, start estimate", value: "TOW_TO_ESTIMATE" });
          btns.push({ label: "Not now", value: "TOW_DONE" });
          setQuickButtons(btns);
          setHint("");
          state.step = "TOW";
          return;
        }

        addBubble("I can help with an estimate, booking, or towing help. Pick one:", "bot");
        setQuickButtons([
          { label: "Start Estimate", value: "START_ESTIMATE" },
          { label: "Book Inspection", value: "BOOK_INSPECTION" },
          { label: "Car Not Drivable", value: "NOT_DRIVABLE" },
        ]);
        return;
      }

      case "TOW": {
        if (raw === "TOW_TO_ESTIMATE") {
          state.lead.intent = "estimate";
          state.lead.drivable = "no";
          addBubble("Okay. Is this going through insurance?", "bot");
          setQuickButtons([
            { label: "Yes", value: "INS_YES" },
            { label: "No", value: "INS_NO" },
            { label: "Not sure", value: "INS_NS" },
          ]);
          state.step = "INSURANCE";
          return;
        }
        if (raw === "TOW_DONE") {
          addBubble("No problem. You can reopen this chat anytime.", "bot");
          const btns = [{ label: "Start over", value: "RESTART" }];
          if (phoneNumber) btns.unshift({ label: "Call Shop Now", value: "CALL_SHOP" });
          setQuickButtons(btns);
          state.step = "POST_SUBMIT";
          return;
        }
        return;
      }

      case "DRIVABLE": {
        if (raw === "DRIVABLE_YES") state.lead.drivable = "yes";
        else if (raw === "DRIVABLE_NO") state.lead.drivable = "no";
        else if (raw === "DRIVABLE_NS") state.lead.drivable = "not_sure";
        else {
          addBubble("Is it drivable? Tap a button:", "bot");
          setQuickButtons([
            { label: "Yes", value: "DRIVABLE_YES" },
            { label: "No", value: "DRIVABLE_NO" },
            { label: "Not sure", value: "DRIVABLE_NS" },
          ]);
          return;
        }

        addBubble("Is this going through insurance?", "bot");
        setQuickButtons([
          { label: "Yes", value: "INS_YES" },
          { label: "No", value: "INS_NO" },
          { label: "Not sure", value: "INS_NS" },
        ]);
        state.step = "INSURANCE";
        return;
      }

      case "INSURANCE": {
        if (raw === "INS_YES") state.lead.insurance = "yes";
        else if (raw === "INS_NO") state.lead.insurance = "no";
        else if (raw === "INS_NS") state.lead.insurance = "not_sure";
        else {
          addBubble("Insurance or not? Tap a button:", "bot");
          setQuickButtons([
            { label: "Yes", value: "INS_YES" },
            { label: "No", value: "INS_NO" },
            { label: "Not sure", value: "INS_NS" },
          ]);
          return;
        }

        if (state.lead.insurance === "yes") {
          addBubble("If you have it, enter your claim number (or tap Skip).", "bot");
          setQuickButtons([{ label: "Skip", value: "SKIP_CLAIM" }]);
          setHint("Claim # optional.");
          state.step = "CLAIM";
          return;
        }

        addBubble("What’s the vehicle? (Year Make Model)", "bot");
        setQuickButtons([]);
        setHint("Example: 2018 Toyota Camry");
        state.step = "VEHICLE";
        return;
      }

      case "CLAIM": {
        if (raw === "SKIP_CLAIM") state.lead.claim_number = "";
        else state.lead.claim_number = raw;

        addBubble("What’s the vehicle? (Year Make Model)", "bot");
        setQuickButtons([]);
        setHint("Example: 2018 Toyota Camry");
        state.step = "VEHICLE";
        return;
      }

      case "VEHICLE": {
        const parts = raw.split(/\s+/);
        const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
        if (!year || parts.length < 3) {
          addBubble("Please format like: Year Make Model\nExample: 2018 Toyota Camry", "bot");
          setHint("Try again.");
          return;
        }
        state.lead.vehicle_year = year;
        state.lead.vehicle_make = parts[1];
        state.lead.vehicle_model = parts.slice(2).join(" ");

        addBubble("Where is the damage? Swipe the buttons left/right. Tap Done when finished.", "bot");
        renderDamageButtons();
        setHint("Selected: (none)");
        state.step = "DAMAGE";
        return;
      }

      case "DAMAGE": {
        renderDamageButtons();

        if (!raw.startsWith("DMG_")) {
          addBubble("Use the buttons to pick damage areas, then tap Done.", "bot");
          setHint(`Selected: ${(state.lead.damage_areas || []).map(prettyKey).join(", ") || "(none)"}`);
          return;
        }

        const key = raw.replace("DMG_", "");

        if (key === "DONE") {
          addBubble("Got it. One sentence: what happened?", "bot");
          setQuickButtons([]);
          setHint("");
          state.step = "INCIDENT";
          return;
        }

        if (key === "CLEAR") {
          state.lead.damage_areas = [];
          addBubble("🧹 Cleared selections. Pick damage areas again.", "bot");
          setHint("Selected: (none)");
          return;
        }

        if (!state.lead.damage_areas.includes(key)) {
          state.lead.damage_areas.push(key);
          addBubble(`✅ Added: ${prettyKey(key)}`, "bot");
        } else {
          addBubble(`ℹ️ Already selected: ${prettyKey(key)}`, "bot");
        }

        setHint(
          `Selected: ${(state.lead.damage_areas || []).map(prettyKey).join(", ") || "(none)"} · Tap Done when finished.`
        );
        return;
      }

      case "INCIDENT": {
        state.lead.incident_description = raw;
        addBubble("What’s your ZIP code?", "bot");
        setQuickButtons([]);
        setHint(cfg.serviceZipHint || "Enter 5 digits.");
        state.step = "ZIP";
        return;
      }

      case "ZIP": {
        if (!isZip(raw)) {
          addBubble("That ZIP doesn’t look right. Please enter 5 digits.", "bot");
          return;
        }
        state.lead.zip = raw;

        addBubble("Best way to reach you?", "bot");
        setQuickButtons([
          { label: "Text", value: "CP_text" },
          { label: "Call", value: "CP_call" },
          { label: "Email", value: "CP_email" },
        ]);
        setHint("");
        state.step = "CONTACT_PREF";
        return;
      }

      // Booking-only path (kept)
      case "BOOK_VEHICLE": {
        const parts = raw.split(/\s+/);
        const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts[0] : "";
        if (!year || parts.length < 3) {
          addBubble("Please format like: Year Make Model\nExample: 2018 Toyota Camry", "bot");
          return;
        }
        state.lead.vehicle_year = year;
        state.lead.vehicle_make = parts[1];
        state.lead.vehicle_model = parts.slice(2).join(" ");

        addBubble("Pick a time window:", "bot");
        setQuickButtons([
          { label: "Today (9–12)", value: "TW_today_morning" },
          { label: "Today (12–3)", value: "TW_today_afternoon" },
          { label: "Tomorrow (9–12)", value: "TW_tomorrow_morning" },
          { label: "Tomorrow (12–3)", value: "TW_tomorrow_afternoon" },
          { label: "This week (3–6)", value: "TW_week_evening" },
        ]);
        state.step = "BOOK_TIME";
        return;
      }

      case "BOOK_TIME": {
        if (!raw.startsWith("TW_")) {
          addBubble("Tap a time window button.", "bot");
          return;
        }
        state.lead.preferred_time_window = raw.replace("TW_", "");

        addBubble("What’s your phone number?", "bot");
        setQuickButtons([]);
        setHint("We’ll confirm the appointment.");
        state.step = "BOOK_PHONE";
        return;
      }

      case "BOOK_PHONE": {
        const p = normalizePhone(raw);
        if (!p) {
          addBubble("Please enter a 10-digit phone number.", "bot");
          return;
        }
        state.lead.phone = p;
        state.lead.contact_preference = "text";
        state.lead.text_consent = true;

        addBubble("What’s your name?", "bot");
        state.step = "BOOK_NAME";
        return;
      }

      case "BOOK_NAME": {
        state.lead.name = raw;

        addBubble("Here’s your booking request. Submit?", "bot");
        addBubble(summaryText(), "bot");
        setQuickButtons([
          { label: "Submit", value: "SUBMIT" },
          { label: "Start over", value: "RESTART" },
        ]);
        state.step = "CONFIRM";
        return;
      }

      default: {
        addBubble("Let’s start over.", "bot");
        handleUser("RESTART", true);
      }
    }
  }

  // input events
  $send.onclick = () => {
    const v = $input.value;
    $input.value = "";
    handleUser(v, false);
  };
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = $input.value;
      $input.value = "";
      handleUser(v, false);
    }
  });
})();
