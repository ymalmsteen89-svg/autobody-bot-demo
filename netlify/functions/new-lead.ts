// netlify/functions/new-lead.ts
import type { Handler } from "@netlify/functions";

type LeadPayload = {
  source?: string;
  intent: "estimate" | "book_inspection" | "tow_help";

  drivable?: "yes" | "no" | "not_sure";
  insurance?: "yes" | "no" | "not_sure";
  claim_number?: string;

  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vin?: string;

  damage_areas?: string[];
  incident_description?: string;
  zip?: string;

  contact_preference?: "text" | "call" | "email";
  name?: string;
  phone?: string;
  email?: string;
  text_consent?: boolean;

  photo_urls?: string[];

  preferred_next_step?: "book_inspection" | "call_back";
  preferred_time_window?: string;
  notes?: string;

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

  // Basic validation for “contactable” leads
  const phone = normalizePhone(payload.phone);
  const email = payload.email?.trim() || undefined;

  if (payload.contact_preference === "email") {
    if (!email) return json(400, { error: "Email required" });
  } else {
    if (!phone) return json(400, { error: "Valid 10-digit phone required for text/call" });
  }

  if (payload.zip && !isValidZip(payload.zip)) {
    return json(400, { error: "Invalid ZIP" });
  }

  const record = {
    source: payload.source || "website-chat",
    intent: payload.intent,
    status: "new",

    drivable: payload.drivable,
    insurance: payload.insurance,
    claim_number: payload.claim_number?.trim() || null,

    vehicle_year: payload.vehicle_year?.trim() || null,
    vehicle_make: payload.vehicle_make?.trim() || null,
    vehicle_model: payload.vehicle_model?.trim() || null,
    vin: payload.vin?.trim() || null,

    damage_areas: payload.damage_areas || [],
    incident_description: payload.incident_description?.trim() || null,
    zip: payload.zip?.trim() || null,

    contact_preference: payload.contact_preference || null,
    name: payload.name?.trim() || null,
    phone: phone || null,
    email: email || null,
    text_consent: !!payload.text_consent,

    photo_urls: payload.photo_urls || [],

    preferred_next_step: payload.preferred_next_step || null,
    preferred_time_window: payload.preferred_time_window || null,
    notes: payload.notes?.trim() || null,

    meta: payload.meta || {},
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
