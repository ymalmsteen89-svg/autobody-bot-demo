// netlify/functions/new-lead.ts
import type { Handler } from "@netlify/functions";

type LeadIntent =
  | "estimate"
  | "book_inspection"
  | "tow_help"
  | "automotive_quote"
  | "contact"; // NEW

type LeadPayload = {
  // routing / attribution
  source?: string;
  leadType?: "contact" | "chatbot" | string; // NEW (from landing page)
  page?: string; // NEW
  intent?: LeadIntent; // now optional because contact form may not send it

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
  service_type?: string; // e.g. "brakes"
  quote_estimate?: string; // e.g. "$350–$900"
  symptoms?: string; // free text

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

  // freeform metadata from widget / landing page
  meta?: Record<string, unknown>;
  activeDemoId?: string; // NEW (from landing page)
  activeDemoKind?: string; // NEW (from landing page)
};

// --- helpers ---
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

function isJsonContentType(ct?: string) {
  return !!ct && ct.toLowerCase().includes("application/json");
}

function isUrlEncodedContentType(ct?: string) {
  return !!ct && ct.toLowerCase().includes("application/x-www-form-urlencoded");
}

/**
 * Parse payload from either JSON (widget) or urlencoded form (fallback).
 * Note: multipart/form-data is intentionally NOT supported here because the landing page
 * submit uses JSON fetch (recommended). If you later need multipart, switch the form to JSON
 * or add a dedicated multipart parser.
 */
function parsePayload(event: Parameters<Handler>[0]): LeadPayload | null {
  const ct = event.headers?.["content-type"] || event.headers?.["Content-Type"];

  // JSON
  if (isJsonContentType(ct)) {
    try {
      return JSON.parse(event.body || "{}");
    } catch {
      return null;
    }
  }

  // urlencoded (fallback / manual tests)
  if (isUrlEncodedContentType(ct)) {
    try {
      const params = new URLSearchParams(event.body || "");
      const obj: Record<string, any> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      return obj as LeadPayload;
    } catch {
      return null;
    }
  }

  // If no content-type, try JSON first
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return null;
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(500, { error: "Missing Supabase env vars" });
  }

  const payload = parsePayload(event);
  if (!payload) return json(400, { error: "Invalid request body" });

  // ---- ROUTING: contact vs widget lead ----
  // Landing page sends leadType=contact; widget sends intent and usually no leadType.
  const leadType = (payload.leadType || "").toLowerCase();
  const isContact = leadType === "contact" || payload.intent === "contact";

  // For contact messages, we don't require ZIP or vehicle info.
  // We DO require name + email (email is the most reliable for a contact form).
  if (isContact) {
    const name = clean(payload.name);
    const email = clean(payload.email);

    // Accept phone if they provide it, but do not require it.
    const phone = normalizePhone(payload.phone);

    if (!name) return json(400, { error: "Name is required" });
    if (!email) return json(400, { error: "Email is required" });

    // Map contact message into existing leads schema (no schema change)
    const record = {
      source: payload.source || "demo-hub",
      intent: "contact",
      status: "new",

      // Keep these blank for contact
      drivable: null,
      insurance: null,
      claim_number: null,

      vehicle_year: null,
      vehicle_make: null,
      vehicle_model: null,
      vin: null,

      damage_areas: [],
      incident_description: null,
      zip: null,

      contact_preference: "email",
      name,
      phone: phone ?? null,
      email,
      text_consent: false,

      photo_urls: [],
      preferred_next_step: null,
      preferred_time_window: null,

      // Put message + page + active demo context in notes/meta
      notes: clean(payload.message) ?? clean(payload.notes) ?? null,
      meta: {
        ...(payload.meta || {}),
        leadType: "contact",
        page: clean(payload.page) ?? null,
        activeDemoId: clean(payload.activeDemoId) ?? null,
        activeDemoKind: clean(payload.activeDemoKind) ?? null,
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
      return json(200, { ok: true, routed: "contact", lead: inserted?.[0] || inserted });
    } catch (err: any) {
      return json(500, { error: "Server error", details: String(err?.message || err) });
    }
  }

  // ---- Existing widget lead flow (intent required) ----
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
      automotive:
        payload.intent === "automotive_quote"
          ? {
              service_type: clean(payload.service_type) ?? null,
              quote_estimate: clean(payload.quote_estimate) ?? null,
              symptoms: clean(payload.symptoms) ?? null,
            }
          : undefined,
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
    return json(200, { ok: true, routed: "lead", lead: inserted?.[0] || inserted });
  } catch (err: any) {
    return json(500, { error: "Server error", details: String(err?.message || err) });
  }
};
