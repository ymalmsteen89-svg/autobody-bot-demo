// widget/widget.js
(() => {
  const cfg = window.CRASH_CONCIERGE_CONFIG || {};
  const shopName = cfg.shopName || "Auto Body Shop";
  const phoneNumber = cfg.phoneNumber || "";
  const apiUrl = cfg.apiUrl || "/.netlify/functions/new-lead";
  const accent = cfg.brandAccent || "#d40000";

  const state = {
    step: "WELCOME",
    lead: {
      source: "website-chat",
      intent: null, // estimate | book_inspection | tow_help

      drivable: null, // yes | no | not_sure
      insurance: null, // yes | no | not_sure
      claim_number: "",

      vehicle_year: "",
      vehicle_make: "",
      vehicle_model: "",
      vin: "",

      damage_areas: [],
      incident_description: "",
      zip: "",

      contact_preference: "text", // text | call | email
      name: "",
     phone: "",
      email: "",
      text_consent: true,

      photo_urls: [],

      preferred_next_step: null, // book_inspection | call_back
      preferred_time_window: null,
      notes: "",

      meta: { demo: true, user_agent: navigator.userAgent },
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
        <div id="cc-title">${shopName} · Crash Concierge</div>
        <div id="cc-subtitle">Estimates + inspections in minutes</div>
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

  // ✅ iPhone-safe: #cc-quick is scroll container; inner row is inline-flex nowrap
  function setQuickButtons(buttons) {
    $quick.innerHTML = "";

    const row = document.createElement("div");
    row.className = "cc-quick-row";

    (buttons || []).forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "cc-btn";
      btn.textContent = b.label;

      // ✅ sticky action buttons for DAMAGE selection
      if (b.value === "DMG_DONE") btn.classList.add("cc-sticky-done");
      if (b.value === "DMG_CLEAR") btn.classList.add("cc-sticky-clear");

      btn.onclick = () => handleUser(b.value, true);
      row.appendChild(btn);
    });

    $quick.appendChild(row);

    // If the row contains sticky buttons, nudge scroll toward the right
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
    panel.style.display = "block";
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

      contact_preference: "text",
      name: "",
      phone: "",
      email: "",
      text_consent: true,

      photo_urls: [],

      preferred_next_step: null,
      preferred_time_window: null,
      notes: "",

      meta: { demo: true, user_agent: navigator.userAgent },
    };
  }

  function summaryText() {
    const L = state.lead;
    const lines = [];
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
    if (L.intent === "book_inspection") {
      lines.push(`Vehicle: ${[L.vehicle_year, L.vehicle_make, L.vehicle_model].filter(Boolean).join(" ") || "-"}`);
      lines.push(`Time window: ${L.preferred_time_window || "-"}`);
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

      addBubble("✅ You’re in. We’ll confirm the next step ASAP.\n\nWant a copy of your summary here?", "bot");
      setQuickButtons([
        { label: "Show summary", value: "SHOW_SUMMARY" },
        { label: "Start over", value: "RESTART" },
      ]);
      setHint("Demo tip: this is where you’d trigger SMS/email notifications.");
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

  // ---------- State Machine ----------
  function start() {
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

  function handleUser(text, fromButton = false) {
    const raw = (text || "").trim();
    if (!raw) return;

    if (!fromButton) addBubble(raw, "user");

    // Global
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

    switch (state.step) {
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
        // Keep Done/Clear accessible on iPhone
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

        setHint(`Selected: ${(state.lead.damage_areas || []).map(prettyKey).join(", ") || "(none)"} · Tap Done when finished.`);
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

        addBubble("Want to book a free inspection time now?", "bot");
        setQuickButtons([
          { label: "Yes, book a time", value: "NEXT_BOOK" },
          { label: "Request a call back", value: "NEXT_CALLBACK" },
        ]);
        setHint("");
        state.step = "NEXT_STEP";
        return;
      }

      case "NEXT_STEP": {
        if (raw === "NEXT_BOOK") {
          state.lead.preferred_next_step = "book_inspection";
          addBubble("Pick a time window:", "bot");
          setQuickButtons([
            { label: "Today (9–12)", value: "TW_today_morning" },
            { label: "Today (12–3)", value: "TW_today_afternoon" },
            { label: "Tomorrow (9–12)", value: "TW_tomorrow_morning" },
            { label: "Tomorrow (12–3)", value: "TW_tomorrow_afternoon" },
            { label: "This week (3–6)", value: "TW_week_evening" },
          ]);
          state.step = "TIME_WINDOW";
          return;
        }

        if (raw === "NEXT_CALLBACK") {
          state.lead.preferred_next_step = "call_back";
          addBubble("When’s best for a quick call?", "bot");
          setQuickButtons([
            { label: "Morning", value: "CB_morning" },
            { label: "Afternoon", value: "CB_afternoon" },
            { label: "Evening", value: "CB_evening" },
          ]);
          state.step = "CALLBACK";
          return;
        }

        addBubble("Choose booking or call back:", "bot");
        setQuickButtons([
          { label: "Yes, book a time", value: "NEXT_BOOK" },
          { label: "Request a call back", value: "NEXT_CALLBACK" },
        ]);
        return;
      }

      case "TIME_WINDOW": {
        if (!raw.startsWith("TW_")) {
          addBubble("Tap a time window button.", "bot");
          return;
        }
        state.lead.preferred_time_window = raw.replace("TW_", "");

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

      case "CALLBACK": {
        if (!raw.startsWith("CB_")) {
          addBubble("Tap a button for morning/afternoon/evening.", "bot");
          return;
        }
        state.lead.preferred_time_window = raw.replace("CB_", "");

        addBubble("Here’s what I’ve got. Looks good?", "bot");
        addBubble(summaryText(), "bot");
        setQuickButtons([
          { label: "Submit", value: "SUBMIT" },
          { label: "Start over", value: "RESTART" },
        ]);
        state.step = "CONFIRM";
        return;
      }

      // Booking-only path
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

      case "CONFIRM": {
        if (raw === "SUBMIT") {
          submitLead();
          return;
        }
        addBubble("Tap Submit or Start over.", "bot");
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
