// netlify/functions/new-lead.ts
import type { Handler } from "@netlify/functions";

type LeadIntent = "estimate" | "book_inspection" | "tow_help" | "automotive_quote";

type LeadPayload = {
  source?: string;
  intent: LeadIntent;

  // auto-body
  drivable?: "yes" | "no" | "not_sure";
  insurance?: "yes" | "no" | "not_sure";
  claim_number?: string;

  // shared vehicle fields
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vin?: string;

  // auto-body
  damage_areas?: string[];
  incident_description?: string;

  // shared
  zip?: string;

  // wesbecker / automotive demo fields (we store in meta to avoid schema changes)
  service_type?: string;       // e.g. "brakes"
  quote_estimate?: string;     // e.g. "$350–$900"
  symptoms?: string;           // free text

  // contact
  contact_preference?: "text" | "call" | "email";
  name?: string;
  phone?: string;
  email?: string;
  text_consent?: boolean;

  // optional
  photo_urls?: string[];

  // booking-ish
  preferred_next_step?: "book_inspection" | "call_back";
  preferred_time_window?: string;
  notes?: string;

  // freeform metadata from widget
  meta?: Record<string, unknown>;
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function isValidZip(zip?: string) {
  return !!zip && /^[0-9]{5}$/.test(zip);
}

function normalizePhone(phone?: string) {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return undefined;
}

function clean(s?: string) {
  const v = (s ?? "").trim();
  return v.length ? v : undefined;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: "Missing Supabase env vars" });
  }

  let payload: LeadPayload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  if (!payload.intent) return json(400, { error: "Missing intent" });

  // --- Normalize / validate contact ---
  const contactPref = payload.contact_preference || "text";
  const phone = normalizePhone(payload.phone);
  const email = clean(payload.email);

  if (contactPref === "email") {
    if (!email) return json(400, { error: "Email required when contact preference is email" });
  } else {
    if (!phone) return json(400, { error: "Valid 10-digit phone required for text/call" });
  }

  // --- ZIP validation (required for estimate + automotive_quote; optional for other paths) ---
  if (payload.intent === "estimate" || payload.intent === "automotive_quote") {
    if (!isValidZip(payload.zip)) return json(400, { error: "Valid 5-digit ZIP required" });
  } else if (payload.zip && !isValidZip(payload.zip)) {
    return json(400, { error: "Invalid ZIP" });
  }

  // --- intent-specific validation ---
  if (payload.intent === "estimate") {
    if (!payload.vehicle_year || !payload.vehicle_make || !payload.vehicle_model) {
      return json(400, { error: "Vehicle year/make/model required for estimate" });
    }
    // damage areas can be empty if they typed everything, but usually required
    // We'll allow empty but encourage selection in UI.
  }

  if (payload.intent === "automotive_quote") {
    // Wesbecker Subaru flow: require year+model
    if (!clean(payload.vehicle_year) || !clean(payload.vehicle_model)) {
      return json(400, { error: "Vehicle year and model required for automotive quote" });
    }
    // Make defaults if missing
    payload.vehicle_make = payload.vehicle_make || "Subaru";
  }

  // --- Build record for Supabase ---
  // IMPORTANT: keep schema-compatible fields only.
  // We store automotive extras inside meta to avoid needing new columns.
  const record = {
    source: payload.source || "website-chat",
    intent: payload.intent,
    status: "new",

    drivable: payload.drivable ?? null,
    insurance: payload.insurance ?? null,
    claim_number: clean(payload.claim_number) ?? null,

    vehicle_year: clean(payload.vehicle_year) ?? null,
    vehicle_make: clean(payload.vehicle_make) ?? null,
    vehicle_model: clean(payload.vehicle_model) ?? null,
    vin: clean(payload.vin) ?? null,

    damage_areas: payload.damage_areas || [],
    incident_description: clean(payload.incident_description) ?? null,
    zip: clean(payload.zip) ?? null,

    contact_preference: contactPref,
    name: clean(payload.name) ?? null,
    phone: phone ?? null,
    email: email ?? null,
    text_consent: !!payload.text_consent,

    photo_urls: payload.photo_urls || [],

    preferred_next_step: payload.preferred_next_step ?? null,
    preferred_time_window: payload.preferred_time_window ?? null,
    notes: clean(payload.notes) ?? null,

    meta: {
      ...(payload.meta || {}),
      // tuck automotive fields into meta safely
      automotive: payload.intent === "automotive_quote" ? {
        service_type: clean(payload.service_type) ?? null,
        quote_estimate: clean(payload.quote_estimate) ?? null,
        symptoms: clean(payload.symptoms) ?? null,
      } : undefined,
    },
  };

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(record),
    });

    const text = await resp.text();
    if (!resp.ok) {
      return json(resp.status, { error: "Supabase insert failed", details: text });
    }

    const inserted = JSON.parse(text);
    return json(200, { ok: true, lead: inserted?.[0] || inserted });
  } catch (err: any) {
    return json(500, { error: "Server error", details: String(err?.message || err) });
  }
};
