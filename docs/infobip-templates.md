# Infobip WhatsApp Templates

The app's WhatsApp template copy — defined in code and registered through
Infobip's API, no portal typing needed. The tracking cron
(`apps/admin/src/lib/tracking/run-slot.ts`) sends the tracking template to
drivers via `sendWhatsAppTemplate()` (`apps/admin/src/lib/chats/infobip.ts`).

**Source of truth:** `apps/admin/scripts/infobip-templates.mjs` holds the
registrable copy; this doc mirrors it for readability. WhatsApp requires
every business-initiated message to be a **Meta-approved template**, so the
template must exist (and be approved) on Infobip's side before sends work —
"template in code" means the definition lives in the repo and the script
pushes it:

```bash
node apps/admin/scripts/infobip-templates.mjs
```

```bash
node apps/admin/scripts/infobip-templates.mjs --apply
```

The first is a dry run listing what exists (and flags copy drift as "would
update"); `--apply` registers what is missing and PATCHes drifted templates
in place. Either way the change goes through Meta approval (status shows on
later runs). Edits to approved templates are rate-limited by Meta: at most
1 per 24h and 10 per 30 days per template.

## How the location call-to-action works

WhatsApp **templates cannot open the location picker directly** — template
buttons are limited to quick reply / URL / phone call. The native
"Send location" button only exists on WhatsApp's *interactive location request*
message, which is a session message (allowed only inside the 24-hour window
after the driver's last reply). So there are two paths:

- **One step (open session — the common case):** when the driver's last
  inbound message is younger than ~23h, the cron skips the template and
  sends the location request directly. Drivers who answer their twice-daily
  pings keep the window open continuously, so they always get the one-tap
  native **Send location** button. Only attempt 1 takes this shortcut.
- **Two steps (cold or silent conversations):**
  1. **Template** (business-initiated, works any time): body + one **quick
     reply button** "Partilhar localização". Tapping the button counts as a
     reply and opens the 24-hour session window.
  2. **Location request** (session message, sent by our webhook the moment
     the button tap arrives): shows WhatsApp's native **Send location**
     button, which opens the phone's location picker. The button label is
     rendered by WhatsApp in the device language — we only provide the body
     text.

## 1. Tracking template — driver location request

Sent up to 3 times per slot (08:00 and 17:00 Maputo) asking the driver to
share their current location for an active order.

| Field | Value |
| --- | --- |
| Suggested name | `appload_tracking_location_request` |
| Category | UTILITY |
| Structure | Body + 1 quick reply button (no header, no footer) |
| Body placeholders | Exactly 5, positional |
| Languages | Register the same name in `pt_PT` and `en` |

### Body placeholders

| Placeholder | Value sent by code | Example |
| --- | --- | --- |
| `{{1}}` | Driver name (falls back to `motorista` when missing) | `João Macuácua` |
| `{{2}}` | Order ID | `APPL021.26` |
| `{{3}}` | Truck plate (falls back to `—` when missing) | `AEL-467-MC` |
| `{{4}}` | Origin, state level (`loadingAddress.state`, else first address segment) | `Maputo` |
| `{{5}}` | Destination, state level (same rule on `offloadingAddress`) | `Tete` |

### Portuguese (`pt_PT`)

Body:

```
Olá {{1}}, a Appload precisa que partilhe a sua localização atual para a carga {{2}} — camião {{3}}, de {{4}} para {{5}}. Envie a localização como anexo (📎 → Localização) ou toque no botão abaixo.
```

Quick reply button:

```
Partilhar localização
```

### English (`en`)

Body:

```
Hello {{1}}, Appload needs you to share your current location for load {{2}} — truck {{3}}, from {{4}} to {{5}}. Send your location as an attachment (📎 → Location) or tap the button below.
```

Quick reply button:

```
Share location
```

## 2. Location request message (not registered in Infobip)

Sent by our code as a session message — directly by the cron when the
driver's session window is open, or right after the driver taps the button
(Infobip endpoint `/whatsapp/1/message/interactive/location-request`).
WhatsApp adds the native **Send location** button itself. Body text only;
the route detail in parentheses appears when the caller has the order row
(the cron path) and is omitted on the webhook path, which only knows the
order id from the button payload:

Portuguese:

```
Toque em "Enviar localização" abaixo para partilhar a sua localização atual para a carga {orderId} (camião {truckPlate}, de {origin} para {destination}).
```

English:

```
Tap "Send location" below to share your current location for load {orderId} (truck {truckPlate}, from {origin} to {destination}).
```

## How the code drives the flow (implemented)

- Before sending, the cron checks the conversation for an inbound message
  younger than 23h (`hasOpenSession()` in `run-slot.ts`). Open session +
  attempt 1 → `sendWhatsAppLocationRequest()` directly; otherwise the
  template goes out and the two-step flow below applies.
- The cron send passes the button's postback parameter
  `share-location:<orderId>` (`shareLocationPayload()` in
  `lib/chats/infobip.ts`, used by `run-slot.ts`) — required by WhatsApp for
  every send of a template that carries a quick-reply button.
- The webhook (`/api/chats/infobip/route.ts`) recognizes the button tap
  (inbound type `BUTTON`, payload prefix `share-location`) and immediately
  answers with message 2 via `sendWhatsAppLocationRequest()`. The tap does
  **not** close the tracking request.
- `parseInboundWebhook()` parses location pins (type `LOCATION`) into
  coordinates and stores them in the chat thread as a Google Maps link; a
  location — or any typed reply — flips the open tracking requests to
  `responded`, which stops further attempts.

## After registration: env vars

Both values must match the Infobip portal **exactly**, or the send fails with
a 400:

```
INFOBIP_TRACKING_TEMPLATE=appload_tracking_location_request
INFOBIP_TRACKING_TEMPLATE_LANGUAGE=pt_PT
```

Note: the code defaults the language to `pt` when the env var is unset, but
WhatsApp only accepts full locale codes for Portuguese (`pt_PT` / `pt_BR`) —
always set the env var to the code you registered. Only one language is sent
at a time; to switch drivers to English, change the env var to `en`.

## SMS fallback (no registration needed)

The third attempt escalates to SMS with a hardcoded string in `run-slot.ts`
(`smsText`). SMS has no buttons, so it stays a plain instruction:

```
Ola {driverName}, a Appload pede a sua localizacao atual para a carga {orderId} (camiao {truckPlate}, {origin} para {destination}). Por favor responda a esta mensagem com a sua localizacao.
```

The hardcoded part is deliberately unaccented ASCII so it leans on GSM-7
encoding — do not "fix" the accents (place names from the database may still
carry theirs), and it does not need an Infobip template.
